import * as T from 'three'
import { createControls, deviceKey, loadBindings } from './controls.js'
import { createSettings, keyLabel } from './settings.js'
import { createCar, createStepper, interpolateCarPose, shiftGear, stepCar } from './vehicle.js'
import { HALF_WORLD, LANDMARKS, PAD, SPAWN, isPaved, nearestRoad, resolveLandmarks, roads } from './roads.js'
import { buildCar, buildWorld } from './scenery.js'
import { createSky } from './sky.js'
import { createSkySettings, loadSkySettings } from './skySettings.js'
import { clockHours, dayOfYear, moonAge, seasonFor, weatherFor } from './weather.js'
import { setGroundSeason } from './landscape.js'
import { createGlare } from './glare.js'
import { loadTextures } from './textures.js'
import { TREE_QUALITY, buildForest } from './forest.js'
import { RESOLUTION, SHADOWS, createGraphicsSettings, loadGraphics } from './graphics.js'
import { HEDGES, POND, WOODS, heightAt, inPond, resolveTrees, slopeAt } from './terrain.js'

const select = id => document.getElementById(id)
const notice = select('notice')
const view = select('view')
const scene = new T.Scene()
const camera = new T.PerspectiveCamera(56, 1, 0.3, 4000)
let renderer
try {
  renderer = new T.WebGLRenderer({ antialias: true })
} catch (error) {
  notice.textContent = 'County Road needs a browser with WebGL 2 and hardware acceleration.'
  notice.hidden = false
  throw error
}
renderer.toneMapping = T.ACESFilmicToneMapping
// Graphics quality (Settings → Graphics: graphics.js).
const graphics = loadGraphics()
renderer.shadowMap.enabled = SHADOWS[graphics.shadows].size > 0
renderer.shadowMap.type = T.PCFShadowMap
view.append(renderer.domElement)
const touch = createTouchDriving(select('game'))
const drivingAudio = createDrivingAudio(select('open-settings'))

