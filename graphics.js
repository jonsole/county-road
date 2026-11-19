// Graphics quality (Settings → Graphics): a preset, or each part set by
// hand. Resolution changes at once; shadows and trees are built when the
// game loads, so changing those reloads the page.

const KEY = 'county-road-graphics'

/** Resolution: the most device pixels per CSS pixel, and the most pixels drawn in all. */
export const RESOLUTION = {
  low: { label: 'Low (fastest)', ratio: 1, pixels: 1024 * 768 },
  medium: { label: 'Medium', ratio: 1.25, pixels: 1920 * 1080 },
  high: { label: 'High', ratio: 2, pixels: 2560 * 1440 },
  native: { label: "Full (the screen's own)", ratio: Infinity, pixels: Infinity },
}

/** Sun shadows (shadows.js SHADOW_LEVELS: how sharp and how far they reach). */
export const SHADOWS = {
  off: { label: 'Off' },
  low: { label: 'Low (to 250 m)' },
  medium: { label: 'Medium (to 500 m)' },
  high: { label: 'High (to 900 m)' },
}

/** Tree detail: forest.js TREE_QUALITY. */
export const TREES = {
  low: { label: 'Low (fewer leaves, shorter leafy range)' },
  medium: { label: 'Medium' },
  high: { label: 'High (most leaves, longest leafy range)' },
}

export const PRESETS = {
  low: { resolution: 'low', shadows: 'low', trees: 'low' },
  medium: { resolution: 'medium', shadows: 'medium', trees: 'medium' },
  high: { resolution: 'high', shadows: 'high', trees: 'high' },
}

const touchFirst = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false

/** The preset Auto picks: Low on phones and tablets, Medium otherwise. */
export const autoPreset = () => (touchFirst() ? 'low' : 'medium')

/**
 * The saved choice: { preset: 'auto' | 'low' | 'medium' | 'high' | 'custom',
 * resolution, shadows, trees } (the parts filled in from the preset).
 */
export function loadGraphics(storage = globalThis.localStorage) {
  let saved = {}
  try { saved = JSON.parse(storage?.getItem(KEY)) ?? {} } catch {}
  const preset = ['auto', 'custom', ...Object.keys(PRESETS)].includes(saved.preset) ? saved.preset : 'auto'
  const parts = preset === 'custom' ? saved : PRESETS[preset === 'auto' ? autoPreset() : preset]
  return {
    preset,
    resolution: RESOLUTION[parts.resolution] ? parts.resolution : 'medium',
    shadows: SHADOWS[parts.shadows] ? parts.shadows : 'medium',
    trees: TREES[parts.trees] ? parts.trees : 'medium',
  }
}

export function saveGraphics(graphics, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(graphics)) } catch {}
}

/**
 * The Graphics tab: a preset and the three parts. onResolution(graphics)
 * when only the resolution changed; the page reloads for shadows and trees.
 */
export function createGraphicsSettings(root, graphics, onResolution, reload = () => location.reload()) {
  const rows = [
    ['preset', 'Preset', { auto: `Auto (${autoPreset() === 'low' ? 'Low' : 'Medium'} on this device)`, low: 'Low', medium: 'Medium', high: 'High', custom: 'Custom' }],
    ['resolution', 'Resolution', Object.fromEntries(Object.entries(RESOLUTION).map(([k, v]) => [k, v.label]))],
    ['shadows', 'Shadows', Object.fromEntries(Object.entries(SHADOWS).map(([k, v]) => [k, v.label]))],
    ['trees', 'Trees', Object.fromEntries(Object.entries(TREES).map(([k, v]) => [k, v.label]))],
  ]
  const inputs = {}
  const note = document.createElement('p')
  note.className = 'settings-help'
  note.textContent = 'Shadows and trees take effect after a quick reload; your car starts again from the beginning.'
  for (const [key, label, options] of rows) {
    const row = document.createElement('label')
    row.className = 'sky-row'
    const name = document.createElement('span')
    name.textContent = label
    const input = document.createElement('select')
    input.id = `graphics-${key}`
    for (const [value, text] of Object.entries(options)) input.append(new Option(text, value))
    input.value = graphics[key]
    input.addEventListener('change', () => {
      const before = { ...graphics }
      if (key === 'preset') {
        graphics.preset = input.value
        if (input.value !== 'custom') Object.assign(graphics, PRESETS[input.value === 'auto' ? autoPreset() : input.value])
      } else {
        graphics[key] = input.value
        graphics.preset = 'custom'
      }
      for (const [k] of rows) inputs[k].value = graphics[k]
      saveGraphics(graphics)
      if (before.shadows !== graphics.shadows || before.trees !== graphics.trees) reload()
      else onResolution(graphics)
    })
    inputs[key] = input
    row.append(name, input)
    root.append(row)
  }
  root.append(note)
}
