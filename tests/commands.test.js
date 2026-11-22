import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getWebAction } from '../commands.js'

test('opens approved websites and explicit public HTTP URLs only', () => {
  assert.deepEqual(getWebAction('JARVIS, entra a YouTube'), {
    type: 'open',
    url: 'https://www.youtube.com',
    response: 'Abriendo YouTube, señor.',
  })
  assert.equal(getWebAction('abre github.com/proyectos').url, 'https://github.com/proyectos')
  assert.equal(getWebAction('javascript:alert(1)'), null)
  assert.equal(getWebAction('abre javascript:alert(1)'), null)
  assert.equal(getWebAction('abre una palabra con espacios'), null)
})

test('searches natural research commands using an encoded query', () => {
  const action = getWebAction('Investiga sobre energía solar en internet')
  assert.equal(action.type, 'research')
  assert.equal(action.query, 'energia solar')
  assert.equal(new URL(action.fallbackUrl).searchParams.get('q'), 'energia solar')

  const question = getWebAction('¿Qué es la fotosíntesis?')
  assert.equal(question.type, 'research')
  assert.equal(question.query, 'la fotosintesis')

  assert.equal(getWebAction('busca canciones para trabajar en Google').type, 'research')
  assert.equal(getWebAction('¿Qué significa inteligencia artificial?').query, 'inteligencia artificial')
  assert.equal(getWebAction('define fotosíntesis').query, 'fotosintesis')
})

test('never interprets Windows drives as web links', () => {
  const action = getWebAction('entra a disco local C')
  assert.equal(action.type, 'local')
  assert.match(action.response, /no puede abrir ni explorar unidades de Windows/)
  assert.equal(getWebAction('abre la unidad D:').type, 'local')
  assert.equal(getWebAction('hablame de mi comida favorita'), null)
})
