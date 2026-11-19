// Leafy trees and bushes, ported from RC Flight Sim (src/world/world.js
// #trees / #site / #addLod, with src/world/fluffy.js, trees.js, lod.js,
// impostor.js, species.js and src/sim/treeShapes.js copied into ./trees).
//
// Each tree is one of a mix of common English species, with its own shape
// of crown, its own green, its own autumn and its own leaf fall. Crowns near
// the camera are drawn as leafy clumps of leaf cards with real branches
// (detailed trunks and branches close up); further away they are pictures
// drawn once at start-up (impostors), lit like the leafy ones, cross-fading
// as the car comes and goes. Bare branches show through autumn and winter.
// Hedgerows are the same leafy bushes in a row. Leaves sway in the wind.
import * as T from 'three'
import { addCloudShadows } from './sky.js'
import { HALF_WORLD } from './roads.js'
import { HEDGES, WOODS, heightAt } from './terrain.js'
import { trunk, simpleTrunk, coniferTrunk, blobCrown, addLeafShading, leafUniforms } from './trees/trees.js'
import { fluffyCrown, crownWood, crownBranches, fluffyConifer, coniferWood, makeFluffy, fluffyDepthMaterial, setLeafDetail, LEAF_ROWS } from './trees/fluffy.js'
import { CrownLod, addLodFade, addCloseSwitch, closeUniforms } from './trees/lod.js'
import { speciesOf, bushSpeciesAt, barkColor, trunkThickness, WOOD, CONIFER, leafName } from './trees/species.js'
import { bakeImpostors, impostorGeometry, makeImpostor } from './trees/impostor.js'
import { CROWN_SEEDS, crownOf } from './trees/treeShapes.js'

// Quality (from RC Flight Sim's src/world/quality.js leafy presets):
// leafy within `radius` m of the camera (hedge bushes: `bushRadius`; there
// are thousands of them), `detail` leaf cards, impostor
// pictures `tile` px, `leafPx` px per leaf picture, detailed wood within `close` m.
export const TREE_QUALITY = {
  low: { radius: 70, bushRadius: 35, detail: 'blob', smooth: false, tile: 64, leafPx: 112, close: 20 },
  medium: { radius: 120, bushRadius: 60, detail: 1, smooth: true, tile: 96, leafPx: 160, close: 30 },
  high: { radius: 200, bushRadius: 90, detail: 2, smooth: true, tile: 128, leafPx: 208, close: 40 },
}

const TRUNK_SEEDS = [3, 41, 67]
const BUSH_SEEDS = [101, 131]
const CONIFER_NAMES = Object.keys(CONIFER)

/** A tree's colour and crown size, as RC Flight Sim's obstacles.js dresses them. */
function dressTree(tree, random) {
  if (tree.conifer) {
    tree.hue = 0.3 + random() * 0.04
    tree.sat = 0.35
    tree.light = 0.16 + random() * 0.06
  } else {
    tree.crownW = tree.h * (0.28 + random() * 0.12)
    tree.hue = 0.22 + random() * 0.07
    tree.sat = 0.4 + random() * 0.15
    tree.light = 0.2 + random() * 0.1
  }
  tree.rot = random() * Math.PI * 2
  tree.pick = Math.floor(random() * 1000)
  tree.variant = Math.floor(random() * CROWN_SEEDS.length)
  return tree
}

/** The trees: the woods and copses inside (terrain.js), and the countryside out to the horizon. */
function allTrees() {
  let seed = 7392
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const trees = WOODS.map(t => dressTree(t, random))
  // Out beyond the drivable area: scattered field trees near it, copses and woods on the hills.
  const copses = Array.from({ length: 150 }, () => [(random() - 0.5) * 5600, (random() - 0.5) * 5600, 30 + random() * 110])
  for (let i = 0; i < 2600; i++) {
    let x, z
    if (i < 700) {
      x = (random() - 0.5) * 2400
      z = (random() - 0.5) * 2400
    } else {
      const [cx, cz, size] = copses[Math.floor(random() * copses.length)]
      x = cx + (random() + random() - 1) * size
      z = cz + (random() + random() - 1) * size
    }
    if (Math.max(Math.abs(x), Math.abs(z)) < HALF_WORLD + 18) continue
    const conifer = random() < (i < 700 ? 0.08 : 0.18)
    trees.push(dressTree({ x, z, y: heightAt(x, z), h: (conifer ? 12 : 9) + random() * 10, conifer }, random))
  }
  return trees
}

/** The hedgerow bushes (terrain.js HEDGES) as RC Flight Sim's bushes: size, turn, shape, tint. */
function allBushes() {
  let seed = 991
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  return HEDGES.map(b => Object.assign(b, {
    w: 1.25 * b.scale, h: 2.1 * b.scale, turn: random() * Math.PI * 2, shape: Math.floor(random() * 2),
    tint: [0.24 + random() * 0.05, 0.42 + random() * 0.12, 0.2 + random() * 0.07],
  }))
}