function resize() {
  const { clientWidth, clientHeight } = view
  if (!clientWidth || !clientHeight) return
  const { ratio, pixels } = RESOLUTION[graphics.resolution]
  const pixelRatio = Math.min(devicePixelRatio, ratio, Math.sqrt(pixels / (clientWidth * clientHeight)))
  renderer.setDrawingBufferSize(clientWidth, clientHeight, pixelRatio)
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

const sky = createSky(scene, { shadowMap: Math.min(SHADOWS[graphics.shadows].size, renderer.capabilities.maxTextureSize) })
await loadTextures(renderer.capabilities.getMaxAnisotropy() >= 8 ? 8 : 4)
buildWorld(scene)
// Leafy trees and hedgerows (forest.js), at the chosen detail.
const forest = buildForest(scene, renderer, TREE_QUALITY[graphics.trees])
const glare = createGlare(view)
const skySettings = loadSkySettings()
createSkySettings(select('sky-options'), skySettings, applySky)
createGraphicsSettings(select('graphics-options'), graphics, resize)
applySky()
let clockTimer = 0
const model = buildCar(scene)
model.root.traverse(object => {
  if (object.isMesh && !object.material.transparent) object.castShadow = true
})
const bindings = loadBindings()
const settings = createSettings(bindings, updateBindingHints)
const controls = createControls(bindings, settings.isOpen)
const controllerStatus = select('controller')
const standardBindings = select('standard-bindings')
const speed = select('speed')
const gear = select('gear')
const rpm = select('rpm')

const map = select('map')
const mapContext = map.getContext('2d')
const staticMap = document.createElement('canvas')
staticMap.width = map.width
staticMap.height = map.height
const base = staticMap.getContext('2d')
const mapScale = 0.219
const mapX = x => map.width / 2 + x * mapScale
const mapZ = z => map.height / 2 + z * mapScale
// Relief: the hills shaded as if lit from the north-west, the woods and the pond.
{
  const relief = base.createImageData(map.width, map.height)
  const step = 1 / mapScale
  for (let py = 0; py < map.height; py++) {
    for (let px = 0; px < map.width; px++) {
      const x = (px - map.width / 2) / mapScale
      const z = (py - map.height / 2) / mapScale
      const h = heightAt(x, z)
      const dx = (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step)
      const dz = (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step)
      const light = Math.max(-0.6, Math.min(0.6, (dx + dz) * -0.9))
      const k = (py * map.width + px) * 4
      const water = Math.hypot(x - POND.x, z - POND.z) < POND.radius && h < POND.level
      const shade = 34 + h * 0.35 + light * 40
      relief.data.set(water ? [40, 70, 78, 255] : [shade * 0.82, shade, shade * 0.74, 255], k)
    }
  }
  base.putImageData(relief, 0, 0)
  base.fillStyle = '#25331f'
  for (const tree of WOODS) base.fillRect(mapX(tree.x) - 1, mapZ(tree.z) - 1, 2, 2)
  base.fillStyle = '#2c3b24'
  for (const bush of HEDGES) base.fillRect(mapX(bush.x) - 0.5, mapZ(bush.z) - 0.5, 1.2, 1.2)
}
base.lineWidth = 3.3
base.lineJoin = 'round'
base.lineCap = 'round'
base.strokeStyle = '#c0c8ad'
for (const road of roads) {
  base.beginPath()
  road.forEach(({ x, z }, index) => {
    if (index === 0) base.moveTo(mapX(x), mapZ(z))
    else base.lineTo(mapX(x), mapZ(z))
  })
  base.stroke()
}
for (const { x, z, radius = 2.6 } of [...LANDMARKS, { ...PAD, radius: PAD.radius * mapScale }]) {
  base.fillStyle = '#e8b270'
  base.beginPath()
  base.arc(mapX(x), mapZ(z), radius, 0, Math.PI * 2)
  base.fill()
}

let car = createCar(SPAWN)
const gearboxButton = document.createElement('button')
gearboxButton.type = 'button'
gearboxButton.className = 'settings-toggle'
select('open-settings').parentElement.append(gearboxButton)
gearboxButton.addEventListener('click', () => setManualMode(!car.manual))
setManualMode(false)
const previousCar = { ...car }
const pose = {}
let input = controls()
let cameraYaw
const shadowFocus = new T.Vector3()
const lookDirection = new T.Vector3()
let cameraHeight
let carGround = 0
let noticeUntil = 0
let lastControllerStatus
let lastHudAt = -Infinity
let lastRpmPercent
let lastMapX, lastMapZ, lastMapHeading
const focus = new T.Vector3()
updateBindingHints()

function setManualMode(manual) {
  car.manual = manual
  gearboxButton.textContent = manual ? 'Manual gears' : 'Auto gears'
  gearboxButton.title = manual ? 'Switch to automatic gears' : 'Switch to manual gears'
  touch.showManual(manual)
}

function updateBindingHints() {
  const label = action => keyLabel(bindings.keys[action].find(Boolean))
  select('keyboard-hint').textContent = `Keyboard · ${label('throttle')} throttle · ${label('brake')} brake · ${label('left')} / ${label('right')} steer · ${label('reverse')} reverse · ${label('reset')} recover · ${label('gearbox')} gearbox · ${label('shiftDown')} / ${label('shiftUp')} shift · ${label('headlights')} lights`
}

function announce(message) {
  notice.textContent = message
  notice.hidden = false
  noticeUntil = performance.now() + 2100
}

function recover(message) {
  const manual = car.manual
  car = createCar(nearestRoad(car.x, car.z, car.heading))
  car.manual = manual
  Object.assign(previousCar, car)
  cameraYaw = undefined
  cameraHeight = undefined
  announce(message)
}

const advance = createStepper(() => {
  Object.assign(previousCar, car)
  stepCar(car, input, isPaved, slopeAt)
  resolveLandmarks(car, previousCar.x, previousCar.z)
  resolveTrees(car)
  if (inPond(car.x, car.z)) recover('Into the pond · returned to the nearest road')
  if (Math.max(Math.abs(car.x), Math.abs(car.z)) > HALF_WORLD) recover('Map edge · returned to the nearest road')
})

// The car sits on the ground under its wheels: pitched and rolled with it.
function renderCar() {
  const sin = Math.sin(pose.heading)
  const cos = Math.cos(pose.heading)
  const at = (forward, right) => heightAt(pose.x + forward * sin - right * cos, pose.z + forward * cos + right * sin)
  const front = (at(1.23, -0.8) + at(1.23, 0.8)) / 2
  const rear = (at(-1.39, -0.8) + at(-1.39, 0.8)) / 2
  const left = (at(1.23, -0.8) + at(-1.39, -0.8)) / 2
  const right = (at(1.23, 0.8) + at(-1.39, 0.8)) / 2
  carGround = (front * 1.39 + rear * 1.23) / 2.62
  model.root.position.set(pose.x, carGround + 0.024, pose.z)
  model.root.rotation.set(-Math.atan2(front - rear, 2.62), pose.heading, Math.atan2(left - right, 1.6), 'YXZ')
  model.body.rotation.x = -pose.ax * 0.0055
  model.body.rotation.z = -pose.ay * 0.006
  model.brakeMaterial.emissiveIntensity = 0.55 + 0.45 * headlightLevel + 2.4 * input.brake
  for (const { pivot, spin, front } of model.wheels) {
    if (front) pivot.rotation.y = -pose.steer
    spin.rotation.x = pose.wheelAngle
  }
}

function updateCamera(delta) {
  const desiredYaw = pose.heading - input.lookX * Math.PI * 0.9
  cameraYaw ??= desiredYaw
  const difference = desiredYaw - cameraYaw
  cameraYaw += Math.atan2(Math.sin(difference), Math.cos(difference)) * (1 - Math.exp(-8 * delta))
  const sin = Math.sin(cameraYaw)
  const cos = Math.cos(cameraYaw)
  const distance = 7.2 + Math.min(1.8, Math.abs(pose.u) * 0.035)
  // Following the car's height, eased, and never inside a hillside.
  const x = pose.x - sin * distance
  const z = pose.z - cos * distance
  cameraHeight ??= carGround
  cameraHeight += (carGround - cameraHeight) * (1 - Math.exp(-6 * delta))
  const y = Math.max(cameraHeight + 3.26 + input.lookY * 1.3, heightAt(x, z) + 1.4)
  camera.position.set(x, y, z)
  focus.set(pose.x + sin * 2.3, cameraHeight + 0.88, pose.z + cos * 2.3)
  camera.lookAt(focus)
}

function updateHud(now) {
  if (!notice.hidden && now >= noticeUntil) notice.hidden = true
  if (now - lastHudAt < 50) return
  lastHudAt = now
  const speedLabel = String(Math.round(Math.hypot(car.u, car.v) * 3.6))
  const gearLabel = car.reverse ? 'R' : car.gear === 0 ? 'N' : String(car.gear)
  const rpmPercent = Math.round(car.rpm / 69)
  if (speed.textContent !== speedLabel) speed.textContent = speedLabel
  if (gear.textContent !== gearLabel) gear.textContent = gearLabel
  if (rpmPercent !== lastRpmPercent) {
    rpm.style.transform = `scaleX(${rpmPercent / 100})`
    lastRpmPercent = rpmPercent
  }
  const custom = input.devices.some(device => device.mapping !== 'standard' || bindings.devices[deviceKey(device)])
  const status = custom ? 'Controller / wheel · see Settings for bindings'
    : input.connected ? 'Controller connected' : 'Press a button on your controller'
  if (lastControllerStatus !== status) {
    controllerStatus.textContent = status
    standardBindings.hidden = custom
    lastControllerStatus = status
  }
  if (car.x === lastMapX && car.z === lastMapZ && car.heading === lastMapHeading) return
  lastMapX = car.x
  lastMapZ = car.z
  lastMapHeading = car.heading
  mapContext.clearRect(0, 0, map.width, map.height)
  mapContext.drawImage(staticMap, 0, 0)
  mapContext.save()
  mapContext.translate(mapX(car.x), mapZ(car.z))
  mapContext.rotate(-car.heading)
  mapContext.fillStyle = '#ffbf75'
  mapContext.strokeStyle = '#131c17'
  mapContext.lineWidth = 2
  mapContext.beginPath()
  mapContext.moveTo(0, 8)
  mapContext.lineTo(-5, -6)
  mapContext.lineTo(0, -3)
  mapContext.lineTo(5, -6)
  mapContext.closePath()
  mapContext.stroke()
  mapContext.fill()
  mapContext.restore()
}

let last = performance.now()
renderer.setAnimationLoop(now => {
  const delta = Math.max(0, Math.min(0.1, (now - last) / 1000))
  last = now
  input = controls()
  const paused = settings.isOpen()
  touch.apply(input, paused)
  settings.update(input.devices)
  if (paused) {
    drivingAudio.update(now, car, input, true)
    updateSky(delta, true)
    renderer.render(scene, camera)
    return
  }
  if (input.reset) recover('Recovered to the nearest road')
  if (input.gearbox) setManualMode(!car.manual)
  if (input.reverse) {
    if (Math.hypot(car.u, car.v) < 0.5) {
      car.reverse = !car.reverse
      car.gear = 1
      car.shiftDelay = 0
    } else {
      announce('Stop before changing direction')
    }
  }
  if (input.shiftUp !== input.shiftDown) shiftGear(car, input.shiftUp ? 1 : -1)
  if (input.headlights) {
    // Switched by hand: the opposite of what they are now (until the next reload).
    headlightsManual = !headlightsWanted()
    announce(headlightsManual ? 'Headlights on' : 'Headlights off')
  }
  const fraction = advance(delta)
  drivingAudio.update(now, car, input, false)
  interpolateCarPose(previousCar, car, fraction, pose)
  renderCar()
  updateCamera(delta)
  updateHud(now)
  updateSky(delta, false)
  renderer.render(scene, camera)
})

/** Apply the sky and weather settings (skySettings.js) to the world. */
function applySky() {
  const o = skySettings
  const now = new Date()
  const hours = o.useClock ? clockHours(now) : Number(o.timeOfDay)
  const day = o.useClock ? dayOfYear(now) : Number(o.dayOfYear)
  // The moon by the date (this year, at that time of day), or as chosen.
  const date = new Date(now.getFullYear(), 0, day, Math.floor(hours), (hours % 1) * 60)
  const age = { new: 0, crescent: 0.15, quarter: 0.25, gibbous: 0.37, full: 0.5 }[o.moonPhase]
    ?? moonAge(o.useClock ? now : date)
  sky.setStars(o.stars)
  sky.setClouds(Number(o.cloudCover), o.cloudType)
  sky.setTime(hours, day, age)
  sky.setWind(Number(o.windSpeed), Number(o.windDir))
  sky.setWeather(weatherFor(o, day, hours))
  const season = seasonFor(day)
  setGroundSeason(season)
  forest.setSeason(day, season)
}

// Headlights: on by themselves at dusk, at night and in mist or low cloud,
// unless switched by hand (null = automatic).
let headlightsManual = null
let headlightLevel = 0
function headlightsWanted() {
  if (headlightsManual !== null) return headlightsManual
  const s = sky.state
  return s.sunElevation < 3 || s.fogNow > 0.2 || s.weather.mist > 0.3 || (s.lowCloudCover ?? 0) > 0.5
}

function updateHeadlights(delta) {
  // They come up in a moment rather than instantly, like real bulbs.
  headlightLevel += (Number(headlightsWanted()) - headlightLevel) * (1 - Math.exp(-delta * 14))
  const on = headlightLevel
  // The lamps' glow shows only from in front of the car.
  const facing = Math.sin(pose.heading) * (camera.position.x - pose.x) + Math.cos(pose.heading) * (camera.position.z - pose.z)
  const fromFront = Math.min(1, Math.max(0, (facing - 1.5) / 3))
  for (const { beam, glow } of model.beams) {
    beam.intensity = 650 * on
    glow.material.opacity = 0.9 * on * fromFront
  }
  model.lamps.emissiveIntensity = 0.6 + 3.4 * on
}

function updateSky(delta, paused) {
  // Following the clock: move the sun along every half minute.
  if (skySettings.useClock && (clockTimer -= delta) <= 0) {
    clockTimer = 30
    applySky()
  }
  shadowFocus.set(pose.x ?? car.x, carGround, pose.z ?? car.z).addScaledVector(camera.getWorldDirection(lookDirection).setY(0).normalize(), sky.state.shadowAhead)
  sky.update(paused ? 0 : delta, camera, heightAt(camera.position.x, camera.position.z), shadowFocus)
  const far = Math.min(4000, sky.state.visibleFar)
  if (Math.abs(camera.far - far) > 1) {
    camera.far = far
    camera.updateProjectionMatrix()
  }
  glare.update(camera, sky.state, delta, skySettings.sunGlare)
  updateHeadlights(delta)
  forest.update(camera.position)
  forest.setWind(performance.now() / 1000, Number(skySettings.windSpeed), Number(skySettings.windDir))
  renderer.toneMappingExposure = sky.state.exposure
}

function createDrivingAudio(settingsButton) {
  const toolbar = document.createElement('div')
  toolbar.className = 'drive-toolbar'
  settingsButton.before(toolbar)
  toolbar.append(settingsButton)
  const Audio = window.AudioContext || window.webkitAudioContext
  if (!Audio) return { update() {} }
  const root = import.meta.env.BASE_URL + 'audio/'
  const credits = document.createElement('a')
  credits.className = 'audio-credits'
  credits.href = root + 'credits.txt'
  credits.target = '_blank'
  credits.rel = 'noopener'
  credits.textContent = 'Audio credits'
  credits.hidden = true
  select('settings').querySelector('.settings-footer').append(credits)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'settings-toggle'
  button.textContent = 'Enable sound'
  toolbar.append(button)
  let graph
  let enabled = false
  let audible = false
  let lastMix = -Infinity

  function buildGraph(context) {
    const master = context.createGain()
    master.gain.value = 0
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 8
    limiter.ratio.value = 4
    limiter.attack.value = 0.01
    limiter.release.value = 0.15
    master.connect(limiter)
    limiter.connect(context.destination)
    const engine = context.createOscillator()
    // The second harmonic represents two combustion pulses per crank revolution.
    const harmonics = new Float32Array([0, 0.32, 1, 0.24, 0.59, 0.17, 0.38, 0.13, 0.26, 0.09, 0.17, 0.06, 0.11])
    engine.setPeriodicWave(context.createPeriodicWave(new Float32Array(harmonics.length), harmonics))
    const noise = context.createBufferSource()
    noise.buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const samples = noise.buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    noise.loop = true

    function voice(source, type, frequency, resonance) {
      const filter = context.createBiquadFilter()
      filter.type = type
      filter.frequency.value = frequency
      filter.Q.value = resonance
      const level = context.createGain()
      level.gain.value = 0
      source.connect(filter)
      filter.connect(level)
      level.connect(master)
      return { frequency: filter.frequency, level: level.gain }
    }

    const exhaust = voice(engine, 'lowpass', 260, 0.7)
    const rolling = voice(noise, 'bandpass', 1150, 0.65)
    const sliding = voice(noise, 'bandpass', 1750, 7.5)
    const intake = voice(noise, 'bandpass', 860, 1.2)
    const braking = voice(noise, 'bandpass', 900, 1.6)
    engine.start()
    noise.start()
    return {
      context, master: master.gain, output: master, pitch: engine.frequency,
      exhaust, rolling, sliding, intake, braking, recordings: {}, engines: [],
    }
  }

  function fade(play) {
    if (!graph || audible === play) return
    audible = play
    graph.master.setTargetAtTime(play ? 0.62 : 0, graph.context.currentTime, 0.035)
  }

  button.addEventListener('click', async () => {
    if (enabled) {
      enabled = false
      fade(false)
      button.textContent = 'Unmute sound'
      return
    }
    button.disabled = true
    try {
      graph ??= buildGraph(new Audio())
      await graph.context.resume()
      if (!graph.recordingLoad) {
        graph.recordingLoad = loadCarRecordings(graph, root).then(count => {
          credits.hidden = count === 0
          button.title = count ? count + ' of 6 recorded car sounds loaded' : 'Synthesised audio'
        })
      }
      enabled = true
      button.textContent = 'Mute sound'
    } catch {
      button.textContent = 'Retry sound'
    } finally {
      button.disabled = false
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) fade(false)
  })

  return {
    update(now, car, input, paused) {
      const play = enabled && !paused && !document.hidden
      fade(play)
      if (!play || now - lastMix < 1000 / 30) return
      lastMix = now
      const { context, pitch, exhaust, rolling, sliding, intake, braking } = graph
      const { throttle, brake } = input
      const time = context.currentTime
      const speed = Math.hypot(car.u, car.v)
      const road = isPaved(car.x, car.z)
      const shift = Math.min(1, car.shiftDelay / 0.18)
      const load = throttle * (1 - 0.56 * shift)
      const motion = Math.min(1, speed / 34)
      const slip = Math.min(1, Math.max(0, (car.pavedSlip - 0.045) / 0.17))
      const { recordings } = graph
      const hasEngines = graph.engines.length > 0 && time >= graph.engineStart
      if (hasEngines) mixRecordedEngine(graph, car.rpm, 0.68 + load * 0.62, time)
      const synth = hasEngines ? 0.08 : 1
      pitch.setTargetAtTime(car.rpm / 60, time, 0.065)
      exhaust.frequency.setTargetAtTime(270 + car.rpm * 0.12 + load * 1100, time, 0.065)
      exhaust.level.setTargetAtTime(synth * (0.12 + load * 0.30 + car.rpm * 0.000014), time, 0.065)
      intake.frequency.setTargetAtTime(540 + car.rpm * 0.15, time, 0.07)
      intake.level.setTargetAtTime(synth * load * (0.045 + car.rpm * 0.000012), time, 0.07)
      rolling.frequency.setTargetAtTime((road ? 830 : 370) + motion * 470, time, 0.08)
      rolling.level.setTargetAtTime(motion * (road ? 0.12 : 0.28), time, 0.075)
      sliding.frequency.setTargetAtTime(1450 + slip * 650 + motion * 180, time, 0.06)
      const squeal = slip * Math.min(1, speed / 8)
      sliding.level.setTargetAtTime(squeal * (recordings.tyre ? 0.08 : 0.42), time, 0.05)
      recordings.tyre?.level.setTargetAtTime(squeal * 0.68, time, 0.07)
      recordings.tyre?.source.playbackRate.setTargetAtTime(0.86 + motion * 0.24 + slip * 0.08, time, 0.09)
      braking.frequency.setTargetAtTime(720 + motion * 630, time, 0.09)
      const brakeNoise = brake * Math.min(1, speed / 8)
      braking.level.setTargetAtTime(brakeNoise * (recordings.brake ? 0.025 : 0.11), time, 0.075)
      recordings.brake?.level.setTargetAtTime(brakeNoise * 0.32, time, 0.09)
      recordings.brake?.source.playbackRate.setTargetAtTime(0.86 + motion * 0.19, time, 0.095)
    },
  }
}

const CYCLE_FRAMES = 2048

function repeatCorrelation(samples, start, end, lag, step) {
  let sum = 0
  let previous = 0
  let current = 0
  for (let i = start + lag; i < end; i += step) {
    const a = samples[i]
    const b = samples[i - lag]
    sum += a * b
    current += a * a
    previous += b * b
  }
  const energy = Math.sqrt(current * previous)
  return energy > 0.0001 ? sum / energy : -1
}

function findEnginePeriod(samples, rate, targetRpm) {
  const stride = Math.max(1, Math.round(rate / 4800))
  const analysis = new Float32Array(Math.floor(samples.length / stride))
  for (let i = 0; i < analysis.length; i++) {
    let sum = 0
    for (let j = 0; j < stride; j++) sum += samples[i * stride + j]
    analysis[i] = sum / stride
  }
  const expected = rate * 20 / (stride * targetRpm)
  const window = Math.min(analysis.length, Math.round(rate / stride * 0.42))
  const hop = Math.max(1, Math.floor((analysis.length - window) / 96))
  const candidates = new Set(Array.from({ length: 13 }, (_, i) => Math.round(expected * (0.82 + i * 0.03))))
  let best = -Infinity
  let start = 0
  let period = Math.round(expected)
  for (let offset = 0; offset + window <= analysis.length; offset += hop) {
    let power = 0
    for (let i = offset; i < offset + window; i += 4) power += analysis[i] ** 2
    if (power < 0.005) continue
    const split = offset + Math.floor(window / 2)
    for (const lag of candidates) {
      const first = repeatCorrelation(analysis, offset, split, lag, 3)
      const second = repeatCorrelation(analysis, split, offset + window, lag, 3)
      const score = 0.68 * Math.min(first, second) + 0.16 * (first + second)
        - 0.24 * Math.abs(Math.log(lag / expected)) + 0.042 * Math.log1p(power)
      if (score <= best) continue
      best = score
      start = offset
      period = lag
    }
  }

  const begin = start * stride
  const end = Math.min(samples.length, begin + window * stride)
  const coarse = period * stride
  const compare = lag => repeatCorrelation(samples, begin, end, lag, stride)
  let fine = coarse
  let fineScore = -Infinity
  for (let lag = Math.max(2, coarse - stride * 2); lag <= coarse + stride * 2; lag++) {
    const score = compare(lag)
    if (score <= fineScore) continue
    fineScore = score
    fine = lag
  }
  const left = compare(fine - 1)
  const right = compare(fine + 1)
  const curvature = left + right - 2 * fineScore
  const fraction = curvature < -1e-8 ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0
  return { begin, end, period: fine + fraction }
}

function centerAndLevel(data) {
  let dc = 0
  for (const value of data) dc += value
  dc /= data.length
  let power = 0
  let peak = 0
  for (let i = 0; i < data.length; i++) {
    const value = data[i] - dc
    data[i] = value
    power += value * value
    peak = Math.max(peak, Math.abs(value))
  }
  if (peak === 0) return data
  const gain = Math.min(10, 0.22 / Math.sqrt(power / data.length), 0.9 / peak)
  for (let i = 0; i < data.length; i++) data[i] *= gain
  return data
}

function engineCycle(samples, rate, targetRpm) {
  const { begin, end, period } = findEnginePeriod(samples, rate, targetRpm)
  const cycle = period * 6
  const repeats = Math.floor((end - begin - 1) / cycle)
  if (repeats < 2) throw new Error('Recording is too short for a V6 cycle')
  const wave = new Float32Array(CYCLE_FRAMES)
  // Fold full 720-degree cycles from the recording with a Hann-weighted overlap.
  // The weights vanish at the ends, so phase 1 joins phase 0 continuously.
  for (let i = 0; i < wave.length; i++) {
    const phase = i / wave.length
    let weightSum = 0
    let total = 0
    for (let n = 0; n < repeats; n++) {
      const position = begin + (n + phase) * cycle
      const index = Math.floor(position)
      const sample = samples[index] + (samples[index + 1] - samples[index]) * (position - index)
      const weight = Math.sin(Math.PI * (n + phase) / repeats) ** 2
      total += sample * weight
      weightSum += weight
    }
    wave[i] = total / weightSum
  }
  return { wave: centerAndLevel(wave), rpm: rate * 20 / period }
}

function alignEngineCycle(wave, reference) {
  if (!reference) return { wave, correlation: 1 }
  let bestShift = 0
  let best = -Infinity
  for (let shift = 0; shift < wave.length; shift++) {
    let sum = 0
    for (let i = 0; i < wave.length; i += 8) sum += reference[i] * wave[(i + shift) % wave.length]
    if (sum <= best) continue
    best = sum
    bestShift = shift
  }
  const aligned = new Float32Array(wave.length)
  let cross = 0
  let aPower = 0
  let bPower = 0
  for (let i = 0; i < wave.length; i++) {
    const a = reference[i]
    const b = wave[(i + bestShift) % wave.length]
    aligned[i] = b
    cross += a * b
    aPower += a * a
    bPower += b * b
  }
  const correlation = Math.max(0, Math.min(1, cross / (Math.sqrt(aPower * bPower) || 1)))
  return { wave: aligned, correlation }
}

function frictionLoop(samples, rate, seconds) {
  const length = Math.min(samples.length, Math.round(rate * seconds))
  const step = Math.max(1, Math.round(rate / 5200))
  const overlap = Math.min(Math.floor(length / 4), Math.round(rate * 0.16))
  const hop = Math.max(1, Math.round(rate * 0.085))
  let bestOffset = 0
  let best = -Infinity
  for (let offset = 0; offset + length <= samples.length; offset += hop) {
    const energy = [0, 0, 0, 0]
    for (let i = step; i < length; i += step) {
      const edge = samples[offset + i] - samples[offset + i - step]
      energy[Math.floor(i * 4 / length)] += edge * edge
    }
    // Prefer sustained friction over sections dominated by a single loud transient.
    const score = Math.min(...energy) + 0.17 * energy.reduce((sum, band) => sum + band, 0)
    if (score <= best) continue
    best = score
    bestOffset = offset
  }
  const data = samples.slice(bestOffset + overlap, bestOffset + length)
  for (let i = 0; i < overlap; i++) {
    const index = data.length - overlap + i
    const fade = 0.5 - 0.5 * Math.cos(Math.PI * i / Math.max(1, overlap - 1))
    const a = 1 - fade
    data[index] = (data[index] * a + samples[bestOffset + i] * fade) / Math.hypot(a, fade)
  }
  return centerAndLevel(data)
}

function createRecordingVoice(context, output, data, rate, highpass) {
  const source = context.createBufferSource()
  const gain = context.createGain()
  source.buffer = context.createBuffer(1, data.length, rate)
  source.buffer.copyToChannel(data, 0)
  source.loop = true
  gain.gain.value = 0
  source.connect(gain)
  if (highpass) {
    const filter = context.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = highpass
    gain.connect(filter)
    filter.connect(output)
  } else {
    gain.connect(output)
  }
  return { source, level: gain.gain, duration: source.buffer.duration }
}

async function loadCarRecordings(graph, root) {
  const { context, output } = graph
  const engineClips = [['idle', 850], ['rev', 1650], ['mid', 2900], ['high', 5300]]
  const frictionClips = [['tyre', 0.94, 950], ['brake', 0.8, 650]]
  let count = 0
  async function decode(name) {
    const response = await fetch(root + name + '.mp3')
    if (!response.ok) throw Error('HTTP ' + response.status)
    return context.decodeAudioData(await response.arrayBuffer())
  }
  const cycles = []
  for (const [name, targetRpm] of engineClips) {
    try {
      const buffer = await decode(name)
      cycles.push(engineCycle(buffer.getChannelData(0), buffer.sampleRate, targetRpm))
      count++
    } catch (error) {
      console.warn('Could not load recorded engine sound ' + name, error)
    }
  }
  cycles.sort((a, b) => a.rpm - b.rpm)
  let reference
  const start = context.currentTime + 0.04
  for (const { wave, rpm } of cycles) {
    const aligned = alignEngineCycle(wave, reference)
    reference = aligned.wave
    const voice = createRecordingVoice(context, output, reference, context.sampleRate)
    voice.source.playbackRate.value = voice.duration * 850 / 120
    voice.source.start(start)
    graph.engines.push({ ...voice, rpm, correlation: aligned.correlation })
  }
  graph.engineStart = start

  for (const [name, seconds, highpass] of frictionClips) {
    try {
      const buffer = await decode(name)
      const data = frictionLoop(buffer.getChannelData(0), buffer.sampleRate, seconds)
      const voice = createRecordingVoice(context, output, data, buffer.sampleRate, highpass)
      voice.source.start()
      graph.recordings[name] = voice
      count++
    } catch (error) {
      console.warn('Could not load recorded friction sound ' + name, error)
    }
  }
  return count
}

function mixRecordedEngine(graph, rpm, gain, time) {
  const { engines } = graph
  const next = engines.findIndex(engine => engine.rpm >= rpm)
  const upper = next < 0 ? engines.length - 1 : next
  const lower = next <= 0 ? upper : upper - 1
  const span = Math.log(engines[upper].rpm / engines[lower].rpm)
  const progress = span > 0 ? Math.log(rpm / engines[lower].rpm) / span : 0
  const blend = progress * progress * (3 - 2 * progress)
  const partA = 1 - blend
  const partB = blend
  const correlation = engines[upper].correlation
  const level = gain / Math.sqrt(partA ** 2 + partB ** 2 + 2 * partA * partB * correlation)
  for (const [index, engine] of engines.entries()) {
    const weight = index === lower ? partA : index === upper ? partB : 0
    // Every source plays one full engine cycle at the same frequency and phase.
    engine.source.playbackRate.setTargetAtTime(rpm * engine.duration / 120, time, 0.065)
    engine.level.setTargetAtTime(level * weight, time, 0.075)
  }
}

function createDriveStick(horizontal) {
  const track = document.createElement('div')
  track.className = horizontal ? 'drive-stick stick-steering' : 'drive-stick stick-pedals'
  track.setAttribute('role', 'group')
  track.setAttribute('aria-label', horizontal ? 'Steering joystick' : 'Throttle and brake joystick')
  const markers = horizontal ? ['←', '→'] : ['Gas', 'Brake']
  for (const [index, text] of markers.entries()) {
    const label = document.createElement('span')
    label.className = index === 0 ? 'stick-start' : 'stick-end'
    label.textContent = text
    label.setAttribute('aria-hidden', 'true')
    track.append(label)
  }
  const thumb = document.createElement('span')
  thumb.className = 'stick-thumb'
  thumb.setAttribute('aria-hidden', 'true')
  track.append(thumb)
  let pointerId = null
  let centre = 0
  let travel = 1
  let value = 0

  function update(event) {
    const delta = (horizontal ? event.clientX : event.clientY) - centre
    const offset = Math.max(-travel, Math.min(travel, delta))
    const amount = (horizontal ? offset : -offset) / travel
    value = Math.sign(amount) * Math.max(0, (Math.abs(amount) - 0.09) / 0.91)
    thumb.style.setProperty('--stick-offset', offset + 'px')
  }

  function clear() {
    const id = pointerId
    if (id === null) return
    pointerId = null
    value = 0
    track.removeAttribute('data-held')
    thumb.style.removeProperty('--stick-offset')
    if (track.hasPointerCapture(id)) track.releasePointerCapture(id)
  }

  track.addEventListener('pointerdown', event => {
    if (pointerId !== null || event.button !== 0) return
    event.preventDefault()
    const bounds = track.getBoundingClientRect()
    const size = horizontal ? bounds.width : bounds.height
    const grip = horizontal ? thumb.offsetWidth : thumb.offsetHeight
    centre = (horizontal ? bounds.left : bounds.top) + size / 2
    travel = Math.max(1, (size - grip) / 2 - 5)
    track.setPointerCapture(event.pointerId)
    pointerId = event.pointerId
    track.setAttribute('data-held', '')
    update(event)
  })
  track.addEventListener('pointermove', event => {
    if (event.pointerId === pointerId) update(event)
  })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    track.addEventListener(event, event => {
      if (event.pointerId === pointerId) clear()
    })
  }
  track.addEventListener('contextmenu', event => event.preventDefault())

  return { track, held: () => pointerId !== null, value: () => value, clear }
}

