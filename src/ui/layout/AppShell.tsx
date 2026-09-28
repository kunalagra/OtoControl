import { RiArrowLeftLine } from '@remixicon/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ActiveDevice } from '@/core/manager'
import { componentFor, navSections, sectionFor } from '../sections/registry'
import { NoDevice } from '../sections/NoDevice'
import { useDevices } from '../useDevice'
import { Nav } from './Nav'
import { TopBar } from './TopBar'

/**
 * The Mono shell — spec §4.
 *
 * One column on a phone (sticky bar, scrolling body, floating pill) and a rail
 * plus a main column from `md` up. Both are the same tree: the nav decides which
 * layout it is in with classes, and the body is the only thing that changes
 * padding.
 */
export function AppShell() {
  const { manager, active } = useDevices()
  // Home is the landing tab, and it is the shell's own section rather than a
  // driver's, so the default is a constant rather than "whatever came first".
  const [activeId, setActiveId] = useState('home')

  const nav = navSections(active)
  // Drivers do not share a section list, so a stale id must not survive a switch
  // — Sennheiser's `debug` means nothing to Sony. `sectionFor` resolves that
  // during render, which is what the old shell's effect was doing one render
  // late: the stale id is never shown, and the state it lingers in is only ever
  // written by a navigation.
  const section = sectionFor(active, activeId)
  // With no device there is no brand and so no section list: the empty state is
  // the whole body, and a tab bar over it would be a guess about hardware we have
  // not seen (spec §3.2).
  const empty = !manager.hasDevice

  // The idle dim, per spec §4.3: not connected means the values on screen are
  // the last ones read, so they are shown but not offered as current. The bar
  // above is outside it — a page that keeps showing a disconnected device must
  // not dim the one thing that says it is disconnected.
  //
  // `home` is the exception the same paragraph makes: its hero has to stay at
  // full strength, and one wrapper around a whole section cannot leave a tile
  // out of it. So this section dims its own non-hero tiles (see `Home`) and the
  // shell leaves it alone.
  const idle = active.state.status !== 'connected' && section.id !== 'home'

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      <Nav
        sections={empty ? [] : nav}
        active={section.id}
        onSelect={setActiveId}
      />

      <main className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        <TopBar manager={manager} active={active} />

        <div
          data-slot="section-body"
          className={cn(
            // 1280px, per spec §4 — the old column was 3xl (768px), which is
            // what made the desktop bento impossible.
            'mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 md:px-6',
            // Room above the first block. The bar is 52px and sticky, so without
            // this the first block sits flush against it while the page scrolls —
            // the one place the layout had no gap at all, because everything
            // below it was measured from the bottom for the pill.
            //
            // It is here rather than on the bar, and on both widths, for one
            // reason: a flex column's `gap` adds nothing *before* its first
            // child. Putting the space on the bar made the bar's own height the
            // only thing holding the two apart, so a `md:pb-0` there (added to
            // stop 20px + 20px becoming 40px) put the section flat against the
            // bar — measured at 0px, against the approved mockup's 14. The
            // desktop is 14 rather than 12 for the same reason the gap is: it
            // is the gap's own value, so the space above the first block and
            // the spaces between the rest are one number.
            'pt-3 md:pt-3.5',
            // The phone gap is the guide's 8px; the desktop's is 14px, the
            // spacing the approved mockup puts between its bar and its grid.
            'gap-2 md:gap-3.5',
            // Room for the floating pill: its 56px, the 16px the guide asks to
            // clear it by, and the home indicator's inset. Measured, not guessed:
            // without the last 16px the last block sits under the pill.
            //
            // **Only when the pill is on the page.** The pill *is* the nav, and
            // with nothing granted there is no nav (spec §3.2) — so on the
            // empty state the 72px was reserving room for a bar that is not
            // rendered, and the hero ended 74px above the bottom of a screen
            // with nothing in that space. The safe-area inset is not conditional:
            // a phone with a home indicator needs the page to stop above it
            // whatever else is at the foot, and `md:pb-5` is the desktop's
            // padding, which never had a pill to clear.
            empty
              ? 'pb-[env(safe-area-inset-bottom)]'
              : 'pb-[calc(56px+16px+env(safe-area-inset-bottom))] md:pb-5',
          )}
        >
          {/* Hidden sections are not in the nav, so this is the only way out of
              them, and it shows at every width rather than only on a phone. */}
          {section.hidden && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground -ml-2 self-start"
              onClick={() => setActiveId('system')}
            >
              <RiArrowLeftLine className="size-4" />
              System
            </Button>
          )}

          {/* Genuine failures only. Headphones being switched off is not one:
              the status token says it, and the cached settings stay up.

              The bordered destructive message is spec §4.4's, kept as it was
              including the border; the *text* is `--signal-strong` rather than
              `--destructive` (spec §8), because this sits on the page ground and
              `#ff4d3d` on white is 3.3 : 1. */}
          {active.state.error && (
            <p className="border-destructive/40 text-signal-strong rounded-lg border px-3 py-2 text-sm">
              {active.state.error}
            </p>
          )}

          {!empty && active.state.status === 'unsupported' && (
            <p className="border-destructive/40 text-signal-strong rounded-lg border px-3 py-2 text-sm">
              This browser has no Web Serial API. Use Chrome, Edge or another Chromium browser.
            </p>
          )}

          {empty ? (
            <NoDevice manager={manager} active={active} />
          ) : (
            // A flex column that fills the leftover body, from `md` up: a section
            // that wants the whole body — Home's bento, which spec §4.2 says
            // fills the remaining height — needs a box with a definite height to
            // fill, and a plain block child of a flex column is only as tall as
            // its content. `min-h-0` alongside it so a section taller than the
            // window still overflows visibly and `main` scrolls, exactly as it
            // did when this was a block.
            <div
              data-slot="section-wrap"
              className={cn(
                'md:flex md:min-h-0 md:flex-1 md:flex-col',
                // …and the one link the chain was missing: a driver's section root
                // is a flex item here, so its own `min-height: auto` made it
                // refuse to shrink, and the definite height from `main` stopped
                // one box short of the section. Everything below it that asks to
                // fill — Home's bento, the EQ desk — was then filling a box
                // nobody had sized, and the browser resolved the leftover
                // percentage against the scroll container instead. Measured: an
                // 890px fader desk in an 800px window, and a page that scrolled
                // when the section's own content was 1013px.
                //
                // Written as a descendant rule rather than a prop on 17 section
                // roots, because the shell is what builds the chain and this is
                // the only place that knows the whole of it. A section shorter
                // than the window simply leaves the space empty at the bottom,
                // which is where a scrollbar would have been.
                'md:[&>*]:min-h-0 md:[&>*]:flex-1',
                idle && 'pointer-events-none opacity-50',
              )}
            >
              <SectionBody active={active} sectionId={section.id} onNavigate={setActiveId} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

interface SectionBodyProps {
  active: ActiveDevice
  sectionId: string
  onNavigate(id: string): void
}

/**
 * Renders whichever component `sectionId` resolves to, through `componentFor` —
 * the shell's own sections first, then the driver's, so `home` and a driver's
 * `sound` go down the same path.
 *
 * Every section is handed the whole prop union `componentFor` erases to: the
 * three a driver section declares, and the `ActiveDevice` a shell-owned one
 * reads. A driver component receives the fourth and ignores it, which is what
 * lets both live in one table (see `ResolvedSectionProps`).
 *
 * No brand switch: every section a driver declares has a component
 * (`driver.test.ts` checks that invariant per driver), and `sectionId` — always
 * taken from the shell's own lists above, never typed in by hand — resolves
 * against one. The `if (!Component)` is a guard, not a branch any current caller
 * reaches: the shell passes `section`, which is by construction a section that
 * does have a component.
 */
function SectionBody({ active, sectionId, onNavigate }: SectionBodyProps) {
  const Component = componentFor(active, sectionId)
  if (!Component) return null
  return (
    <Component
      device={active.device}
      state={active.state}
      active={active}
      onNavigate={onNavigate}
    />
  )
}
