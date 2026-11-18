// Drawing the land (its shape: terrain.js). The ground shader is ported
// from RC Flight Sim (src/world/ground.js): grass at two scales, close-up
// blades, and beyond the drivable area a patchwork of farm fields with
// hedgerows. Steep banks and cuttings show bare earth.
import * as T from 'three'
import { addCloudShadows } from './sky.js'
import { FLAT_EDGE, POND, groundGrid, natural } from './terrain.js'

export { FLAT_EDGE, heightAt } from './terrain.js'
export const TERRAIN_SIZE = 7200
const OUTER_CELL = 20

function grassTexture() {
  // 6 m of lawn: an even mid green with fine, low-contrast blade strokes,
  // so from a distance it reads as smooth grass, not camouflage.
  const N = 512
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  ctx.fillStyle = '#6a8c3e'
  ctx.fillRect(0, 0, N, N)
  ctx.lineCap = 'round'
  for (let i = 0; i < 30000; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const len = 1.5 + rnd() * 3.5
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2
    const l = 30 + rnd() * 16
    ctx.strokeStyle = `hsla(${80 + rnd() * 16}, ${36 + rnd() * 14}%, ${l}%, 0.55)`
    ctx.lineWidth = 0.8 + rnd() * 0.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  const t = new T.CanvasTexture(c)
  t.wrapS = t.wrapT = T.RepeatWrapping
  t.colorSpace = T.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/**
 * Close-up grass: a metre of blades as brightness (0.5 = no change), laid
 * over the ground near the camera so close up you see blades.
 */
function grassFineTexture() {
  const N = 512
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  g.fillStyle = 'rgb(92, 96, 88)'
  g.fillRect(0, 0, N, N)
  g.lineCap = 'round'
  for (let i = 0; i < 14000; i++) {
    const k = i / 14000
    const x = rnd() * N
    const y = rnd() * N
    const len = 6 + rnd() * 14 + k * 8
    const a = rnd() * Math.PI * 2
    const v = 104 + k * 50 + rnd() * 30
    const yel = rnd() * 14
    g.strokeStyle = `rgb(${Math.round(v + yel)}, ${Math.round(v + 4)}, ${Math.round(v - 10 - yel)})`
    g.lineWidth = 1.6 + rnd() * 1.8
    // Drawn wrapping round the edges so the tile repeats seamlessly.
    for (const ox of [-N, 0, N]) {
      for (const oy of [-N, 0, N]) {
        const x0 = x + ox
        const y0 = y + oy
        if (x0 < -40 || x0 > N + 40 || y0 < -40 || y0 > N + 40) continue
        g.beginPath()
        g.moveTo(x0, y0)
        g.quadraticCurveTo(x0 + Math.cos(a) * len * 0.6 + 2, y0 + Math.sin(a) * len * 0.6, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len)
        g.stroke()
      }
    }
  }
  const px = g.getImageData(0, 0, N, N).data
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2]
  const mean = sum / (px.length / 4) / 3 / 255
  const tex = new T.CanvasTexture(c)
  tex.wrapS = tex.wrapT = T.RepeatWrapping
  tex.colorSpace = T.NoColorSpace
  tex.anisotropy = 8
  return { tex, mean }
}

/** Grass for the season (weather.js seasonFor), shared by the ground's shader. */
export const groundUniforms = {
  uGrassTint: { value: new T.Vector3(1, 1, 1) },
  uGrassDry: { value: 0 }, // late summer: the grass yellows
  uGrassLen: { value: 0 }, // how long it has grown (0-1): coarser blades
}

/** Set the ground's grass for the season. */
export function setGroundSeason(season) {
  groundUniforms.uGrassTint.value.set(...season.grass)
  groundUniforms.uGrassDry.value = season.dry
  groundUniforms.uGrassLen.value = season.length
}

const GLSL = /* glsl */ `
varying vec3 vGroundWorld;
varying vec3 vGroundNormal;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
float gFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * gNoise(p); p = p * 2.07 + vec2(5.3, 1.7); a *= 0.5; }
  return s;
}
`

/** Add the per-pixel ground detail to the terrain's material. */
function addGroundDetail(material) {
  const fine = grassFineTexture()
  const edge = FLAT_EDGE.toFixed(1)
  material.onBeforeCompile = shader => {
    shader.uniforms.grassFine = { value: fine.tex }
    shader.uniforms.grassFineMean = { value: fine.mean }
    Object.assign(shader.uniforms, groundUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;\nvarying vec3 vGroundNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}\nuniform sampler2D grassFine;\nuniform float grassFineMean;\nuniform vec3 uGrassTint;\nuniform float uGrassDry;\nuniform float uGrassLen;`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec2 p = vGroundWorld.xz;
        // Grass texture at two scales and angles, blended by a slow noise,
        // so no repeat pattern shows.
        vec2 q = p / 6.0;
        vec2 uvB = vec2(q.x * 0.81 - q.y * 0.59, q.x * 0.59 + q.y * 0.81) * 0.43 + 0.37;
        float mixAB = smoothstep(0.3, 0.7, gNoise(p / 37.0));
        vec3 g = mix(texture2D(map, q).rgb, texture2D(map, uvB).rgb, mixAB);
        // Large, soft patches of lighter and darker grass.
        g *= 0.94 + 0.12 * gFbm(p / 31.0);

        // Fields on a jittered grid, each its own crop.
        vec2 fp = vec2(p.x * 0.96 + p.y * 0.28, -p.x * 0.28 + p.y * 0.96);
        vec2 cellSize = vec2(190.0, 140.0);
        vec2 cell = floor(fp / cellSize);
        vec2 f = fract(fp / cellSize);
        vec2 wob = vec2(gNoise(fp / 60.0 + 3.0), gNoise(fp / 60.0 + 9.0)) - 0.5;
        f += wob * 0.08;
        float h = gHash(cell);
        // Where you drive: meadows of slightly different greens, no hedges
        // (nothing there to hit). Beyond: the full patchwork.
        vec2 out2 = max(abs(p) - ${edge}, 0.0);
        float farm = smoothstep(10.0, 110.0, length(out2));
        g *= 1.0 + (gHash(cell + 7.0) - 0.5) * 0.12 * (1.0 - farm);
        if (farm > 0.0) {
          vec3 field;
          if (h < 0.42) field = g * vec3(1.05, 1.08, 0.95);                       // pasture
          else if (h < 0.58) field = vec3(0.62, 0.55, 0.32) * (0.9 + 0.2 * gNoise(fp / 4.0)); // stubble
          else if (h < 0.7) field = vec3(0.36, 0.27, 0.19) * (0.8 + 0.35 * step(0.5, fract(fp.x / 1.6))); // ploughed
          else if (h < 0.86) field = vec3(0.42, 0.58, 0.22) * (0.85 + 0.3 * step(0.5, fract(fp.y / 2.2))); // crop rows
          else field = vec3(0.55, 0.62, 0.3) * (0.9 + 0.2 * gNoise(fp / 8.0));    // hay meadow
          // Hedgerows: 3 m wide, dark and lumpy.
          vec2 e = min(f, 1.0 - f) * cellSize;
          float hedge = 1.0 - smoothstep(1.2, 3.2, min(e.x, e.y));
          vec3 hedgeCol = vec3(0.12, 0.2, 0.08) * (0.7 + 0.6 * gNoise(fp / 2.0));
          field = mix(field, hedgeCol, hedge);
          g = mix(g, field, farm);
        }

        // Steep banks, cuttings and hillsides: thin grass over bare earth
        // and stones on the steepest.
        float upright = normalize(vGroundNormal).y;
        float steep = smoothstep(0.86, 0.66, upright);
        if (steep > 0.0) {
          float clods = gNoise(p / 1.3) * 0.6 + gNoise(p / 4.0) * 0.4;
          vec3 earth = vec3(0.43, 0.35, 0.26) * (0.75 + 0.45 * clods);
          vec3 stone = vec3(0.52, 0.5, 0.46) * (0.8 + 0.35 * gHash(floor(p * 2.0)));
          earth = mix(earth, stone, smoothstep(0.62, 0.5, upright) * step(0.55, gNoise(p / 2.2 + 3.0)));
          // Grass hangs on in patches.
          float hold = smoothstep(0.35, 0.65, gNoise(p / 3.1 + 7.0) + (upright - 0.7));
          g = mix(g, earth, steep * (1.0 - 0.7 * hold));
        }

        // Close up: blades at two scales and angles, fading with distance.
        float grassy = smoothstep(0.0, 0.06, g.g - max(g.r, g.b));
        {
          float camD = length(vGroundWorld - cameraPosition);
          float len = clamp(0.45 + 0.55 * uGrassLen, 0.0, 1.0);
          float near = 1.0 - smoothstep(10.0, 70.0 + 50.0 * len, camD);
          if (near > 0.0 && grassy > 0.0) {
            vec2 r1 = vec2(p.x * 0.94 - p.y * 0.34, p.x * 0.34 + p.y * 0.94);
            vec3 b1 = texture2D(grassFine, r1 / 0.9).rgb;
            vec3 b2 = texture2D(grassFine, vec2(p.y, -p.x) / 0.37 + 0.31).rgb;
            vec3 blades = mix(b1, b2, 0.4) / grassFineMean;
            // Longer grass: big coarse blades and tufts with shadowed hollows.
            vec3 b3 = texture2D(grassFine, vec2(p.x * 0.6 + p.y * 0.8, -p.x * 0.8 + p.y * 0.6) / 2.6 + 0.17).rgb / grassFineMean;
            blades = mix(blades, mix(blades, b3, 0.6), len);
            blades = 1.0 + (blades - 1.0) * mix(vec3(0.85), vec3(1.25), len);
            float tuft = mix(0.92 + 0.16 * gNoise(p / 0.45), 0.72 + 0.56 * gNoise(p / 0.8) * gNoise(p / 2.3 + 5.0) * 1.6, len);
            g *= mix(vec3(1.0), blades * tuft, near * grassy);
          }
        }
        // The season: on green ground only (hedges, crops and pasture too).
        g *= mix(vec3(1.0), uGrassTint, grassy);
        {
          // Dried out towards straw in a dry late summer, patchily.
          float lumG = dot(g, vec3(0.3, 0.59, 0.11));
          vec3 straw = vec3(1.55, 1.3, 0.72) * lumG * 1.45;
          float patchy = 0.85 + 0.3 * gNoise(p / 9.0);
          g = mix(g, straw, clamp(uGrassDry * patchy, 0.0, 1.0) * grassy);
        }
        diffuseColor.rgb *= g;
      `)
  }
  material.customProgramCacheKey = () => 'countyGround'
  return material
}