const _trunkM = new T.Matrix4()
const _crownM = new T.Matrix4()
const _o = new T.Object3D()

/** A tree's trunk and crown matrices (unit trunk scaled by height; crown from crownOf). */
function treeMatrices(t, trunkM, crownM) {
  _o.rotation.set(0, t.rot, 0)
  _o.position.set(t.x, t.y - 0.15, t.z)
  const th = trunkThickness(t)
  _o.scale.set(t.h * th, t.h, t.h * th)
  _o.updateMatrix()
  trunkM.copy(_o.matrix)
  const c = crownOf(t)
  if (t.conifer) {
    _o.position.set(t.x, c.y0, t.z)
    _o.scale.set(c.r, c.ch, c.r)
  } else {
    _o.position.set(t.x, c.cy, t.z)
    _o.scale.set(c.sx, c.sy, c.sx)
  }
  _o.updateMatrix()
  crownM.copy(_o.matrix)
}

/** A bush's matrix: the crown shape sat on the ground, h tall and 2w wide. */
function bushMatrix(b, out) {
  _o.position.set(b.x, b.y + b.h * 0.5, b.z)
  _o.rotation.set(0, b.turn, 0)
  _o.scale.set(b.w, b.h * 0.55, b.w)
  _o.updateMatrix()
  return out.copy(_o.matrix)
}

/**
 * Build the trees and bushes into a scene. Returns update(cameraPosition)
 * for every frame, setSeason(day, season) and setWind(time, speed, fromDegrees).
 */
