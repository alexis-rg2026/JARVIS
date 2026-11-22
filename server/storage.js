import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const DERIVED_KEY_LENGTH = 64
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const MAX_MEMORIES = 500
const MAX_ACTIVITY_EVENTS = 200

function deriveKeys(password, salt) {
  const derived = scryptSync(password, salt, DERIVED_KEY_LENGTH, SCRYPT_OPTIONS)
  return {
    verifier: derived.subarray(0, 32),
    encryptionKey: derived.subarray(32),
  }
}

function encrypt(key, value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  })
}

function decrypt(key, payload) {
  const encrypted = JSON.parse(payload)
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plaintext)
}

function normalizeLabel(label) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
}

function toMemory(row, key) {
  const value = decrypt(key, row.encrypted_value)
  return {
    id: row.id,
    category: row.category,
    label: value.label,
    value: value.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createStorage(databasePath = ':memory:') {
  const db = new DatabaseSync(databasePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('profile', 'preference', 'note')),
      dedupe_key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(category, dedupe_key)
    );
    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'cleared')),
      category TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interaction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK (action IN ('assistant_query', 'web_open', 'file_loaded')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL
    );
  `)

  const getMetadata = db.prepare('SELECT value FROM metadata WHERE key = ?')
  const setMetadata = db.prepare(
    'INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )

  function isConfigured() {
    return Boolean(getMetadata.get('password_salt'))
  }

  function setupPassword(password) {
    if (isConfigured()) {
      throw Object.assign(new Error('JARVIS ya está configurado.'), { status: 409 })
    }

    const salt = randomBytes(16)
    const keys = deriveKeys(password, salt)
    setMetadata.run('password_salt', salt.toString('base64'))
    setMetadata.run('password_verifier', keys.verifier.toString('base64'))
    return keys.encryptionKey
  }

  function authenticate(password) {
    const saltRow = getMetadata.get('password_salt')
    const verifierRow = getMetadata.get('password_verifier')
    if (!saltRow || !verifierRow) return null

    const keys = deriveKeys(password, Buffer.from(saltRow.value, 'base64'))
    const expected = Buffer.from(verifierRow.value, 'base64')
    if (keys.verifier.length !== expected.length || !timingSafeEqual(keys.verifier, expected)) {
      return null
    }
    return keys.encryptionKey
  }

  function listMemories(key) {
    return db
      .prepare('SELECT * FROM memories ORDER BY updated_at DESC')
      .all()
      .map((row) => toMemory(row, key))
  }

  function recordEvent(action, category = null) {
    db.prepare(
      'INSERT INTO memory_events (action, category, created_at) VALUES (?, ?, ?)',
    ).run(action, category, new Date().toISOString())
    db.prepare(`
      DELETE FROM memory_events
      WHERE id NOT IN (
        SELECT id FROM memory_events ORDER BY id DESC LIMIT 200
      )
    `).run()
  }

  function saveMemory(key, memory) {
    const existing = listMemories(key).find(
      (item) =>
        item.category === memory.category &&
        normalizeLabel(item.label) === normalizeLabel(memory.label),
    )
    const now = new Date().toISOString()
    const id = existing?.id ?? randomBytes(16).toString('hex')
    const dedupeKey = createHmac('sha256', key)
      .update(`${memory.category}\0${normalizeLabel(memory.label)}`)
      .digest('hex')

    db.prepare(`
      INSERT INTO memories (id, category, dedupe_key, encrypted_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category, dedupe_key) DO UPDATE SET
        encrypted_value = excluded.encrypted_value,
        updated_at = excluded.updated_at
    `).run(
      id,
      memory.category,
      dedupeKey,
      encrypt(key, { label: memory.label, value: memory.value }),
      existing?.createdAt ?? now,
      now,
    )
    recordEvent(existing ? 'updated' : 'created', memory.category)
    return listMemories(key).find((item) => item.id === id)
  }

  function updateMemory(key, id, memory) {
    const old = db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
    if (!old) return null

    const dedupeKey = createHmac('sha256', key)
      .update(`${memory.category}\0${normalizeLabel(memory.label)}`)
      .digest('hex')
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE memories
      SET category = ?, dedupe_key = ?, encrypted_value = ?, updated_at = ?
      WHERE id = ?
    `).run(
      memory.category,
      dedupeKey,
      encrypt(key, { label: memory.label, value: memory.value }),
      now,
      id,
    )
    recordEvent('updated', memory.category)
    return listMemories(key).find((item) => item.id === id)
  }

  function deleteMemory(key, id) {
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
    if (!row) return false
    db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    recordEvent('deleted', row.category)
    return true
  }

  function listEvents() {
    return db
      .prepare(`
        SELECT action, category, created_at AS createdAt, 'memory' AS source
        FROM memory_events
        UNION ALL
        SELECT action, NULL AS category, created_at AS createdAt, 'interaction' AS source
        FROM interaction_events
        ORDER BY createdAt DESC, source ASC LIMIT 100
      `)
      .all()
  }

  function recordInteraction(action) {
    db.prepare(
      'INSERT INTO interaction_events (action, created_at) VALUES (?, ?)',
    ).run(action, new Date().toISOString())
    db.prepare(`
      DELETE FROM interaction_events
      WHERE id NOT IN (
        SELECT id FROM interaction_events ORDER BY id DESC LIMIT ?
      )
    `).run(MAX_ACTIVITY_EVENTS)
  }

  function loadChat(key) {
    const row = db.prepare('SELECT encrypted_value FROM app_state WHERE key = ?').get('chat')
    return row ? decrypt(key, row.encrypted_value) : []
  }

  function saveChat(key, messages) {
    db.prepare(`
      INSERT INTO app_state (key, encrypted_value) VALUES ('chat', ?)
      ON CONFLICT(key) DO UPDATE SET encrypted_value = excluded.encrypted_value
    `).run(encrypt(key, messages))
  }

  function clearAll() {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM memories; DELETE FROM memory_events; DELETE FROM interaction_events; DELETE FROM app_state;')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function close() {
    db.close()
  }

  function canAddMemory(key) {
    return listMemories(key).length < MAX_MEMORIES
  }

  return {
    authenticate,
    canAddMemory,
    clearAll,
    close,
    deleteMemory,
    isConfigured,
    listEvents,
    listMemories,
    loadChat,
    recordInteraction,
    saveChat,
    saveMemory,
    setupPassword,
    updateMemory,
  }
}
