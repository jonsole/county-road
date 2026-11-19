import {
  KEY_ACTIONS, DEVICE_ACTIONS, bindingValue, buttonAction, centeredAction, defaultKeys,
  deviceBindings, deviceKey, newBinding, rawValue, saveBindings,
} from './controls.js'

const select = id => document.getElementById(id)

export function keyLabel(code) {
  if (!code) return 'Unbound'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow'
  return code
}

function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function button(text, onClick) {
  const node = element('button', text)
  node.type = 'button'
  node.addEventListener('click', onClick)
  return node
}

export function createSettings(config, onChange) {
  const dialog = select('settings')
  const keyboard = select('key-bindings')
  const deviceFields = select('device-settings-fields')
  const devicePicker = select('input-device')
  const deviceHelp = select('device-help')
  const bindingRows = select('device-bindings')
  const status = select('settings-status')
  const reset = select('reset-bindings')
  const tabs = [...dialog.querySelectorAll('[data-panel]')]
  let panel = 'keyboard'
  let capture
  let devices = []
  let deviceSignature = ''
  let liveRows = []
  const selectedDevice = () => devices[devicePicker.selectedIndex]

  function save() {
    status.textContent = saveBindings(config) ? 'Bindings saved' : 'Bindings applied for this session'
    onChange()
  }

  function labelKeyButton(node, action, slot) {
    const label = keyLabel(config.keys[action][slot])
    node.textContent = label
    node.setAttribute('aria-label', `${KEY_ACTIONS[action]} ${slot === 0 ? 'primary' : 'alternate'} key, ${label}`)
  }

  function renderKeyboard() {
    keyboard.replaceChildren()
    for (const [action, label] of Object.entries(KEY_ACTIONS)) {
      const row = element('div', undefined, 'key-row')
      row.append(element('span', label))
      config.keys[action].forEach((_, slot) => {
        const node = button('', () => {
          cancelCapture()
          capture = { kind: 'key', action, slot, node }
          node.textContent = 'Press a key'
          status.textContent = 'Press a key to assign it, or Esc to cancel.'
        })
        node.id = `key-${action}-${slot}`
        labelKeyButton(node, action, slot)
        row.append(node)
      })
      keyboard.append(row)
    }
  }

  function cancelCapture() {
    if (!capture) return
    if (capture.kind === 'key') labelKeyButton(capture.node, capture.action, capture.slot)
    else capture.node.textContent = 'Detect'
    capture = undefined
    status.textContent = ''
  }

  function assignKey(code) {
    const { action, slot } = capture
    if (code && config.keys[action][slot] !== code) {
      for (const keys of Object.values(config.keys)) {
        const existing = keys.indexOf(code)
        if (existing !== -1) keys[existing] = config.keys[action][slot]
      }
    }
    config.keys[action][slot] = code
    capture = undefined
    renderKeyboard()
    select(`key-${action}-${slot}`).focus()
    save()
  }

  function setBinding(device, action, binding) {
    config.devices[deviceKey(device)] = { ...deviceBindings(config, device), [action]: binding }
  }

  function calibrationButtons(action, source) {
    if (source === 'button') return []
    if (action === 'steer' || action === 'lookX') return [['start', 'Left'], ['center', 'Center'], ['end', 'Right']]
    if (action === 'lookY') return [['start', 'Up'], ['center', 'Center'], ['end', 'Down']]
    return [['start', 'Released'], ['end', 'Pressed']]
  }

  function renderDevice() {
    bindingRows.replaceChildren()
    liveRows = []
    const device = selectedDevice()
    deviceFields.hidden = !device
    reset.disabled = panel === 'devices' && !device
    deviceHelp.textContent = device
      ? 'Use Detect with the wheel centred and pedals released. Then move one control and use the calibration buttons to record its full range.'
      : 'Connect a controller or wheel, then press a button on it with this tab focused. For a Fanatec CSL DD, try yellow PC Compatibility mode if it does not appear.'
    if (!device) return
    const profile = deviceBindings(config, device)
    Object.entries(DEVICE_ACTIONS).forEach(([action, label]) => {
      const centered = centeredAction(action)
      const digital = buttonAction(action)
      const binding = profile[action]
      const row = element('div', undefined, 'device-row')
      const heading = element('label', label)
      heading.htmlFor = `input-${action}`
      const source = element('select')
      source.id = heading.htmlFor
      source.add(new Option('Unbound', ''))
      if (!digital) device.axes.forEach((_, index) => source.add(new Option(`Axis ${index}`, `axis:${index}`)))
      if (!centered) device.buttons.forEach((_, index) => source.add(new Option(`Button ${index}`, `button:${index}`)))
      source.value = binding ? `${binding.source}:${binding.index}` : ''
      if (source.selectedIndex === -1) source.selectedIndex = 0
      source.addEventListener('change', () => {
        cancelCapture()
        const [kind, index] = source.value.split(':')
        const binding = kind ? newBinding(action, kind, Number(index), device.mapping === 'standard') : null
        if (kind === 'axis' && !centered) {
          const rest = rawValue(selectedDevice(), binding)
          if (Number.isFinite(rest)) {
            binding.start = rest
            binding.end = rest > 0 ? -1 : 1
          }
        }
        setBinding(device, action, binding)
        renderDevice()
        select(source.id).focus()
        save()
      })
      const detect = button('Detect', () => {
        cancelCapture()
        const active = selectedDevice()
        if (!active) return
        capture = { kind: 'device', action, node: detect, axes: [...active.axes],
          buttons: active.buttons.map(input => input.value) }
        detect.textContent = 'Listening…'
        status.textContent = digital ? 'Press the button to assign it.' : 'Move the axis or press the control to assign it.'
      })
      detect.id = `detect-${action}`
      detect.setAttribute('aria-label', `Detect input for ${label.toLowerCase()}`)
      detect.disabled = source.options.length === 1
      const live = element('output', undefined, 'input-reading')
      live.setAttribute('aria-label', `${label} input reading`)
      live.setAttribute('aria-live', 'off')
      liveRows.push({ action, node: live })
      row.append(heading, source, detect, live)
      if (binding && !digital && binding.source === 'axis') {
        const calibration = element('div', undefined, 'calibration')
        for (const [field, position] of calibrationButtons(action, binding.source)) {
          const record = button(`${position} ${binding[field].toFixed(2)}`, () => {
            const raw = rawValue(selectedDevice(), binding)
            if (!Number.isFinite(raw)) return
            setBinding(device, action, { ...deviceBindings(config, device)[action], [field]: raw })
            record.textContent = `${position} ${raw.toFixed(2)}`
            save()
          })
          record.setAttribute('aria-label', `Set ${label.toLowerCase()} ${position.toLowerCase()}`)
          calibration.append(record)
        }
        if (centered) {
          const label = element('label', undefined, 'invert-axis')
          const invert = element('input')
          invert.type = 'checkbox'
          invert.checked = binding.inverted
          invert.setAttribute('aria-label', `Invert ${DEVICE_ACTIONS[action].toLowerCase()}`)
          invert.addEventListener('change', () => {
            setBinding(device, action, { ...deviceBindings(config, device)[action], inverted: invert.checked })
            save()
          })
          label.append(invert, ' Invert')
          calibration.append(label)
        }
        const deadzoneLabel = element('label', undefined, 'deadzone')
        const deadzone = element('input')
        deadzone.type = 'number'
        deadzone.min = 0
        deadzone.max = 95
        deadzone.step = 1
        deadzone.value = Math.round(binding.deadzone * 100)
        deadzone.setAttribute('aria-label', `${DEVICE_ACTIONS[action]} dead zone percentage`)
        deadzone.addEventListener('change', () => {
          deadzone.value = Math.max(0, Math.min(95, deadzone.valueAsNumber || 0))
          setBinding(device, action, { ...deviceBindings(config, device)[action], deadzone: Number(deadzone.value) / 100 })
          save()
        })
        deadzoneLabel.append('Dead zone ', deadzone, '%')
        calibration.append(deadzoneLabel)
        row.append(calibration)
      }
      bindingRows.append(row)
    })
  }

  function detectInput(device) {
    const { action, axes, buttons } = capture
    const digital = buttonAction(action)
    const centered = centeredAction(action)
    const standard = device.mapping === 'standard'
    const buttonIndex = centered ? -1 : device.buttons.findIndex(
      (input, i) => input.value - (buttons[i] ?? 0) > 0.3,
    )
    let axisIndex = -1
    if (!digital && (!standard || buttonIndex === -1)) {
      let strongest = standard ? 0.28 : 0.06
      device.axes.forEach((value, i) => {
        const movement = Math.abs(value - axes[i])
        if (!Number.isFinite(movement) || movement <= strongest) return
        strongest = movement
        axisIndex = i
      })
    }
    if (axisIndex === -1 && buttonIndex === -1) return
    const kind = axisIndex === -1 ? 'button' : 'axis'
    const index = axisIndex === -1 ? buttonIndex : axisIndex
    const binding = newBinding(action, kind, index, device.mapping === 'standard')
    if (kind === 'axis' && !centeredAction(action)) {
      binding.start = axes[index]
      binding.end = device.axes[index] > binding.start ? 1 : -1
    }
    if (kind === 'axis' && centeredAction(action)) binding.center = axes[index]
    setBinding(device, action, binding)
    capture = undefined
    renderDevice()
    select(`detect-${action}`).focus()
    save()
  }

  function switchPanel(next) {
    cancelCapture()
    status.textContent = ''
    panel = next
    select('keyboard-settings').hidden = panel !== 'keyboard'
    select('devices-settings').hidden = panel !== 'devices'
    select('sky-settings').hidden = panel !== 'sky'
    select('graphics-settings').hidden = panel !== 'graphics'
    reset.hidden = panel === 'sky' || panel === 'graphics'
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.panel === panel))
    reset.textContent = panel === 'keyboard' ? 'Restore keyboard defaults' : 'Restore device defaults'
    if (panel === 'keyboard') reset.disabled = false
    else if (panel === 'devices') renderDevice()
  }

  function open() {
    status.textContent = ''
    dialog.showModal()
  }

  select('open-settings').addEventListener('click', open)
  select('close-settings').addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', event => {
    // A platform close request may come from the native select picker.
    if (dialog.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') {
      event.preventDefault()
    }
  })
  dialog.addEventListener('close', () => {
    cancelCapture()
    select('game').focus({ preventScroll: true })
  })
  for (const tab of tabs) tab.addEventListener('click', () => switchPanel(tab.dataset.panel))
  devicePicker.addEventListener('change', () => {
    cancelCapture()
    renderDevice()
  })
  reset.addEventListener('click', () => {
    cancelCapture()
    if (panel === 'keyboard') {
      config.keys = defaultKeys()
      renderKeyboard()
    } else {
      const device = selectedDevice()
      if (!device) return
      delete config.devices[deviceKey(device)]
      renderDevice()
    }
    save()
  })
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && !dialog.open && !event.repeat) {
      event.preventDefault()
      open()
      return
    }
    if (!dialog.open || !capture || event.code === 'Tab' || event.repeat) return
    if (event.code === 'Escape') {
      event.preventDefault()
      cancelCapture()
    } else if (capture.kind === 'key' && !event.ctrlKey && !event.metaKey && !event.altKey && event.code) {
      event.preventDefault()
      assignKey(event.code === 'Backspace' ? null : event.code)
    }
  })
  renderKeyboard()
  switchPanel('keyboard')

  return {
    isOpen: () => dialog.open,
    update(nextDevices) {
      devices = nextDevices
      if (!dialog.open || panel !== 'devices') return
      const options = devices.map((device, index) => ({
        key: `${device.index ?? index}:${deviceKey(device)}:${device.axes.length}/${device.buttons.length}`,
        name: device.id || `Input device ${index + 1}`,
      }))
      const signature = JSON.stringify(options)
      if (signature !== deviceSignature) {
        const previous = devicePicker.value
        devicePicker.replaceChildren(...options.map(({ key, name }) => new Option(name, key)))
        if (options.some(({ key }) => key === previous)) devicePicker.value = previous
        deviceSignature = signature
        cancelCapture()
        renderDevice()
      }
      const device = selectedDevice()
      if (!device) return
      if (capture?.kind === 'device') detectInput(device)
      const profile = deviceBindings(config, device)
      for (const { action, node } of liveRows) {
        const raw = rawValue(device, profile[action])
        const value = bindingValue(device, action, profile[action])
        const reading = Number.isFinite(raw)
          ? buttonAction(action) ? (value ? 'Pressed' : 'Released') : `${raw.toFixed(2)} → ${value.toFixed(2)}`
          : '—'
        if (node.textContent !== reading) node.textContent = reading
      }
    },
  }
}
