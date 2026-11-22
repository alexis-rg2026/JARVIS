import { getWebAction } from './commands.js'

const PROFILE_FIELDS = [
  ['Nombre completo', 'Nombre completo'],
  ['Apodo preferido', 'Apodo preferido'],
  ['Fecha de nacimiento', 'Fecha de nacimiento'],
  ['Ciudad', 'Ciudad'],
  ['País', 'País'],
  ['Profesión u ocupación', 'Profesión'],
  ['Idiomas', 'Idiomas'],
]

const CATEGORY_NAMES = {
  profile: 'Perfil',
  preference: 'Preferencias',
  note: 'Notas',
}

const NAV_ITEMS = [
  { id: 'interact', label: 'INTERACTUAR', icon: '◉' },
  { id: 'profile', label: 'PERFIL', icon: '○' },
  { id: 'memory', label: 'MEMORIA', icon: '◇' },
  { id: 'activity', label: 'ACTIVIDAD', icon: '▤' },
]

const STORAGE_KEYS = {
  provider: 'jarvis-ai-provider',
  model: 'jarvis-ai-model',
  apiKey: 'jarvis-ai-api-key',
  consent: 'jarvis-external-consent',
}

const INITIAL_CHAT = [
  { tipo: 'jarvis', texto: 'J.A.R.V.I.S. está preparado. ¿En qué puedo ayudarle, señor?' },
]

const SYSTEM_PROMPT = [
  'Eres J.A.R.V.I.S., un asistente personal educado, preciso y técnico.',
  'Responde siempre en español, con tono elegante y conciso.',
  'Dirígete al usuario como "señor" cuando resulte natural.',
  'No inventes datos personales ni afirmes haber ejecutado acciones que no realizaste.',
  'Si recibes contenido de un archivo, úsalo únicamente para contestar la pregunta del usuario.',
  'Cuando investigues, explica el concepto en español de forma clara y breve, distingue hechos de incertidumbres y no inventes fuentes.',
].join(' ')

const state = {
  phase: 'loading',
  configured: false,
  view: 'interact',
  memories: [],
  events: [],
  messages: [],
  message: '',
  busy: false,
  listening: false,
  speaking: false,
  editId: null,
  toastTimer: null,
  chatTimer: null,
  file: null,
  loadingEvents: false,
}

const app = document.querySelector('#app')
const toastRegion = document.querySelector('#toast-region')

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Fecha no disponible'
    : date.toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })
}

function calculateAge(value) {
  const birth = new Date(`${value}T00:00:00`)
  if (
    Number.isNaN(birth.getTime()) ||
    birth.toISOString().slice(0, 10) !== value ||
    birth > new Date()
  ) return null

  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age -= 1
  return age
}

