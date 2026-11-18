import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HALF_WORLD, JOINTS, LANDMARKS, PAD, roads } from './roads.js'
import { asphaltMaterial, buildMarkerPosts, buildVillageEdges, roadStrip, vergeMaterial } from './roadSurface.js'
import { addCloudShadows } from './sky.js'
import { buildTerrain } from './landscape.js'
import { HEDGES, PAD_HEIGHT, WOODS, heightAt } from './terrain.js'

const matte = color => addCloudShadows(new T.MeshStandardMaterial({ color, roughness: 0.83 }))
const terrainMaterial = color => addCloudShadows(new T.MeshLambertMaterial({ color }))
let seed = 7392
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296
}

const shadowGeometry = new T.PlaneGeometry().rotateX(-Math.PI / 2)
let shadowTexture
function addContactShadow(parent, width, length, opacity, x = 0, z = 0) {
  if (!shadowTexture) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const context = canvas.getContext('2d')
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31)
    gradient.addColorStop(0.35, '#fff')
    gradient.addColorStop(0.7, '#c0c0c0')
    gradient.addColorStop(1, '#000')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
    shadowTexture = new T.CanvasTexture(canvas)
  }
  const material = new T.MeshBasicMaterial({
    color: 0x111812, alphaMap: shadowTexture, opacity, transparent: true, depthWrite: false,
  })
  const mesh = new T.Mesh(shadowGeometry, material)
  mesh.scale.set(width, 1, length)
  mesh.position.set(x, 0.032, z)
  parent.add(mesh)
}

function box(parent, material, sx, sy, sz, x, y, z) {
  const mesh = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

// Road surfaces: lifted a few centimetres above the ground they're built
// on, and drawn in front of it (polygon offset), so it never shows through.
const lifted = (material, units) => Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units })

function disk(radius, x, z, material, lift, level) {
  const mesh = new T.Mesh(new T.CircleGeometry(radius, 96, 0, Math.PI * 2), material)
  mesh.geometry.rotateX(-Math.PI / 2)
  const p = mesh.geometry.attributes.position
  const uv = mesh.geometry.attributes.uv
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) + x) / 3.2, (p.getZ(i) + z) / 3.2)
    p.setY(i, (level ?? heightAt(p.getX(i) + x, p.getZ(i) + z)) + lift)
  }
  mesh.geometry.computeVertexNormals()
  const count = p.count
  mesh.geometry.setAttribute('aRoad', new T.Float32BufferAttribute(Array.from({ length: count }, (_, i) => [p.getX(i), p.getZ(i) + z]).flat(), 2))
  mesh.geometry.setAttribute('aInfo', new T.Float32BufferAttribute(Array.from({ length: count }, () => [radius + 50, 0]).flat(), 2))
  mesh.position.set(x, 0, z)
  return mesh
}

