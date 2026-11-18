// The lie of the land, shared by the physics and the scenery.
//
// A designed landscape: a big hill to the east whose flank the east loop
// climbs round, a steep ridge to the west with the west loop on its side, a
// winding valley across the north, a crest on the central road, a hollow
// with a pond, all on rolling noise. Beyond the drivable area it carries on
// into the distant hills.
//
// The roads are laid on it as real ones are: each road's height follows a
// smoothed version of the ground, its grade capped, junctions at one height,
// level across its width. Where it crosses a slope the ground is cut away
// or built up to it in banks (cuttings and embankments).
import { HALF_WORLD, JOINTS, LANDMARKS, PAD, roads } from './roads.js'

export const FLAT_EDGE = HALF_WORLD + 50 // (where the distant country takes over)
export const MAX_GRADE = 0.11
const BED = 3 // the level road bed reaches this far past the road's edge (m)
export const GRID = 2.5 // ground grid cell (m)
export const GRID_HALF = 720 // the grid covers -720..720 in x and z
const N = Math.round((GRID_HALF * 2) / GRID) + 1

// --- Noise ---------------------------------------------------------------------

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function smoothNoise(x, z) {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)
  const a = hash(xi, zi)
  const b = hash(xi + 1, zi)
  const c = hash(xi, zi + 1)
  const d = hash(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export function fbm(x, z) {
  let sum = 0
  let amp = 1
  let freq = 1
  for (let i = 0; i < 4; i++) {
    sum += amp * smoothNoise(x * freq, z * freq)
    amp *= 0.5
    freq *= 2.03
  }
  return sum / 1.875
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const bump = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r))

// --- The natural ground ----------------------------------------------------------

/** The land before any road is built on it (m). */
export function natural(x, z) {
  // Rolling country, and smaller swells on it.
  let h = fbm(x / 260 + 3.1, z / 260 + 7.7) * 34 - 15 + fbm(x / 70, z / 70) * 5
  // Beacon Hill, east: the east loop climbs round its western flank.
  h += 72 * bump(x, z, 455, 30, 150)
  // A steep ridge to the west, wandering a little; the west loop runs along its side.
  const across = x + 545 + 30 * Math.sin(z / 160)
  h += 62 * Math.exp(-((across / 95) ** 2)) * smooth(-470, -330, z) * (1 - smooth(330, 470, z))
  // A winding valley across the north.
  const valley = z - 175 - 28 * Math.sin(x / 110)
  h -= 24 * Math.exp(-((valley / 62) ** 2))
  // A crest the central road runs over, south of the crossroads.
  h += 26 * bump(x, z, 70, -110, 105)
  // A hollow with a pond in it.
  h -= 14 * bump(x, z, POND.x, POND.z, 75)
  // Beyond the drivable area: rising into the distant hills.
  const dx = Math.max(0, Math.abs(x) - FLAT_EDGE)
  const dz = Math.max(0, Math.abs(z) - FLAT_EDGE)
  const out = Math.hypot(dx, dz)
  if (out > 0) h += Math.max(0, (out - 300) / 1400) * 140 * fbm(x / 600 + 7, z / 600 + 3) + smooth(0, 400, out) * 12
  return h
}

export const POND = { x: -235, z: -185, radius: 85, level: 0 }

/** The village stretch round the crossroads: kerbs and footways, no hedges. */
export const VILLAGE = { x: 0, z: 28, radius: 115 }
export const inVillage = (x, z) => Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.radius

// --- A smoothed ground, for the roads to follow --------------------------------

