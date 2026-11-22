export async function api(path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  })
  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.error || 'No se pudo completar la solicitud.')
  }
  return result
}