/** The ground: a fine mesh over the drivable area (from terrain.js's grid) and a coarse one beyond. */
export function buildTerrain(scene) {
  const map = grassTexture()
  const material = addCloudShadows(addGroundDetail(new T.MeshLambertMaterial({ map, vertexColors: true })))
  const tint = groundTint()

  // Inside: the grid the physics uses, so they agree, with a skirt round
  // its edge dropping under the coarse ground (no cracks where they meet).
  const { heights, n, cell, half } = groundGrid
  const m = n + 2
  const inner = new Float32Array(m * m * 3)
  const innerColour = new Float32Array(m * m * 3)
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const gi = Math.min(n - 1, Math.max(0, i - 1))
      const gj = Math.min(n - 1, Math.max(0, j - 1))
      const x = gi * cell - half
      const z = gj * cell - half
      const skirt = i === 0 || j === 0 || i === m - 1 || j === m - 1
      const h = heights[gj * n + gi] - (skirt ? 4 : 0)
      const k = (j * m + i) * 3
      inner.set([x, h, z], k)
      tint(x, z, h, innerColour, k)
    }
  }
  scene.add(gridMesh(inner, innerColour, m, () => true, material))

  // Outside: every 20 m out to the horizon, leaving a hole for the inside.
  const cells = TERRAIN_SIZE / OUTER_CELL
  const o = cells + 1
  const outer = new Float32Array(o * o * 3)
  const outerColour = new Float32Array(o * o * 3)
  for (let j = 0; j < o; j++) {
    for (let i = 0; i < o; i++) {
      const x = i * OUTER_CELL - TERRAIN_SIZE / 2
      const z = j * OUTER_CELL - TERRAIN_SIZE / 2
      const h = natural(x, z)
      const k = (j * o + i) * 3
      outer.set([x, h, z], k)
      tint(x, z, h, outerColour, k)
    }
  }
  const covered = (i, j) => {
    const x0 = i * OUTER_CELL - TERRAIN_SIZE / 2
    const z0 = j * OUTER_CELL - TERRAIN_SIZE / 2
    return x0 >= -half && x0 + OUTER_CELL <= half && z0 >= -half && z0 + OUTER_CELL <= half
  }
  scene.add(gridMesh(outer, outerColour, o, (i, j) => !covered(i, j), material))

  // The pond.
  const water = new T.Mesh(new T.CircleGeometry(POND.radius, 64).rotateX(-Math.PI / 2), addCloudShadows(new T.MeshStandardMaterial({
    color: 0x2c4a4c, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.92,
  })))
  water.position.set(POND.x, POND.level, POND.z)
  scene.add(water)
}

function groundTint() {
  // Vertex colours multiply the grass texture, so they stay light.
  const c1 = new T.Color('#f2ffd8')
  const c2 = new T.Color('#c4d79c')
  const c3 = new T.Color('#e8e2c0')
  const colour = new T.Color()
  return (x, z, h, out, k) => {
    const wave = Math.sin(x * 0.011) * Math.cos(z * 0.013) * 0.5 + 0.5
    colour.copy(c1).lerp(c2, wave * 0.8)
    if (h > 60) colour.lerp(c3, Math.min(1, (h - 60) / 120))
    out[k] = colour.r
    out[k + 1] = colour.g
    out[k + 2] = colour.b
  }
}

function gridMesh(positions, colours, n, keep, material) {
  const index = []
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (!keep(i, j)) continue
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      index.push(a, c, b, b, c, d)
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new T.BufferAttribute(colours, 3))
  geometry.setIndex(index.length > 65535 ? new T.Uint32BufferAttribute(index, 1) : new T.Uint16BufferAttribute(index, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return new T.Mesh(geometry, material)
}
