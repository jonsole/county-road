import { CatmullRomCurve3, Vector3 } from 'three'

export const HALF_WORLD = 620
export const ROAD_HALF = 5
export const PAD = { x: 34, z: -238, radius: 24 }
export const SPAWN = { x: -2.5, z: -246, heading: 0 }
export const LANDMARKS = [
  { x: -48, z: 52, halfX: 8, halfZ: 6 },
  { x: 294, z: -103, halfX: 2.7, halfZ: 2.7 },
]
// Where roads meet (the ends of the loops, the crossroads, the skidpad spur).
export const JOINTS = [[0, -360], [0, 360], [-428, 0], [0, 28], [320, 0], [0, -238]]
const CELL = 20
const GRID_STRIDE = 2 * Math.ceil(HALF_WORLD / CELL) + 1
const grid = new Map()
const segments = []
const key = (x, z) => x * GRID_STRIDE + z

export const roads = [
  [[0, -360], [0, 360]],
  [[0, -360], [-140, -360], [-312, -320], [-413, -140], [-428, 0],
    [-427, 196], [-350, 330], [-200, 360], [0, 360]],
  [[0, -360], [115, -360], [204, -285], [211, -207], [310, -170], [372, -112],
    [392, -40], [320, 0], [282, 74], [338, 150], [372, 232], [318, 300], [230, 354], [0, 360]],
  [[-428, 0], [-300, 0], [-153, 30], [0, 28], [165, -12], [320, 0]],
  [[0, -238], [34, -238]],
].map(waypoints => {
  const curve = new CatmullRomCurve3(waypoints.map(([x, z]) => new Vector3(x, 0, z)))
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / 3))
})

for (const points of roads) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const segment = { a, b, dx, dz, lengthSquared: dx * dx + dz * dz }
    segments.push(segment)
    for (let x = Math.floor((Math.min(a.x, b.x) - ROAD_HALF) / CELL);
      x <= Math.floor((Math.max(a.x, b.x) + ROAD_HALF) / CELL); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - ROAD_HALF) / CELL);
        z <= Math.floor((Math.max(a.z, b.z) + ROAD_HALF) / CELL); z++) {
        const id = key(x, z)
        if (!grid.has(id)) grid.set(id, [])
        grid.get(id).push(segment)
      }
    }
  }
}

function project(x, z, { a, dx, dz, lengthSquared }) {
  return Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared))
}

export function isPaved(x, z) {
  if ((x - PAD.x) ** 2 + (z - PAD.z) ** 2 <= PAD.radius ** 2) return true
  if (Math.abs(x) > HALF_WORLD || Math.abs(z) > HALF_WORLD) return false
  const nearby = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)))
  if (!nearby) return false
  for (const segment of nearby) {
    const t = project(x, z, segment)
    if ((x - segment.a.x - t * segment.dx) ** 2
      + (z - segment.a.z - t * segment.dz) ** 2 <= ROAD_HALF ** 2) return true
  }
  return false
}

export function nearestRoad(x, z, heading) {
  let bestDistance = Infinity
  let result = SPAWN
  for (const segment of segments) {
    const t = project(x, z, segment)
    const roadX = segment.a.x + t * segment.dx
    const roadZ = segment.a.z + t * segment.dz
    const distance = (roadX - x) ** 2 + (roadZ - z) ** 2
    if (distance >= bestDistance) continue
    const direction = Math.atan2(segment.dx, segment.dz)
    bestDistance = distance
    result = { x: roadX, z: roadZ, heading: Math.cos(heading - direction) < 0 ? direction + Math.PI : direction }
  }
  return result
}

export function resolveLandmarks(car, previousX, previousZ) {
  for (const { x, z, halfX, halfZ } of LANDMARKS) {
    const overlapX = halfX + 1.25 - Math.abs(car.x - x)
    const overlapZ = halfZ + 1.25 - Math.abs(car.z - z)
    if (overlapX <= 0 || overlapZ <= 0) continue
    if (overlapX < overlapZ) car.x = x + (Math.sign(previousX - x) || 1) * (halfX + 1.25)
    else car.z = z + (Math.sign(previousZ - z) || 1) * (halfZ + 1.25)
    car.u *= -0.14
    car.v *= -0.14
    car.yaw *= 0.3
  }
}
