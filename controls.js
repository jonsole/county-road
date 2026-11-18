export const KEY_ACTIONS = {
  left: 'Steer left', right: 'Steer right', throttle: 'Throttle', brake: 'Brake',
  reverse: 'Toggle reverse', reset: 'Recover car',
  shiftDown: 'Shift down', shiftUp: 'Shift up', gearbox: 'Toggle manual gearbox',
  headlights: 'Headlights on / off',
}
export const DEVICE_ACTIONS = {
  steer: 'Steering', throttle: 'Throttle', brake: 'Brake', lookX: 'Look left / right',
  lookY: 'Look up / down', reverse: 'Toggle reverse', reset: 'Recover car',
  shiftDown: 'Shift down', shiftUp: 'Shift up', gearbox: 'Toggle manual gearbox',
  headlights: 'Headlights on / off',
}
export const centeredAction = action => action === 'steer' || action === 'lookX' || action === 'lookY'
const PULSE_ACTIONS = ['reverse', 'reset', 'shiftDown', 'shiftUp', 'gearbox', 'headlights']
export const buttonAction = action => PULSE_ACTIONS.includes(action)
const ZERO = {
  steer: 0, throttle: 0, brake: 0, lookX: 0, lookY: 0,
  reverse: false, reset: false, shiftDown: false, shiftUp: false, gearbox: false, headlights: false,
}
const STORAGE_KEY = 'county-road-controls-v1'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function defaultKeys() {
  return {
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'],
    reverse: ['KeyF', null], reset: ['KeyR', null],
    shiftDown: ['KeyQ', null], shiftUp: ['KeyE', null], gearbox: ['KeyM', null],
    headlights: ['KeyL', null],
  }
}

export function newBinding(action, source, index, standard = false) {
  return {
    source, index, start: source === 'axis' ? -1 : 0, center: 0, end: 1,
    deadzone: standard && centeredAction(action) ? 0.1 : source === 'axis' ? 0.02 : 0,
    inverted: false,
  }
}

export function defaultDevice(device) {
  if (device.mapping !== 'standard') return {}
  return {
    steer: newBinding('steer', 'axis', 0, true), throttle: newBinding('throttle', 'button', 7),
    brake: newBinding('brake', 'button', 6), lookX: newBinding('lookX', 'axis', 2, true),
    lookY: newBinding('lookY', 'axis', 3, true), reverse: newBinding('reverse', 'button', 0),
    reset: newBinding('reset', 'button', 3), headlights: newBinding('headlights', 'button', 2),
  }
}

export function loadBindings(storage) {
  const config = { keys: defaultKeys(), devices: {} }
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? 'null')
    for (const action of Object.keys(KEY_ACTIONS)) {
      if (Array.isArray(saved?.keys?.[action])) {
        config.keys[action] = [0, 1].map(slot => {
          const value = saved.keys[action][slot]
          return typeof value === 'string' && value !== 'Escape' && value !== 'Tab' ? value : null
        })
      }
    }
    if (saved?.devices && typeof saved.devices === 'object' && !Array.isArray(saved.devices)) {
      config.devices = saved.devices
    }
  } catch {
    // The game can still use the defaults when storage is unavailable.
  }
  return config
}

export function saveBindings(config, storage) {
  try {
    const target = storage ?? globalThis.localStorage
    if (!target) return false
    target.setItem(STORAGE_KEY, JSON.stringify(config))
    return true
  } catch {
    return false
  }
}

export function deviceKey(device) {
  return `${device.mapping}:${device.id || `${device.axes.length} axes/${device.buttons.length} buttons`}`
}

function deduplicateFanatec(devices) {
  const unique = []
  const layouts = new Map()
  const reportsInput = device => device.axes.some(value => Math.abs(value) > 0.0001)
    || device.buttons.some(button => button.pressed || button.value > 0.0001)

  for (const device of devices) {
    if (!/fanatec|vendor:\s*0eb7/i.test(device.id)) {
      unique.push(device)
      continue
    }
    const key = `${deviceKey(device)}:${device.axes.length}/${device.buttons.length}`
    const index = layouts.get(key)
    if (index === undefined) {
      layouts.set(key, unique.length)
      unique.push(device)
    } else if (!reportsInput(unique[index]) && reportsInput(device)) {
      // Some Fanatec bases expose an all-zero duplicate alongside the real controls.
      unique[index] = device
    }
  }
  return unique
}

