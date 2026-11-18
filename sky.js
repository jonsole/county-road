// Sky, sun, moon, stars, haze and clouds, ported from RC Flight Sim
// (src/world/world.js, sun.js, clouds.js): a Preetham daylight sky tuned for
// clear English summer air, a gradient dome for twilight and night, a layer
// of fair-weather cumulus whose shadows drift across the ground, and the
// lights and horizon haze for the time of day.
import * as T from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { FIELD_GLSL, LowCloud, fog4, fogUniforms, installVolumetricFog, moonIllumination } from './weather.js'

const LATITUDE = 52
const deg = Math.PI / 180
// Everything in the sky is drawn inside the camera's far plane.
const DOME = 3200

/**
 * Sun elevation and azimuth (degrees; azimuth 0 = north, 90 = east) for a
 * local solar time in hours (12 = noon) on a day of the year.
 */
export function sunPosition(hours, day = 172, latitude = LATITUDE) {
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10)) * deg
  const lat = latitude * deg
  const ha = (hours - 12) * 15 * deg
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const y = -Math.sin(ha) * Math.cos(decl)
  const x = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(ha)
  let az = Math.atan2(y, x) / deg
  if (az < 0) az += 360
  return { elevation: el / deg, azimuth: az }
}

/**
 * The moon for its age (0 new .. 0.5 full): it runs that much of a day
 * behind the sun, along the sun's path for that much later in the year
 * (so a full moon rides low in summer and high in winter).
 */
export function moonPosition(hours, day, age = 0.5) {
  return sunPosition((((hours - age * 24) % 24) + 24) % 24, day + age * 365)
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Unit direction (+y up) for an elevation/azimuth in degrees (azimuth 0 = north/-z). */
function skyDir(elevationDeg, azimuthDeg, out) {
  const el = elevationDeg * deg
  const az = azimuthDeg * deg
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az))
}

// Horizon haze by sun elevation: night, deep twilight, sunset, golden hour, day.
const HAZE = [
  [-12, new T.Color('#070b16')],
  [-5, new T.Color('#28334f')],
  [0, new T.Color('#d39a72')],
  [8, new T.Color('#e3c7a4')],
  [20, new T.Color('#a9c7ec')],
]
function hazeColour(el, out) {
  if (el <= HAZE[0][0]) return out.copy(HAZE[0][1])
  for (let i = 1; i < HAZE.length; i++) {
    if (el <= HAZE[i][0]) {
      const [e0, c0] = HAZE[i - 1]
      const [e1, c1] = HAZE[i]
      return out.copy(c0).lerp(c1, (el - e0) / (e1 - e0))
    }
  }
  return out.copy(HAZE.at(-1)[1])
}

const TWILIGHT_ZENITH = new T.Color('#2a4069')
const NIGHT_ZENITH = new T.Color('#02050d')
const TWILIGHT_HORIZON = new T.Color('#8b6f86')
const NIGHT_HORIZON = new T.Color('#0c1528')
const TWILIGHT_GLOW = new T.Color('#e08a4a')

