const SEARCH_ENGINE = 'https://www.google.com/search?q='

const KNOWN_SITES = new Map([
  ['youtube', { url: 'https://www.youtube.com', name: 'YouTube' }],
  ['youtube web', { url: 'https://www.youtube.com', name: 'YouTube' }],
  ['google', { url: 'https://www.google.com', name: 'Google' }],
  ['github', { url: 'https://github.com', name: 'GitHub' }],
  ['whatsapp', { url: 'https://web.whatsapp.com', name: 'WhatsApp Web' }],
  ['whatsapp web', { url: 'https://web.whatsapp.com', name: 'WhatsApp Web' }],
])

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
}

function parsePublicUrl(value) {
  const candidate = value.trim().replace(/[.,!?]+$/, '')
  const hasProtocol = /^https?:\/\//i.test(candidate)
  const hasPublicDomain = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(candidate)
  if (!hasProtocol && !hasPublicDomain) return null

  try {
    const url = new URL(hasProtocol ? candidate : `https://${candidate}`)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !url.hostname.includes('.') ||
      url.username ||
      url.password
    ) return null
    return url
  } catch {
    return null
  }
}

function parseSearch(text) {
  const command = normalize(text).replace(/^jarvis[,\s]+/, '').replace(/^[¿¡\s]+/, '')
  const searchCommand = command.match(
    /^(?:busca(?:r)?|investiga(?:r)?(?:me)?|consulta(?:r)?(?:me)?|averigua(?:r)?|explica|define|haz una investigacion sobre)\s+(?:(?:sobre|de|el concepto de|que es)\s+)?(.+?)(?:\s+(?:en|por)\s+(?:google|internet|la web))?[?.!]*$/,
  )
  const questionCommand = command.match(
    /^(?:que es|que significa|que quiere decir|cual es|quien es|quien fue|como funciona|por que|para que sirve|donde queda|cuando ocurrio|cuales son)\s+(.+?)\??$/,
  )
  const query = (searchCommand?.[1] || questionCommand?.[1] || '').trim()
  return query ? query.replace(/[?.!]+$/, '').trim() : null
}

export function getWebAction(text) {
  const input = String(text || '').trim()
  if (!input) return null

  const query = parseSearch(input)
  if (query) {
    return {
      type: 'research',
      query,
      fallbackUrl: `${SEARCH_ENGINE}${encodeURIComponent(query)}`,
    }
  }

  const command = input.replace(/^jarvis[,\s]+/i, '').trim()
  const openCommand = command.match(/^(?:abre|abrir|entra a|ve a|open)\s+(.+)$/i)
  if (openCommand) {
    const target = openCommand[1].trim()
    const normalizedTarget = normalize(target).replace(/[.,!?]+$/, '')
    if (
      /(?:disco local|disco duro|unidad|explorador de archivos|(?:^|\s)[a-z]:(?:\s|$))/i.test(normalizedTarget)
    ) {
      return {
        type: 'local',
        response: 'Por seguridad, esta página no puede abrir ni explorar unidades de Windows. Use “Adjuntar archivo” para elegir un archivo manualmente, señor.',
      }
    }

    const site = KNOWN_SITES.get(normalizedTarget)
    if (site) {
      return {
        type: 'open',
        url: site.url,
        response: `Abriendo ${site.name}, señor.`,
      }
    }

    const url = parsePublicUrl(target)
    if (url) {
      return {
        type: 'open',
        url: url.href,
        response: `Abriendo ${url.hostname}, señor.`,
      }
    }
    return null
  }

  const directUrl = parsePublicUrl(input)
  return directUrl
    ? {
        type: 'open',
        url: directUrl.href,
        response: `Abriendo ${directUrl.hostname}, señor.`,
      }
    : null
}
