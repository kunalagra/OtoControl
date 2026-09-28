import { RiHeadphoneLine } from '@remixicon/react'

import { cn } from '@/lib/utils'

import type { Section } from '../sections/registry'
import { ThemeToggle } from './ThemeToggle'

interface NavProps {
  /**
   * Resolved by the shell, so the rail and the pill cannot disagree — and
   * empty when no device is granted, which is the one case with no nav at all
   * (spec §3.2): with nothing granted there is no known section list, and
   * showing one brand's would be a guess about hardware we have not seen.
   */
  sections: Section[]
  active: string
  onSelect(id: string): void
}

/**
 * The nav: an 88px rail from `md` up, a floating pill below it, one element and
 * one set of buttons for both — spec §8 and DESIGN-GUIDE §5.9.
 *
 * Two `<nav>`s with one hidden per breakpoint would read as two tab bars to a
 * screen reader and could disagree after a device switch, so the breakpoint
 * lives in the classes instead. That is also why the rail's furniture — the app
 * mark and the theme toggle, which spec §4.2 puts at the two ends of the column
 * — is inside the same element: it is one column at `md`, and below `md` both
 * are hidden and only the pills are left.
 */
export function Nav({ sections, active, onSelect }: NavProps) {
  const hasItems = sections.length > 0

  return (
    <nav
      data-slot="nav"
      aria-label="Sections"
      className={cn(
        // The rail, from md up: a full-height 88px column with a 1px rule down
        // its right edge. The three `md:border-*-0` are not redundant: the pill
        // below needs Tailwind's `border` shorthand, which is
        // `border-width: 1px` on *all four* sides, and nothing else narrows it.
        // Without these the rail carries a 1px box around itself — a visible
        // ring on three sides that spec §4.2 does not ask for.
        //
        // Per-side zeros rather than `md:border-x-0` / `md:border-y-0`: `cn` is
        // tailwind-merge, which treats an axis-wide width as conflicting with a
        // single-side one and keeps only the last, so the axis form drops
        // `md:border-r` from the class list entirely and then zeroes all four
        // sides. Measured: the axis form renders the rail with no rule at all
        // (left/right/top/bottom all 0px), which is a different wrong from the
        // ring this whole block exists to prevent, not the same one.
        //
        // `md:rounded-none` for the same underlying reason: the rail is the pill's
        // own element, so without it `rounded-full` rides along and the 1px rule
        // bows 44px away at each end instead of running straight to the page edge.
        'md:flex md:h-dvh md:w-[88px] md:shrink-0 md:flex-col md:items-center md:gap-1.5 md:border-r md:border-l-0 md:border-t-0 md:border-b-0 md:rounded-none md:py-[18px]',
        hasItems
          ? cn(
              // The pill: floating chrome, so it keeps its 1px border — the one
              // place DESIGN-GUIDE §1.2 allows one.
              'fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-30 flex h-14 items-center justify-around rounded-full border border-border bg-card',
              'md:static md:h-dvh md:w-[88px] md:justify-start md:bg-transparent',
            )
          : 'hidden',
      )}
    >
      <AppMark />

      {sections.map((section) => (
        <NavItem
          key={section.id}
          section={section}
          active={active === section.id}
          onSelect={() => onSelect(section.id)}
        />
      ))}

      {/* Rail only: the mark and the toggle sit at the two ends of the column,
          the tabs in between. */}
      <div aria-hidden className="hidden flex-1 md:block" />
      <div className="hidden md:block">
        <ThemeToggle compact />
      </div>
    </nav>
  )
}

/**
 * The 38px inverted square with a headphone glyph: the same `RiHeadphoneLine`
 * the Home tab and the empty state use, so the mark is monochrome and needs
 * no new asset. (Spec §4.2 names an "O" here; the glyph reads as the app at
 * 38px where a letter reads as a tab label.)
 */
function AppMark() {
  return (
    <span
      aria-hidden
      className="mb-2 hidden size-[38px] shrink-0 place-items-center rounded-[12px] bg-foreground text-background md:grid"
    >
      <RiHeadphoneLine className="size-5" />
    </span>
  )
}

interface NavItemProps {
  section: Section
  active: boolean
  onSelect(): void
}

function NavItem({ section, active, onSelect }: NavItemProps) {
  const Icon = section.icon
  return (
    <button
      type="button"
      data-slot="nav-item"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // Touch target: the guide asks for 44x44 on a phone, and the pill's own
        // padding does not reach that on its own. `md:min-h-0` puts the floor
        // back to nothing on a desktop, where the item is already 55px tall from
        // its icon and label and the pointer is a mouse.
        'flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-full px-3.5 py-2 outline-none',
        // Selection is the one thing the design animates (DESIGN-GUIDE §6), and
        // the ring is spec §8's: 2px of foreground, 2px clear of the pill.
        'transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'md:h-auto md:min-h-0 md:w-16 md:rounded-2xl md:py-2.5',
        active
          ? 'bg-foreground font-bold text-background'
          : // **The muted token, at full strength — and no `opacity-55`.**
            //
            // Spec §4.1 asks for "inactive tabs are 55% opacity text", and that
            // is not a contrast rule, it is a *visual* one: the active tab is
            // supposed to read as the one you are on. Both parts are kept — the
            // hierarchy is the inverted fill, which is a much stronger signal
            // than a dimmer label — but the dimming itself is dropped, because
            // measured against the surfaces this nav actually sits on it fails
            // AA badly: `#777` at 55% over the pill's `#111` is **2.1 : 1**, and
            // over the light pill's `#f2f2f2` it is **2.0 : 1** (computed, not
            // estimated). The bare `#777` on the rail was the other half of the
            // same problem: 4.69 : 1 in dark and **4.48 : 1** in light, the
            // latter short of the 4.5 that a 9px label needs — the one contrast
            // failure the browser audit turned up on the device pages.
            //
            // `--muted-foreground` is the guide's own "less important than
            // foreground" step (5.33 : 1 light, 5.92 : 1 dark on the page), and
            // 4.76 / 5.33 : 1 on the light / dark pill surfaces. One class, both themes,
            // no arbitrary hex, and §8 is satisfied where §4.1's opacity was
            // only ever a way of drawing the same distinction.
            'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-5" />
      {/* The pill has room for the short word, the rail for the full one. */}
      <span className="text-[10px] uppercase tracking-[.1em] md:hidden">{section.shortLabel}</span>
      <span className="hidden text-[9px] uppercase tracking-[.1em] md:block">{section.label}</span>
    </button>
  )
}