function daySky() {
  const sky = new Sky()
  sky.scale.setScalar(DOME)
  const u = sky.material.uniforms
  // Clear summer air: deeper blue overhead, paler down to the horizon.
  u.turbidity.value = 2.2
  u.rayleigh.value = 2.0
  u.mieCoefficient.value = 0.0025
  u.mieDirectionalG.value = 0.85
  // The Preetham sky is very bright; scaled down (and its blue deepened)
  // before tone mapping, the blue survives instead of washing out.
  u.skyGain = { value: 0.36 }
  u.skyFog = { value: 0 }
  u.skyFogColor = { value: new T.Color() }
  Object.assign(u, fogUniforms())
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('void main() {', `uniform float skyGain;\nuniform float skyFog;\nuniform vec3 skyFogColor;\n${FIELD_GLSL}\nvoid main() {`)
    .replace('#include <tonemapping_fragment>', `{
      vec3 c = gl_FragColor.rgb * skyGain;
      float l = dot(c, vec3(0.3, 0.55, 0.15));
      gl_FragColor.rgb = max(mix(vec3(l), c, 1.4), 0.0);
    }
    #include <tonemapping_fragment>`)
    // Down to the horizon the sky turns into the haze the distant ground
    // fades into (same colour, mixed the same way), so there's no seam.
    .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
    {
      vec3 sd = normalize(vWorldPosition - cameraPosition);
      float toHaze = max(skyFog, 1.0 - smoothstep(-0.01, 0.16, sd.y));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, skyFogColor, toHaze);
      // Mist and low cloud in the way (out to 3 km).
      if (fogMistA.x > 0.0 || fogMistA.z > 0.0) {
        vec4 f = vfAlong(cameraPosition, cameraPosition + sd * 3000.0, skyFogColor);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, f.yzw, 1.0 - exp(-f.x));
      }
    }`)
  return sky
}

/** A gradient dome for twilight and night (the day sky model only does day). */
function nightDome() {
  const material = new T.ShaderMaterial({
    uniforms: {
      zenith: { value: new T.Color('#02050d') },
      horizon: { value: new T.Color('#0c1528') },
      glow: { value: new T.Color('#3a2a3a') },
      sunDir: { value: new T.Vector3(0, -1, 0) },
      opacity: { value: 0 },
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; uniform float opacity;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.45));
        vec2 a = normalize(vDir.xz + 1e-5);
        vec2 b = normalize(sunDir.xz + 1e-5);
        float toward = max(0.0, dot(a, b));
        c += glow * pow(toward, 3.0) * exp(-h * 8.0) * clamp(1.0 + sunDir.y * 6.0, 0.0, 1.0);
        gl_FragColor = vec4(c, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: T.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  })
  const dome = new T.Mesh(new T.SphereGeometry(DOME * 0.98, 32, 16), material)
  dome.renderOrder = -2
  dome.frustumCulled = false
  return dome
}

function starField() {
  const position = []
  const color = []
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const radius = DOME * 0.95
  for (let i = 0; i < 2500; i++) {
    const y = random() * 1.1 - 0.1
    const a = random() * Math.PI * 2
    const r = Math.sqrt(1 - y * y)
    position.push(Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius)
    const b = 0.18 + random() ** 6 * 0.82
    const warm = random()
    color.push(b, b * (0.92 + warm * 0.08), b * (0.85 + (1 - warm) * 0.15))
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new T.Float32BufferAttribute(color, 3))
  const material = new T.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
  })
  const stars = new T.Points(geometry, material)
  stars.renderOrder = -1
  stars.frustumCulled = false
  return stars
}

/** Draw the moon's face for its age (0 new .. 0.5 full), lit from the sun's side. */
function drawMoon(canvas, age) {
  const g = canvas.getContext('2d')
  const lit = moonIllumination(age)
  g.clearRect(0, 0, 128, 128)
  g.globalCompositeOperation = 'source-over'
  const glow = g.createRadialGradient(64, 64, 18, 64, 64, 64)
  glow.addColorStop(0, `rgba(220,230,255,${(0.35 * lit).toFixed(3)})`)
  glow.addColorStop(1, 'rgba(220,230,255,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  // The lit part: a half disc on the sun's side (right while waxing, as
  // seen from the north), widened by a half ellipse when gibbous or cut
  // down by one when a crescent.
  const face = document.createElement('canvas')
  face.width = face.height = 128
  const m = face.getContext('2d')
  const r = 20
  const waxing = age < 0.5
  m.fillStyle = '#eef0f4'
  m.beginPath()
  m.arc(64, 64, r, -Math.PI / 2, Math.PI / 2, !waxing)
  m.fill()
  const rx = r * Math.abs(Math.cos(age * 2 * Math.PI))
  m.globalCompositeOperation = lit > 0.5 ? 'source-over' : 'destination-out'
  m.beginPath()
  m.ellipse(64, 64, Math.max(rx, 0.01), r, 0, 0, Math.PI * 2)
  m.fill()
  // Darker "seas", on the lit part only.
  m.globalCompositeOperation = 'source-atop'
  m.fillStyle = 'rgba(150,155,170,0.5)'
  for (const [x, y, rr] of [[58, 58, 6], [70, 66, 5], [62, 72, 4], [72, 55, 3]]) {
    m.beginPath()
    m.arc(x, y, rr, 0, Math.PI * 2)
    m.fill()
  }
  // The dark side, faintly (earthshine).
  g.fillStyle = 'rgba(40,46,60,0.35)'
  g.beginPath()
  g.arc(64, 64, r, 0, Math.PI * 2)
  g.fill()
  g.drawImage(face, 0, 0)
}

function moonSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  drawMoon(canvas, 0.5)
  const map = new T.CanvasTexture(canvas)
  map.colorSpace = T.SRGBColorSpace
  const moon = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false }))
  moon.scale.setScalar(DOME * 0.106)
  moon.renderOrder = -1
  moon.userData.age = 0.5
  moon.userData.setAge = age => {
    if (Math.abs(age - moon.userData.age) < 0.004) return
    moon.userData.age = age
    drawMoon(canvas, age)
    map.needsUpdate = true
  }
  return moon
}

// --- Clouds --------------------------------------------------------------------
// Fair-weather cumulus on one big plane, drawn by a noise shader. The same
// noise dims the sunlight on the ground below, so shadows always match.

/** Cloud types: noise scale and stretch, coverage, edge, opacity, shadow, height (m). */
export const CLOUD_TYPES = {
  cumulus: { label: 'Fair-weather cumulus', scale: [700, 700], low: 0.66, high: 0.30, edge: 0.09, alpha: 1, shadow: 1, height: 700, detail: 0.2 },
  stratocumulus: { label: 'Stratocumulus rolls', scale: [1200, 480], low: 0.5, high: 0.12, edge: 0.16, alpha: 1, shadow: 0.85, height: 620, detail: 0.3 },
  altocumulus: { label: 'Altocumulus (mackerel sky)', scale: [260, 190], low: 0.62, high: 0.3, edge: 0.07, alpha: 0.85, shadow: 0.45, height: 1300, detail: 0.5 },
  cirrus: { label: 'High cirrus', scale: [2600, 160], low: 0.62, high: 0.28, edge: 0.3, alpha: 0.55, shadow: 0.15, height: 1700, detail: 0.45 },
}

/** Shared by the cloud layer and every material that shows cloud shadows. */
export const cloudUniforms = {
  cloudOffset: { value: new T.Vector2() },
  cloudCover: { value: 0.35 },
  cloudSunDir: { value: new T.Vector3(0, 1, 0) },
  cloudShadowStrength: { value: 0.6 },
  cloudScale: { value: new T.Vector2(700, 700) },
  cloudShape: { value: new T.Vector4(0.66, 0.30, 0.09, 0.2) }, // threshold clear, overcast; edge; detail
  cloudHeight: { value: 700 },
}

const NOISE = /* glsl */ `
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), u.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), u.x), u.y);
}
float cFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * cNoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
float cloudDensity(vec2 xz) {
  // Turned a little off the compass so streaks and rolls don't line up with the roads.
  vec2 q = xz + cloudOffset;
  q = vec2(q.x * 0.87 + q.y * 0.5, -q.x * 0.5 + q.y * 0.87);
  vec2 p = q / cloudScale;
  float n = cFbm(p) * (1.0 - cloudShape.w) + cFbm(p * 3.7 + 4.0) * cloudShape.w;
  float t = mix(cloudShape.x, cloudShape.y, cloudCover);
  return smoothstep(t, t + cloudShape.z, n);
}
`

const UNIFORM_DECLS = /* glsl */ `
uniform vec2 cloudOffset;
uniform float cloudCover;
uniform vec3 cloudSunDir;
uniform float cloudShadowStrength;
uniform vec2 cloudScale;
uniform vec4 cloudShape;
uniform float cloudHeight;
`

function cloudLayer() {
  const uniforms = {
    ...cloudUniforms,
    lightColor: { value: new T.Color(1, 1, 1) },
    shadeColor: { value: new T.Color(0.62, 0.66, 0.72) },
    hazeColor: { value: new T.Color('#c3d5e8') },
    night: { value: 0 },
    mistFade: { value: 0 },
    cloudAlpha: { value: 1 },
  }
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${UNIFORM_DECLS}
      uniform vec3 lightColor; uniform vec3 shadeColor; uniform vec3 hazeColor; uniform float night; uniform float mistFade; uniform float cloudAlpha;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        float d = cloudDensity(vWorld.xz);
        if (d < 0.01) discard;
        // Thicker parts are darker underneath; thin edges catch the light.
        float thick = cloudDensity(vWorld.xz + cloudSunDir.xz * 120.0);
        vec3 c = mix(lightColor, shadeColor, clamp(thick * 0.9, 0.0, 1.0));
        float dist = length(vWorld.xz - cameraPosition.xz);
        c = mix(c, hazeColor, smoothstep(700.0, ${(DOME * 0.95).toFixed(1)}, dist) * 0.85);
        float a = min(1.0, d * 1.5) * (1.0 - smoothstep(${(DOME * 0.75).toFixed(1)}, ${(DOME * 1.1).toFixed(1)}, dist)) * mix(1.0, 0.8, night) * cloudAlpha * (1.0 - mistFade);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    fog: false,
  })
  const mesh = new T.Mesh(new T.PlaneGeometry(DOME * 2.6, DOME * 2.6).rotateX(-Math.PI / 2), material)
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return { mesh, uniforms }
}

/** Let a lit material show cloud shadows: direct sunlight dims under a cloud. */
export function addCloudShadows(material) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer)
    Object.assign(shader.uniforms, cloudUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudWorld;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vCloudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef USE_INSTANCING
          vCloudWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #endif`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECLS}\nvarying vec3 vCloudWorld;\n${NOISE}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // Follow the sun ray up to the cloud layer.
          float up = max(cloudSunDir.y, 0.08);
          vec2 at = vCloudWorld.xz + cloudSunDir.xz / up * (cloudHeight - vCloudWorld.y);
          float shade = 1.0 - cloudShadowStrength * cloudDensity(at);
          reflectedLight.directDiffuse *= shade;
          reflectedLight.directSpecular *= shade;
        }`)
  }
  const prevKey = material.customProgramCacheKey?.bind(material)
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cloudShadows`
  material.needsUpdate = true
  return material
}

