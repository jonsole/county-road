// Drawing the land (its shape: terrain.js). The ground shader is ported
// from RC Flight Sim (src/world/ground.js) and drawn with photographic
// textures (textures.js): two grasses blended so no repeat shows, with their
// bumps (normal maps); beyond the drivable area a patchwork of farm fields
// with hedgerows; steep banks and cuttings show bare mud.
import * as T from 'three'
import { addCloudShadows } from './sky.js'
import { FLAT_EDGE, POND, groundGrid, natural } from './terrain.js'
import { TEX } from './textures.js'

export { FLAT_EDGE, heightAt } from './terrain.js'
export const TERRAIN_SIZE = 7200
const OUTER_CELL = 20

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
  const edge = FLAT_EDGE.toFixed(1)
  // (Sets USE_NORMALMAP for three.js's tangent-frame code; the shader samples its own maps.)
  material.normalMap = TEX.grass.normal
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, groundUniforms, {
      grassA: { value: TEX.grass.color }, grassB: { value: TEX['grass-patchy'].color },
      grassNA: { value: TEX.grass.normal }, grassNB: { value: TEX['grass-patchy'].normal },
      mudMap: { value: TEX.mud.color }, mudN: { value: TEX.mud.normal },
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;\nvarying vec3 vGroundNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}\nuniform sampler2D grassA, grassB, grassNA, grassNB, mudMap, mudN;\nuniform vec3 uGrassTint;\nuniform float uGrassDry;\nuniform float uGrassLen;`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec2 p = vGroundWorld.xz;
        // Two photographed grasses, at different scales and angles, blended
        // by a slow noise so no repeat shows. They give the detail (blades,
        // clumps, bare bits); the colour is held to the landscape's green.
        vec2 q = p / 2.6;
        vec2 uvB = vec2(p.x * 0.81 - p.y * 0.59, p.x * 0.59 + p.y * 0.81) / 3.7 + 0.37;
        float mixAB = smoothstep(0.3, 0.7, gNoise(p / 23.0));
        vec3 ta = texture2D(grassA, q).rgb / vec3(0.079, 0.047, 0.007);
        vec3 tb = texture2D(grassB, uvB).rgb / vec3(0.155, 0.118, 0.048);
        vec3 detail = mix(ta, tb, mixAB);
        float shade = dot(detail, vec3(0.3, 0.6, 0.1));
        vec3 g = vec3(0.144, 0.262, 0.048) * mix(vec3(shade), clamp(detail, 0.0, 3.0), 0.28) * 1.15;
        vec3 groundNormal = mix(texture2D(grassNA, q).xyz, texture2D(grassNB, uvB).xyz, mixAB);
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
          // (Mud on a bank, mapped across the slope rather than squashed by it.)
          vec2 mq = (abs(vGroundNormal.x) > abs(vGroundNormal.z) ? vec2(p.y, vGroundWorld.y) : vec2(p.x, vGroundWorld.y)) / 2.4;
          vec3 earth = texture2D(mudMap, mq).rgb * 1.35;
          // Grass hangs on in patches.
          float hold = smoothstep(0.35, 0.65, gNoise(p / 3.1 + 7.0) + (upright - 0.7));
          float bare = steep * (1.0 - 0.7 * hold);
          g = mix(g, earth, bare);
          groundNormal = mix(groundNormal, texture2D(mudN, mq).xyz, bare);
        }

        float grassy = smoothstep(0.0, 0.06, g.g - max(g.r, g.b));
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
      // The bumps, from the same blended maps (and the mud's on the banks).
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 mapN = groundNormal * 2.0 - 1.0;
          mapN.xy *= 0.9;
          mat3 tbn = getTangentFrame(- vViewPosition, normal, q);
          normal = normalize(tbn * mapN);
        }
      `)
  }
  material.customProgramCacheKey = () => 'countyGround'
  return material
}

/** The ground: a fine mesh over the drivable area (from terrain.js's grid) and a coarse one beyond. */
export function buildTerrain(scene) {
  const material = addCloudShadows(addGroundDetail(new T.MeshLambertMaterial({ vertexColors: true })))
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
