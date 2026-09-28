/**
 * Which Home tiles exist, in what order, and which desktop stack each joins.
 * Kept out of `Home.tsx` so that file exports components only.
 */

/** A Home tile, by what it shows. */
export type TileId = 'battery' | 'noise' | 'eq' | 'devices' | 'system'

/** Which tile goes first when there is room for fewer than all of them. */
export const TILE_PRIORITY: readonly TileId[] = ['battery', 'noise', 'eq', 'devices', 'system']

/**
 * Roughly how tall each tile draws, in battery-strip units. Only the ratios
 * matter: they decide which column a tile joins, not how big it is drawn.
 */
const TILE_WEIGHT: Record<TileId, number> = { battery: 1, noise: 3, eq: 4, devices: 2, system: 3 }

/**
 * Splits the tiles a device has over the two desktop stacks.
 *
 * A set light enough for one stack stays in one. Otherwise each tile, in
 * priority order, joins whichever stack is shorter so far (the middle one on a
 * tie). Priority order is kept inside each stack, and the battery strip is
 * always at the top of the middle one. With the
 * full set it lands on the approved mockup: battery, EQ and system in the
 * middle; noise and devices on the right.
 */
/**
 * The most weight one stack holds before the tiles are split over two. The
 * WF-C500's battery, EQ and System (8) stack in one column; a Momentum's full
 * set (13), or Nothing's four (11), splits.
 */
const SINGLE_STACK_MAX = 8

export function placeTiles(ids: readonly TileId[]): { middle: TileId[]; right: TileId[] } {
  // A small set spread over two stacks is tall, mostly empty tiles: keep it
  // in one, and let the hero have the width.
  const total = ids.reduce((sum, id) => sum + TILE_WEIGHT[id], 0)
  if (total <= SINGLE_STACK_MAX) return { middle: [...ids], right: [] }

  const middle: TileId[] = []
  const right: TileId[] = []
  let middleHeight = 0
  let rightHeight = 0
  for (const id of ids) {
    if (middleHeight <= rightHeight) {
      middle.push(id)
      middleHeight += TILE_WEIGHT[id]
    } else {
      right.push(id)
      rightHeight += TILE_WEIGHT[id]
    }
  }
  return { middle, right }
}

/** The sections a Home tile opens, which are the ones a tile can grow into. */
export const MORPH_TARGETS: ReadonlySet<string> = new Set(['sound', 'system', 'devices'])
