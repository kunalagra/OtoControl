import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ActiveDevice, DeviceManager } from '@/core/manager'

import { summarise } from '../device/summary'
import { DeviceMenu } from './DeviceMenu'

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
 * Every connection action — state, switching, adding, refresh, disconnect —
 * lives in `DeviceMenu` beside the name, on every width. The bar keeps one
 * button of its own: Reconnect, while a known device is away.
 */
export function TopBar({ manager, active }: TopBarProps) {
  const summary = summarise(active)
  const status = active.state.status
  // The one action worth a button in the bar: a known device that has gone
  // away. Everything else lives in the device menu beside the name.
  const reconnectable = manager.hasDevice && status === 'disconnected'

  /**
   * The bar's own name, which is the device's when there is one.
   *
   * `summarise` answers "No device" for an absent model, which is the right
   * answer for a field called `model` and the wrong one for this row: the
   * empty state below it says so, and the bar names the *thing*. With nothing
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
        {/* With nothing granted the empty state below holds Add device, so
            there is no menu to open yet. */}
        {manager.hasDevice && <DeviceMenu manager={manager} active={active} />}
      </div>

      {reconnectable && (
        <div className="flex shrink-0 items-center">
          <ReconnectButton manager={manager} />
        </div>
      )}
    </header>
  )
}

/**
 * Back to the device the app already knows, without a picker when it can be:
 * `autoConnect` reopens the granted port it last used. When that finds nothing
 * to reopen, the serial picker is the way back in.
 */
function ReconnectButton({
  manager,
  slot,
  className,
}: {
  manager: DeviceManager
  slot?: string
  className?: string
}) {
  const reconnect = async () => {
    if (!(await manager.autoConnect())) await manager.connect()
  }
  return (
    <Button size="sm" data-slot={slot} className={className} onClick={() => void reconnect()}>
      Reconnect
    </Button>
  )
}