export function getDevices() {
  try {
    const devices = Array.from(navigator.getGamepads?.() ?? []).filter(device => device?.connected)
    return devices.length < 2 ? devices : deduplicateFanatec(devices)
  } catch {
    return []
  }
}

export function deviceBindings(config, device) {
  return config.devices[deviceKey(device)] ?? defaultDevice(device)
}

export function rawValue(device, binding) {
  if (!binding) return undefined
  return binding.source === 'axis' ? device.axes[binding.index] : device.buttons[binding.index]?.value
}

export function bindingValue(device, action, binding) {
  if (buttonAction(action)) {
    return binding?.source === 'button' && Boolean(device.buttons[binding.index]?.pressed)
  }
  const raw = rawValue(device, binding)
  if (!Number.isFinite(raw)) return 0
  const span = binding.end - binding.start
  if (!Number.isFinite(span) || Math.abs(span) < 0.04) return 0
  const progress = clamp((raw - binding.start) / span, 0, 1)
  const deadzone = clamp(binding.deadzone || 0, 0, 0.95)
  const outsideDeadzone = value => Math.max(0, (value - deadzone) / (1 - deadzone))
  if (!centeredAction(action)) return outsideDeadzone(progress)
  const center = (binding.center - binding.start) / span
  if (!Number.isFinite(center) || center <= 0 || center >= 1) return 0
  const signed = progress < center ? (progress - center) / center : (progress - center) / (1 - center)
  return Math.sign(signed) * outsideDeadzone(Math.abs(signed)) * (binding.inverted ? -1 : 1)
}

export function readGamepad(device, bindings) {
  if (!device?.connected) return { ...ZERO }
  const profile = bindings ?? defaultDevice(device)
  return Object.fromEntries(Object.keys(DEVICE_ACTIONS).map(action => [
    action, bindingValue(device, action, profile[action]),
  ]))
}

export function createControls(config = loadBindings(), isPaused = () => false) {
  const keys = new Set()
  const taps = new Set()
  const clearKeys = () => {
    keys.clear()
    taps.clear()
  }
  window.addEventListener('keydown', event => {
    if (isPaused() || event.ctrlKey || event.metaKey || event.altKey
      || (['Enter', 'Space'].includes(event.code) && event.target?.closest?.('button'))
      || !Object.values(config.keys).some(codes => codes.includes(event.code))) return
    event.preventDefault()
    if (!event.repeat) {
      keys.add(event.code)
      taps.add(event.code)
    }
  })
  window.addEventListener('keyup', event => keys.delete(event.code))
  window.addEventListener('blur', clearKeys)
  let previous = ZERO

  return () => {
    const devices = getDevices()
    const input = { ...ZERO }
    for (const device of devices) {
      const values = readGamepad(device, deviceBindings(config, device))
      for (const action of Object.keys(DEVICE_ACTIONS)) {
        if (Math.abs(values[action]) > Math.abs(input[action])) input[action] = values[action]
      }
    }
    const connected = devices.length > 0
    if (isPaused()) {
      clearKeys()
      previous = input
      return { ...ZERO, connected, devices }
    }
    const hasInput = (action, set = keys) => config.keys[action]?.some(code => set.has(code)) ?? false
    const keySteer = Number(hasInput('right')) - Number(hasInput('left'))
    const keyboardSteering = input.steer === 0 && keySteer !== 0
    const output = {
      ...input, connected, devices, keyboardSteering,
      steer: keyboardSteering ? keySteer : input.steer,
      throttle: Math.max(input.throttle, Number(hasInput('throttle'))),
      brake: Math.max(input.brake, Number(hasInput('brake'))),
    }
    for (const action of PULSE_ACTIONS) {
      output[action] = hasInput(action, taps) || (input[action] && !previous[action])
    }
    taps.clear()
    previous = input
    return output
  }
}