function formatMemory(memory) {
  if (normalize(memory.label) === 'fecha de nacimiento') {
    const date = new Date(`${memory.value}T00:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('es-BO', { dateStyle: 'long' })
    }
  }
  return memory.value
}

function notify(message, type = 'success') {
  window.clearTimeout(state.toastTimer)
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status')

  const icon = document.createElement('span')
  icon.className = 'toast-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = type === 'error' ? '!' : '✓'

  const content = document.createElement('span')
  content.textContent = message

  const close = document.createElement('button')
  close.type = 'button'
  close.setAttribute('aria-label', 'Cerrar aviso')
  close.textContent = '×'
  close.addEventListener('click', () => toast.remove())

  toast.append(icon, content, close)
  toastRegion.replaceChildren(toast)
  state.toastTimer = window.setTimeout(() => toast.remove(), 3400)
}

function openExternalPage(url) {
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.referrerPolicy = 'no-referrer'
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers,
    })
  } catch {
    throw new Error('No hay conexión con la API local. Inicie JARVIS con “npm run dev” y mantenga esa ventana abierta.')
  }

  const body = await response.text()
  let result = {}
  if (body) {
    try {
      result = JSON.parse(body)
    } catch {
      if (!response.ok) {
        throw new Error('La API local no está disponible. Inicie JARVIS con “npm run dev” y mantenga esa ventana abierta.')
      }
      throw new Error('La API local devolvió una respuesta no válida.')
    }
  }
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.')
  return result
}

function currentProfileValue(storedLabel) {
  return state.memories.find(
    (memory) =>
      memory.category === 'profile' &&
      normalize(memory.label) === normalize(storedLabel),
  )
}

function segmentBar(count, amber = false) {
  const active = Math.max(0, Math.min(12, count))
  return `<span class="segmented-bar${amber ? ' amber' : ''}" aria-hidden="true">${
    Array.from({ length: 12 }, (_, index) => `<span${index < active ? ' class="on"' : ''}></span>`).join('')
  }</span>`
}

function renderMetric(label, value, count, amber = false) {
  return `
    <div class="system-metric">
      <div class="metric-head"><span>${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong></div>
      ${segmentBar(count, amber)}
    </div>
  `
}

function renderHeader() {
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo" aria-hidden="true">J</div>
        <div><h1>J.A.R.V.I.S.</h1><p>JUST A RATHER VERY INTELLIGENT SYSTEM</p></div>
      </div>
      <nav class="main-nav" aria-label="Navegación principal">
        ${NAV_ITEMS.map((item) => `
          <button type="button" class="nav-button${state.view === item.id ? ' active' : ''}"
            data-action="navigate" data-view="${item.id}" aria-current="${state.view === item.id ? 'page' : 'false'}">
            <span class="nav-icon" aria-hidden="true">${item.icon}</span>
            <span>${item.label}</span>
            ${item.id === 'memory' ? `<span class="nav-count">${state.memories.length}</span>` : ''}
            ${item.id === 'activity' ? `<span class="nav-count">${state.events.length}</span>` : ''}
          </button>
        `).join('')}
      </nav>
      <div class="header-actions">
        <span class="encrypted-indicator"><i class="status-light"></i> MEMORIA CIFRADA</span>
        <button type="button" class="lock-button" data-action="lock">Bloquear</button>
      </div>
    </header>
  `
}

function renderLeftPanel() {
  const memorySegments = Math.min(12, state.memories.length)
  const eventSegments = Math.min(12, state.events.length)
  return `
    <aside class="hud-panel side-panel left-panel" aria-label="Estado del sistema">
      <h2 class="panel-heading">ESTADO DEL SISTEMA <span class="corner">×</span></h2>
      ${renderMetric('ASISTENTE', 'Preparado', 12)}
      ${renderMetric('MEMORIA LOCAL', 'Cifrada', 12)}
      ${renderMetric('RECUERDOS', `${state.memories.length} guardados`, memorySegments, true)}
      ${renderMetric('ACTIVIDAD', `${state.events.length} eventos`, eventSegments, true)}
      <p class="local-storage-note"><i class="status-light"></i>Los datos se guardan cifrados en este dispositivo.</p>
    </aside>
  `
}

function renderQuickPanel() {
  const configuredProvider = getAiSettings().apiKey
  const description = configuredProvider
    ? 'IA lista; envío con autorización'
    : 'Asistente local disponible'
  return `
    <aside class="hud-panel side-panel right-panel" aria-label="Acceso rápido">
      <h2 class="panel-heading">ACCESO RÁPIDO <span class="corner">×</span></h2>
      <button type="button" class="quick-link" data-action="navigate" data-view="profile">
        <span class="quick-icon">♙</span><span class="quick-copy"><strong class="quick-title">Perfil personal</strong><small class="quick-description">Consultar o editar sus datos</small></span><b class="quick-arrow">›</b>
      </button>
      <button type="button" class="quick-link" data-action="navigate" data-view="memory">
        <span class="quick-icon">◇</span><span class="quick-copy"><strong class="quick-title">Memoria</strong><small class="quick-description">${state.memories.length} datos almacenados</small></span><b class="quick-arrow">›</b>
      </button>
      <button type="button" class="quick-link" data-action="navigate" data-view="activity">
        <span class="quick-icon">▤</span><span class="quick-copy"><strong class="quick-title">Actividad</strong><small class="quick-description">Ver cambios de recuerdos</small></span><b class="quick-arrow">›</b>
      </button>
      <div class="neural-status"><i class="status-light"></i><span>${escapeHtml(description)}<br>Sin conexión externa automática</span></div>
    </aside>
  `
}

function renderWaveform() {
  const active = state.listening || state.speaking
  const bars = Array.from({ length: 46 }, (_, index) => {
    const height = 7 + Math.round((Math.sin(index * 1.77) + 1) * 17 * (0.25 + Math.abs(Math.sin(index * 0.41))))
    const delay = `${(index % 12) * -0.035}s`
    const speed = state.listening ? `${0.2 + (index % 5) * 0.055}s` : `${0.48 + (index % 7) * 0.075}s`
    return `<span style="--wave-height:${height}px;--wave-delay:${delay};--wave-speed:${speed}"></span>`
  }).join('')
  const mode = state.speaking ? 'speaking' : state.listening ? 'listening' : ''
  return `
    <div class="waveform${active ? ` active ${mode}` : ''}" aria-label="${active ? state.speaking ? 'JARVIS está hablando' : 'JARVIS está escuchando' : 'Visualizador de audio'}">
      ${bars}
      <button class="wave-microphone${state.listening ? ' listening' : ''}" type="button" data-action="microphone" aria-label="${state.listening ? 'Escuchando' : 'Activar micrófono'}" ${state.listening ? 'disabled' : ''}>
        <span aria-hidden="true">${state.listening ? '◉' : '🎙'}</span>
      </button>
    </div>
  `
}

function renderMessages() {
  if (!state.messages.length) {
    return '<p class="empty-state">La conversación está vacía.</p>'
  }
  return state.messages.slice(-100).map((message, index) => `
    <article class="chat-message ${message.tipo === 'usuario' ? 'user' : 'assistant'}">
      <div class="message-label">${message.tipo === 'usuario' ? 'USTED' : 'J.A.R.V.I.S.'}</div>
      <p class="message-body">${escapeHtml(message.texto)}</p>
      ${message.tipo === 'jarvis' ? `
        <div class="message-actions">
          <button type="button" data-action="speak" data-text="${escapeHtml(message.texto)}">🔊 Escuchar</button>
          ${state.speaking && index === state.messages.length - 1 ? '<button type="button" data-action="stop-voice">■ Detener</button>' : ''}
        </div>
      ` : ''}
    </article>
  `).join('')
}

function renderInteraction() {
  const file = state.file
  return `
    <section class="center-stage">
      <p class="eyebrow">ASISTENTE PERSONAL · ALMACENAMIENTO LOCAL</p>
      <div class="core-stage${state.listening ? ' listening' : ''}${state.speaking ? ' speaking' : ''}">
        <div class="energy-wave" aria-hidden="true"></div>
        <div class="core-rings" aria-hidden="true">
          <span class="core-ring core-ring-outer"></span>
          <span class="core-ring core-ring-middle"></span>
          <span class="core-ring core-ring-inner"></span>
          <span class="core-tick-ring"></span>
        </div>
        <button type="button" class="core-button${state.listening ? ' listening' : ''}${state.speaking ? ' speaking' : ''}"
          data-action="microphone" aria-label="${state.listening ? 'JARVIS está escuchando' : 'Hablar con JARVIS'}"
          ${state.listening ? 'disabled' : ''}>
          <span class="core-letter">J</span>
          <span class="core-caption">${state.listening ? 'ESCUCHANDO' : state.speaking ? 'RESPONDIENDO' : 'J.A.R.V.I.S.'}</span>
        </button>
      </div>
      <h2 class="conversation-title">Converse con JARVIS</h2>
      <p class="conversation-subtitle">Escriba un mensaje o active el micrófono para hablar.</p>
      ${renderWaveform()}
      ${file ? `
        <div class="file-chip">
          <span>▣ ${escapeHtml(file.name)} · ${file.text.length.toLocaleString('es-BO')} caracteres</span>
          <button type="button" data-action="remove-file" aria-label="Quitar archivo">Quitar ×</button>
        </div>
        <details><summary class="tool-row">Vista previa del archivo</summary><pre class="file-preview">${escapeHtml(file.text.slice(0, 5000))}</pre></details>
      ` : ''}
      <div class="chat-log" id="chat-log" aria-live="polite">${renderMessages()}</div>
      ${state.busy ? '<p class="tool-row" role="status">JARVIS está procesando su solicitud…</p>' : ''}
      <form class="composer" id="message-form">
        <input id="message-input" name="message" autocomplete="off" maxlength="1800"
          placeholder="Escriba un comando..." value="${escapeHtml(state.message)}"
          aria-label="Mensaje para JARVIS" required ${state.busy ? 'disabled' : ''}>
        <button type="submit" class="send-button" ${state.busy ? 'disabled' : ''}>${state.busy ? '…' : 'Enviar ➤'}</button>
      </form>
      <div class="tool-row">
        <span>Comandos locales y voz disponibles</span>
        <span>
          <button type="button" data-action="open-file">＋ Adjuntar archivo</button>
          <button type="button" data-action="clear-chat">Limpiar chat</button>
        </span>
      </div>
      <input class="file-input" id="file-input" type="file"
        accept=".txt,.json,.csv,.md,.pdf,.js,.jsx,.ts,.tsx,.html,.css,.py,.java,.c,.cpp,.h,.sql,.xml,.yaml,.yml,.log">
    </section>
  `
}

function renderProfile() {
  const fields = PROFILE_FIELDS.map(([label, storedLabel]) => {
    const memory = currentProfileValue(storedLabel)
    const age = memory && normalize(memory.label) === 'fecha de nacimiento'
      ? calculateAge(memory.value)
      : null
    const value = memory
      ? `${formatMemory(memory)}${age === null ? '' : ` · ${age} años`}`
      : 'No indicado'
    return `
      <article class="profile-card">
        <label>${escapeHtml(label)}</label>
        <strong>${escapeHtml(value)}</strong>
        <button type="button" data-action="edit-profile" data-label="${escapeHtml(storedLabel)}">
          ${memory ? 'Editar dato' : 'Añadir dato'}
        </button>
      </article>
    `
  }).join('')
  const settings = getAiSettings()

  return `
    <section class="hud-panel section-panel" aria-labelledby="profile-title">
      <h2 class="panel-heading" id="profile-title">PERFIL PERSONAL <span class="corner">● CIFRADO</span></h2>
      <p class="section-description">Información que JARVIS puede recordar. Los campos vacíos no se completan hasta que usted los proporcione.</p>
      <div class="profile-grid">${fields}</div>
      <div class="settings-card">
        <h3>Configuración de Inteligencia Artificial</h3>
        <p>Gemini puede investigar temas actuales con Google Search y explicar el concepto con fuentes. Requiere una API Key de Gemini y su autorización; su uso puede consumir cuota o tener costo según el plan.</p>
        <form id="ai-settings-form">
          <div class="settings-grid">
            <label class="field">Proveedor
              <select id="ai-provider" name="provider">
                <option value="gemini" ${settings.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                <option value="openai" ${settings.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
              </select>
            </label>
            <label class="field">Modelo
              <input id="ai-model" name="model" value="${escapeHtml(settings.model)}" maxlength="80" required>
            </label>
            <label class="field" style="grid-column:1/-1">API Key ${settings.apiKey ? '(clave configurada)' : ''}
              <input id="ai-key" name="apiKey" type="password" maxlength="300" autocomplete="new-password"
                placeholder="${settings.apiKey ? 'Dejar vacío para conservarla' : 'Pegue su clave API aquí'}">
            </label>
          </div>
          <label class="settings-check">
            <input id="external-consent" type="checkbox" ${settings.consent ? 'checked' : ''}>
            <span>Autorizo enviar mi mensaje, el contexto reciente del chat y el archivo adjunto (si lo hay) al proveedor seleccionado para generar respuestas. No se envía el perfil ni la memoria de forma automática.</span>
          </label>
          <div class="security-warning">La clave se guarda en localStorage de este navegador, como se solicita. Cualquier script malicioso ejecutado en este sitio podría leerla. No reutilice contraseñas ni comparta esta sesión.</div>
          <div class="settings-actions">
            <button type="submit" class="primary-button">Guardar configuración</button>
            ${settings.apiKey ? '<button type="button" class="danger-button" data-action="remove-ai-key">Eliminar API Key</button>' : ''}
          </div>
        </form>
      </div>
    </section>
  `
}

function renderMemory() {
  const edit = state.editId
    ? state.memories.find((memory) => memory.id === state.editId)
    : null
  const formMemory = edit || { category: 'profile', label: '', value: '' }
  const memories = state.memories.length
    ? `<div class="memory-list">${state.memories.map((memory) => `
        <article class="memory-item">
          <div class="memory-copy">
            <span class="memory-category">${escapeHtml(CATEGORY_NAMES[memory.category] || 'Otros')}</span>
            <strong>${escapeHtml(memory.label)}</strong>
            <span>${escapeHtml(formatMemory(memory))}</span>
            <small>Actualizado ${escapeHtml(formatDate(memory.updatedAt))}</small>
          </div>
          <div class="memory-actions">
            <button type="button" class="secondary-button" data-action="edit-memory" data-id="${escapeHtml(memory.id)}">Editar</button>
            <button type="button" class="danger-button" data-action="delete-memory" data-id="${escapeHtml(memory.id)}">Eliminar</button>
          </div>
        </article>
      `).join('')}</div>`
    : '<p class="empty-state">Aún no hay datos guardados. Añada un recuerdo o use “recuerda que…” en la conversación.</p>'

  return `
    <section class="hud-panel section-panel" aria-labelledby="memory-title">
      <h2 class="panel-heading" id="memory-title">MEMORIA PERSONAL <span class="corner">${state.memories.length} RECUERDOS</span></h2>
      <p class="section-description">Sus datos se guardan cifrados en la base local. Añada, edite o elimine recuerdos; los cambios aparecen en Actividad.</p>
      <form id="memory-form" class="memory-form">
        <label class="field">Tipo
          <select name="category">
            <option value="profile" ${formMemory.category === 'profile' ? 'selected' : ''}>Perfil</option>
            <option value="preference" ${formMemory.category === 'preference' ? 'selected' : ''}>Preferencia</option>
            <option value="note" ${formMemory.category === 'note' ? 'selected' : ''}>Nota</option>
          </select>
        </label>
        <label class="field">Dato
          <input name="label" maxlength="80" value="${escapeHtml(formMemory.label)}" placeholder="Ej.: Comida favorita" required>
        </label>
        <label class="field">Información
          <input name="value" maxlength="1000" value="${escapeHtml(formMemory.value)}"
            type="${normalize(formMemory.label) === 'fecha de nacimiento' ? 'date' : 'text'}"
            placeholder="Escriba un valor" required>
        </label>
        <div class="settings-actions">
          <button type="submit" class="primary-button">${edit ? 'Guardar cambios' : 'Añadir dato'}</button>
          ${edit ? '<button type="button" class="secondary-button" data-action="cancel-edit">Cancelar</button>' : ''}
        </div>
      </form>
      ${memories}
      <div class="settings-card">
        <h3>Privacidad y control</h3>
        <p>El perfil, los recuerdos y el chat se almacenan cifrados localmente. JARVIS no envía estos datos a terceros sin autorización.</p>
        <button type="button" class="danger-button" data-action="wipe-data">Borrar permanentemente todos mis datos</button>
      </div>
    </section>
  `
}

function eventActionLabel(action) {
  return {
    created: 'Recuerdo añadido',
    updated: 'Recuerdo actualizado',
    deleted: 'Recuerdo eliminado',
    cleared: 'Memoria borrada',
    assistant_query: 'Consulta al asistente',
    web_open: 'Enlace web abierto',
    file_loaded: 'Archivo analizado',
  }[action] || 'Cambio registrado'
}

function renderActivity() {
  const events = state.events.length
    ? `<ul class="event-list">${state.events.map((event) => `
        <li class="event-item" data-action="${escapeHtml(event.action)}">
          <span class="event-action"><i class="event-dot"></i>${escapeHtml(eventActionLabel(event.action))}</span>
          <span>${event.source === 'interaction' ? 'Comando' : escapeHtml(CATEGORY_NAMES[event.category] || 'Todos los datos')}</span>
          <time>${escapeHtml(formatDate(event.createdAt))}</time>
        </li>
      `).join('')}</ul>`
    : '<p class="empty-state">Aún no hay actividad. Al añadir, editar o eliminar un recuerdo, el registro aparecerá aquí. No se almacena el contenido privado.</p>'

  return `
    <section class="hud-panel section-panel" aria-labelledby="activity-title">
      <h2 class="panel-heading" id="activity-title">ACTIVIDAD DE LA MEMORIA
        <button type="button" class="secondary-button" data-action="refresh-activity" ${state.loadingEvents ? 'disabled' : ''}>
          ${state.loadingEvents ? 'Actualizando…' : 'Actualizar'}
        </button>
      </h2>
      <p class="section-description">Registro local de altas, modificaciones y eliminaciones. Solo muestra la categoría y la fecha; no revela el contenido del recuerdo.</p>
      <div class="activity-counter"><strong>${state.events.length}</strong><span>${state.events.length === 1 ? 'evento reciente' : 'eventos recientes'}</span></div>
      ${events}
    </section>
  `
}

function renderReady() {
  let center
  if (state.view === 'profile') center = renderProfile()
  else if (state.view === 'memory') center = renderMemory()
  else if (state.view === 'activity') center = renderActivity()
  else center = renderInteraction()

  app.innerHTML = `
    <div class="app">
      ${renderHeader()}
      <main class="app-grid">
        ${renderLeftPanel()}
        ${center}
        ${renderQuickPanel()}
      </main>
      <footer class="footer">J.A.R.V.I.S. · MEMORIA LOCAL CIFRADA · CONTROLADO POR EL USUARIO</footer>
    </div>
  `

  if (state.view === 'interact') {
    const chat = document.querySelector('#chat-log')
    if (chat) chat.scrollTop = chat.scrollHeight
    const input = document.querySelector('#message-input')
    if (input) {
      input.addEventListener('input', () => {
        state.message = input.value
      })
    }
  }
}

function renderAuth() {
  if (state.phase === 'loading') {
    app.innerHTML = `
      <main class="auth-screen"><section class="auth-card">
        <div class="brand-logo">J</div><h1>J.A.R.V.I.S.</h1>
        <p>Conectando con la memoria local cifrada…</p>
      </section></main>
    `
    return
  }

  if (state.phase === 'offline') {
    app.innerHTML = `
      <main class="auth-screen"><section class="auth-card">
        <div class="brand-logo">J</div><h1>J.A.R.V.I.S.</h1>
        <p role="alert">${escapeHtml(state.error || 'No se pudo conectar con el servidor local.')}</p>
        <button type="button" class="primary-button" data-action="retry">Reintentar conexión</button>
        <p class="privacy-copy">En desarrollo, inicie ambos procesos con <code>npm run dev</code>.</p>
      </section></main>
    `
    return
  }

  const login = state.phase === 'login'
  app.innerHTML = `
    <main class="auth-screen">
      <form class="auth-card" id="auth-form">
        <div class="brand-logo">J</div>
        <p class="eyebrow">${login ? 'SISTEMA BLOQUEADO' : 'CONFIGURACIÓN INICIAL'}</p>
        <h1>${login ? 'Desbloquear J.A.R.V.I.S.' : 'Configurar memoria segura'}</h1>
        <p>${login
          ? 'Ingrese su contraseña maestra para acceder a su perfil y recuerdos.'
          : 'Cree una contraseña de al menos 12 caracteres. Sin ella no podrá recuperar los datos cifrados.'}</p>
        <label class="field" for="master-password">Contraseña maestra
          <input id="master-password" name="password" type="password" minlength="${login ? 1 : 12}"
            maxlength="256" autocomplete="${login ? 'current-password' : 'new-password'}" required autofocus>
        </label>
        ${state.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ''}
        <button type="submit" class="primary-button">${login ? 'Desbloquear' : 'Crear memoria cifrada'}</button>
        <p class="privacy-copy">Todo queda en su equipo. Ningún recuerdo se comparte con un proveedor externo sin autorización.</p>
      </form>
    </main>
  `
}

function render() {
  if (state.phase === 'ready') renderReady()
  else renderAuth()
}

function getAiSettings() {
  try {
    const provider = localStorage.getItem(STORAGE_KEYS.provider) || 'gemini'
    return {
      provider: provider === 'openai' ? 'openai' : 'gemini',
      model: localStorage.getItem(STORAGE_KEYS.model) ||
        (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash'),
      apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || '',
      consent: localStorage.getItem(STORAGE_KEYS.consent) === 'true',
    }
  } catch (error) {
    notify(`No se pudo leer la configuración local de IA: ${error.message}`, 'error')
    return { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: '', consent: false }
  }
}

async function refreshPrivateData() {
  try {
    const [memories, events, messages] = await Promise.all([
      api('/memories'),
      api('/events'),
      api('/chat'),
    ])
    state.memories = memories
    state.events = events
    state.messages = messages

    if (!state.messages.length) {
      let legacyMessages = []
      const oldChat = localStorage.getItem('jarvis-chat')
      if (oldChat) {
        try {
          const parsed = JSON.parse(oldChat)
          if (Array.isArray(parsed)) legacyMessages = parsed.slice(-100)
        } catch {
          notify('El historial antiguo del navegador tenía un formato inválido; no se importó.', 'error')
        }
      }
      state.messages = legacyMessages.length ? legacyMessages : [...INITIAL_CHAT]
      await api('/chat', {
        method: 'PUT',
        body: JSON.stringify({ messages: state.messages.slice(-200) }),
      })
      if (oldChat) localStorage.removeItem('jarvis-chat')
    }
    state.phase = 'ready'
    render()
    scheduleChatSave()
  } catch (error) {
    if (error.message.includes('Inicia sesión')) {
      state.phase = 'login'
      state.configured = true
    } else {
      state.error = error.message
      state.phase = 'offline'
    }
    render()
  }
}

async function checkStatus() {
  state.phase = 'loading'
  render()
  try {
    const status = await api('/status')
    state.configured = status.configured
    if (status.authenticated) {
      await refreshPrivateData()
      return
    }
    state.phase = status.configured ? 'login' : 'setup'
  } catch (error) {
    state.error = error.message
    state.phase = 'offline'
  }
  render()
}

async function handleAuth(event) {
  event.preventDefault()
  const form = event.target
  const password = new FormData(form).get('password')
  const endpoint = state.configured ? '/login' : '/setup'
  const submit = form.querySelector('button[type="submit"]')
  submit.disabled = true
  submit.textContent = 'Un momento…'
  state.error = ''
  try {
    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    state.configured = true
    await refreshPrivateData()
  } catch (error) {
    state.error = error.message
    state.phase = state.configured ? 'login' : 'setup'
    render()
  }
}

function scheduleChatSave() {
  window.clearTimeout(state.chatTimer)
  if (state.phase !== 'ready') return
  state.chatTimer = window.setTimeout(() => {
    api('/chat', {
      method: 'PUT',
      body: JSON.stringify({ messages: state.messages.slice(-200) }),
    }).catch((error) => notify(`No se pudo guardar el chat: ${error.message}`, 'error'))
  }, 350)
}

async function saveMemory(memory, id = null) {
  const saved = await api(id ? `/memories/${encodeURIComponent(id)}` : '/memories', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(memory),
  })
  state.memories = [
    saved,
    ...state.memories.filter((item) =>
      item.id !== saved.id &&
      !(item.category === saved.category && normalize(item.label) === normalize(saved.label)),
    ),
  ]
  state.editId = null
  state.events = await api('/events')
  render()
  return saved
}

async function deleteMemory(id) {
  const memory = state.memories.find((item) => item.id === id)
  if (!memory || !window.confirm(`¿Eliminar permanentemente el recuerdo “${memory.label}”?`)) return
  await api(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' })
  state.memories = state.memories.filter((item) => item.id !== id)
  state.events = await api('/events')
  render()
  notify('Recuerdo eliminado.')
}

async function logInteraction(action) {
  try {
    await api('/activity', {
      method: 'POST',
      body: JSON.stringify({ action }),
    })
    state.events = await api('/events')
    render()
  } catch (error) {
    notify(`No se pudo registrar la actividad: ${error.message}`, 'error')
  }
}

function dateForBirth(value) {
  const dayFirst = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  const iso = dayFirst
    ? `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`
    : value.trim()
  return calculateAge(iso) === null ? null : iso
}

function getRememberCommand(text) {
  const command = text.trim().replace(/^jarvis[,\s]*/i, '')
  let match
  if ((match = command.match(/^(?:mi nombre es|me llamo)\s+(.+)$/i))) {
    return { category: 'profile', label: 'Nombre completo', value: match[1].trim() }
  }
  if ((match = command.match(/^(?:mi apodo es|ll[aá]mame)\s+(.+)$/i))) {
    return { category: 'profile', label: 'Apodo preferido', value: match[1].trim() }
  }
  if ((match = command.match(/^(?:nac[ií] el|mi fecha de nacimiento es)\s+(.+)$/i))) {
    const value = dateForBirth(match[1])
    return value
      ? { category: 'profile', label: 'Fecha de nacimiento', value }
      : { invalid: 'Indique una fecha válida como “nací el 12/03/1990”.' }
  }
  if ((match = command.match(/^(?:mi ciudad es|vivo en)\s+(.+)$/i))) {
    return { category: 'profile', label: 'Ciudad', value: match[1].trim() }
  }
  if ((match = command.match(/^mi pa[ií]s es\s+(.+)$/i))) {
    return { category: 'profile', label: 'País', value: match[1].trim() }
  }
  if ((match = command.match(/^(?:mi profesi[oó]n es|trabajo como)\s+(.+)$/i))) {
    return { category: 'profile', label: 'Profesión', value: match[1].trim() }
  }
  if ((match = command.match(/^(?:hablo|mi idioma es|mis idiomas son)\s+(.+)$/i))) {
    return { category: 'profile', label: 'Idiomas', value: match[1].trim() }
  }
  const remember = command.match(/^(?:recuerda(?: que)?|recu[eé]rdame que|guarda en memoria)\s+(.+)$/i)
  if (!remember) return null
  const detail = remember[1].match(/^(.+?)\s+es\s+(.+)$/i)
  if (detail) {
    const label = detail[1].replace(/^(?:mi|mis)\s+/i, '').trim()
    const profileField = PROFILE_FIELDS.find(([, stored]) => normalize(stored) === normalize(label))
    return {
      category: profileField ? 'profile' : 'preference',
      label: profileField ? profileField[1] : label.charAt(0).toLocaleUpperCase('es') + label.slice(1),
      value: detail[2].trim(),
    }
  }
  return { category: 'note', label: 'Recuerdo', value: remember[1].trim() }
}

function findFileAnswer(text) {
  if (!state.file) return null
  const stopWords = new Set(['cual', 'que', 'como', 'donde', 'cuando', 'para', 'este', 'esta', 'archivo', 'sobre', 'dice'])
  const terms = normalize(text).split(/\W+/).filter((word) => word.length > 2 && !stopWords.has(word))
  if (!terms.length) return null
  const lines = state.file.text.split(/\r?\n/).filter(Boolean)
  const matchingLines = lines
    .map((line) => ({ line, score: terms.reduce((sum, term) => sum + (normalize(line).includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.line.trim())
  return matchingLines.length
    ? `Encontré este fragmento en ${state.file.name}:\n${matchingLines.join('\n')}`
    : `No encontré coincidencias claras en ${state.file.name}. Puedo analizarlo con IA si configura un proveedor y autoriza el envío del contenido.`
}

function localAnswer(text) {
  const question = normalize(text).replace(/^[¿¡\s]+/, '')
  const remembered = getRememberCommand(text)
  if (remembered) {
    if (remembered.invalid) return remembered.invalid
    if (/fecha de nacimiento|direccion|tel[eé]fono|salud|pasaporte|contrase[nñ]a|privad/i.test(`${remembered.label} ${remembered.value}`)) {
      if (!window.confirm(`¿Autoriza guardar “${remembered.label}” cifrado localmente en este dispositivo?`)) {
        return 'No guardé ese dato. Su privacidad es importante, señor.'
      }
    }
    return saveMemory(remembered).then((saved) => `He guardado ${saved.label} en su memoria, señor.`)
  }

  if (/^(?:como me llamo|cual es mi nombre)\??$/.test(question)) {
    const name = currentProfileValue('Nombre completo')
    const nickname = currentProfileValue('Apodo preferido')
    return name
      ? `Su nombre es ${name.value}${nickname ? `, y prefiere que le llame ${nickname.value}` : ''}, señor.`
      : 'Aún no me ha indicado su nombre, señor.'
  }
  if (/^(?:cuando es mi cumpleanos|cuando cumplo anos|cual es mi cumpleanos)\??$/.test(question)) {
    const birthday = currentProfileValue('Fecha de nacimiento')
    if (!birthday) return 'Aún no me ha indicado su fecha de nacimiento, señor.'
    return `Su cumpleaños es el ${formatMemory(birthday)}, señor.`
  }
  if (/^(?:cuantos anos tengo|que edad tengo)\??$/.test(question)) {
    const birthday = currentProfileValue('Fecha de nacimiento')
    const age = birthday && calculateAge(birthday.value)
    return age === null || age === undefined
      ? 'No tengo su fecha de nacimiento para calcular su edad, señor.'
      : `Tiene ${age} años, señor.`
  }
  if (/^(?:muestra(?:me)? mi perfil|ver mi perfil|mi perfil)\??$/.test(question)) {
    state.view = 'profile'
    render()
    return 'He abierto su perfil personal, señor.'
  }
  if (/^(?:que recuerdas de mi|que sabes de mi)\??$/.test(question)) {
    return state.memories.length
      ? `Tengo ${state.memories.length} datos en su memoria cifrada. Puede revisarlos desde la pestaña Memoria, señor.`
      : 'Aún no hay datos en su memoria, señor.'
  }
  const forget = text.trim().match(/^olvida(?: el dato)?\s+(.+)$/i)
  if (forget) {
    const target = normalize(forget[1])
    const memory = state.memories.find(
      (item) => normalize(item.label) === target || normalize(item.value) === target,
    )
    if (!memory) return 'No encontré ese dato en su memoria, señor.'
    if (!window.confirm(`¿Desea olvidar “${memory.label}” de forma permanente?`)) {
      return 'No eliminé ningún dato, señor.'
    }
    return api(`/memories/${encodeURIComponent(memory.id)}`, { method: 'DELETE' })
      .then(async () => {
        state.memories = state.memories.filter((item) => item.id !== memory.id)
        state.events = await api('/events')
        render()
        return `He olvidado ${memory.label}, señor.`
      })
  }
  if (question.includes('hora')) return `La hora actual es ${new Date().toLocaleTimeString('es-BO')}, señor.`
  if (question.includes('fecha') || question.includes('que dia')) {
    return `Hoy es ${new Date().toLocaleDateString('es-BO', { dateStyle: 'full' })}, señor.`
  }
  if (question.includes('hola')) return 'J.A.R.V.I.S. está a su servicio, señor.'
  if (question.includes('quien eres')) return 'Soy J.A.R.V.I.S., su asistente virtual personal, señor.'
  if (/^(?:que puedes hacer|que sabes hacer|como puedes ayudarme)\??$/.test(question)) {
    return 'Puedo guardar y consultar sus recuerdos, editar su perfil, calcular operaciones, decirle la hora y la fecha, abrir sitios web, leer archivos que usted seleccione y conversar por voz. Para responder preguntas generales necesito configurar una IA en Perfil, señor.'
  }
  if (question.includes('gracias')) return 'Siempre a su servicio, señor.'
  if (question.includes('abrir archivo') || question.includes('analizar archivo')) {
    return 'Use “Adjuntar archivo” y seleccione un archivo de texto o PDF, señor.'
  }
  if (question.includes('calcula') || question.includes('cuanto es')) {
    const operation = question.match(/(-?\d+(?:[.,]\d+)?)\s*([+\-*/])\s*(-?\d+(?:[.,]\d+)?)/)
    if (!operation) return 'Escriba una operación como: calcula 25 + 15.'
    const first = Number(operation[1].replace(',', '.'))
    const second = Number(operation[3].replace(',', '.'))
    if (operation[2] === '/' && second === 0) return 'No es posible dividir entre cero, señor.'
    const result = operation[2] === '+' ? first + second
      : operation[2] === '-' ? first - second
        : operation[2] === '*' ? first * second
          : first / second
    return `El resultado es ${result}, señor.`
  }
  const memoryQuestion = state.memories.find((memory) => question.includes(normalize(memory.label)))
  if (memoryQuestion && /cual es|que es|como es|dime|recuerdas/.test(question)) {
    return `Su ${memoryQuestion.label.toLocaleLowerCase('es')} es ${memoryQuestion.value}, señor.`
  }
  const fileAnswer = findFileAnswer(text)
  if (fileAnswer) return fileAnswer

  const settings = getAiSettings()
  if (!settings.apiKey) {
    return 'La IA externa no está configurada. Puedo responder comandos locales; configure Gemini u OpenAI desde Perfil, señor.'
  }
  if (!settings.consent) {
    return 'No enviaré el mensaje a un servicio externo sin su autorización. Revise la opción de privacidad en Perfil, señor.'
  }
  return null
}

async function consultarIA(message, { grounded = false } = {}) {
  const settings = getAiSettings()
  if (!settings.apiKey || !settings.consent || (grounded && settings.provider !== 'gemini')) return null

  const conversation = grounded
    ? [{ role: 'user', content: message }]
    : state.messages.slice(-8).map((item) => ({
        role: item.tipo === 'usuario' ? 'user' : 'assistant',
        content: item.texto,
      }))
  if (!grounded) {
    conversation.pop()
    const fileContext = state.file
      ? `\n\n[Archivo adjunto: ${state.file.name}]\n${state.file.text.slice(0, 24000)}`
      : ''
    conversation.push({ role: 'user', content: `${message}${fileContext}` })
  }

  try {
    const result = await api('/assistant', {
      method: 'POST',
      body: JSON.stringify({
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.apiKey,
        systemPrompt: SYSTEM_PROMPT,
        grounded,
        messages: conversation,
      }),
    })
    return result.text
  } catch (error) {
    notify(`No se pudo consultar la IA externa: ${error.message}`, 'error')
    return 'No pude conectar con el servicio de IA. La memoria local sigue disponible; revise la clave y la conexión, señor.'
  }
}

function isOpenFileCommand(text) {
  return /^(?:jarvis[,\s]+)?(?:abrir|abre|analizar|analiza)\s+archivo$/i.test(text.trim())
}

async function sendMessage(text) {
  const message = String(text || '').trim()
  if (!message || state.busy) return

  state.message = ''
  state.busy = true
  state.messages.push({ tipo: 'usuario', texto: message })
  state.messages = state.messages.slice(-200)

  // Open the target while the user gesture is still active, before awaiting network work.
  const webAction = getWebAction(message)
  if (webAction?.type === 'research') {
    void logInteraction('assistant_query')
    render()
    const settings = getAiSettings()
    const canGround = settings.provider === 'gemini' && settings.apiKey && settings.consent
    if (!canGround) {
      openExternalPage(webAction.fallbackUrl)
      const response = !settings.apiKey
        ? 'Para explicarle el concepto con información actual y fuentes, configure una API Key de Gemini y autorice su uso en Perfil. Solicité abrir los resultados de Google en otra pestaña; no envié el historial ni sus archivos a Gemini.'
        : !settings.consent
          ? 'No envié la consulta a Gemini porque falta su autorización. Solicité abrir los resultados de Google en otra pestaña; active el permiso en Perfil si desea una explicación con fuentes.'
          : 'La explicación con búsqueda y fuentes requiere seleccionar Gemini en Perfil. Solicité abrir los resultados de Google en otra pestaña.'
      state.busy = false
      state.messages.push({ tipo: 'jarvis', texto: response })
      state.messages = state.messages.slice(-200)
      render()
      scheduleChatSave()
      speak(response)
      return
    }

    try {
      const response = await consultarIA(webAction.query, { grounded: true })
      state.busy = false
      state.messages.push({ tipo: 'jarvis', texto: String(response) })
      state.messages = state.messages.slice(-200)
      render()
      scheduleChatSave()
      speak(String(response))
    } catch (error) {
      state.busy = false
      state.messages.push({ tipo: 'jarvis', texto: `No pude investigar el tema: ${error.message}` })
      render()
      scheduleChatSave()
      notify(error.message, 'error')
    }
    return
  }
  if (webAction) {
    if (webAction.type === 'open') {
      openExternalPage(webAction.url)
      void logInteraction('web_open')
    } else {
      void logInteraction('assistant_query')
    }
    state.busy = false
    state.messages.push({ tipo: 'jarvis', texto: webAction.response })
    render()
    scheduleChatSave()
    speak(webAction.response)
    return
  }
  if (isOpenFileCommand(message)) {
    void logInteraction('assistant_query')
    state.busy = false
    const reply = 'Seleccione el archivo que desea analizar, señor.'
    state.messages.push({ tipo: 'jarvis', texto: reply })
    render()
    scheduleChatSave()
    document.querySelector('#file-input')?.click()
    speak(reply)
    return
  }

  render()
  scheduleChatSave()
  void logInteraction('assistant_query')
  try {
    let response = await localAnswer(message)
    if (response === null) response = await consultarIA(message)
    if (response === null) response = 'No tengo una respuesta programada para eso todavía, señor.'
    state.messages.push({ tipo: 'jarvis', texto: String(response) })
    state.messages = state.messages.slice(-200)
    state.busy = false
    render()
    scheduleChatSave()
    speak(String(response))
  } catch (error) {
    state.busy = false
    const response = `No pude completar la solicitud: ${error.message}`
    state.messages.push({ tipo: 'jarvis', texto: response })
    render()
    scheduleChatSave()
    notify(error.message, 'error')
    speak(response)
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    notify('Este navegador no admite síntesis de voz.', 'error')
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'es-ES'
  utterance.rate = 0.96
  utterance.pitch = 0.88
  const voices = window.speechSynthesis.getVoices()
  const spanishVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('es'))
  const preferred = spanishVoices.find((voice) =>
    /jorge|diego|pablo|raul|miguel|antonio|male|mascul/i.test(voice.name),
  )
  if (preferred || spanishVoices[0]) utterance.voice = preferred || spanishVoices[0]
  utterance.onstart = () => {
    state.speaking = true
    render()
  }
  utterance.onend = () => {
    state.speaking = false
    render()
  }
  utterance.onerror = () => {
    state.speaking = false
    render()
    notify('No se pudo reproducir la respuesta de voz.', 'error')
  }
  window.speechSynthesis.speak(utterance)
}

function stopVoice() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  state.speaking = false
  render()
}

function startListening() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Recognition) {
    notify('El reconocimiento de voz no está disponible en este navegador. Pruebe Chrome.', 'error')
    return
  }
  const recognition = new Recognition()
  recognition.lang = 'es-ES'
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  recognition.onstart = () => {
    state.listening = true
    render()
  }
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript
    state.listening = false
    if (transcript) sendMessage(transcript)
    else render()
  }
  recognition.onerror = () => {
    state.listening = false
    render()
    notify('No pude reconocer la voz. Revise los permisos del micrófono.', 'error')
  }
  recognition.onend = () => {
    if (state.listening) {
      state.listening = false
      render()
    }
  }
  try {
    recognition.start()
  } catch (error) {
    state.listening = false
    render()
    notify(`No se pudo iniciar el micrófono: ${error.message}`, 'error')
  }
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'))
    reader.readAsText(file, 'UTF-8')
  })
}

async function readPdf(file) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const buffer = await file.arrayBuffer()
  const document = await pdfjs.getDocument({ data: buffer }).promise
  try {
    const pages = []
    const pageCount = Math.min(document.numPages, 80)
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      if (pages.join('\n').length >= 30000) break
    }
    return pages.join('\n').slice(0, 30000)
  } finally {
    await document.destroy()
  }
}