const BLUR_CELL = 5
const BN = Math.round((GRID_HALF * 2 + 80) / BLUR_CELL) + 1
const BLUR_HALF = (BN - 1) * BLUR_CELL / 2
const raw = new Float32Array(BN * BN) // the land every 5 m (the ground grid samples it between)
const blurred = new Float32Array(BN * BN)
{
  for (let j = 0; j < BN; j++) {
    for (let i = 0; i < BN; i++) raw[j * BN + i] = natural(i * BLUR_CELL - BLUR_HALF, j * BLUR_CELL - BLUR_HALF)
  }
  blurred.set(raw)
  // Two box blurs each way (about a 45 m Gaussian).
  const R = 8
  const line = new Float32Array(BN)
  for (let pass = 0; pass < 2; pass++) {
    for (const horizontal of [true, false]) {
      for (let a = 0; a < BN; a++) {
        for (let b = 0; b < BN; b++) line[b] = blurred[horizontal ? a * BN + b : b * BN + a]
        let sum = 0
        for (let k = -R; k <= R; k++) sum += line[Math.min(BN - 1, Math.max(0, k))]
        for (let b = 0; b < BN; b++) {
          blurred[horizontal ? a * BN + b : b * BN + a] = sum / (2 * R + 1)
          sum += line[Math.min(BN - 1, b + R + 1)] - line[Math.max(0, b - R)]
        }
      }
    }
  }
}

function bilinear(field, n, cell, half, x, z) {
  const fx = Math.min(n - 1.001, Math.max(0, (x + half) / cell))
  const fz = Math.min(n - 1.001, Math.max(0, (z + half) / cell))
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const u = fx - i
  const v = fz - j
  const a = field[j * n + i]
  const b = field[j * n + i + 1]
  const c = field[(j + 1) * n + i]
  const d = field[(j + 1) * n + i + 1]
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

const smoothedGround = (x, z) => bilinear(blurred, BN, BLUR_CELL, BLUR_HALF, x, z)
const land5 = (x, z) => bilinear(raw, BN, BLUR_CELL, BLUR_HALF, x, z)

// --- Road heights ---------------------------------------------------------------

// The skidpad is level with the junction its spur leaves from.
export const PAD_HEIGHT = smoothedGround(0, -238)
for (const landmark of LANDMARKS) landmark.y = smoothedGround(landmark.x, landmark.z)

for (const road of roads) {
  const h = road.map(p => smoothedGround(p.x, p.z))
  // Junctions (and the skidpad) are pinned, so every road meeting there meets at one height.
  const pinned = road.map((p, i) => {
    const joint = JOINTS.find(([x, z]) => Math.hypot(p.x - x, p.z - z) < 2)
    if (joint) h[i] = smoothedGround(joint[0], joint[1])
    if (Math.hypot(p.x - PAD.x, p.z - PAD.z) < PAD.radius) h[i] = PAD_HEIGHT
    return Boolean(joint) || Math.hypot(p.x - PAD.x, p.z - PAD.z) < PAD.radius
  })
  const step = i => Math.hypot(road[i].x - road[i - 1].x, road[i].z - road[i - 1].z)
  for (let round = 0; round < 6; round++) {
    // Ease the bumps out, then cap the grade both ways.
    for (let pass = 0; pass < 3; pass++) {
      const copy = h.slice()
      for (let i = 1; i < h.length - 1; i++) if (!pinned[i]) h[i] = (copy[i - 1] + 2 * copy[i] + copy[i + 1]) / 4
    }
    for (let i = 1; i < h.length; i++) {
      if (pinned[i]) continue
      const g = MAX_GRADE * step(i)
      h[i] = Math.min(h[i - 1] + g, Math.max(h[i - 1] - g, h[i]))
    }
    for (let i = h.length - 2; i >= 0; i--) {
      if (pinned[i]) continue
      const g = MAX_GRADE * step(i + 1)
      h[i] = Math.min(h[i + 1] + g, Math.max(h[i + 1] - g, h[i]))
    }
  }
  road.forEach((p, i) => { p.y = h[i] })
}

// The pond's water: a little above the bottom of its hollow, and never up to a road.
{
  let bottom = Infinity
  for (let a = 0; a < 40; a++) {
    for (let r = 0; r <= 50; r += 5) {
      bottom = Math.min(bottom, natural(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r))
    }
  }
  let roadLow = Infinity
  for (const road of roads) {
    for (const p of road) if (Math.hypot(p.x - POND.x, p.z - POND.z) < 220) roadLow = Math.min(roadLow, p.y)
  }
  POND.level = Math.min(bottom + 4.5, roadLow - 2)
}

// --- The ground: the land with the roads built into it --------------------------

const ground = new Float32Array(N * N)
{
  const distance = new Float32Array(N * N).fill(Infinity)
  const bed = new Float32Array(N * N) // the road (or pad) height nearest each point
  const REACH = 70
  const mark = (x0, x1, z0, z1, test) => {
    const i0 = Math.max(0, Math.floor((x0 - REACH + GRID_HALF) / GRID))
    const i1 = Math.min(N - 1, Math.ceil((x1 + REACH + GRID_HALF) / GRID))
    const j0 = Math.max(0, Math.floor((z0 - REACH + GRID_HALF) / GRID))
    const j1 = Math.min(N - 1, Math.ceil((z1 + REACH + GRID_HALF) / GRID))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) test(j * N + i, i * GRID - GRID_HALF, j * GRID - GRID_HALF)
    }
  }
  for (const road of roads) {
    for (let k = 1; k < road.length; k++) {
      const a = road[k - 1]
      const b = road[k]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length2 = dx * dx + dz * dz
      mark(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z), (index, x, z) => {
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2))
        const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz) - (a.half + (b.half - a.half) * t + BED)
        if (d < distance[index]) {
          distance[index] = d
          bed[index] = a.y + (b.y - a.y) * t
        }
      })
    }
  }
  // The skidpad and the landmarks stand on level ground too.
  for (const { x: cx, z: cz, radius, y } of [{ ...PAD, radius: PAD.radius + 4, y: PAD_HEIGHT },
    ...LANDMARKS.map(l => ({ ...l, radius: Math.hypot(l.halfX, l.halfZ) + 6 }))]) {
    mark(cx - radius, cx + radius, cz - radius, cz + radius, (index, x, z) => {
      const d = Math.hypot(x - cx, z - cz) - radius
      if (d < distance[index]) {
        distance[index] = d
        bed[index] = y
      }
    })
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const index = j * N + i
      const land = land5(i * GRID - GRID_HALF, j * GRID - GRID_HALF)
      const d = distance[index]
      if (d === Infinity) {
        ground[index] = land
        continue
      }
      // Banks about 1 in 1.7 from the edge of the road bed out to the land.
      const bank = 3 + Math.abs(land - bed[index]) * 1.7
      const t = Math.min(1, Math.max(0, d / bank))
      ground[index] = bed[index] + (land - bed[index]) * t * t * (3 - 2 * t)
    }
  }
}

