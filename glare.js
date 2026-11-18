// Sun glare, ported from RC Flight Sim (src/view/glare.js): looking towards
// the sun the picture washes out, as a camera or your eyes would, most when
// it's square in view and low in the sky. Hills in front of the sun block
// it; cloud cover, mist and low cloud dim it.
// A screen overlay behind the HUD: a white veil and a bright bloom.
import { Vector3 } from 'three'
import { heightAt } from './terrain.js'
import { cloudUniforms } from './sky.js'

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const forward = new Vector3()
const projected = new Vector3()

export function createGlare(view) {
  const root = document.createElement('div')
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;'
  const veil = document.createElement('div')
  veil.style.cssText = 'position:absolute;inset:0;background:#fffaf0;opacity:0;'
  const bloom = document.createElement('div')
  bloom.style.cssText = 'position:absolute;inset:0;opacity:0;'
  root.append(veil, bloom)
  view.after(root)
  let level = 0
  let seen = 1
  let frame = 0

  /** How much of the sun gets through (0-1): hills, then clouds. */
  function visible(from, sun, state) {
    for (let d = 5; d < 2500; d += d < 100 ? 5 : 25) {
      const y = from.y + sun.y * d
      if (y > 260) break
      if (y < heightAt(from.x + sun.x * d, from.z + sun.z * d)) return 0
    }
    return 1 - (state.cloudDim ?? 0.95) * smooth(0.35, 0.85, cloudUniforms.cloudCover.value)
  }

  return {
    update(camera, state, dt, enabled) {
      let target = 0
      const sun = state.sunDir
      if (enabled && state.sunElevation > -1) {
        camera.getWorldDirection(forward)
        const aim = Math.pow(smooth(Math.cos((40 * Math.PI) / 180), 1, forward.dot(sun)), 1.6)
        if (aim > 0) {
          if (frame++ % 6 === 0) seen = visible(camera.position, sun, state)
          const low = 0.65 + 0.35 * (1 - smooth(10, 50, state.sunElevation))
          const day = smooth(-1, 6, state.sunElevation)
          const murk = Math.max(state.fogNow ?? 0, state.lowCloudCover ?? 0)
          target = aim * seen * low * day * (1 - Math.min(1, murk * 1.2))
        }
      }
      // Eyes adjust quickly, not instantly.
      level += (target - level) * (1 - Math.exp(-dt * 8))
      veil.style.opacity = Math.min(0.93, level * 1.05).toFixed(3)
      if (level > 0.01) {
        projected.copy(camera.position).addScaledVector(sun, 1000).project(camera)
        const x = (projected.x * 0.5 + 0.5) * 100
        const y = (-projected.y * 0.5 + 0.5) * 100
        bloom.style.background = `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(255,252,240,1) 0%, rgba(255,246,225,0.85) 6%, rgba(255,240,215,0.35) 22%, rgba(255,240,215,0) 55%)`
      }
      bloom.style.opacity = Math.min(1, level * 1.3).toFixed(3)
    },
  }
}