export function buildForest(scene, renderer, quality = TREE_QUALITY.medium) {
  setLeafDetail(quality.leafPx)
  const trees = allTrees()
  const bushes = allBushes()
  const lods = []
  const twigMeshes = []
  let twigsOn = true
  let seasonDay = null

  // Materials (as RC Flight Sim's World).
  const leafMat = addLeafShading(addCloudShadows(new T.MeshLambertMaterial({ vertexColors: true })))
  const cardMat = addLodFade(makeFluffy(addLeafShading(addCloudShadows(new T.MeshLambertMaterial({ vertexColors: true }))),
    { smooth: quality.smooth, detail: quality.detail, softDepth: false }), false)
  const barkMat = addCloudShadows(new T.MeshLambertMaterial({ vertexColors: true }))
  const trunkMat = addCloseSwitch(addCloudShadows(new T.MeshLambertMaterial({ vertexColors: true })), false)
  closeUniforms.uCloseR.value = quality.close
  const plainWoodMat = addCloseSwitch(addLodFade(addCloudShadows(new T.MeshLambertMaterial({ color: 0xaaaaaa, vertexColors: true })), false), false)
  const closeWoodMat = addCloseSwitch(addCloudShadows(new T.MeshLambertMaterial({ color: 0xaaaaaa, vertexColors: true })), true)
  const closeTrunkMat = addCloseSwitch(addCloudShadows(new T.MeshLambertMaterial({ vertexColors: true })), true)

  const woodCache = new Map()
  const wood = (kind, seed, sp, from) => {
    const key = `${kind}|${seed}|${sp}|${from ?? ''}`
    if (!woodCache.has(key)) {
      const w = WOOD[sp] ?? {}
      let geometry
      if (kind === 'trunk') geometry = trunk(seed, true, w.trunk)
      else if (kind.startsWith('conifer')) geometry = coniferWood(CONIFER[sp], seed, { close: kind === 'coniferClose' })
      else geometry = crownWood(seed, { from, wood: w.crown, close: kind === 'close' })
      woodCache.set(key, geometry)
    }
    return woodCache.get(key)
  }

  // The distant pictures: each leafy shape drawn once, at its trees' typical height for their width.
  const average = (list, f, fallback) => (list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : fallback)
  const broad = trees.filter(t => !t.conifer)
  const treeR = seed => average(broad.filter(t => CROWN_SEEDS[t.variant] === seed), t => crownOf(t).sy / crownOf(t).sx, 1.8)
  const bushR = average(bushes, b => (b.h * 0.55) / b.w, 1)
  const coniferR = sp => average(trees.filter(t => t.conifer && speciesOf(t).name === sp), t => crownOf(t).ch / crownOf(t).r, (1 - CONIFER[sp].base) / CONIFER[sp].crownW)
  const species = new Set(trees.filter(t => t.conifer).map(t => speciesOf(t).name))
  const atlas = bakeImpostors(renderer, [
    ...CROWN_SEEDS.map(seed => ({ leafy: fluffyCrown(seed, quality.detail), twigs: crownWood(seed), stretch: treeR(seed) })),
    ...BUSH_SEEDS.map(seed => ({ leafy: fluffyCrown(seed, 'blob'), twigs: crownBranches(seed, { from: -0.9 }), leafRow: LEAF_ROWS.indexOf('hawthorn'), stretch: bushR })),
    ...CONIFER_NAMES.map(sp => (species.has(sp) ? { leafy: fluffyConifer(CONIFER[sp], 11, quality.detail), twigs: coniferWood(CONIFER[sp], 11), leafRow: LEAF_ROWS.indexOf(leafName(sp)), stretch: coniferR(sp) } : null)),
  ], quality.tile)
  const impostorMat = addLodFade(makeImpostor(addLeafShading(addCloudShadows(new T.MeshLambertMaterial())), atlas), true)

  const syncTwigs = lod => lod.shadows.forEach((shadow, k) => {
    shadow.count = lod.solid[k].count
    shadow.boundingSphere = lod.sphere
  })

  /** A level-of-detail set: leafy cards cast leaf-card shadows; the pictures' shadows come from plain shapes. */
  function addLod(lod, shadowShapes, { woodAlways = false } = {}) {
    lods.push(lod)
    lod.shadows = lod.solid.map((mesh, k) => {
      const shadow = new T.InstancedMesh(shadowShapes[k], leafMat, 1)
      shadow.instanceMatrix = mesh.instanceMatrix
      shadow.layers.set(1) // (drawn into the shadow map only)
      return shadow
    })
    for (const mesh of lod.leafy) mesh.customDepthMaterial = fluffyDepthMaterial(quality.detail)
    lod.update(0, 0, true)
    if (seasonDay != null) lod.setSeason(seasonDay)
    syncTwigs(lod)
    for (const mesh of [...lod.meshes, ...lod.shadows]) {
      mesh.castShadow = !lod.solid.includes(mesh)
      mesh.receiveShadow = !lod.solid.includes(mesh) && !lod.shadows.includes(mesh)
      scene.add(mesh)
    }
    const addWood = mesh => {
      const role = mesh.userData.role
      mesh.castShadow = role === 'twigs'
      mesh.receiveShadow = true
      scene.add(mesh)
      if (role !== 'closeTrunk' && !woodAlways) {
        twigMeshes.push(mesh)
        mesh.visible = twigsOn
      }
    }
    for (const mesh of lod.woodMeshes) addWood(mesh)
    if (lod.o.wood) lod.o.wood.added = addWood
  }

  // Trunks: near the roads grown as each species grows them (a design per
  // trunk pick and species); out in the distant countryside a plain one
  // (a few pixels tall from the car), casting no shadow there. Conifers' straight.
  const SP = Object.keys(WOOD)
  const trunkShapes = TRUNK_SEEDS.flatMap(seed => SP.map(sp => trunk(seed, false, WOOD[sp].trunk)))
  const trunkMeshes = trunkShapes.map(g => new T.InstancedMesh(g, trunkMat, trees.length))
  const farTrunks = new T.InstancedMesh(simpleTrunk(), trunkMat, trees.length)
  let farCount = 0
  const far = t => Math.max(Math.abs(t.x), Math.abs(t.z)) > HALF_WORLD + 250
  const conTrunks = new T.InstancedMesh(coniferTrunk(), barkMat, trees.length)
  const counts = trunkMeshes.map(() => 0)
  let conCount = 0
  const colour = new T.Color()
  const broadTrees = []
  const conifers = []
  for (const t of trees) {
    treeMatrices(t, _trunkM, _crownM)
    if (t.conifer) {
      conTrunks.setMatrixAt(conCount, _trunkM)
      conTrunks.setColorAt(conCount++, barkColor(t, colour))
      conifers.push(t)
    } else if (far(t)) {
      farTrunks.setMatrixAt(farCount, _trunkM)
      farTrunks.setColorAt(farCount++, barkColor(t, colour))
      broadTrees.push(t)
    } else {
      const k = (t.pick % 3) * SP.length + Math.max(0, SP.indexOf(speciesOf(t).name))
      trunkMeshes[k].setMatrixAt(counts[k], _trunkM)
      trunkMeshes[k].setColorAt(counts[k]++, barkColor(t, colour))
      broadTrees.push(t)
    }
  }
  trunkMeshes.forEach((mesh, k) => (mesh.count = counts[k]))
  conTrunks.count = conCount
  farTrunks.count = farCount
  for (const mesh of [...trunkMeshes, conTrunks, farTrunks]) {
    if (!mesh.count) continue
    mesh.castShadow = mesh !== farTrunks
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }

  const treeColour = (t, out) => out.setHSL(t.hue, t.sat, t.light * 1.12 + 0.02)
  addLod(new CrownLod(broadTrees, {
    matrix: (t, out) => {
      treeMatrices(t, _trunkM, out)
      return out
    },
    color: treeColour,
    shape: t => t.variant,
    species: t => speciesOf(t),
    bark: (t, out) => barkColor(t, out),
    leafy: CROWN_SEEDS.map(seed => fluffyCrown(seed, quality.detail)),
    solid: CROWN_SEEDS.map((_, k) => impostorGeometry(k)),
    leafyMat: cardMat,
    solidMat: impostorMat,
    radius: quality.radius,
    wood: {
      closeRadius: quality.close,
      plain: (k, sp) => wood('plain', CROWN_SEEDS[k], sp),
      close: (k, sp) => wood('close', CROWN_SEEDS[k], sp),
      trunk: (kind, sp) => wood('trunk', TRUNK_SEEDS[kind], sp),
      plainMat: plainWoodMat,
      closeMat: closeWoodMat,
      trunkMat: closeTrunkMat,
      trunkMatrix: (t, out) => {
        treeMatrices(t, out, _crownM)
        return out
      },
      trunkKind: t => t.pick % 3,
    },
    onDraw: () => {},
  }), CROWN_SEEDS.map(seed => blobCrown(seed)))

  if (conifers.length) {
    addLod(new CrownLod(conifers, {
      matrix: (t, out) => {
        const c = crownOf(t)
        _o.position.set(t.x, c.y0 + c.ch / 2, t.z)
        _o.rotation.set(0, t.rot, 0)
        _o.scale.set(c.r, c.ch, c.r)
        _o.updateMatrix()
        return out.copy(_o.matrix)
      },
      color: treeColour,
      shape: t => Math.max(0, CONIFER_NAMES.indexOf(speciesOf(t).name)),
      species: t => speciesOf(t),
      bark: (t, out) => barkColor(t, out),
      leafy: CONIFER_NAMES.map(sp => fluffyConifer(CONIFER[sp], 11, quality.detail)),
      solid: CONIFER_NAMES.map((_, k) => impostorGeometry(CROWN_SEEDS.length + 2 + k)),
      leafyMat: cardMat,
      solidMat: impostorMat,
      radius: quality.radius,
      wood: {
        closeRadius: quality.close,
        plain: k => wood('coniferPlain', 11, CONIFER_NAMES[k]),
        close: k => wood('coniferClose', 11, CONIFER_NAMES[k]),
        plainMat: plainWoodMat,
        closeMat: closeWoodMat,
      },
      onDraw: () => {},
    }), CONIFER_NAMES.map(() => new T.ConeGeometry(1, 1, 8)), { woodAlways: true })
  }

  // The hedgerows: leafy bushes (hawthorn and blackthorn), the fewest, biggest cards.
  addLod(new CrownLod(bushes, {
    matrix: (b, out) => bushMatrix(b, out),
    color: (b, out) => out.setHSL(...b.tint),
    shape: b => b.shape,
    species: b => bushSpeciesAt(b.x, b.z),
    bark: (b, out) => barkColor({ x: b.x, z: b.z, species: 'hawthorn' }, out),
    leafy: BUSH_SEEDS.map(seed => fluffyCrown(seed, 'blob')),
    solid: [0, 1].map(k => impostorGeometry(CROWN_SEEDS.length + k)),
    leafyMat: cardMat,
    solidMat: impostorMat,
    radius: quality.bushRadius,
    wood: {
      closeRadius: quality.close,
      plain: (k, sp) => wood('plain', BUSH_SEEDS[k], sp, -0.9),
      close: (k, sp) => wood('close', BUSH_SEEDS[k], sp, -0.9),
      plainMat: plainWoodMat,
      closeMat: closeWoodMat,
    },
    onDraw: () => {},
  }), BUSH_SEEDS.map(seed => blobCrown(seed)))

  return {
    /** Leafy crowns follow the camera: call every frame. */
    update(position) {
      for (const lod of lods) if (lod.update(position.x, position.z)) syncTwigs(lod)
    },
    /** The time of year: each tree's leaves by its species; branches show once leaves go. */
    setSeason(day, season) {
      seasonDay = day
      leafUniforms.uBare.value = season.bare
      leafUniforms.uAutumn.value = season.autumn
      leafUniforms.uFresh.value = season.fresh
      for (const lod of lods) {
        lod.setSeason(day)
        syncTwigs(lod)
      }
      twigsOn = season.bare > 0.02 || lods.some(lod => lod.bare.some(b => b > 0.02))
      for (const mesh of twigMeshes) mesh.visible = twigsOn
    },
    /** Leaf sway: time (s), wind speed (m/s) and the direction it blows from (degrees). */
    setWind(time, speed, fromDegrees) {
      leafUniforms.uLeafTime.value = time
      leafUniforms.uWindSpeed.value = speed
      const from = (fromDegrees * Math.PI) / 180
      leafUniforms.uWindDir.value.set(-Math.sin(from), 0, Math.cos(from))
    },
  }
}
