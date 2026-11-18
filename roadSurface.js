// What a country road looks like up close: worn, patched asphalt with
// faded paint and crumbling edges, a muddy, gravelly margin fading into the
// verge, kerbs and footways through the village, and white marker posts.
//
// Each road strip carries its own coordinates (aRoad: metres across from the
// centre, metres along), and the road's half-width and markings (aInfo), so
// the shaders draw everything in road space.
import * as T from 'three'
import { inVillage } from './terrain.js'
import { JOINTS } from './roads.js'
import { addCloudShadows } from './sky.js'
import { TEX } from './textures.js'

const NOISE = /* glsl */ `
varying vec2 vRoad;
varying vec2 vInfo;
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1, 0)), u.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), u.x), u.y);
}
`

/** Pass the road coordinates through to a material's fragment shader, and run `fragment` on its colour. */
function roadShader(material, key, fragment, uniforms = {}) {
  material.onBeforeCompile = shader => {
    for (const [name, texture] of Object.entries(uniforms)) shader.uniforms[name] = { value: texture }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad;\nattribute vec2 aInfo;\nvarying vec2 vRoad;\nvarying vec2 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvInfo = aInfo;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\n${Object.keys(uniforms).map(name => `uniform sampler2D ${name};`).join('\n')}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${fragment}`)
  }
  material.customProgramCacheKey = () => key
  return addCloudShadows(Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1 }))
}

/** The asphalt: photographed tarmac with its bumps and roughness; resurfaced sections, patches, wheel tracks, potholes, worn paint, crumbling edges. */
export function asphaltMaterial() {
  const tex = TEX['asphalt-cracked']
  const material = new T.MeshStandardMaterial({ map: tex.color, normalMap: tex.normal, roughnessMap: tex.rough, roughness: 1, metalness: 0 })
  material.normalScale.set(1.1, 1.1)
  material.polygonOffsetUnits = -4
  return roadShader(material, 'asphalt', /* glsl */ `
    {
      float across = vRoad.x;
      float along = vRoad.y;
      float half_ = vInfo.x;
      float side = across < 0.0 ? -1.0 : 1.0;
      float ax = abs(across);
      // The edge breaks up: bitten into, in places a good way.
      float bite = rNoise(vec2(along / 1.6, side * 13.0)) * 0.55 + rNoise(vec2(along / 0.35, side * 7.0)) * 0.3;
      bite *= 0.4 + 0.9 * rNoise(vec2(along / 18.0, side * 3.0));
      if (ax > half_ - bite * 0.5) discard;
      vec3 c = diffuseColor.rgb;
      // Resurfaced at different times: sections of the older, paler, smoother tar.
      float section = smoothstep(0.35, 0.65, rNoise(vec2(along / 85.0, 1.7)));
      vec2 rotated = vec2(vMapUv.x * 0.8 - vMapUv.y * 0.6, vMapUv.x * 0.6 + vMapUv.y * 0.8) * 0.7;
      c = mix(c, texture2D(asphaltWorn, rotated).rgb * 0.62, section);
      c *= 0.92 + 0.16 * rNoise(vec2(along / 31.0, 4.2));
      // Weathered paler where the traffic doesn't run: the crown and the edges.
      c *= 1.0 + 0.08 * smoothstep(half_ * 0.55, half_, ax) + 0.05 * smoothstep(0.6, 0.0, ax);
      // Repair patches across a lane, a few metres long, newer and blacker (or older and paler).
      float cell = floor(along / 7.0);
      float h = rHash(vec2(cell, side));
      if (h < 0.16) {
        float start = rHash(vec2(cell, 4.0)) * 3.0;
        float len = 1.5 + rHash(vec2(cell, 5.0)) * 3.0;
        float f = along - cell * 7.0;
        float inner = rHash(vec2(cell, 6.0)) * half_ * 0.5;
        float wobbly = (rNoise(vec2(along * 1.3, across * 1.3)) - 0.5) * 0.25;
        if (f > start + wobbly && f < start + len + wobbly && ax > inner && ax < half_ - 0.2) c *= h < 0.09 ? 0.62 : 1.25;
      }
      // Polished, darker wheel tracks.
      float lane = half_ * 0.5;
      float track = min(abs(ax - lane * 0.55), abs(ax - lane * 1.45));
      c *= 1.0 - 0.09 * smoothstep(0.45, 0.1, track) * (0.6 + 0.4 * rNoise(vec2(along / 5.0, ax)));
      // Now and then a pothole near the edge.
      vec2 pc = vec2(floor(along / 3.0), floor(across / 1.2));
      if (rHash(pc + 21.0) < 0.012 && ax > half_ - 1.6) {
        vec2 centre = vec2((pc.x + 0.3 + rHash(pc) * 0.4) * 3.0, (pc.y + 0.5) * 1.2);
        float r = length(vec2(along, across) - centre) / (0.25 + rHash(pc + 3.0) * 0.3);
        c *= mix(1.0, 0.45, smoothstep(1.0, 0.6, r));
      }
      // Paint: a dashed centre line, solid edge lines; worn, and fading at the edges of each dash.
      float wear = smoothstep(0.15, 0.7, rNoise(vec2(along / 1.9, across * 3.0))) * (0.55 + 0.45 * rNoise(vec2(along / 40.0, 2.0)));
      float paint = 0.0;
      if (vInfo.y > 0.5) paint = max(paint, step(abs(across), 0.06) * step(fract(along / 9.0), 0.4));
      if (vInfo.y > 1.5) paint = max(paint, step(abs(ax - (half_ - 0.35)), 0.055));
      c = mix(c, vec3(0.86, 0.84, 0.76), paint * wear);
      diffuseColor.rgb = c;
    }
  `, { asphaltWorn: TEX['asphalt-worn'].color })
}

/** The margin under and beside the road: mud and gravel at the edge, fading out into the grass. */
export function vergeMaterial() {
  const tex = TEX['verge-gravel']
  const material = new T.MeshLambertMaterial({ map: tex.color, normalMap: tex.normal, transparent: true, depthWrite: false })
  material.polygonOffsetUnits = -2
  return roadShader(material, 'verge', /* glsl */ `
    {
      float side = vRoad.x < 0.0 ? -1.0 : 1.0;
      float e = abs(vRoad.x) - vInfo.x; // metres past the road's edge
      float along = vRoad.y;
      vec3 c = diffuseColor.rgb * 1.25;
      // Mud where wheels have run off the edge.
      float rut = smoothstep(0.55, 0.85, rNoise(vec2(along / 9.0, side * 5.0))) * smoothstep(1.4, 0.3, e);
      c = mix(c, vec3(0.24, 0.19, 0.14), rut * 0.7);
      // Out into the grass: patchily, and further where it's worn.
      float reach = 0.05 + 0.75 * rNoise(vec2(along / 3.5, side * 11.0)) * rNoise(vec2(along / 17.0, side * 4.0) ) * 1.6 + 0.7 * rut;
      float fade = 1.0 - smoothstep(reach - 0.3, reach + 0.3, e);
      // Out from the edge, grass creeping over the mud.
      c = mix(c, vec3(0.16, 0.22, 0.07), smoothstep(0.0, 1.0, e) * 0.5 * (1.0 - rut));
      diffuseColor.rgb = c;
      diffuseColor.a = fade * (0.7 + 0.3 * rNoise(vec2(along * 2.0, vRoad.x * 2.0)));
    }
  `)
}

/**
 * A strip along a road between two offsets from its centre: across(p) gives
 * [from, to] (m, + to the road's left), height(p, side) the height there.
 */
export function roadStrip(points, across, height) {
  const position = []
  const road = []
  const info = []
  const uv = []
  const index = []
  points.forEach((p, i) => {
    const q = points[Math.min(i + 1, points.length - 1)]
    const o = points[Math.max(0, i - 1)]
    const tx = q.x - o.x
    const tz = q.z - o.z
    const length = Math.hypot(tx, tz)
    const nx = tz / length
    const nz = -tx / length
    for (const [k, offset] of across(p).entries()) {
      const x = p.x + nx * offset
      const z = p.z + nz * offset
      position.push(x, height(p, k), z)
      road.push(offset, p.along)
      info.push(p.half, p.markings)
      uv.push(x / 3.2, z / 3.2)
    }
    if (i > 0) {
      const a = i * 2 - 2
      index.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  })
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3))
  geometry.setAttribute('aRoad', new T.Float32BufferAttribute(road, 2))
  geometry.setAttribute('aInfo', new T.Float32BufferAttribute(info, 2))
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** Runs of consecutive road points that pass a test (at least `min` long). */
function runs(points, test, min = 4) {
  const out = []
  let run = []
  for (const p of points) {
    if (test(p)) run.push(p)
    else {
      if (run.length >= min) out.push(run)
      run = []
    }
  }
  if (run.length >= min) out.push(run)
  return out
}

/**
 * Kerbs and paved footways along the village stretch of each road: the
 * kerb 12 cm proud of the road, the footway on top, its back edge sloping
 * down to the ground.
 */
export function buildVillageEdges(scene, roads, groundAt) {
  const concrete = TEX['asphalt-worn']
  const kerb = addCloudShadows(new T.MeshStandardMaterial({ map: concrete.color, normalMap: concrete.normal, color: 0xd8d4c8, roughness: 0.9, side: T.DoubleSide }))
  const footway = addCloudShadows(new T.MeshStandardMaterial({ map: TEX.paving.color, normalMap: TEX.paving.normal, roughnessMap: TEX.paving.rough, side: T.DoubleSide }))
  const KERB = 0.2
  const FOOTWAY = 1.5
  const RISE = 0.2 // above the road surface's lift
  for (const points of roads) {
    // Stop short of each junction's mouth.
    const clearOfJunctions = p => JOINTS.every(([x, z]) => Math.hypot(p.x - x, p.z - z) > 17)
    for (const run of runs(points, p => inVillage(p.x, p.z) && clearOfJunctions(p))) {
      for (const side of [-1, 1]) {
        const top = (p, k) => p.y + 0.08 + (k === 0 ? 0 : RISE)
        // The kerb's face, then its top.
        scene.add(new T.Mesh(roadStrip(run, p => [side * p.half, side * p.half], top), kerb))
        scene.add(new T.Mesh(roadStrip(run, p => [side * p.half, side * (p.half + KERB)], p => p.y + 0.08 + RISE), kerb))
        // The footway, and a little bank down from its back edge.
        const slabs = roadStrip(run, p => [side * (p.half + KERB), side * (p.half + KERB + FOOTWAY)], p => p.y + 0.08 + RISE)
        const uv = slabs.attributes.uv
        const road = slabs.attributes.aRoad
        for (let i = 0; i < uv.count; i++) uv.setXY(i, road.getX(i) / 2.4, road.getY(i) / 2.4)
        scene.add(new T.Mesh(slabs, footway))
        scene.add(new T.Mesh(roadStrip(run, p => [side * (p.half + KERB + FOOTWAY), side * (p.half + KERB + FOOTWAY + 0.6)],
          (p, k) => (k === 0 ? p.y + 0.08 + RISE : groundAt(p) - 0.05)), kerb))
      }
    }
  }
}

/** White marker posts with a reflector, along the lanes outside the village, every 50 m or so, alternating sides. */
export function buildMarkerPosts(scene, roads, heightAt) {
  const posts = []
  roads.forEach((points, index) => {
    if (index === 4) return
    let next = 25
    let side = 1
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]
      if (p.along < next) continue
      next += 50
      side = -side
      if (inVillage(p.x, p.z)) continue
      const q = points[i + 1]
      const length = Math.hypot(q.x - p.x, q.z - p.z)
      const nx = (q.z - p.z) / length
      const nz = -(q.x - p.x) / length
      const offset = p.half + 0.9
      const x = p.x - nx * offset * side
      const z = p.z - nz * offset * side
      posts.push({ x, z, y: heightAt(x, z), heading: Math.atan2(q.x - p.x, q.z - p.z) })
    }
  })
  const white = addCloudShadows(new T.MeshLambertMaterial({ color: 0xe8e6de }))
  const band = new T.MeshLambertMaterial({ color: 0x1b1b1b, emissive: 0x3a1a00 })
  const post = new T.BoxGeometry(0.11, 1, 0.11).translate(0, 0.5, 0)
  const top = new T.BoxGeometry(0.115, 0.14, 0.115).translate(0, 0.84, 0)
  const meshes = [new T.InstancedMesh(post, white, posts.length), new T.InstancedMesh(top, band, posts.length)]
  const transform = new T.Object3D()
  posts.forEach(({ x, y, z, heading }, i) => {
    transform.position.set(x, y, z)
    transform.rotation.set(0, heading, 0)
    transform.updateMatrix()
    for (const mesh of meshes) mesh.setMatrixAt(i, transform.matrix)
  })
  for (const mesh of meshes) {
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }
}
