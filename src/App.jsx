import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import './App.css'

const INITIAL_CHAT = [
  { tipo: 'jarvis', texto: 'Buenos días, señor. ¿En qué puedo ayudarte?' },
]

const PROFILE_FIELDS = [
  ['Nombre completo', 'Nombre completo'],
  ['Apodo preferido', 'Apodo preferido'],
  ['Fecha de nacimiento', 'Fecha de nacimiento'],
  ['Ciudad', 'Ciudad'],
  ['País', 'País'],
  ['Profesión u ocupación', 'Profesión'],
  ['Idiomas', 'Idiomas'],
]

const categoryNames = {
  profile: 'Perfil',
  preference: 'Preferencias',
  note: 'Notas',
}

const sections = [
  { id: 'console', label: 'INTERACTUAR', icon: '◉' },
  { id: 'profile', label: 'PERFIL', icon: '◌' },
  { id: 'memory', label: 'MEMORIA', icon: '◇' },
  { id: 'activity', label: 'ACTIVIDAD', icon: '▤' },
]

function normalized(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
}

function calculateAge(value) {
  const birthDate = new Date(`${value}T00:00:00`)
  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.toISOString().slice(0, 10) !== value ||
    birthDate > new Date()
  ) return null
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1
  }
  return age
}

function formatMemory(memory) {
  if (normalized(memory.label) === 'fecha de nacimiento') {
    const date = new Date(`${memory.value}T00:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('es-BO', { dateStyle: 'long' })
    }
  }
  return memory.value
}

function getCommand(text, memories) {
  const rawCommand = text.trim().replace(/^jarvis[,\s]*/i, '')
  const command = normalized(rawCommand).replace(/^[¿¡\s]+/, '')
  const remember = rawCommand.match(/^(?:recuerda(?: que)?|recu[eé]rdame que)\s+(.+)$/i)
  let match

  if ((match = rawCommand.match(/^(?:mi nombre es|me llamo)\s+(.+)$/i))) {
    return { type: 'save', category: 'profile', label: 'Nombre completo', value: match[1] }
  }
  if ((match = rawCommand.match(/^(?:mi apodo es|ll[aá]mame)\s+(.+)$/i))) {
    return { type: 'save', category: 'profile', label: 'Apodo preferido', value: match[1] }
  }
  if ((match = rawCommand.match(/^(?:nac[ií] el|mi fecha de nacimiento es)\s+(.+)$/i))) {
    const rawDate = match[1].trim()
    const dateMatch = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    const value = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`
      : rawDate
    const age = calculateAge(value)
    if (age === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { type: 'reply', text: 'Indique una fecha válida como “nací el 12/03/1990”.' }
    }
    return { type: 'save', category: 'profile', label: 'Fecha de nacimiento', value }
  }
  if ((match = rawCommand.match(/^(?:mi ciudad es|vivo en)\s+(.+)$/i))) {
    return { type: 'save', category: 'profile', label: 'Ciudad', value: match[1] }
  }
  if ((match = rawCommand.match(/^mi pa[ií]s es\s+(.+)$/i))) {
    return { type: 'save', category: 'profile', label: 'País', value: match[1] }
  }
  if ((match = rawCommand.match(/^(?:mi profesi[oó]n es|trabajo como)\s+(.+)$/i))) {
    return { type: 'save', category: 'profile', label: 'Profesión', value: match[1] }
  }
  if ((match = rawCommand.match(/^(?:hablo|mis idiomas son|mi idioma es)\s+(.+)$/i))) {
    return { type: 'save', category: 'profile', label: 'Idiomas', value: match[1] }
  }
  if (remember) {
    const detail = remember[1].match(/^(.+?)\s+es\s+(.+)$/i)
    if (detail) {
      const rawLabel = detail[1].replace(/^(?:mi|mis)\s+/, '').trim()
      const label = rawLabel.charAt(0).toLocaleUpperCase('es') + rawLabel.slice(1)
      const personalField = PROFILE_FIELDS.find(([, key]) => normalized(key) === normalized(label))
      return {
        type: 'save',
        category: personalField ? 'profile' : 'preference',
        label: personalField ? personalField[0] : label,
        value: detail[2],
      }
    }
    return {
      type: 'save',
      category: 'note',
      label: 'Recuerdo',
      value: remember[1],
    }
  }

  if (/^(?:como me llamo|cual es mi nombre)\??$/.test(command)) {
    const name = memories.find(
      (item) => item.category === 'profile' && normalized(item.label) === 'nombre completo',
    )
    const nickname = memories.find(
      (item) => item.category === 'profile' && normalized(item.label) === 'apodo preferido',
    )
    return {
      type: 'reply',
      text: name
        ? `Su nombre es ${name.value}${nickname ? `, aunque prefiere que le llame ${nickname.value}` : ''}, señor.`
        : 'Aún no me ha indicado su nombre, señor.',
    }
  }
  if (/^(?:cuando es mi cumpleanos|cuando cumplo anos|cual es mi cumpleanos)\??$/.test(command)) {
    const birthday = memories.find(
      (item) => item.category === 'profile' && normalized(item.label) === 'fecha de nacimiento',
    )
    return {
      type: 'reply',
      text: birthday
        ? `Su cumpleaños es el ${formatMemory(birthday)}, señor. ¿Desea que le recuerde esa fecha?`
        : 'Aún no me ha indicado su fecha de nacimiento, señor.',
    }
  }
  if (/^(?:cuantos anos tengo|que edad tengo)\??$/.test(command)) {
    const birthday = memories.find(
      (item) => item.category === 'profile' && normalized(item.label) === 'fecha de nacimiento',
    )
    const age = birthday && calculateAge(birthday.value)
    return {
      type: 'reply',
      text: age === null || age === undefined
        ? 'No tengo su fecha de nacimiento para calcular su edad, señor.'
        : `Tiene ${age} años, señor.`,
    }
  }
  if (/^(?:muestra(?:me)? mi perfil|ver mi perfil|mi perfil)\??$/.test(command)) {
    return { type: 'reply', text: 'He actualizado su perfil en el panel de memoria, señor.' }
  }
  if (/^(?:olvida(?: ese dato)?|olvida ese recuerdo)$/.test(command)) {
    return {
      type: 'reply',
      text: 'Abra el panel de memoria y seleccione “Eliminar” junto al dato que desea olvidar, señor.',
    }
  }
  if ((match = command.match(/^olvida(?: el dato)?\s+(.+)$/))) {
    const target = normalized(match[1])
    const item = memories.find(
      (memory) =>
        normalized(memory.label) === target ||
        normalized(memory.value) === target,
    )
    return item
      ? { type: 'delete', memory: item }
      : { type: 'reply', text: 'No encontré ese dato en su memoria, señor.' }
  }

  return null
}

function App() {
  const [phase, setPhase] = useState('loading')
  const [configured, setConfigured] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [memories, setMemories] = useState([])
  const [events, setEvents] = useState([])
  const [conversacion, setConversacion] = useState([])
  const [chatLoaded, setChatLoaded] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [escuchando, setEscuchando] = useState(false)
  const [nucleoActivo, setNucleoActivo] = useState(false)
  const [detectorAplausosActivo, setDetectorAplausosActivo] = useState(false)
  const [activandoDetectorAplausos, setActivandoDetectorAplausos] = useState(false)
  const [memoryForm, setMemoryForm] = useState({ category: 'profile', label: '', value: '' })
  const [editingId, setEditingId] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeSection, setActiveSection] = useState('console')
  const [loadingEvents, setLoadingEvents] = useState(false)
  const streamAplausos = useRef(null)
  const audioContextAplausos = useRef(null)
  const frameAplausos = useRef(null)
  const nucleoActivoRef = useRef(false)

  function detenerDetectorAplausos() {
    if (frameAplausos.current !== null) {
      window.cancelAnimationFrame(frameAplausos.current)
      frameAplausos.current = null
    }
    streamAplausos.current?.getTracks().forEach((track) => track.stop())
    streamAplausos.current = null
    if (audioContextAplausos.current && audioContextAplausos.current.state !== 'closed') {
      audioContextAplausos.current.close()
    }
    audioContextAplausos.current = null
  }

  useEffect(() => () => detenerDetectorAplausos(), [])

  function showNotice(message, type = 'success') {
    setNotice({ message, type })
  }

  function encenderNucleo() {
    nucleoActivoRef.current = true
    setNucleoActivo(true)
  }

  function alternarNucleo() {
    if (nucleoActivoRef.current) {
      nucleoActivoRef.current = false
      setNucleoActivo(false)
      window.speechSynthesis?.cancel()
      return
    }
    encenderNucleo()
    escuchar()
  }

  const loadPrivateData = useCallback(async () => {
    setPhase('loading')
    setConnectionError('')
    try {
      const [savedMemories, savedEvents, savedChat] = await Promise.all([
        api('/memories'),
        api('/events'),
        api('/chat'),
      ])
      let restoredChat = savedChat
      if (!savedChat.length) {
        const legacyChat = window.localStorage.getItem('jarvis-chat')
        if (legacyChat) {
          try {
            const parsedChat = JSON.parse(legacyChat)
            if (!Array.isArray(parsedChat)) {
              throw new Error('El historial guardado tiene un formato no reconocido.')
            }
            restoredChat = parsedChat.slice(-200)
            await api('/chat', {
              method: 'PUT',
              body: JSON.stringify({ messages: restoredChat }),
            })
            window.localStorage.removeItem('jarvis-chat')
          } catch (error) {
            showNotice(`No pude migrar el historial antiguo; sigue conservado en este navegador. ${error.message}`, 'error')
            restoredChat = []
          }
        }
      }
      setMemories(savedMemories)
      setEvents(savedEvents)
      setConversacion(restoredChat.length ? restoredChat : INITIAL_CHAT)
      setChatLoaded(true)
      setPhase('ready')
    } catch (error) {
      if (error.message.includes('Inicia sesión')) {
        setPhase('login')
        setChatLoaded(false)
      } else {
        setConnectionError(error.message)
        setPhase('offline')
      }
    }
  }, [])

  const loadStatus = useCallback(async () => {
    setPhase('loading')
    setConnectionError('')
    try {
      const status = await api('/status')
      setConfigured(status.configured)
      if (status.authenticated) {
        await loadPrivateData()
      } else {
        setPhase(status.configured ? 'login' : 'setup')
      }
    } catch (error) {
      setConnectionError(error.message)
      setPhase('offline')
    }
  }, [loadPrivateData])

  useEffect(() => {
    let active = true
    const initialization = Promise.resolve().then(() => {
      if (active) return loadStatus()
      return undefined
    })
    initialization.catch((error) => {
      if (active) setConnectionError(error.message)
    })
    return () => {
      active = false
    }
  }, [loadStatus])

  useEffect(() => {
    if (!chatLoaded || phase !== 'ready') return undefined
    const timeout = window.setTimeout(() => {
      api('/chat', {
        method: 'PUT',
        body: JSON.stringify({ messages: conversacion.slice(-200) }),
      }).catch((error) => showNotice(error.message, 'error'))
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [chatLoaded, conversacion, phase])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  async function submitPassword(event) {
    event.preventDefault()
    setAuthError('')
    setBusy(true)
    try {
      await api(configured ? '/login' : '/setup', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setPassword('')
      setConfigured(true)
      await loadPrivateData()
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveMemory(memory) {
    const saved = editingId
      ? await api(`/memories/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(memory),
      })
      : await api('/memories', {
        method: 'POST',
        body: JSON.stringify(memory),
      })
    setMemories((previous) => [
      saved,
      ...previous.filter(
        (item) =>
          item.id !== saved.id &&
          !(item.category === saved.category && normalized(item.label) === normalized(saved.label)),
      ),
    ])
    setEditingId(null)
    setMemoryForm({ category: 'profile', label: '', value: '' })
    setEvents(await api('/events'))
    return saved
  }

  async function deleteMemory(memory) {
    if (!window.confirm(`¿Desea eliminar “${memory.label}” de forma permanente?`)) return false
    await api(`/memories/${memory.id}`, { method: 'DELETE' })
    setMemories((previous) => previous.filter((item) => item.id !== memory.id))
    setEvents(await api('/events'))
    return true
  }

  async function refreshEvents() {
    setLoadingEvents(true)
    try {
      setEvents(await api('/events'))
    } catch (error) {
      showNotice(error.message, 'error')
    } finally {
      setLoadingEvents(false)
    }
  }

  function openSection(section) {
    setActiveSection(section)
    if (section === 'activity') refreshEvents()
  }

  function editProfileField(label) {
    const [, storedLabel] = PROFILE_FIELDS.find(([title]) => title === label)
    const memory = memories.find(
      (item) => item.category === 'profile' && normalized(item.label) === normalized(storedLabel),
    )
    setEditingId(memory?.id ?? null)
    setMemoryForm({
      category: 'profile',
      label: memory?.label ?? storedLabel,
      value: memory?.value ?? '',
    })
    setActiveSection('memory')
  }

  async function responder(text) {
    const command = getCommand(text, memories)
    if (!command) {
      const question = normalized(text)
      if (question.includes('hola')) return '¡Hola, señor! JARVIS está listo para ayudarle.'
      if (question.includes('hora')) return `La hora actual es ${new Date().toLocaleTimeString('es-BO')}`
      if (
        question.includes('fecha') ||
        question.includes('que dia') ||
        question.includes('que dia es hoy')
      ) {
        return `Hoy es ${new Date().toLocaleDateString('es-BO', { dateStyle: 'full' })}`
      }
      if (question.includes('abre google') || question.includes('abrir google')) {
        window.open('https://www.google.com', '_blank')
        return 'Abriendo Google, señor.'
      }
      if (question.includes('abre youtube') || question.includes('abrir youtube')) {
        window.open('https://www.youtube.com', '_blank')
        return 'Abriendo YouTube, señor.'
      }
      if (
        question.includes('calcula') ||
        question.includes('cuanto es')
      ) {
        const operation = question.match(
          /(-?\d+(?:[.,]\d+)?)\s*([+\-*/])\s*(-?\d+(?:[.,]\d+)?)/
        )
        if (!operation) return 'Escriba una operación como: calcula 25 + 15.'
        const first = Number(operation[1].replace(',', '.'))
        const second = Number(operation[3].replace(',', '.'))
        if (operation[2] === '/' && second === 0) {
          return 'No es posible dividir entre cero, señor.'
        }
        const result = operation[2] === '+' ? first + second
          : operation[2] === '-' ? first - second
            : operation[2] === '*' ? first * second
              : first / second
        return `El resultado es ${result}, señor.`
      }
      if (question.includes('quien eres')) return 'Soy JARVIS, su asistente virtual personal.'
      if (question.includes('gracias')) return 'Siempre a su servicio, señor.'
      return 'No tengo una respuesta programada para eso todavía, señor.'
    }
    if (command.type === 'reply') return command.text

    if (command.type === 'delete') {
      const deleted = await deleteMemory(command.memory)
      return deleted
        ? `He olvidado ${command.memory.label}, señor.`
        : 'No eliminé ningún dato, señor.'
    }

    const sensitive = /fecha de nacimiento|direccion|telefono|salud|contraseña|pasaporte|informacion privada|informacion adicional/i
      .test(`${command.label} ${command.value}`)
    if (
      sensitive &&
      !window.confirm(`JARVIS guardará “${command.label}” cifrado localmente en este dispositivo. ¿Autoriza guardar este dato?`)
    ) {
      return 'No guardé ese dato. Su privacidad es importante, señor.'
    }

    const saved = await saveMemory(command)
    return `He guardado ${saved.label} en su memoria, señor.`
  }

  async function enviarMensaje(event) {
    event.preventDefault()
    const texto = mensaje.trim()
    if (!texto || busy) return

    encenderNucleo()
    setBusy(true)
    setMensaje('')
    try {
      const respuesta = await responder(texto)
      setConversacion((previous) => [
        ...previous,
        { tipo: 'usuario', texto },
        { tipo: 'jarvis', texto: respuesta },
      ])
      hablar(respuesta)
    } catch (error) {
      showNotice(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  function hablar(texto) {
    if (!('speechSynthesis' in window)) {
      showNotice('Tu navegador no admite respuestas de voz.', 'error')
      return
    }
    window.speechSynthesis.cancel()
    const voz = new SpeechSynthesisUtterance(texto)
    voz.lang = 'es-ES'
    voz.rate = 1
    voz.pitch = 1
    window.speechSynthesis.speak(voz)
  }

  function escuchar() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      showNotice('El reconocimiento de voz no está disponible. Prueba con Google Chrome.', 'error')
      return
    }

    const reconocimiento = new SpeechRecognition()
    reconocimiento.lang = 'es-BO'
    reconocimiento.interimResults = false
    reconocimiento.maxAlternatives = 1
    reconocimiento.onstart = () => {
      encenderNucleo()
      setEscuchando(true)
    }
    reconocimiento.onresult = (evento) => setMensaje(evento.results[0][0].transcript)
    reconocimiento.onerror = () => {
      setEscuchando(false)
      showNotice('No pude reconocer tu voz. Revisa el micrófono y sus permisos.', 'error')
    }
    reconocimiento.onend = () => setEscuchando(false)
    reconocimiento.start()
  }

  async function alternarDetectorAplausos() {
    if (detectorAplausosActivo) {
      detenerDetectorAplausos()
      setDetectorAplausosActivo(false)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotice('La detección de aplausos requiere un navegador compatible y una conexión segura o local.', 'error')
      return
    }

    setActivandoDetectorAplausos(true)
    let stream
    let audioContext
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) {
        throw new Error('Este navegador no admite el análisis de audio necesario.')
      }
      audioContext = new AudioContext()
      await audioContext.resume()
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      audioContext.createMediaStreamSource(stream).connect(analyser)

      streamAplausos.current = stream
      audioContextAplausos.current = audioContext
      const samples = new Uint8Array(analyser.fftSize)
      let lastClapAt = window.performance.now()
      const detectClap = () => {
        analyser.getByteTimeDomainData(samples)
        let sumSquares = 0
        let peak = 0
        for (const sample of samples) {
          const amplitude = Math.abs((sample - 128) / 128)
          sumSquares += amplitude * amplitude
          peak = Math.max(peak, amplitude)
        }
        const rms = Math.sqrt(sumSquares / samples.length)
        const now = window.performance.now()
        if (!nucleoActivoRef.current && rms > 0.12 && peak > 0.4 && now - lastClapAt > 700) {
          lastClapAt = now
          encenderNucleo()
          showNotice('Aplauso detectado. JARVIS está escuchando.')
          escuchar()
        }
        frameAplausos.current = window.requestAnimationFrame(detectClap)
      }
      setDetectorAplausosActivo(true)
      frameAplausos.current = window.requestAnimationFrame(detectClap)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (audioContext && audioContext.state !== 'closed') audioContext.close()
      showNotice(`No pude activar la detección de aplausos. Revisa el permiso del micrófono. ${error.message}`, 'error')
    } finally {
      setActivandoDetectorAplausos(false)
    }
  }

  async function reiniciarConversacion() {
    const initial = [
      { tipo: 'jarvis', texto: 'Conversación reiniciada, señor. ¿En qué puedo ayudarte?' },
    ]
    setConversacion(initial)
    try {
      await api('/chat', { method: 'PUT', body: JSON.stringify({ messages: initial }) })
    } catch (error) {
      showNotice(error.message, 'error')
    }
  }

  async function wipeAllData() {
    if (!window.confirm('Se eliminarán permanentemente todos sus recuerdos, el perfil, el historial y los eventos. Esta acción no se puede deshacer. ¿Continuar?')) return
    if (!window.confirm('Confirme una vez más: ¿borrar permanentemente todos los datos personales de JARVIS?')) return
    try {
      detenerDetectorAplausos()
      setDetectorAplausosActivo(false)
      nucleoActivoRef.current = false
      setNucleoActivo(false)
      await api('/data', { method: 'DELETE' })
      await api('/logout', { method: 'POST' })
      setMemories([])
      setEvents([])
      setConversacion([])
      setChatLoaded(false)
      setConfigured(true)
      setPhase('login')
      showNotice('Todos los datos personales se eliminaron permanentemente.')
    } catch (error) {
      showNotice(error.message, 'error')
    }
  }

  async function logout() {
    try {
      detenerDetectorAplausos()
      setDetectorAplausosActivo(false)
      nucleoActivoRef.current = false
      setNucleoActivo(false)
      await api('/logout', { method: 'POST' })
      setMemories([])
      setEvents([])
      setConversacion([])
      setChatLoaded(false)
      setPhase('login')
    } catch (error) {
      showNotice(error.message, 'error')
    }
  }

  const profile = useMemo(
    () => PROFILE_FIELDS.map(([, storedLabel]) => memories.find(
      (memory) => memory.category === 'profile' && normalized(memory.label) === normalized(storedLabel),
    )),
    [memories],
  )

  if (phase === 'loading' || phase === 'offline') {
    return (
      <div className="jarvis auth-page">
        <section className="auth-card">
          <div className="logo auth-logo">J</div>
          <h1>J.A.R.V.I.S.</h1>
          {phase === 'loading' ? <p>Conectando con la memoria local...</p> : (
            <>
              <p className="notice error">{connectionError || 'No se pudo conectar con el servidor local.'}</p>
              <button type="button" className="primary-button" onClick={loadStatus}>Reintentar conexión</button>
              <p className="privacy-note">Inicie el servidor con <code>npm run dev</code>.</p>
            </>
          )}
        </section>
      </div>
    )
  }

  if (phase === 'setup' || phase === 'login') {
    return (
      <div className="jarvis auth-page">
        <form className="auth-card" onSubmit={submitPassword}>
          <div className="logo auth-logo">J</div>
          <p className="eyebrow">MEMORIA PERSONAL CIFRADA</p>
          <h1>{configured ? 'Bienvenido de nuevo' : 'Configure su memoria'}</h1>
          <p>
            {configured
              ? 'Autentíquese para consultar su perfil y recuerdos.'
              : 'Cree una contraseña maestra de al menos 12 caracteres. Sin ella no podrá acceder ni recuperar los datos.'}
          </p>
          <label htmlFor="master-password">Contraseña maestra</label>
          <input
            id="master-password"
            className="auth-input"
            type="password"
            minLength={configured ? undefined : 12}
            autoComplete={configured ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={256}
            autoFocus
          />
          {authError && <p className="notice error">{authError}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Un momento...' : configured ? 'Iniciar sesión' : 'Crear memoria segura'}
          </button>
          <p className="privacy-note">Los recuerdos y el historial se cifran en este equipo; no se envían a servicios externos.</p>
        </form>
      </div>
    )
  }

  return (
    <div className="jarvis app-shell">
      <header className="encabezado">
        <div className="logo">J</div>
        <div className="brand-copy">
          <h1>J.A.R.V.I.S.</h1>
          <p>JUST A RATHER VERY INTELLIGENT SYSTEM</p>
        </div>
        <span className="estado"><span className="punto-verde">●</span> MEMORIA CIFRADA</span>
        <button className="quiet-button logout-button" type="button" onClick={logout}>Bloquear</button>
      </header>

      <nav className="menu-bar" aria-label="Secciones de JARVIS">
        {sections.map((section) => (
          <button
            className={`menu-item${activeSection === section.id ? ' active' : ''}`}
            type="button"
            key={section.id}
            aria-current={activeSection === section.id ? 'page' : undefined}
            onClick={() => openSection(section.id)}
          >
            <span className="menu-icon" aria-hidden="true">{section.icon}</span>
            <span>{section.label}</span>
            {section.id === 'memory' && <small>{memories.length}</small>}
            {section.id === 'activity' && <small>{events.length}</small>}
          </button>
        ))}
      </nav>

      {notice && (
        <div className={`toast${notice.type === 'error' ? ' toast-error' : ''}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          <span className="toast-mark" aria-hidden="true">{notice.type === 'error' ? '!' : '✓'}</span>
          <span>{notice.message}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <main className={`workspace section-${activeSection}`}>
        {activeSection === 'console' && (
          <>
            <div className="console-grid">
              <aside className="system-rail dashboard-panel">
                <p className="panel-label">ESTADO DEL SISTEMA</p>
                <div className="status-line"><span>ASISTENTE</span><strong><i /> Preparado</strong></div>
                <div className="status-line"><span>MEMORIA LOCAL</span><strong><i /> Cifrada</strong></div>
                <div className="status-line"><span>RECUERDOS</span><strong>{memories.length} guardados</strong></div>
                <div className="status-line"><span>ACTIVIDAD</span><strong>{events.length} eventos</strong></div>
                <p className="rail-note">Los datos se guardan en este dispositivo.</p>
              </aside>

              <section className="console-center" aria-labelledby="conversation-title">
                <p className="eyebrow">ASISTENTE PERSONAL · ALMACENAMIENTO LOCAL</p>
                <button
                  type="button"
                  className={`core-orb${nucleoActivo ? ' awake' : ' off'}${escuchando ? ' listening' : ''}`}
                  onClick={alternarNucleo}
                  disabled={escuchando}
                  aria-label={escuchando
                    ? 'JARVIS está escuchando'
                    : nucleoActivo
                      ? 'Núcleo encendido. Pulsa para apagarlo'
                      : 'Núcleo apagado. Pulsa para encenderlo y hablar'}
                >
                  <span className="core-ring ring-one" />
                  <span className="core-ring ring-two" />
                  <span className="core-ring ring-three" />
                  <span className="core-letter">J</span>
                  <span className="core-caption">
                    {escuchando ? 'ESCUCHANDO' : nucleoActivo ? 'J.A.R.V.I.S.' : 'APAGADO'}
                  </span>
                </button>
                <h2 id="conversation-title">Converse con JARVIS</h2>
                <p className="console-subtitle">
                  {nucleoActivo
                    ? 'Núcleo encendido. Pulse el núcleo para apagarlo.'
                    : 'Núcleo apagado. Un aplauso o el botón del núcleo lo encienden.'}
                </p>
                <button
                  type="button"
                  className={`clap-toggle${detectorAplausosActivo ? ' active' : ''}`}
                  onClick={alternarDetectorAplausos}
                  disabled={activandoDetectorAplausos}
                  aria-pressed={detectorAplausosActivo}
                >
                  {activandoDetectorAplausos
                    ? 'Solicitando permiso del micrófono...'
                    : detectorAplausosActivo
                      ? 'Desactivar detección de aplausos'
                      : '👏 Activar detección de aplausos'}
                </button>
                <p className="clap-help">
                  {detectorAplausosActivo
                    ? 'El detector permanece activo mientras esta página está abierta; el aplauso enciende el núcleo.'
                    : 'Actívelo y conceda permiso al micrófono para despertar el núcleo con un aplauso.'}
                </p>

                <div className="chat" aria-live="polite">
                  {conversacion.map((item, index) => (
                    <div className={`chat-message ${item.tipo}`} key={`${index}-${item.texto}`}>
                      <p className="etiqueta">{item.tipo === 'usuario' ? 'USTED' : 'JARVIS'}</p>
                      <p>{item.texto}</p>
                      {item.tipo === 'jarvis' && (
                        <button className="boton-voz" type="button" onClick={() => hablar(item.texto)}>🔊 Escuchar</button>
                      )}
                    </div>
                  ))}
                </div>
                <form className="entrada" onSubmit={enviarMensaje}>
                  <input
                    type="text"
                    placeholder="Escriba un comando..."
                    value={mensaje}
                    onChange={(event) => setMensaje(event.target.value)}
                    aria-label="Mensaje para JARVIS"
                  />
                  <button className="boton-microfono" type="button" onClick={escuchar} disabled={escuchando}>
                    {escuchando ? '🎙️' : '🎤'}
                  </button>
                  <button type="submit" disabled={busy}>{busy ? 'Enviando...' : 'Enviar ➤'}</button>
                </form>
                <p className="command-help">Ejemplos: “mi nombre es Ana”, “recuerda que mi comida favorita es la pasta” o “¿cuántos años tengo?”.</p>
                <button className="conversation-reset" type="button" onClick={reiniciarConversacion}>Limpiar conversación</button>
              </section>

              <aside className="quick-rail dashboard-panel">
                <p className="panel-label">ACCESO RÁPIDO</p>
                <button type="button" onClick={() => openSection('profile')}>
                  <span className="quick-icon">◌</span>
                  <span><strong>Perfil personal</strong><small>Consultar o editar sus datos</small></span>
                  <b>›</b>
                </button>
                <button type="button" onClick={() => openSection('memory')}>
                  <span className="quick-icon">◇</span>
                  <span><strong>Memoria</strong><small>{memories.length} datos almacenados</small></span>
                  <b>›</b>
                </button>
                <button type="button" onClick={() => openSection('activity')}>
                  <span className="quick-icon">▤</span>
                  <span><strong>Actividad</strong><small>Ver cambios de recuerdos</small></span>
                  <b>›</b>
                </button>
                <div className="privacy-summary">
                  <span className="punto-verde">●</span>
                  <span>Sin conexión a servicios externos</span>
                </div>
              </aside>
            </div>
          </>
        )}

        {activeSection === 'profile' && (
          <section className="memory-panel page-panel" aria-labelledby="profile-title">
            <div className="section-heading">
              <div><p className="eyebrow">MEMORIA PERSISTENTE</p><h2 id="profile-title">Perfil personal</h2></div>
              <span className="memory-status"><span className="punto-verde">●</span> Protegido localmente</span>
            </div>
            <p className="page-description">Información que JARVIS utiliza para personalizar sus respuestas. Los campos vacíos aún no se han proporcionado.</p>
            <div className="profile-grid">
              {PROFILE_FIELDS.map(([label], index) => {
                const memory = profile[index]
                const age = memory && normalized(memory.label) === 'fecha de nacimiento'
                  ? calculateAge(memory.value)
                  : null
                return (
                  <article className="profile-field" key={label}>
                    <span>{label}</span>
                    <strong>{memory ? `${formatMemory(memory)}${age !== null ? ` · ${age} años` : ''}` : 'No indicado'}</strong>
                    <button className="quiet-button" type="button" onClick={() => editProfileField(label)}>
                      {memory ? 'Editar' : 'Añadir'}
                    </button>
                  </article>
                )
              })}
            </div>
            <button className="primary-button page-action" type="button" onClick={() => {
              setMemoryForm({ category: 'profile', label: '', value: '' })
              setEditingId(null)
              setActiveSection('memory')
            }}>Añadir otro dato al perfil</button>
          </section>
        )}

        {activeSection === 'memory' && (
          <section className="memory-panel page-panel" aria-labelledby="memories-title">
            <div className="section-heading">
              <div><p className="eyebrow">ALMACENAMIENTO LOCAL CIFRADO</p><h2 id="memories-title">Memoria personal</h2></div>
              <span className="memory-status"><span className="punto-verde">●</span> {memories.length} recuerdos</span>
            </div>
            <p className="page-description">Añada o actualice información que JARVIS recordará. Los cambios se guardan en este dispositivo.</p>
            <form
              className="memory-form"
              onSubmit={async (event) => {
                event.preventDefault()
                try {
                  const isSensitive = /fecha|nacimiento|direccion|telefono|salud|pasaporte|contraseña|privad/i
                    .test(`${memoryForm.label} ${memoryForm.value}`)
                  if (
                    isSensitive &&
                    !window.confirm(`Se guardará “${memoryForm.label}” cifrado en este equipo. ¿Autoriza almacenar este dato sensible?`)
                  ) return
                  const saved = await saveMemory(memoryForm)
                  showNotice(`${saved.label} guardado correctamente.`)
                } catch (error) {
                  showNotice(error.message, 'error')
                }
              }}
            >
              <label>
                <span>Tipo de dato</span>
                <select value={memoryForm.category} onChange={(event) => setMemoryForm({ ...memoryForm, category: event.target.value })}>
                  <option value="profile">Perfil</option>
                  <option value="preference">Gusto o preferencia</option>
                  <option value="note">Información adicional</option>
                </select>
              </label>
              <label>
                <span>Nombre del dato</span>
                <input
                  value={memoryForm.label}
                  onChange={(event) => setMemoryForm({ ...memoryForm, label: event.target.value })}
                  placeholder="Ej.: Comida favorita"
                  required
                  maxLength={80}
                />
              </label>
              <label>
                <span>Información</span>
                <input
                  type={normalized(memoryForm.label) === 'fecha de nacimiento' ? 'date' : 'text'}
                  value={memoryForm.value}
                  onChange={(event) => setMemoryForm({ ...memoryForm, value: event.target.value })}
                  placeholder="Escriba un valor"
                  required
                  maxLength={1000}
                />
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit">{editingId ? 'Guardar cambios' : 'Añadir dato'}</button>
                {editingId && <button className="quiet-button" type="button" onClick={() => {
                  setEditingId(null)
                  setMemoryForm({ category: 'profile', label: '', value: '' })
                }}>Cancelar</button>}
              </div>
            </form>

            {memories.length === 0 ? <p className="empty-state">Todavía no hay recuerdos guardados.</p> : (
              <div className="memory-list">
                {memories.map((memory) => (
                  <article className="memory-row" key={memory.id}>
                    <div className="memory-copy">
                      <span className="memory-tag">{categoryNames[memory.category]}</span>
                      <strong>{memory.label}</strong>
                      <span>{formatMemory(memory)}</span>
                      <small>Actualizado {new Date(memory.updatedAt).toLocaleString('es-BO')}</small>
                    </div>
                    <div className="row-actions">
                      <button className="quiet-button" type="button" onClick={() => {
                        setEditingId(memory.id)
                        setMemoryForm({ category: memory.category, label: memory.label, value: memory.value })
                      }}>Editar</button>
                      <button className="danger-button" type="button" onClick={() => deleteMemory(memory).catch((error) => showNotice(error.message, 'error'))}>Eliminar</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <section className="privacy-panel">
              <div><p className="eyebrow">CONTROL DE PRIVACIDAD</p><h3>Sus datos, bajo su control</h3><p>Los recuerdos y la conversación se cifran localmente; no se envían a servicios externos.</p></div>
              <button className="danger-button" type="button" onClick={wipeAllData}>Borrar todos mis datos</button>
            </section>
          </section>
        )}

        {activeSection === 'activity' && (
          <section className="memory-panel page-panel" aria-labelledby="activity-title">
            <div className="section-heading">
              <div><p className="eyebrow">REGISTRO LOCAL DE CAMBIOS</p><h2 id="activity-title">Actividad de la memoria</h2></div>
              <button className="quiet-button" type="button" onClick={refreshEvents} disabled={loadingEvents}>
                {loadingEvents ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
            <p className="page-description">Aquí puede revisar cuándo se añadió, editó o eliminó un recuerdo. Este registro no incluye el contenido privado de los datos.</p>
            <div className="activity-summary">
              <strong>{events.length}</strong>
              <span>{events.length === 1 ? 'cambio registrado' : 'cambios registrados'}</span>
            </div>
            {events.length === 0 ? <p className="empty-state">Todavía no hay cambios. Al guardar, editar o eliminar un recuerdo, aparecerá aquí.</p> : (
              <ul className="event-list">
                {events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`}>
                    <span className={`event-action action-${event.action}`}><i />{event.action === 'created' ? 'Añadido' : event.action === 'updated' ? 'Editado' : event.action === 'deleted' ? 'Eliminado' : 'Borrado'}</span>
                    <span>{event.category ? categoryNames[event.category] : 'Todos los datos'}</span>
                    <time>{new Date(event.createdAt).toLocaleString('es-BO')}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
      <footer>JARVIS 2026 | MEMORIA PERSONAL LOCAL</footer>
    </div>
  )
}

export default App
