import assert from 'node:assert/strict'
import test from 'node:test'
import { PRESETS, loadGraphics, saveGraphics } from './graphics.js'

const memory = (initial = {}) => {
  const data = { ...initial }
  return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value } }
}

test('graphics default to Auto, which is Medium off a touch screen', () => {
  assert.deepEqual(loadGraphics(memory()), { preset: 'auto', ...PRESETS.medium })
})

test('a preset fills in its parts, and a custom choice keeps its own', () => {
  const storage = memory()
  saveGraphics({ preset: 'high', resolution: 'low', shadows: 'off', trees: 'low' }, storage)
  assert.deepEqual(loadGraphics(storage), { preset: 'high', ...PRESETS.high })
  saveGraphics({ preset: 'custom', resolution: 'native', shadows: 'off', trees: 'high' }, storage)
  assert.deepEqual(loadGraphics(storage), { preset: 'custom', resolution: 'native', shadows: 'off', trees: 'high' })
})

test('unreadable or unknown saved graphics fall back safely', () => {
  assert.equal(loadGraphics(memory({ 'county-road-graphics': '{not json' })).preset, 'auto')
  const odd = loadGraphics(memory({ 'county-road-graphics': JSON.stringify({ preset: 'custom', resolution: 'huge', shadows: 7 }) }))
  assert.deepEqual(odd, { preset: 'custom', resolution: 'medium', shadows: 'medium', trees: 'medium' })
})
