import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createApp } from '../server/app.js'
import { createStorage } from '../server/storage.js'

let server
let storage
let baseUrl
let authenticatedCookie
let upstreamFetch = globalThis.fetch

before(async () => {
  storage = createStorage()
  server = createApp(storage, {
    fetch: (...args) => upstreamFetch(...args),
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  storage.close()
})

async function request(path, { cookie, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (cookie) headers.set('Cookie', cookie)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${baseUrl}/api${path}`, { ...options, headers })
  return {
    response,
    body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  }
}

async function login() {
  const setup = await request('/setup', {
    method: 'POST',
    body: JSON.stringify({ password: 'memoria-local-segura-2026' }),
  })
  assert.equal(setup.response.status, 201)
  authenticatedCookie = setup.cookie
  return setup.cookie
}

test('requires authentication and rejects a weak setup password', async () => {
  const privateData = await request('/memories')
  assert.equal(privateData.response.status, 401)

  const weakPassword = await request('/setup', {
    method: 'POST',
    body: JSON.stringify({ password: 'corta' }),
  })
  assert.equal(weakPassword.response.status, 400)
})

test('encrypts stored memory content and updates duplicate labels without duplication', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-memory-test-'))
  const database = path.join(directory, 'memory.sqlite')
  let isolatedStorage = createStorage(database)
  try {
    const key = isolatedStorage.setupPassword('memoria-local-segura-2026')
    const first = isolatedStorage.saveMemory(key, {
      category: 'profile',
      label: 'Nombre completo',
      value: 'Ángela Rodríguez',
    })
    const updated = isolatedStorage.saveMemory(key, {
      category: 'profile',
      label: ' nombre completo ',
      value: 'Ángela María Rodríguez',
    })

    assert.equal(updated.id, first.id)
    assert.equal(isolatedStorage.listMemories(key).length, 1)
    assert.equal(isolatedStorage.listMemories(key)[0].value, 'Ángela María Rodríguez')
    isolatedStorage.close()

    const onDisk = readFileSync(database).toString('utf8')
    assert.equal(onDisk.includes('Ángela María Rodríguez'), false)
    isolatedStorage = createStorage(database)
    const restoredKey = isolatedStorage.authenticate('memoria-local-segura-2026')
    assert.ok(restoredKey)
    assert.equal(isolatedStorage.listMemories(restoredKey)[0].value, 'Ángela María Rodríguez')
  } finally {
    isolatedStorage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('validates, saves, edits and deletes authenticated memories', async () => {
  const cookie = await login()
  const unauthorized = await request('/memories', { method: 'POST' })
  assert.equal(unauthorized.response.status, 401)

  const missingAiKey = await request('/assistant', {
    cookie,
    method: 'POST',
    body: JSON.stringify({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      systemPrompt: 'Responde en español.',
      messages: [{ role: 'user', content: 'Hola' }],
    }),
  })
  assert.equal(missingAiKey.response.status, 400)

  let groundedPayload
  const originalFetch = upstreamFetch
  upstreamFetch = async (url, options) => {
    assert.match(url, /generativelanguage\.googleapis\.com/)
    groundedPayload = JSON.parse(options.body)
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'La fotosíntesis es el proceso por el que las plantas convierten luz en energía química.' }] },
        groundingMetadata: {
          groundingChunks: [
            { web: { title: 'Khan Academy', uri: 'https://www.khanacademy.org/science/biology/photosynthesis-in-plants' } },
            { web: { title: 'Inválido', uri: 'javascript:alert(1)' } },
          ],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const researched = await request('/assistant', {
      cookie,
      method: 'POST',
      body: JSON.stringify({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'test-gemini-api-key',
        systemPrompt: 'Responde en español.',
        grounded: true,
        messages: [{ role: 'user', content: 'Explica la fotosíntesis.' }],
      }),
    })
    assert.equal(researched.response.status, 200)
    assert.match(researched.body.text, /La fotosíntesis es el proceso/)
    assert.match(researched.body.text, /Fuentes consultadas:\n- Khan Academy: https:\/\/www\.khanacademy\.org/)
    assert.doesNotMatch(researched.body.text, /javascript:/)
    assert.deepEqual(groundedPayload.tools, [{ googleSearch: {} }])
    assert.deepEqual(groundedPayload.contents, [{
      role: 'user',
      parts: [{ text: 'Explica la fotosíntesis.' }],
    }])

    const unsupportedGrounding = await request('/assistant', {
      cookie,
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-openai-api-key',
        systemPrompt: 'Responde en español.',
        grounded: true,
        messages: [{ role: 'user', content: 'Explica la fotosíntesis.' }],
      }),
    })
    assert.equal(unsupportedGrounding.response.status, 400)
  } finally {
    upstreamFetch = originalFetch
  }

  const invalid = await request('/memories', {
    cookie,
    method: 'POST',
    body: JSON.stringify({ category: 'unknown', label: '', value: '' }),
  })
  assert.equal(invalid.response.status, 400)

  const added = await request('/memories', {
    cookie,
    method: 'POST',
    body: JSON.stringify({ category: 'preference', label: 'Comida favorita', value: 'Pasta' }),
  })
  assert.equal(added.response.status, 201)

  const duplicate = await request('/memories', {
    cookie,
    method: 'POST',
    body: JSON.stringify({ category: 'preference', label: 'comida FAVORITA', value: 'Sopa' }),
  })
  assert.equal(duplicate.response.status, 200)
  assert.equal(duplicate.body.id, added.body.id)

  const edited = await request(`/memories/${added.body.id}`, {
    cookie,
    method: 'PUT',
    body: JSON.stringify({ category: 'preference', label: 'Comida favorita', value: 'Sopa' }),
  })
  assert.equal(edited.body.value, 'Sopa')

  const deleted = await request(`/memories/${added.body.id}`, { cookie, method: 'DELETE' })
  assert.deepEqual(deleted.body, { ok: true })
  const activity = await request('/events', { cookie })
  assert.deepEqual(activity.body.map((event) => event.action), [
    'deleted',
    'updated',
    'updated',
    'created',
  ])

  const commandEvent = await request('/activity', {
    cookie,
    method: 'POST',
    body: JSON.stringify({ action: 'assistant_query' }),
  })
  assert.equal(commandEvent.response.status, 201)
  const searchedEvent = await request('/activity', {
    cookie,
    method: 'POST',
    body: JSON.stringify({ action: 'assistant_query' }),
  })
  assert.equal(searchedEvent.response.status, 201)
  const invalidEvent = await request('/activity', {
    cookie,
    method: 'POST',
    body: JSON.stringify({ action: 'private_message_content' }),
  })
  assert.equal(invalidEvent.response.status, 400)
  const combinedActivity = await request('/events', { cookie })
  assert.equal(combinedActivity.body.filter((event) => event.action === 'assistant_query').length, 2)
  assert.equal(combinedActivity.body[0].source, 'interaction')

  const missing = await request(`/memories/${added.body.id}`, { cookie, method: 'DELETE' })
  assert.equal(missing.response.status, 404)
})

test('persists encrypted chat, rejects bad login and removes all personal data', async () => {
  const chatCookie = authenticatedCookie
  const invalidLogin = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'incorrecta' }),
  })
  assert.equal(invalidLogin.response.status, 401)

  const validLogin = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'memoria-local-segura-2026' }),
  })
  assert.equal(validLogin.response.status, 200)
  assert.ok(validLogin.cookie)
  const authenticatedStatus = await request('/status', { cookie: validLogin.cookie })
  assert.equal(authenticatedStatus.body.authenticated, true)

  const saved = await request('/chat', {
    cookie: chatCookie,
    method: 'PUT',
    body: JSON.stringify({ messages: [{ tipo: 'jarvis', texto: 'Hola, señor.' }] }),
  })
  assert.equal(saved.response.status, 200)
  const chat = await request('/chat', { cookie: chatCookie })
  assert.deepEqual(chat.body, [{ tipo: 'jarvis', texto: 'Hola, señor.' }])

  const memory = await request('/memories', {
    cookie: chatCookie,
    method: 'POST',
    body: JSON.stringify({ category: 'profile', label: 'Nombre completo', value: 'Ana' }),
  })
  assert.equal(memory.response.status, 201)

  const removed = await request('/data', { cookie: chatCookie, method: 'DELETE' })
  assert.equal(removed.response.status, 200)
  const empty = await request('/memories', { cookie: chatCookie })
  assert.deepEqual(empty.body, [])
  const emptyChat = await request('/chat', { cookie: chatCookie })
  assert.deepEqual(emptyChat.body, [])
  const history = await request('/events', { cookie: chatCookie })
  assert.deepEqual(history.body, [])
})