export function buildWorld(scene) {
  buildTerrain(scene)
  // The roads: worn asphalt over a muddy, gravelly margin that fades into
  // the verge (roadSurface.js), kerbs and footways through the village,
  // marker posts along the lanes.
  const asphalt = asphaltMaterial()
  const verge = vergeMaterial()
  const paint = lifted(new T.MeshBasicMaterial({ color: 0xe0dac1 }), -6)
  const transforms = new T.Object3D()
  for (const points of roads) {
    scene.add(new T.Mesh(roadStrip(points, p => [-(p.half + 2.2), p.half + 2.2], p => p.y + 0.04), verge))
    scene.add(new T.Mesh(roadStrip(points, p => [-p.half, p.half], p => p.y + 0.08), asphalt))
  }
  buildVillageEdges(scene, roads, p => p.y)
  buildMarkerPosts(scene, roads, heightAt)
  // Junctions: a disc of asphalt where the roads meet, as wide as the widest mouth.
  for (const [x, z] of JOINTS) {
    let half = 3
    for (const points of roads) for (const p of points) if (Math.hypot(p.x - x, p.z - z) < 2) half = Math.max(half, p.half)
    scene.add(disk(half, x, z, asphalt, 0.085))
  }
  scene.add(disk(PAD.radius, PAD.x, PAD.z, asphalt, 0.085, PAD_HEIGHT))
  for (const radius of [10, 18]) {
    const ring = new T.Mesh(new T.RingGeometry(radius - 0.05, radius + 0.05, 80), paint)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(PAD.x, PAD_HEIGHT + 0.1, PAD.z)
    scene.add(ring)
  }

  const barn = new T.Group()
  barn.position.set(LANDMARKS[0].x, LANDMARKS[0].y, LANDMARKS[0].z)
  scene.add(barn)
  addContactShadow(barn, 25, 20, 0.4, 3, 2)
  box(barn, matte(0x8c4432), 16, 5, 12, 0, 2.5, 0)
  box(barn, matte(0x3b312c), 4.5, 3.6, 0.14, 0, 1.8, 6.02)
  const roof = matte(0x555e5d)
  for (const side of [-1, 1]) {
    const pitch = box(barn, roof, 17, 0.22, 7.15, 0, 6.1, side * 3.1)
    pitch.rotation.x = side * 0.35
  }

  const tower = new T.Group()
  tower.position.set(LANDMARKS[1].x, LANDMARKS[1].y, LANDMARKS[1].z)
  scene.add(tower)
  addContactShadow(tower, 11, 10, 0.3, 3, 2)
  const steel = matte(0x777b70)
  for (const x of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) box(tower, steel, 0.32, 18, 0.32, x, 9, z)
  const tank = new T.Mesh(new T.CylinderGeometry(3.8, 3.15, 5.5, 16), matte(0xc2c2a5))
  tank.position.y = 19.2
  tower.add(tank)
  const lid = new T.Mesh(new T.ConeGeometry(3.95, 1.45, 16), steel)
  lid.position.y = 22.65
  tower.add(lid)

  // Trees: scattered over the fields around the roads, thicker in the
  // woods and copses on the hills beyond, all standing on the ground.
  const copses = Array.from({ length: 140 }, () => [
    (random() - 0.5) * 5600, (random() - 0.5) * 5600, 30 + random() * 110])
  const treeGeometries = [new T.IcosahedronGeometry(1, 0), new T.IcosahedronGeometry(1, 1)]
  // Each kind of tree turns its own autumn colour.
  const treeMaterials = []
  for (const [color, count, spread, autumnColor] of [[0x697f4b, 530, 2400, 0xb5762c], [0x506843, 300, 2400, 0x8c5a2e],
    [0x5f7746, 1400, 5600, 0xc29038], [0x4a6140, 900, 5600, 0x9a4a24]]) {
    const material = terrainMaterial(color)
    material.userData.summer = new T.Color(color)
    material.userData.autumn = new T.Color(autumnColor)
    treeMaterials.push(material)
    const batches = [[], []]
    for (let i = 0; i < count; i++) {
      let x = (random() - 0.5) * spread
      let z = (random() - 0.5) * spread
      if (spread > 2400) {
        // On the hills, trees grow in copses and small woods.
        const [cx, cz, size] = copses[Math.floor(random() * copses.length)]
        x = cx + (random() + random() - 1) * size
        z = cz + (random() + random() - 1) * size
      }
      const distance = Math.max(Math.abs(x), Math.abs(z))
      if (distance < HALF_WORLD + 14 || (spread > 2400 && distance < 1100)) {
        i--
        continue
      }
      const scale = 2.8 + random() * 6
      transforms.position.set(x, heightAt(x, z) + scale * 0.68, z)
      transforms.scale.set(scale * 0.86, scale * 1.38, scale * 0.82)
      transforms.rotation.set(0, random() * Math.PI, 0)
      transforms.updateMatrix()
      batches[Number(distance < HALF_WORLD + 150)].push(transforms.matrix.clone())
    }
    batches.forEach((matrices, i) => {
      if (!matrices.length) return
      const trees = new T.InstancedMesh(treeGeometries[i], material, matrices.length)
      matrices.forEach((matrix, index) => trees.setMatrixAt(index, matrix))
      trees.computeBoundingSphere()
      scene.add(trees)
    })
  }
  // Woods and copses on the slopes inside the drivable area (terrain.js; solid).
  for (const kind of [0, 1]) {
    const trees = WOODS.filter(tree => tree.kind === kind)
    const mesh = new T.InstancedMesh(treeGeometries[1], treeMaterials[kind], trees.length)
    trees.forEach((tree, index) => {
      transforms.position.set(tree.x, tree.y + tree.scale * 0.62, tree.z)
      transforms.scale.set(tree.scale * 0.86, tree.scale * 1.38, tree.scale * 0.82)
      transforms.rotation.set(0, (tree.x * 7.13 + tree.z) % Math.PI, 0)
      transforms.updateMatrix()
      mesh.setMatrixAt(index, transforms.matrix)
    })
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }
  // Hedgerows along the lanes (terrain.js; solid): hawthorn and blackthorn, dark and dense.
  {
    const material = terrainMaterial(0x41592f)
    material.userData.summer = new T.Color(0x41592f)
    material.userData.autumn = new T.Color(0x7d5a2c)
    treeMaterials.push(material)
    const mesh = new T.InstancedMesh(treeGeometries[1], material, HEDGES.length)
    HEDGES.forEach((bush, index) => {
      const lean = (bush.x * 3.7 + bush.z * 1.3) % 1
      transforms.position.set(bush.x, bush.y + 0.7 * bush.scale, bush.z)
      transforms.scale.set(1.3 * bush.scale, (0.95 + 0.3 * lean) * bush.scale, 1.3 * bush.scale)
      transforms.rotation.set(0, lean * Math.PI, 0)
      transforms.updateMatrix()
      mesh.setMatrixAt(index, transforms.matrix)
    })
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }
  // Shadows: everything on the ground receives them; trees, hedges,
  // buildings and posts cast them (the distant trees, beyond the shadow
  // map's reach, don't).
  scene.traverse(object => {
    if (!object.isMesh) return
    object.receiveShadow = true
    const caster = object.isInstancedMesh || object.parent === barn || object.parent === tower
    if (caster && (!object.isInstancedMesh || object.boundingSphere.radius < 3000)) object.castShadow = true
  })
  const fresh = new T.Color(0x8fae58)
  const bareTwigs = new T.Color(0x6b6158)
  return {
    /** Leaves for the season (weather.js seasonFor): fresh in spring, autumn colours, bare in winter. */
    setSeason({ bare, autumn, fresh: spring }) {
      for (const material of treeMaterials) {
        const { summer, autumn: turned } = material.userData
        material.color.copy(summer).lerp(fresh, spring * 0.45).lerp(turned, autumn).lerp(bareTwigs, bare * 0.85)
      }
    },
  }
}

