/**
 * Fighter portraits for the Dojo, taken from the player's own Tekken 3 Expanded installation.
 *
 * Tekken 3 Expanded cuts these itself from the player's own dumps when it is built (Tekken 3
 * arcade for Tekken 3's cast, Tag Tournament for its guests) and keeps them beside the game.
 * The hub only reads them there and turns them into PNGs in its own data folder: no portrait is
 * part of the hub, its repository or its releases, and none is ever uploaded.
 */

/** The game's `mods` folder, relative to the installation (newest layout first). */
export const PORTRAIT_MOD_DIRS = ['build-release/mods', 'mods']

/** Dojo fighter id → the portrait file under `mods/`. Anna, Gon and Dr. B have none there: see `TMST_PORTRAIT_FILES`. */
export const PORTRAIT_FILES: Record<string, string> = {
  // Tekken 3's cast: tools/arcade_stages/faces.py, face-<PS1 character ID>-portrait-hd.bin
  paul: 'arcade-stages/face-00-portrait-hd.bin',
  law: 'arcade-stages/face-01-portrait-hd.bin',
  lei: 'arcade-stages/face-02-portrait-hd.bin',
  king: 'arcade-stages/face-03-portrait-hd.bin',
  yoshimitsu: 'arcade-stages/face-04-portrait-hd.bin',
  nina: 'arcade-stages/face-05-portrait-hd.bin',
  hwoarang: 'arcade-stages/face-06-portrait-hd.bin',
  xiaoyu: 'arcade-stages/face-07-portrait-hd.bin',
  eddy: 'arcade-stages/face-08-portrait-hd.bin',
  jin: 'arcade-stages/face-09-portrait-hd.bin',
  julia: 'arcade-stages/face-10-portrait-hd.bin',
  kuma: 'arcade-stages/face-11-portrait-hd.bin',
  bryan: 'arcade-stages/face-12-portrait-hd.bin',
  heihachi: 'arcade-stages/face-13-portrait-hd.bin',
  ogre: 'arcade-stages/face-14-portrait-hd.bin',
  mokujin: 'arcade-stages/face-15-portrait-hd.bin',
  'gun-jack': 'arcade-stages/face-16-portrait-hd.bin',
  'true-ogre': 'arcade-stages/face-20-portrait-hd.bin',
  // Tag Tournament's guests (and Panda and Tiger): tools/ttt1/ui.py, <Name>-T3-portrait-hd.bin
  alex: 'ttt1/Alex-T3-portrait-hd.bin',
  angel: 'ttt1/Angel-T3-portrait-hd.bin',
  'armor-king': 'ttt1/Armorking-T3-portrait-hd.bin',
  baek: 'ttt1/Baek-T3-portrait-hd.bin',
  bruce: 'ttt1/Bruce-T3-portrait-hd.bin',
  devil: 'ttt1/Devil-T3-portrait-hd.bin',
  ganryu: 'ttt1/Ganryu-T3-portrait-hd.bin',
  'jack-2': 'ttt1/Jack2-T3-portrait-hd.bin',
  jun: 'ttt1/Jun-T3-portrait-hd.bin',
  kazuya: 'ttt1/Kazuya-T3-portrait-hd.bin',
  kunimitsu: 'ttt1/Kunimitsu-T3-portrait-hd.bin',
  lee: 'ttt1/Lee-T3-portrait-hd.bin',
  michelle: 'ttt1/Michelle-T3-portrait-hd.bin',
  panda: 'ttt1/Panda-T3-portrait-hd.bin',
  'p-jack': 'ttt1/Pjack-T3-portrait-hd.bin',
  roger: 'ttt1/Roger-T3-portrait-hd.bin',
  tetsujin: 'ttt1/Tetsujin-T3-portrait-hd.bin',
  tiger: 'ttt1/Tiger-T3-portrait-hd.bin',
  unknown: 'ttt1/Unknown-T3-portrait-hd.bin',
  wang: 'ttt1/Wang-T3-portrait-hd.bin'
}

/**
 * The TMST add-on renders its Tournament Mode portraits as PNGs when it is installed, Anna, Gon and
 * Dr. B among them. The Dojo takes only those three from it (the rest come from the game above).
 * The folder is relative to the add-on's installation, which sits at `addons/tmst` in Tekken 3 Expanded.
 */
export const TMST_PORTRAIT_DIR = 'workspace/tournament/portraits'
export const TMST_IN_EXPANDED = 'addons/tmst'
export const TMST_PORTRAIT_FILES: Record<string, string> = {
  anna: 'anna.png',
  gon: 'gon.png',
  'dr-b': 'drb.png'
}

/** Every fighter the Dojo can show a portrait of. */
export const PORTRAIT_FIGHTERS = new Set([...Object.keys(PORTRAIT_FILES), ...Object.keys(TMST_PORTRAIT_FILES)])

export const PORTRAIT_WIDTH = 168
export const PORTRAIT_HEIGHT = 252

/**
 * RGBA pixels of a portrait file: 15-bit texels, little-endian, row after row (bits 0-4 red,
 * 5-9 green, 10-14 blue, 15 the PlayStation's semi-transparency flag); 0 is transparent.
 * Null when the file is not a portrait of the expected size.
 */
export function decodePortrait(data: Uint8Array): Uint8Array | null {
  const count = PORTRAIT_WIDTH * PORTRAIT_HEIGHT
  if (data.length !== count * 2) return null
  const out = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) {
    const v = data[i * 2]! | (data[i * 2 + 1]! << 8)
    if (v === 0) continue // transparent, already zero
    out[i * 4] = (((v & 31) * 255 + 15) / 31) | 0
    out[i * 4 + 1] = ((((v >> 5) & 31) * 255 + 15) / 31) | 0
    out[i * 4 + 2] = ((((v >> 10) & 31) * 255 + 15) / 31) | 0
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * A TMST portrait as the Dojo shows it. TMST writes the PlayStation texture as it is: 126 x 252, RGB,
 * see-through texels magenta (0xff00ff). The game draws it 4:3 wider, so it is stretched to
 * PORTRAIT_WIDTH x PORTRAIT_HEIGHT (nearest texel, like the game's own portraits) and the magenta
 * becomes transparent. Null when the picture is not PORTRAIT_HEIGHT tall.
 */
export function tmstPortrait(rgba: Uint8Array, width: number, height: number): Uint8Array | null {
  if (height !== PORTRAIT_HEIGHT || width < 1 || rgba.length !== width * height * 4) return null
  const out = new Uint8Array(PORTRAIT_WIDTH * PORTRAIT_HEIGHT * 4)
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let x = 0; x < PORTRAIT_WIDTH; x++) {
      const s = (y * width + Math.floor((x * width) / PORTRAIT_WIDTH)) * 4
      const r = rgba[s]!
      const g = rgba[s + 1]!
      const b = rgba[s + 2]!
      if ((r === 255 && g === 0 && b === 255) || rgba[s + 3] === 0) continue // transparent, already zero
      const d = (y * PORTRAIT_WIDTH + x) * 4
      out[d] = r
      out[d + 1] = g
      out[d + 2] = b
      out[d + 3] = 255
    }
  }
  return out
}
