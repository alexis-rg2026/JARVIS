import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from './app.js'
import { createStorage } from './storage.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(directory, '..')
const databasePath = process.env.JARVIS_DB_PATH
  ? path.resolve(process.env.JARVIS_DB_PATH)
  : path.join(projectDirectory, 'data', 'jarvis.sqlite')

mkdirSync(path.dirname(databasePath), { recursive: true })

const storage = createStorage(databasePath)
const app = createApp(storage)
const serveFrontend = process.argv.includes('--serve')

if (serveFrontend) {
  const distDirectory = path.join(projectDirectory, 'dist')
  app.use(express.static(distDirectory))
  app.get(/^(?!\/api).*/, (request, response) => {
    response.sendFile(path.join(distDirectory, 'index.html'))
  })
}

const port = Number(process.env.JARVIS_PORT ?? 3001)
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`JARVIS API disponible en http://127.0.0.1:${port}`)
  if (serveFrontend) {
    console.log(`JARVIS disponible en http://127.0.0.1:${port}`)
  }
})

function shutdown() {
  server.close(() => {
    storage.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
