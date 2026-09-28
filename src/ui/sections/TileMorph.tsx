import { ViewTransition } from 'react'
import type { ReactNode } from 'react'

/**
 * Pairs a Home tile with the page it opens, so opening one grows the tile
 * into the page (a shared-element view transition).
 *
 * The same name wraps the tile on Home and the section body on its tab; only
 * one is mounted at a time, which is what lets them pair. `default="none"`
 * keeps every other update silent — values changing, a tab tapped in the nav —
 * and only a navigation that `openFromTile` runs as a transition morphs.
 */
export function TileMorph({ section, children }: { section: string; children: ReactNode }) {
  return (
    <ViewTransition name={`tile-${section}`} share="tile-morph" default="none">
      {children}
    </ViewTransition>
  )
}
