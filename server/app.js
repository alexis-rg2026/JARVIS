import { randomBytes } from 'node:crypto'
import express from 'express'

const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const SESSION_COOKIE = 'jarvis_session'
const ALLOWED_CATEGORIES = new Set(['profile', 'preference', 'note'])
const ALLOWED_INTERACTIONS = new Set(['assistant_query', 'web_open', 'file_loaded'])

function apiError(status, message) {
  return Object.assign(new Error(message), { status })
}

function readCookie(request) {
  const cookies = request.headers.cookie?.split(';') ?? []
  const entry = cookies.find((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`))
  return entry ? decodeURIComponent(entry.trim().slice(SESSION_COOKIE.length + 1)) : null
}

function validateMemory(body) {
  const category = body?.category
  const label = typeof body?.label === 'string' ? body.label.trim() : ''
  const value = typeof body?.value === 'string' ? body.value.trim() : ''

  if (!ALLOWED_CATEGORIES.has(category)) {
    throw apiError(400, 'Selecciona una categoría válida.')
  }
  if (!label || label.length > 80 || !value || value.length > 1000) {
    throw apiError(400, 'El dato debe tener una etiqueta y un valor válidos.')
  }
  return { category, label, value }
}

function validateMessages(body) {
  if (!Array.isArray(body?.messages) || body.messages.length > 200) {
    throw apiError(400, 'El historial no tiene un formato válido.')
  }
  return body.messages.map((message) => {
    if (
      !message ||
      !['jarvis', 'usuario'].includes(message.tipo) ||
      typeof message.texto !== 'string' ||
      message.texto.length > 2000
    ) {
      throw apiError(400, 'El historial contiene un mensaje no válido.')
    }
    return { tipo: message.tipo, texto: message.texto }
  })
}

export function createApp(storage, options = {}) {
  const app = express()
  const sessions = new Map()
  const loginAttempts = new Map()
  const fetchUpstream = options.fetch ?? globalThis.fetch
  const allowedOrigins = new Set(options.allowedOrigins ?? [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
  ])

  app.disable('x-powered-by')
  app.use('/api', (request, response, next) => {
    const origin = request.get('origin')
    if (origin && !allowedOrigins.has(origin)) {
      next(apiError(403, 'Origen no autorizado.'))
      return
    }
    next()
  })
  app.use('/api', express.json({ limit: '80kb' }))

  function createSession(response, key) {
    const token = randomBytes(32).toString('hex')
    sessions.set(token, { key, expiresAt: Date.now() + SESSION_TTL_MS })
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      maxAge: SESSION_TTL_MS,
    })
  }

  function requireSession(request, response, next) {
    const token = readCookie(request)
    const session = token && sessions.get(token)
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessions.delete(token)
      next(apiError(401, 'Inicia sesión para acceder a la memoria de JARVIS.'))
      return
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS
    request.memorySession = session
    request.sessionToken = token
    next()
  }

  app.get('/api/status', (request, response) => {
    const session = sessions.get(readCookie(request))
    response.json({
      configured: storage.isConfigured(),
      authenticated: Boolean(session && session.expiresAt > Date.now()),
    })
  })

  app.post('/api/setup', (request, response, next) => {
    try {
      const password = request.body?.password
      if (storage.isConfigured()) {
        throw apiError(409, 'JARVIS ya está configurado. Inicia sesión.')
      }
      if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
        throw apiError(400, 'La contraseña debe tener entre 12 y 256 caracteres.')
      }
      const key = storage.setupPassword(password)
      createSession(response, key)
      response.status(201).json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/login', (request, response, next) => {
    try {
      const ip = request.ip
      const attempt = loginAttempts.get(ip)
      if (attempt && attempt.blockedUntil > Date.now()) {
        throw apiError(429, 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.')
      }

      const password = request.body?.password
      const key = typeof password === 'string' ? storage.authenticate(password) : null
      if (!key) {
        const nextAttempt = attempt && attempt.blockedUntil <= Date.now()
          ? { count: 0, blockedUntil: 0 }
          : attempt ?? { count: 0, blockedUntil: 0 }
        nextAttempt.count += 1
        if (nextAttempt.count >= 5) {
          nextAttempt.blockedUntil = Date.now() + 60_000
          nextAttempt.count = 0
        }
        loginAttempts.set(ip, nextAttempt)
        throw apiError(401, 'Contraseña incorrecta.')
      }

      loginAttempts.delete(ip)
      createSession(response, key)
      response.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/logout', (request, response) => {
    const token = readCookie(request)
    if (token) sessions.delete(token)
    response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', path: '/api' })
    response.json({ ok: true })
  })

  app.use('/api', requireSession)

  app.post('/api/assistant', async (request, response, next) => {
    try {
      const { provider, model, apiKey, systemPrompt, messages } = request.body ?? {}
      const grounded = request.body?.grounded === true
      if (!['gemini', 'openai'].includes(provider)) {
        throw apiError(400, 'Selecciona un proveedor de IA válido.')
      }
      if (request.body?.grounded !== undefined && typeof request.body.grounded !== 'boolean') {
        throw apiError(400, 'El modo de búsqueda no es válido.')
      }
      if (grounded && provider !== 'gemini') {
        throw apiError(400, 'La búsqueda fundamentada requiere Google Gemini.')
      }
      if (
        typeof apiKey !== 'string' ||
        apiKey.length < 10 ||
        apiKey.length > 300 ||
        typeof model !== 'string' ||
        !/^[a-zA-Z0-9._:-]{1,80}$/.test(model)
      ) {
        throw apiError(400, 'La clave o el modelo no tienen un formato válido.')
      }
      if (
        typeof systemPrompt !== 'string' ||
        systemPrompt.length > 1500 ||
        !Array.isArray(messages) ||
        messages.length < 1 ||
        messages.length > 12 ||
        messages.some((message) =>
          !message ||
          !['user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string' ||
          message.content.length > 30000
        )
      ) {
        throw apiError(400, 'El mensaje o el contexto de la conversación no es válido.')
      }

      const endpoint = provider === 'gemini'
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
        : 'https://api.openai.com/v1/chat/completions'
      const headers = { 'Content-Type': 'application/json' }
      let payload

      if (provider === 'gemini') {
        headers['x-goog-api-key'] = apiKey
        payload = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
          generationConfig: { temperature: 0.7, maxOutputTokens: 900 },
        }
      } else {
        headers.Authorization = `Bearer ${apiKey}`
        payload = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          max_tokens: 900,
          temperature: 0.7,
        }
      }

      let upstream
      try {
        upstream = await fetchUpstream(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          throw apiError(504, 'El proveedor de IA tardó demasiado en responder.')
        }
        throw apiError(502, 'No se pudo conectar con el proveedor de IA.')
      }

      let result
      try {
        result = await upstream.json()
      } catch {
        throw apiError(502, 'El proveedor de IA devolvió una respuesta no válida.')
      }
      if (!upstream.ok) {
        const message = upstream.status === 401 || upstream.status === 403
          ? 'El proveedor rechazó la API Key. Verifíquela en Perfil.'
          : upstream.status === 429
            ? 'El proveedor de IA alcanzó su límite de solicitudes. Inténtelo más tarde.'
            : `El proveedor de IA rechazó la solicitud (${upstream.status}).`
        throw apiError(502, message)
      }

      const candidate = result.candidates?.[0]
      let text = provider === 'gemini'
        ? candidate?.content?.parts?.map((part) => part.text || '').join('').trim()
        : result.choices?.[0]?.message?.content?.trim()
      if (!text) throw apiError(502, 'El proveedor de IA no devolvió texto.')
      if (grounded) {
        const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
          .map((chunk) => chunk.web)
          .filter((web) => {
            if (typeof web?.uri !== 'string' || typeof web?.title !== 'string') return false
            try {
              return new URL(web.uri).protocol === 'https:'
            } catch {
              return false
            }
          })
          .filter((web, index, list) => list.findIndex((item) => item.uri === web.uri) === index)
          .slice(0, 5)
        if (sources.length) {
          text += `\n\nFuentes consultadas:\n${sources.map((source) => `- ${source.title}: ${source.uri}`).join('\n')}`
        }
      }
      response.json({ text })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/memories', (request, response) => {
    response.json(storage.listMemories(request.memorySession.key))
  })

  app.post('/api/memories', (request, response, next) => {
    try {
      const memory = validateMemory(request.body)
      const existing = storage.listMemories(request.memorySession.key).find(
        (item) =>
          item.category === memory.category &&
          item.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es') ===
            memory.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es'),
      )
      if (!existing && !storage.canAddMemory(request.memorySession.key)) {
        throw apiError(409, 'La memoria alcanzó su límite de 500 datos.')
      }
      const saved = storage.saveMemory(request.memorySession.key, memory)
      response.status(existing ? 200 : 201).json(saved)
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/memories/:id', (request, response, next) => {
    try {
      const memory = validateMemory(request.body)
      const updated = storage.updateMemory(request.memorySession.key, request.params.id, memory)
      if (!updated) throw apiError(404, 'No se encontró ese recuerdo.')
      response.json(updated)
    } catch (error) {
      if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') {
        next(apiError(409, 'Ya existe un dato con esa etiqueta en la categoría seleccionada.'))
        return
      }
      next(error)
    }
  })

  app.delete('/api/memories/:id', (request, response) => {
    const deleted = storage.deleteMemory(request.memorySession.key, request.params.id)
    if (!deleted) throw apiError(404, 'No se encontró ese recuerdo.')
    response.json({ ok: true })
  })

  app.get('/api/events', (request, response) => {
    response.json(storage.listEvents())
  })

  app.post('/api/activity', (request, response, next) => {
    try {
      const action = request.body?.action
      if (!ALLOWED_INTERACTIONS.has(action)) {
        throw apiError(400, 'El tipo de actividad no es válido.')
      }
      storage.recordInteraction(action)
      response.status(201).json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/chat', (request, response) => {
    response.json(storage.loadChat(request.memorySession.key))
  })

  app.put('/api/chat', (request, response, next) => {
    try {
      storage.saveChat(request.memorySession.key, validateMessages(request.body))
      response.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/data', (request, response) => {
    storage.clearAll()
    response.json({ ok: true })
  })

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'Ruta de API no encontrada.' })
  })

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error)
      return
    }
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'La solicitud contiene JSON inválido.' })
      return
    }
    const status = Number.isInteger(error.status) ? error.status : 500
    if (status === 500) console.error('Error en la API de JARVIS:', error)
    response.status(status).json({
      error: status === 500 ? 'Ocurrió un error interno. Inténtalo de nuevo.' : error.message,
    })
  })

  return app
}
