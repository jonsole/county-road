// Sun (and moon) shadows: cascaded shadow maps (three.js's CSM add-on).
// The view is split by distance, each slice with its own shadow map: a
// sharp one near the car, coarser ones further out, so close and distant
// things alike keep their shadows. RC Flight Sim draws one static map over
// its whole field instead; a car moves too far and is seen too close for that.
//
// The cascade lights take the sun's place (sky.js's sun stays for its
// direction and colour, but lights nothing), and every lit material is set
// up for them (setupMaterials), its own shader changes kept.
import { Vector3 } from 'three'
import { CSM } from 'three/addons/csm/CSM.js'

/** Per Graphics → Shadows level: map size, number of cascades, how far shadows reach (m). */
export const SHADOW_LEVELS = {
  low: { size: 1024, cascades: 2, far: 250 },
  medium: { size: 2048, cascades: 3, far: 500 },
  high: { size: 2048, cascades: 4, far: 900 },
}

const LIT = ['isMeshLambertMaterial', 'isMeshStandardMaterial', 'isMeshPhongMaterial']

export function createShadows(scene, camera, sky, level) {
  const csm = new CSM({
    camera, parent: scene, cascades: level.cascades, maxFar: level.far, mode: 'practical',
    shadowMapSize: level.size, lightDirection: new Vector3(0, -1, 0), lightIntensity: 1,
    lightNear: 1, lightFar: 4000, lightMargin: 400, shadowBias: -0.00002,
  })
  csm.fade = true // (blend from one cascade to the next, no seam)
  csm.updateFrustums()
  for (const light of csm.lights) {
    // Layer 1: the distant trees' plain shadow shapes (forest.js), drawn into the maps only.
    light.shadow.camera.layers.enable(1)
  }
  setNormalBias()
  // The sky's own sun now lights nothing; the cascades do, in its colour and strength.
  sky.sun.visible = false

  /** Push each cascade's shadow lookups off surfaces by about one of its pixels (no acne). */
  function setNormalBias() {
    for (const light of csm.lights) {
      const cam = light.shadow.camera
      light.shadow.normalBias = ((cam.right - cam.left) / level.size) * 1.2
    }
  }

  const done = new Set()
  return {
    /** Set up materials for the cascades (each once), keeping their own shader changes. */
    setupMaterials(materials) {
      for (const material of materials) {
        if (!material || done.has(material) || !LIT.some(k => material[k])) continue
        done.add(material)
        const own = material.onBeforeCompile
        csm.setupMaterial(material)
        const cascades = material.onBeforeCompile
        material.onBeforeCompile = (shader, renderer) => {
          own?.call(material, shader, renderer)
          cascades.call(material, shader, renderer)
        }
        material.needsUpdate = true
      }
    },
    /** Every lit material in the scene. */
    setupScene() {
      const materials = []
      scene.traverse(object => {
        if (object.material) materials.push(...[object.material].flat())
      })
      this.setupMaterials(materials)
    },
    /** After the camera's shape or reach changes. */
    resize() {
      csm.updateFrustums()
      setNormalBias()
    },
    /** Every frame: the sun's direction, colour and strength, and the cascades follow the camera. */
    update() {
      csm.lightDirection.copy(sky.state.lightDir).negate()
      for (const light of csm.lights) {
        light.color.copy(sky.sun.color)
        light.intensity = sky.sun.intensity
      }
      csm.update()
    },
  }
}