function createTouchDriving(game) {
  const style = document.createElement('style')
  style.textContent = `
    .drive-toolbar { display: flex; flex-wrap: wrap; gap: 0 6px; }
    .touch-game {
      height: 100dvh;
      bottom: auto;
      --touch-size: clamp(52px, min(15vw, 18dvh), 80px);
      --stick-size: clamp(92px, min(27vw, 33dvh), 140px);
      --touch-left: max(12px, env(safe-area-inset-left, 0px));
      --touch-right: max(12px, env(safe-area-inset-right, 0px));
      --touch-bottom: max(12px, env(safe-area-inset-bottom, 0px));
      --touch-top: max(10px, env(safe-area-inset-top, 0px));
    }
    .touch-game .controls, .touch-game #open-settings kbd { display: none; }
    .touch-game .title { top: var(--touch-top); left: var(--touch-left); padding: 8px 10px 9px; }
    .touch-game .title h1 { font-size: 20px; }
    .touch-game .drive-toolbar button { min-height: 36px; margin-top: 6px; }
    .touch-game .map { top: var(--touch-top); right: var(--touch-right); padding: 6px 8px; }
    .touch-game #map { width: clamp(64px, 19vw, 102px); }
    .touch-game .dash {
      bottom: calc(var(--touch-bottom) + var(--stick-size) + 53px);
      right: var(--touch-right);
      width: 124px;
      padding: 7px 8px;
      gap: 5px;
    }
    .touch-game #speed { font-size: 30px; }
    .touch-game #notice { top: 30%; width: max-content; max-width: 75%; }
    .touch-driving { position: absolute; inset: 0; pointer-events: none; }
    .touch-driving > div { position: absolute; display: flex; gap: 7px; }
    .touch-driving .drive-stick {
      display: block;
      bottom: var(--touch-bottom);
      width: var(--stick-size);
      height: var(--stick-size);
      border: 1px solid #ffffff67;
      border-radius: 50%;
      background: #121b17cf;
      box-shadow: inset 0 0 16px #0a0f0bc0, 0 3px 12px #0a0f0b55;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
    }
    .stick-steering { left: var(--touch-left); }
    .stick-pedals { right: var(--touch-right); }
    .drive-stick span { position: absolute; pointer-events: none; }
    .stick-start, .stick-end { color: #f4f6e9; font-size: 11px; font-weight: 700; line-height: 1; }
    .stick-steering .stick-start, .stick-steering .stick-end { top: 50%; translate: 0 -50%; font-size: 17px; }
    .stick-steering .stick-start { left: 9px; }
    .stick-steering .stick-end { right: 9px; }
    .stick-pedals .stick-start, .stick-pedals .stick-end { left: 50%; translate: -50% 0; }
    .stick-pedals .stick-start { top: 8px; color: var(--accent); }
    .stick-pedals .stick-end { bottom: 8px; }
    .stick-thumb {
      top: 50%;
      left: 50%;
      width: 40%;
      height: 40%;
      border-radius: 50%;
      border: 2px solid #f6d99a;
      background: #5c4930;
      box-shadow: 0 3px 9px #0009;
      transform: translate(calc(-50% + var(--stick-x, 0px)), calc(-50% + var(--stick-y, 0px)));
      transition: transform 100ms ease-out;
    }
    .stick-steering .stick-thumb { --stick-x: var(--stick-offset, 0px); }
    .stick-pedals .stick-thumb { --stick-y: var(--stick-offset, 0px); }
    .drive-stick[data-held] .stick-thumb { transition: none; background: #826340; }
    .touch-driving .drive-actions {
      right: var(--touch-right);
      bottom: calc(var(--touch-bottom) + var(--stick-size) + 7px);
    }
    .touch-driving button {
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      width: var(--touch-size);
      height: var(--touch-size);
      border-radius: 12px;
      border-color: #ffffff60;
      background: #121b17e0;
      padding: 0;
    }
    .touch-driving .shift-actions {
      left: var(--touch-left);
      bottom: calc(var(--touch-bottom) + var(--stick-size) + 7px);
    }
    .touch-driving .drive-actions button, .touch-driving .shift-actions button { height: 44px; font-size: 11px; }
    .drive-toolbar .settings-toggle { white-space: nowrap; }
    .touch-game .drive-toolbar { max-width: 195px; }
    .audio-credits { color: var(--muted); }
    .touch-driving button:active { color: #232318; background: var(--accent); }
    @media (orientation: landscape) {
      .touch-game .dash { bottom: var(--touch-bottom); left: 50%; right: auto; transform: translateX(-50%); }
      .touch-game #map { width: clamp(64px, 20dvh, 102px); }
    }
  `
  document.head.append(style)

  const pointer = matchMedia('(any-pointer: coarse)')
  const landscape = matchMedia('(orientation: landscape)')
  const overlay = document.createElement('section')
  overlay.className = 'touch-driving'
  overlay.setAttribute('aria-label', 'On-screen driving controls')
  const steering = createDriveStick(true)
  const pedals = createDriveStick(false)
  overlay.append(steering.track, pedals.track)
  let reverse = false
  let recover = false
  let shift = 0
  let active = false

  function clear() {
    steering.clear()
    pedals.clear()
    reverse = false
    recover = false
    shift = 0
  }

  function updateAvailability() {
    active = pointer.matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches)
    overlay.hidden = !active
    game.classList.toggle('touch-game', active)
    if (!active) clear()
  }

  function controls(className, items) {
    const group = document.createElement('div')
    group.className = className
    for (const [text, label, tap] of items) {
      const control = document.createElement('button')
      control.type = 'button'
      control.textContent = text
      control.setAttribute('aria-label', label)
      control.addEventListener('contextmenu', event => event.preventDefault())
      control.addEventListener('click', tap)
      group.append(control)
    }
    overlay.append(group)
    return group
  }

  controls('drive-actions', [
    ['Reverse', 'Toggle drive or reverse', () => { reverse = true }],
    ['Recover', 'Recover to the nearest road', () => { recover = true }],
  ])
  const shiftButtons = controls('shift-actions', [
    ['Gear −', 'Shift down', () => { shift = -1 }],
    ['Gear +', 'Shift up', () => { shift = 1 }],
  ])
  shiftButtons.hidden = true
  game.append(overlay)
  updateAvailability()
  pointer.addEventListener('change', () => {
    updateAvailability()
    resize()
  })
  landscape.addEventListener('change', clear)
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear()
  })

  return {
    isActive: () => active,
    showManual(manual) { shiftButtons.hidden = !manual },
    apply(input, paused) {
      if (paused || !active) {
        clear()
        return
      }
      if (steering.held()) {
        input.steer = steering.value()
        input.keyboardSteering = false
      }
      if (pedals.held()) {
        const amount = pedals.value()
        input.throttle = Math.max(0, amount)
        input.brake = Math.max(0, -amount)
      }
      input.reverse ||= reverse
      input.reset ||= recover
      input.shiftDown ||= shift < 0
      input.shiftUp ||= shift > 0
      reverse = false
      recover = false
      shift = 0
    },
  }
}