async function handleFile(file) {
  if (!file) return
  if (file.size > 12 * 1024 * 1024) {
    notify('El archivo supera el límite local de 12 MB.', 'error')
    return
  }
  const extension = file.name.split('.').pop().toLowerCase()
  const allowed = new Set([
    'txt', 'json', 'csv', 'md', 'pdf', 'js', 'jsx', 'ts', 'tsx',
    'html', 'css', 'py', 'java', 'c', 'cpp', 'h', 'sql', 'xml', 'yaml', 'yml', 'log',
  ])
  if (!allowed.has(extension)) {
    notify('Ese tipo de archivo no está permitido.', 'error')
    return
  }

  try {
    const text = extension === 'pdf' ? await readPdf(file) : await readAsText(file)
    if (!text.trim()) {
      notify('El archivo no contiene texto legible.', 'error')
      return
    }
    state.file = { name: file.name, text: text.slice(0, 30000) }
    state.view = 'interact'
    void logInteraction('file_loaded')
    render()
    notify(`${file.name} está listo para analizarse localmente.`)
  } catch (error) {
    notify(`No pude leer el archivo: ${error.message}`, 'error')
  }
}

async function handleAiSettings(event) {
  event.preventDefault()
  const form = event.target
  const provider = form.elements.provider.value
  const model = form.elements.model.value.trim()
  const apiKey = form.elements.apiKey.value.trim()
  const consent = document.querySelector('#external-consent').checked
  try {
    if (!model || model.length > 80) throw new Error('Indique un modelo válido.')
    if (!apiKey && !localStorage.getItem(STORAGE_KEYS.apiKey)) {
      throw new Error('Configure una API Key para habilitar el proveedor seleccionado.')
    }
    localStorage.setItem(STORAGE_KEYS.provider, provider)
    localStorage.setItem(STORAGE_KEYS.model, model)
    if (apiKey) localStorage.setItem(STORAGE_KEYS.apiKey, apiKey)
    localStorage.setItem(STORAGE_KEYS.consent, String(consent))
    render()
    notify('Configuración de IA guardada en este navegador.')
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function handleMemoryForm(event) {
  event.preventDefault()
  const form = event.target
  const memory = Object.fromEntries(new FormData(form))
  memory.label = String(memory.label || '').trim()
  memory.value = String(memory.value || '').trim()
  if (!memory.label || !memory.value) {
    notify('Complete el nombre del dato y su información.', 'error')
    return
  }
  if (/fecha|nacimiento|direccion|tel[eé]fono|salud|pasaporte|contrase[nñ]a|privad/i.test(`${memory.label} ${memory.value}`)) {
    if (!window.confirm(`“${memory.label}” puede ser un dato sensible. ¿Autoriza guardarlo cifrado en este equipo?`)) return
  }
  try {
    const saved = await saveMemory(memory, state.editId)
    notify(`${saved.label} guardado correctamente.`)
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function lock() {
  try {
    await api('/logout', { method: 'POST' })
    window.speechSynthesis?.cancel()
    state.phase = 'login'
    state.memories = []
    state.events = []
    state.messages = []
    state.file = null
    render()
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function wipeData() {
  if (!window.confirm('Se borrarán permanentemente los recuerdos, el perfil, el chat y la actividad. ¿Desea continuar?')) return
  if (!window.confirm('Confirme una vez más: ¿eliminar todos los datos personales de JARVIS?')) return
  try {
    await api('/data', { method: 'DELETE' })
    await api('/logout', { method: 'POST' })
    state.phase = 'login'
    state.memories = []
    state.events = []
    state.messages = []
    state.file = null
    state.editId = null
    render()
    notify('Todos los datos personales se eliminaron permanentemente.')
  } catch (error) {
    notify(error.message, 'error')
  }
}

async function refreshActivity() {
  state.loadingEvents = true
  render()
  try {
    state.events = await api('/events')
    render()
  } catch (error) {
    notify(error.message, 'error')
  } finally {
    state.loadingEvents = false
  }
}

async function clearChat() {
  if (!window.confirm('¿Borrar la conversación guardada?')) return
  state.messages = [...INITIAL_CHAT]
  render()
  try {
    await api('/chat', {
      method: 'PUT',
      body: JSON.stringify({ messages: state.messages }),
    })
  } catch (error) {
    notify(error.message, 'error')
  }
}

app.addEventListener('submit', (event) => {
  if (event.target.id === 'auth-form') handleAuth(event)
  if (event.target.id === 'message-form') {
    event.preventDefault()
    const input = event.target.elements.message
    const value = input.value
    state.message = ''
    sendMessage(value)
  }
  if (event.target.id === 'memory-form') handleMemoryForm(event)
  if (event.target.id === 'ai-settings-form') handleAiSettings(event)
})

app.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action]')
  if (!control) return
  const action = control.dataset.action

  if (action === 'navigate') {
    state.view = control.dataset.view
    render()
    if (state.view === 'activity') await refreshActivity()
  } else if (action === 'lock') {
    await lock()
  } else if (action === 'retry') {
    await checkStatus()
  } else if (action === 'microphone') {
    startListening()
  } else if (action === 'open-file') {
    document.querySelector('#file-input')?.click()
  } else if (action === 'remove-file') {
    state.file = null
    render()
  } else if (action === 'clear-chat') {
    await clearChat()
  } else if (action === 'speak') {
    speak(control.dataset.text || '')
  } else if (action === 'stop-voice') {
    stopVoice()
  } else if (action === 'refresh-activity') {
    await refreshActivity()
  } else if (action === 'edit-memory') {
    state.editId = control.dataset.id
    render()
    document.querySelector('#memory-form input[name="label"]')?.focus()
  } else if (action === 'cancel-edit') {
    state.editId = null
    render()
  } else if (action === 'delete-memory') {
    try {
      await deleteMemory(control.dataset.id)
    } catch (error) {
      notify(error.message, 'error')
    }
  } else if (action === 'edit-profile') {
    const memory = currentProfileValue(control.dataset.label)
    state.view = 'memory'
    state.editId = memory?.id || null
    render()
  } else if (action === 'remove-ai-key') {
    if (window.confirm('¿Eliminar la API Key guardada en este navegador?')) {
      localStorage.removeItem(STORAGE_KEYS.apiKey)
      localStorage.setItem(STORAGE_KEYS.consent, 'false')
      render()
      notify('API Key eliminada de este navegador.')
    }
  } else if (action === 'wipe-data') {
    await wipeData()
  }
})

app.addEventListener('change', (event) => {
  if (event.target.id === 'file-input') {
    handleFile(event.target.files?.[0])
    event.target.value = ''
  }
  if (event.target.id === 'ai-provider') {
    const model = document.querySelector('#ai-model')
    if (model) model.value = event.target.value === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash'
  }
})

checkStatus()