/** Ground height (m) at a point. */
export function heightAt(x, z) {
  if (Math.abs(x) >= GRID_HALF || Math.abs(z) >= GRID_HALF) return natural(x, z)
  return bilinear(ground, N, GRID, GRID_HALF, x, z)
}

/** The ground's slope at a point: [dh/dx, dh/dz]. */
export function slopeAt(x, z, out = [0, 0]) {
  const e = 1.2
  out[0] = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e)
  out[1] = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
  return out
}

export const inPond = (x, z) => Math.hypot(x - POND.x, z - POND.z) < POND.radius && heightAt(x, z) < POND.level - 0.35

/** The ground grid, for drawing it (heights row by row, z then x). */
export const groundGrid = { heights: ground, n: N, cell: GRID, half: GRID_HALF }

// --- Woods ------------------------------------------------------------------------
// Copses and woods inside the drivable area: on the steeper slopes and in
// patches, clear of the roads, the pond and the landmarks. Each is solid.

const WOOD_CELL = 20
const woodGrid = new Map()
export const WOODS = []
{
  let seed = 9127
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const slope = [0, 0]
  for (let attempt = 0; attempt < 26000 && WOODS.length < 900; attempt++) {
    const x = (random() - 0.5) * 2 * (HALF_WORLD - 10)
    const z = (random() - 0.5) * 2 * (HALF_WORLD - 10)
    slopeAt(x, z, slope)
    const steep = Math.hypot(slope[0], slope[1])
    const patch = fbm(x / 140 + 11, z / 140 + 5)
    if (patch + steep * 0.9 < 0.68) continue
    if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + 6) continue
    if (Math.hypot(x - PAD.x, z - PAD.z) < PAD.radius + 14) continue
    if (LANDMARKS.some(l => Math.abs(x - l.x) < l.halfX + 12 && Math.abs(z - l.z) < l.halfZ + 12)) continue
    if (roadDistance(x, z) < 15 || inVillage(x, z)) continue
    const scale = 2.8 + random() * 5.5
    const tree = { x, z, y: heightAt(x, z), scale, radius: scale * 0.42, kind: random() < 0.6 ? 0 : 1 }
    WOODS.push(tree)
    const key = `${Math.floor(x / WOOD_CELL)},${Math.floor(z / WOOD_CELL)}`
    if (!woodGrid.has(key)) woodGrid.set(key, [])
    woodGrid.get(key).push(tree)
  }
}

