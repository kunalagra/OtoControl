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
const TILE_WEIGHT: Record<TileId, number> = { battery: 1, noise: 3, eq: 3, devices: 2, system: 2 }

/**
 * Splits the tiles a device has over the two desktop stacks.
 *
 * Each tile, in priority order, joins whichever stack is shorter so far (the
 * middle one on a tie). Priority order is kept inside each stack, the battery
 * strip is always at the top of the middle one, and a device with only a few
 * features still fills both stacks rather than leaving one empty. With the
 * full set it lands on the approved mockup: battery, EQ and system in the
 * middle; noise and devices on the right.
 */
export function placeTiles(ids: readonly TileId[]): { middle: TileId[]; right: TileId[] } {
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