function shell(parent, material, sections) {
  const positions = sections.flatMap(([z, width, bottom, top]) =>
    [-width, bottom, z, width, bottom, z, width * 0.86, top, z, -width * 0.86, top, z])
  const indices = [0, 2, 1, 0, 3, 2]
  for (let base = 0; base < positions.length / 3 - 4; base += 4) {
    for (let side = 0; side < 4; side++) {
      const a = base + side
      const b = base + (side + 1) % 4
      indices.push(a, b, a + 4, b, b + 4, a + 4)
    }
  }
  const end = positions.length / 3 - 4
  indices.push(end, end + 1, end + 2, end, end + 2, end + 3)
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new T.Mesh(geometry, material)
  parent.add(mesh)
}

export function buildCar(scene) {
  const root = new T.Group()
  const body = new T.Group()
  root.add(body)
  scene.add(root)
  addContactShadow(root, 4, 6.6, 0.45, -0.24, 0.12) // (soft shade under it; the sun's shadow is the shadow map's)
  const red = new T.MeshStandardMaterial({ color: 0xc54e31, metalness: 0.32, roughness: 0.32 })
  const glass = new T.MeshStandardMaterial({ color: 0x203337, metalness: 0.38, roughness: 0.18 })
  const trim = matte(0x242729)
  const tire = matte(0x1b2020)
  const alloy = new T.MeshStandardMaterial({ color: 0x8d999d, metalness: 0.67, roughness: 0.34 })
  shell(body, red, [[-2.12, 0.82, 0.28, 0.68], [-1.55, 0.97, 0.24, 0.79],
    [0.25, 0.92, 0.23, 0.75], [1.5, 0.96, 0.23, 0.66], [2.15, 0.79, 0.29, 0.51]])
  shell(body, glass, [[-1.49, 0.76, 0.73, 0.78], [-0.63, 0.71, 0.74, 1.24],
    [0.27, 0.66, 0.71, 1.24], [1.00, 0.79, 0.69, 0.75]])
  box(body, red, 1.2, 0.055, 0.94, 0, 1.245, -0.18)
  box(body, trim, 1.51, 0.13, 0.06, 0, 0.34, -2.13)
  box(body, trim, 1.18, 0.12, 0.06, 0, 0.35, 2.15)
  const brakeMaterial = new T.MeshStandardMaterial({ color: 0xff3e2c, emissive: 0xe71908, emissiveIntensity: 0.6 })
  const lamps = new T.MeshStandardMaterial({ color: 0xe7f6ff, emissive: 0xc2e3ff, emissiveIntensity: 0.6 })
  const wheels = []
  const wheelParts = [[0.33, 0.26, tire], [0.215, 0.28, alloy]].map(([radius, width, material]) => ({
    geometry: new T.CylinderGeometry(radius, radius, width, 24).rotateZ(Math.PI / 2), material,
  }))
  for (const side of [-1, 1]) {
    box(body, brakeMaterial, 0.46, 0.09, 0.045, side * 0.53, 0.56, -2.13)
    box(body, lamps, 0.43, 0.075, 0.045, side * 0.54, 0.46, 2.15)
    box(body, trim, 0.23, 0.09, 0.19, side * 0.9, 0.88, 0.65)
    const spokes = Array.from({ length: 5 }, (_, index) => {
      const angle = index * Math.PI * 0.4
      return new T.BoxGeometry(0.019, 0.07, 0.125).rotateX(-angle)
        .translate(side * 0.148, Math.sin(angle) * 0.115, Math.cos(angle) * 0.115)
    })
    const rimFace = mergeGeometries(spokes)
    for (const geometry of spokes) geometry.dispose()
    for (const z of [-1.39, 1.23]) {
      const pivot = new T.Group()
      const spin = new T.Group()
      for (const { geometry, material } of wheelParts) spin.add(new T.Mesh(geometry, material))
      spin.add(new T.Mesh(rimFace, trim))
      pivot.add(spin)
      pivot.position.set(side * 0.85, 0.33, z)
      root.add(pivot)
      wheels.push({ pivot, spin, front: z > 0 })
    }
  }
  // Headlights: a spotlight from each lamp, aimed a little down the road
  // ahead (a dipped beam), and a soft glow on the lamp itself. Always in
  // the scene (switching lights in and out would recompile every
  // material); off is no brightness.
  const beams = []
  const glowMap = lampGlow()
  for (const side of [-1, 1]) {
    const beam = new T.SpotLight(0xfff1d8, 0, 140, 0.4, 0.5, 1.25)
    beam.position.set(side * 0.54, 0.5, 2.2)
    beam.target.position.set(side * 1.2, 0, 38)
    root.add(beam, beam.target)
    const glow = new T.Sprite(new T.SpriteMaterial({
      map: glowMap, color: 0xfff4e2, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false,
    }))
    glow.position.set(side * 0.54, 0.46, 2.22)
    glow.scale.setScalar(1.1)
    root.add(glow)
    beams.push({ beam, glow })
  }
  return { root, body, wheels, brakeMaterial, lamps, beams }
}

function lampGlow() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.18, 'rgba(255,248,230,0.75)')
  gradient.addColorStop(1, 'rgba(255,240,210,0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, 64, 64)
  return new T.CanvasTexture(canvas)
}
