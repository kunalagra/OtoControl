import { useLayoutEffect, useRef } from 'react'

/**
 * Up to a pixel over is rounding, not overflow: row heights and the box
 * height are rounded separately, so rows that exactly fill a box can "end" a
 * pixel past it.
 */
const ROUNDING = 1

/**
 * How many rows, in priority order, fit in `available` pixels, given where each
 * row's bottom edge falls. The first row always stays, so a tile never draws as
 * an empty frame; the rest go from the end.
 */
export function fitCount(available: number, bottoms: readonly number[]): number {
  if (bottoms.length === 0) return 0
  let count = 1
  while (count < bottoms.length && bottoms[count] <= available + ROUNDING) count += 1
  return count
}

/**
 * Hides the trailing children of a box that do not fit its height — a tile
 * showing as many of its rows as the window allows, most important first,
 * instead of growing the page into a scroll.
 *
 * The box must have a bounded height (a flex item with `min-h-0`) and be the
 * rows' offset parent (`relative`). Rows are hidden with the `hidden`
 * attribute, straight on the DOM, so a resize never re-renders the tile.
 * Where there is no `ResizeObserver` (tests, old browsers) every row shows.
 */
export function useFitList<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const box = ref.current
    if (!box || typeof ResizeObserver === 'undefined') return

    const fit = () => {
      const rows = Array.from(box.children) as HTMLElement[]
      for (const row of rows) row.hidden = false
      // Fractional sizes, not the rounded `offset*` ones.
      const top = box.getBoundingClientRect().top
      const keep = fitCount(
        box.clientHeight,
        rows.map((row) => row.getBoundingClientRect().bottom - top),
      )
      rows.forEach((row, index) => {
        row.hidden = index >= keep
      })
    }

    fit()
    const observer = new ResizeObserver(fit)
    // The box, the tile around it and the stack around that: the room can grow
    // without the box itself changing size — a banner above going away, say —
    // and a row hidden in a tighter moment would otherwise stay hidden.
    for (let node: HTMLElement | null = box, depth = 0; node && depth < 3; node = node.parentElement, depth += 1) {
      observer.observe(node)
    }
    return () => observer.disconnect()
  })

  return ref
}
