import { RiArrowDownSLine, RiMore2Line, RiRefreshLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ActiveDevice, DeviceManager } from '@/core/manager'

import { summarise } from '../device/summary'
import { ConnectionControls, DevicePickers } from './ConnectionControls'
import { DeviceSelect, MIN_DEVICES_TO_SWITCH } from './DeviceSelect'
import { StatusToken } from './StatusToken'
import { ThemeToggle } from './ThemeToggle'

interface TopBarProps {
  manager: DeviceManager
  active: ActiveDevice
}

/**
 * The bar above the section body — spec §4.1, §4.2, DESIGN-GUIDE §5.10.
 *
 * One element, two layouts again, and for the same reason as the nav: a
 * duplicated bar would double the landmarks a screen reader reads. On a phone
 * it is 52px and sticky over a scrolling body, and every action hides behind
 * one ⋯ button; from `md` up it stands still above the bento and the actions
 * are pills, because there is room to name them.
 *
 * The model name is the page's one `<h1>` on both sides of the breakpoint, so
 * the switcher is its own button beside it rather than a control wrapping a
 * heading. **This is a deliberate deviation from DESIGN-GUIDE §5.10**, which
 * draws the phone's switcher as one button reading "MOMENTUM 4 ▾": a button
 * inside a heading is either invalid nesting or an `<h1>` that reads as a label
 * for a control, and the name is the one thing on the bar that should be the
 * page's heading. The visual result is the guide's — name, then chevron — with
 * the two as separate nodes.
 *
 * Both phone controls carry the 44px floor from spec §8 as `min-h-11 min-w-11`
 * hit slop rather than as a taller visual (DESIGN-GUIDE §5.2), since the bar is
 * 52px and there is no room for 44px buttons in it.
 */
export function TopBar({ manager, active }: TopBarProps) {
  const summary = summarise(active)
  const status = active.state.status
  const connected = status === 'connected'

  /**
   * The bar's own name, which is the device's when there is one.
   *
   * `summarise` answers "No device" for an absent model, which is the right
   * answer for a field called `model` and the wrong one for this row: the
   * status token beside it already says NO DEVICE (spec §4.4), and the mockup
   * puts the *state* in the token and the *thing* on the left. With nothing
   * granted the thing is the app — the one name on the page that is true.
   */
  const title = manager.hasDevice ? summary.model : 'OtoControl'

  return (
    <header
      data-slot="top-bar"
      className={cn(
        // Phone: sticky over a scrolling body, 52px, blurred so the content
        // passing under it stays readable. `inset-x-0` matters as much as the
        // height — a sticky bar that stops short of the edges would leave the
        // content showing through beside it.
        'bg-background/85 sticky top-0 z-20 mx-auto flex h-[52px] w-full max-w-[1280px] items-center justify-between gap-3 px-4 backdrop-blur',
        // Desktop: not sticky — the rail is fixed and the body scrolls under a
        // bar that is part of the flow. The vertical padding is the guide's 20px,
        // and `pt` only: the space *below* the bar belongs to the body's own top
        // padding (see `AppShell`), because a flex column's `gap` contributes
        // nothing before its first child, so a bottom pad here would be the only
        // thing separating the bar from the section — and 20px of it is the
        // mockup's 14 doubled.
        'md:static md:h-auto md:px-6 md:pt-5',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 md:gap-3">
        <h1
          data-slot="top-bar-title"
          className="truncate text-[10px] font-medium uppercase tracking-[.14em] md:text-[22px] md:font-extrabold md:tracking-[-.02em]"
        >
          {title}
        </h1>
        {/* One device is a dropdown with one entry, so the switcher only
            appears when there is something to switch to. */}
        {manager.available.length >= MIN_DEVICES_TO_SWITCH && (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Switch device"
                  // The 44px floor is the `min-*`, not a taller button
                  // (DESIGN-GUIDE §5.2): the phone form is a 16px chevron, and
                  // a 44px box around it would not fit a 52px bar beside
                  // anything else.
                  className="min-h-11 min-w-11 gap-0.5 px-1.5 text-muted-foreground md:min-h-0 md:min-w-0 md:gap-1 md:px-3"
                >
                  <RiArrowDownSLine className="size-4 md:hidden" />
                  <span className="hidden md:inline">Switch</span>
                </Button>
              }
            />
            <PopoverContent align="start" className="w-64 p-3">
              <DeviceSelect manager={manager} active={active} />
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <StatusToken status={status} hasDevice={manager.hasDevice} />

        {/* Phone: everything else, behind one button. */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
                // The 44px floor as hit slop around a 32px box, not a 44px box
                // around a 44px glyph — see the switcher above.
                className="text-muted-foreground min-h-11 min-w-11 md:hidden"
              >
                <RiMore2Line />
              </Button>
            }
          />
          <PopoverContent align="end" className="w-60 p-2">
            {/* The same rule as the desktop pills below, for the same reason:
                with no device the empty state is already a full pair of connect
                buttons on the page, so a menu offering them again says it
                twice. The phone used to be the exception — its bar had nowhere
                else to put them — and the empty state is what removed that
                reason. */}
            {manager.hasDevice ? (
              /* A menu wants a column, which is what `ConnectionControls`
                  already is — so the phone reuses it whole rather than restating
                  which buttons each state gets. */
              <ConnectionControls manager={manager} active={active} />
            ) : null}
            {/* Labelled here rather than the icon-only rail form: a menu row that
                says which theme is active beats a glyph that has to be decoded.
                It stays either way, because a phone has no rail to put it on. */}
            <ThemeToggle />
          </PopoverContent>
        </Popover>

        {/* Desktop: the same set as pills, and nothing at all when there is no
            device — the empty state below is one large pair of buttons, and
            repeating them in a 52px bar would say the same thing twice. */}
        <div data-slot="top-bar-pills" className="hidden items-center gap-2 md:flex">
          {!manager.hasDevice ? null : connected ? (
            <>
              <RefreshPill manager={manager} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void manager.disconnect()}
              >
                Disconnect
              </Button>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="outline" size="sm">
                      Add device
                    </Button>
                  }
                />
                <PopoverContent align="end" className="w-64 p-3">
                  <DevicePickers manager={manager} status={status} verb="Add" />
                </PopoverContent>
              </Popover>
            </>
          ) : (
            <ConnectionPills manager={manager} status={status} />
          )}
        </div>
      </div>
    </header>
  )
}

/**
 * Re-read everything, with the explanation it needs.
 *
 * A tooltip because a 11px "Refresh" says what the tap does and not why it
 * exists: most settings have no notification in firmware, so this is the only
 * way to pick up a change made in the phone app.
 */
function RefreshPill({ manager }: { manager: DeviceManager }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="outline" size="sm" onClick={() => void manager.refresh()}>
            <RiRefreshLine data-icon="inline-start" />
            Refresh
          </Button>
        }
      />
      <TooltipContent>Re-read every setting. Needed for settings the device never announces.</TooltipContent>
    </Tooltip>
  )
}

/**
 * Nothing is connected, so the top bar's job is to offer a way in.
 *
 * Just the two pickers: `DevicePickers` is the same two buttons
 * `ConnectionControls` offers when disconnected, and a separate "Connect" here
 * would be a third control calling one of the same two methods. Being
 * disconnected is no reason to hide a picker, so both stay.
 */
function ConnectionPills({
  manager,
  status,
}: {
  manager: DeviceManager
  status: string
}) {
  return <DevicePickers manager={manager} status={status} verb="Connect" />
}
