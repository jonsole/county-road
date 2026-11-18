// Photographic surface textures (public/textures, from Poly Haven, CC0: see
// CREDITS.txt there): colour, normal (bumps) and roughness maps, loaded
// before the world is built.
import * as T from 'three'

const SETS = ['asphalt-cracked', 'asphalt-worn', 'grass', 'grass-patchy', 'verge-gravel', 'mud', 'paving']

/** TEX['grass'].color, .normal, .rough, once loadTextures() has finished. */
export const TEX = {}

export async function loadTextures(anisotropy = 8) {
  const loader = new T.TextureLoader()
  const base = `${import.meta.env.BASE_URL}textures/`
  const load = async (name, colour) => {
    const texture = await loader.loadAsync(`${base}${name}.webp`)
    texture.wrapS = texture.wrapT = T.RepeatWrapping
    texture.anisotropy = anisotropy
    texture.colorSpace = colour ? T.SRGBColorSpace : T.NoColorSpace
    return texture
  }
  await Promise.all(SETS.map(async name => {
    const [color, normal, rough] = await Promise.all([load(`${name}-color`, true), load(`${name}-normal`), load(`${name}-rough`)])
    TEX[name] = { color, normal, rough }
  }))
  return TEX
}