// --- Hedgerows ----------------------------------------------------------------------
// Along stretches of the lanes, a couple of metres back from the edge, with
// gaps for field gates; none near junctions, the skidpad or the village
// stretch with kerbs. Each bush is solid.


export const HEDGES = []
{
  let seed = 4421
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  roads.forEach((road, index) => {
    if (index === 4) return
    for (const side of [-1, 1]) {
      let gap = 0
      for (let k = 1; k < road.length - 1; k++) {
        const p = road[k]
        // Stretches of hedge, different on each side.
        if (fbm(p.along / 160 + index * 9.1 + side * 4.7, side * 2.3 + index) < 0.47) continue
        if (JOINTS.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 30) || inVillage(p.x, p.z)) continue
        // Field gates: a few metres open now and then.
        if (gap > 0) {
          gap -= 3
          continue
        }
        if (random() < 0.012) {
          gap = 6
          continue
        }
        const q = road[k + 1]
        const tx = q.x - p.x
        const tz = q.z - p.z
        const length = Math.hypot(tx, tz)
        for (const f of [0, 0.5]) {
          const offset = p.half + 2.4 + random() * 0.5
          const x = p.x + tx * f + (tz / length) * offset * side
          const z = p.z + tz * f - (tx / length) * offset * side
          if (roadDistance(x, z) < p.half + 1.5) continue
          if (Math.hypot(x - POND.x, z - POND.z) < POND.radius) continue
          if (Math.hypot(x - PAD.x, z - PAD.z) < PAD.radius + 6) continue
          if (LANDMARKS.some(l => Math.abs(x - l.x) < l.halfX + 4 && Math.abs(z - l.z) < l.halfZ + 4)) continue
          const bush = { x, z, y: heightAt(x, z), scale: 1.05 + random() * 0.35, radius: 0.85, kind: 2 }
          HEDGES.push(bush)
          const key = `${Math.floor(x / WOOD_CELL)},${Math.floor(z / WOOD_CELL)}`
          if (!woodGrid.has(key)) woodGrid.set(key, [])
          woodGrid.get(key).push(bush)
        }
      }
    }
  })
}

function roadDistance(x, z) {
  let best = Infinity
  for (const road of roads) {
    for (let k = 0; k < road.length; k++) {
      const p = road[k]
      if (Math.abs(p.x - x) > 40 || Math.abs(p.z - z) > 40) continue
      best = Math.min(best, Math.hypot(p.x - x, p.z - z))
    }
  }
  return best
}

/** Keep the car out of the trees: pushed back out, most of its speed gone. */
export function resolveTrees(car) {
  const cx = Math.floor(car.x / WOOD_CELL)
  const cz = Math.floor(car.z / WOOD_CELL)
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (const tree of woodGrid.get(`${i},${j}`) ?? []) {
        const dx = car.x - tree.x
        const dz = car.z - tree.z
        const reach = tree.radius + 1.3
        const d = Math.hypot(dx, dz)
        if (d >= reach || d === 0) continue
        car.x = tree.x + (dx / d) * reach
        car.z = tree.z + (dz / d) * reach
        car.u *= -0.14
        car.v *= -0.14
        car.yaw *= 0.3
        return true
      }
    }
  }
  return false
}