// --- The whole sky -------------------------------------------------------------

const ORIGIN = new T.Vector3()
const UP = new T.Vector3(0, 1, 0)
const NORTH = new T.Vector3(0, 0, 1)
const _mist = new T.Color()
const _cloudTop = new T.Color()
const _cloudSun = new T.Color()

/**
 * Build the sky, lights, haze and weather in a scene. Call setOptions with
 * the settings (sky options), and update(dt, camera) every frame.
 */
export function createSky(scene, { haze = 0.0006, far = 4000, shadowMap = 2048 } = {}) {
  // Haze, mist and low cloud in every material's fog (weather.js).
  installVolumetricFog(haze)
  scene.background = new T.Color('#9cc3e6')
  scene.fog = new T.FogExp2('#c3d5e8', haze)
  const sky = daySky()
  const night = new T.Group()
  const dome = nightDome()
  const stars = starField()
  const moon = moonSprite()
  night.add(dome, stars, moon)
  const clouds = cloudLayer()
  scene.add(sky, night, clouds.mesh)

  const hemi = new T.HemisphereLight('#cfe3ff', '#4d5a33', 1.1)
  const sun = new T.DirectionalLight('#fff3df', 2.6)
  scene.add(hemi, sun, sun.target)
  // Shadows from the sun (or moon): a map about 150 m across that follows
  // the car, sharp near it, redrawn every frame so its own shadow moves.
  const SHADOW_HALF = 75
  if (shadowMap) {
    sun.castShadow = true
    sun.shadow.mapSize.set(shadowMap, shadowMap)
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 700 })
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.06
    sun.shadow.radius = 3
  }
  const shadowCentre = new T.Vector3()
  const lightSpace = new T.Matrix4()
  const lightInverse = new T.Matrix4()

  const lowCloud = new LowCloud()
  const sunDir = new T.Vector3()
  const moonDir = new T.Vector3()
  const lightDir = new T.Vector3()
  const hazeBase = new T.Color()
  const wind = new T.Vector2()
  // What the rest of the game reads: the sun, how foggy it is around the
  // camera, how far anything can be seen, the exposure to use.
  const state = {
    exposure: 0.9, night: 0, sunDir, sunElevation: 30, fogNow: 0, visibleFar: far,
    weather: { mist: 0, mistTop: 45, lowCloud: { amount: 0, base: 60, top: 100 } },
    starLevel: 1, cloudShadow: 1,
  }
  let sunBase = sun.intensity
  let hemiBase = hemi.intensity

  /**
   * Time and date: sun, moon, sky, light colours, haze and stars.
   * moonAgeNow: the moon's age (0 new .. 0.5 full).
   */
  function setTime(hours, day, moonAgeNow = 0.5) {
    const s = sunPosition(hours, day)
    const m = moonPosition(hours, day, moonAgeNow)
    const lit = moonIllumination(moonAgeNow)
    skyDir(s.elevation, s.azimuth, sunDir)
    skyDir(m.elevation, m.azimuth, moonDir)
    const el = s.elevation
    state.sunElevation = el
    sky.material.uniforms.sunPosition.value.copy(sunDir)
    const dark = smooth(2, -10, el)
    state.night = dark
    const daylight = smooth(-3, 14, el)
    const warm = 1 - smooth(2, 22, el)
    const moonUp = smooth(-3, 8, m.elevation)
    if (el > -3) {
      lightDir.copy(sunDir)
      lightDir.y = Math.max(lightDir.y, 0.03)
      sun.intensity = 2.8 * daylight
      sun.color.setRGB(1, 0.95 - warm * 0.3, 0.88 - warm * 0.5)
    } else {
      lightDir.copy(moonDir)
      lightDir.y = Math.max(lightDir.y, 0.05)
      sun.intensity = 0.32 * moonUp * dark * lit
      sun.color.setRGB(0.62, 0.72, 1)
    }
    lightDir.normalize()
    // Sky light: blue by day, deep blue at night (a little more under a
    // bright moon, never quite black).
    const moonGlow = moonUp * lit * dark
    hemi.intensity = 0.1 + 1.0 * daylight + 0.08 * (1 - dark) + 0.06 * moonGlow
    hemi.color.setRGB(0.81 - 0.45 * dark, 0.89 - 0.42 * dark, 1 - 0.3 * dark)
    hemi.groundColor.setRGB(0.3 * (1 - dark) + 0.03, 0.35 * (1 - dark) + 0.04, 0.2 * (1 - dark) + 0.06)
    hazeColour(el, hazeBase)
    scene.fog.color.copy(hazeBase)
    scene.background.copy(hazeBase)
    sunBase = sun.intensity
    hemiBase = hemi.intensity
    const u = dome.material.uniforms
    u.opacity.value = smooth(3, -3, el)
    u.zenith.value.copy(TWILIGHT_ZENITH).lerp(NIGHT_ZENITH, smooth(-2, -12, el))
    u.horizon.value.copy(TWILIGHT_HORIZON).lerp(NIGHT_HORIZON, smooth(0, -9, el))
    u.glow.value.copy(TWILIGHT_GLOW).multiplyScalar(1 - smooth(-4, -14, el))
    u.sunDir.value.copy(sunDir)
    // Stars fade in as it gets dark (and under a bright moon a little).
    stars.material.opacity = dark * state.starLevel * (1 - 0.3 * moonGlow)
    stars.visible = stars.material.opacity > 0.01
    moon.userData.setAge(moonAgeNow)
    moon.visible = m.elevation > -2 && lit > 0.02
    moon.userData.opacity = 0.25 + 0.75 * smooth(0, -8, el)
    moon.material.opacity = moon.userData.opacity
    moon.position.copy(moonDir).multiplyScalar(DOME * 0.9)
    state.exposure = 0.9 + 0.5 * dark
    cloudUniforms.cloudSunDir.value.copy(lightDir)
    cloudUniforms.cloudShadowStrength.value = (0.75 * daylight + 0.2 * dark * lit) * state.cloudShadow
    const cu = clouds.uniforms
    const k = Math.min(1, sun.intensity / 2.2)
    const dim = 1 - 0.85 * dark
    cu.lightColor.value.copy(sun.color).multiplyScalar((0.35 + 0.75 * k) * dim).addScalar(0.08 * (1 - dark))
    cu.shadeColor.value.setRGB(0.5, 0.54, 0.6).multiplyScalar((0.25 + 0.85 * k) * dim).lerp(hazeBase, 0.25)
    cu.hazeColor.value.copy(hazeBase)
    cu.night.value = dark
  }

  /** Cloud cover (0-1) and type (a key of CLOUD_TYPES). */
  function setClouds(cover, type = 'cumulus') {
    const t = CLOUD_TYPES[type] ?? CLOUD_TYPES.cumulus
    cloudUniforms.cloudCover.value = cover
    cloudUniforms.cloudScale.value.set(...t.scale)
    cloudUniforms.cloudShape.value.set(t.low, t.high, t.edge, t.detail)
    cloudUniforms.cloudHeight.value = t.height
    clouds.mesh.position.y = t.height
    clouds.uniforms.cloudAlpha.value = t.alpha
    state.cloudShadow = t.shadow
    state.cloudDim = 0.95 * t.shadow // how much it can hide the sun (glare)
    clouds.mesh.visible = cover > 0.01
  }

  /** Mist (0-1) and low cloud ({ amount, base, top }): weather.js weatherFor. */
  function setWeather(w) {
    state.weather = w
    lowCloud.set(w.lowCloud.amount, w.lowCloud.base, w.lowCloud.top)
  }

  /** Wind (m/s) and the compass direction it blows from (degrees). */
  function setWind(speed, fromDeg) {
    const a = fromDeg * deg
    // Blowing from the north (azimuth 0, -z) moves things towards +z.
    wind.set(-Math.sin(a) * speed, Math.cos(a) * speed)
  }

  /** Stars: 'dark' (dark countryside), 'town' (fewer, town glow) or 'off'. */
  function setStars(mode) {
    state.starLevel = mode === 'off' ? 0 : mode === 'town' ? 0.4 : 1
  }

  /**
   * Every frame: drift the clouds; mist and low cloud where the camera is
   * (the haze thickens and greys, the sky and high clouds fade into it,
   * the sun dims; inside a cloud you see a few tens of metres).
   */
  function update(dt, camera, groundY = 0, focus = camera.position) {
    const o = cloudUniforms.cloudOffset.value
    const aloft = CLOUD_TYPES.cirrus.height === cloudUniforms.cloudHeight.value ? 3.5 : 1.8
    o.x -= wind.x * aloft * dt
    o.y -= wind.y * aloft * dt
    const camPos = camera.position
    night.position.copy(camPos)
    clouds.mesh.position.x = camPos.x
    clouds.mesh.position.z = camPos.z
    // Centre the shadow map on the focus (the car), snapped to whole shadow
    // pixels in the light's own frame, so edges don't shimmer as it moves.
    const texel = (2 * SHADOW_HALF) / sun.shadow.mapSize.x
    lightSpace.lookAt(lightDir, ORIGIN, Math.abs(lightDir.y) > 0.99 ? NORTH : UP)
    lightInverse.copy(lightSpace).invert()
    shadowCentre.copy(focus).applyMatrix4(lightInverse)
    shadowCentre.x = Math.round(shadowCentre.x / texel) * texel
    shadowCentre.y = Math.round(shadowCentre.y / texel) * texel
    shadowCentre.applyMatrix4(lightSpace)
    sun.target.position.copy(shadowCentre)
    sun.position.copy(shadowCentre).addScaledVector(lightDir, 300)
    sun.target.updateMatrixWorld()

    lowCloud.update(dt, wind)
    const w = state.weather
    const mist = w.mist
    const fog = scene.fog
    const el = state.sunElevation
    const day = smooth(-6, 14, el)
    const mistD = mist > 0 ? 3 / (650 - 560 * Math.pow(mist, 0.7)) : 0
    const top = w.mistTop ?? 45
    Object.assign(fog4.a, { x: mistD, y: top, z: lowCloud.amount, w: 3 / 35 })
    Object.assign(fog4.b, { x: lowCloud.base, y: lowCloud.top, z: lowCloud.offset.x, w: lowCloud.offset.y })
    Object.assign(fog4.sun, { x: sunDir.x, y: sunDir.y, z: sunDir.z, w: 0.25 * smooth(-2, 10, el) })
    const inCloud = lowCloud.inside(camPos)
    const H = Math.max(top * 0.3, 4)
    const overhead = mistD * (Math.max(0, top - camPos.y) + H * Math.exp(-Math.max(0, camPos.y - top) / H))
    const veil = 1 - Math.exp(-overhead * 1.2)
    // How far anything can be seen: no need to draw beyond solid fog.
    const inMist = mistD > 0 ? 1 - smooth(groundY + top, groundY + top * 2 + 20, camPos.y) : 0
    let visible = far
    if (inMist > 0) visible = Math.min(visible, 6 / (0.7 * mistD) / Math.max(inMist, 1e-3))
    if (inCloud > 0.3) visible = Math.min(visible, 350 / inCloud)
    state.visibleFar = Math.max(250, visible)
    const grey = Math.max(veil, inCloud)
    state.fogNow = grey
    // The haze greys with mist: its own colour of the moment, so it
    // darkens through dusk with the sky.
    const h = hazeBase
    const lum = 0.3 * h.r + 0.55 * h.g + 0.15 * h.b
    _mist.setRGB(lum, lum * 1.02, lum * 1.06).lerp(h, 0.35).multiplyScalar(0.92)
    fog.color.copy(h).lerp(_mist, Math.min(1, mist * 1.2))
    // Low cloud: underneath the same grey as the mist (a shade darker), on
    // top brighter in the sun.
    _mist.setRGB(lum, lum * 1.02, lum * 1.06).lerp(h, 0.35).multiplyScalar(0.88)
    _cloudTop.copy(_mist)
    _mist.convertLinearToSRGB()
    Object.assign(fog4.under, { x: _mist.r, y: _mist.g, z: _mist.b })
    _cloudTop.lerp(_cloudSun.copy(sun.color).multiplyScalar(0.95), 0.6 * day).convertLinearToSRGB()
    Object.assign(fog4.top, { x: _cloudTop.r, y: _cloudTop.g, z: _cloudTop.b })
    scene.background.copy(fog.color)
    const su = sky.material.uniforms
    su.skyFog.value = 0
    su.skyFogColor.value.copy(fog.color).convertLinearToSRGB()
    // Under low cloud the high clouds and stars are hidden too.
    const ceiling = camPos.y < lowCloud.base ? smooth(0.5, 0.9, lowCloud.amount) : 0
    clouds.uniforms.mistFade.value = Math.min(1, Math.max(grey * 1.3, ceiling))
    const hidden = Math.min(1, Math.max(grey * 1.3, ceiling))
    stars.material.opacity = state.night * state.starLevel * (1 - hidden)
    moon.material.opacity = (moon.userData.opacity ?? 1) * (1 - hidden)
    const overcast = camPos.y < lowCloud.base ? lowCloud.amount * 0.6 : 0
    const dim = 1 - Math.max(veil * 0.75, overcast, inCloud * 0.8)
    sun.intensity = sunBase * dim
    hemi.intensity = hemiBase * (1 + 0.15 * grey)
    state.lowCloudCover = overcast
  }

  setWind(3, 270)
  setTime(15, 172)
  setClouds(0.35)
  return { setTime, setClouds, setWeather, setWind, setStars, update, state, hemi, sun }
}
