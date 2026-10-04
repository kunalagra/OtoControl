import { RiHeadphoneLine } from '@remixicon/react'

import { Card } from '@/components/ui/card'
import type { DeviceManager, ActiveDevice } from '@/core/manager'
import { AddDevice } from '../layout/DeviceMenu'

interface Props {
  manager: DeviceManager
  active: ActiveDevice
}

/**
 * What the app shows before any device is known — spec §3.2, DESIGN-GUIDE §5.13.
 *
 * Deliberately not a greyed-out copy of one brand's controls. Which sections
 * exist depends entirely on what the device reports, so rendering a Momentum
 * noise dial to someone who has not connected anything states something we do
 * not know. An empty state says the true thing instead — and it is the fourth
 * place the dotted texture belongs, so this is the one screen where a page with
 * no data on it still has a showpiece (DESIGN-GUIDE §1.4).
 *
 * The way in is `AddDevice`, the same block the device menu holds, so the
 * first device and the next one are added the same way: serial first, and
 * Bluetooth behind "My device isn't listed".
 */
export function NoDevice({ manager, active }: Props) {
  // Nothing to connect *with*, so there is nothing to offer: the hero keeps its
  // heading and says which browser would work instead.
  const unsupported = active.state.status === 'unsupported'

  return (
    <Card
      variant="hero"
      data-slot="no-device"
      // `flex-1` and no `min-h-0`: the hero fills the body, and on a short
      // screen it is the one thing on the page, so it grows past the viewport
      // and the page scrolls rather than the block clipping its own buttons.
      className="flex-1 justify-center"
    >
      {/* The block's own padding is the padding (14px on a phone, 18px from
          `md`); this is the measure, not the inset. */}
      <div className="flex w-full flex-col items-center justify-center gap-4 text-center md:gap-5">
        <RiHeadphoneLine aria-hidden className="text-foreground/30 size-24 shrink-0" />

        {/* An `h2` under the top bar's `h1`, which names the app here — the
            status token beside it is what says "No device" (spec §4.4). */}
        <h2 className="text-[30px] leading-[1.05] font-[850] tracking-[-.03em] text-balance">
          Connect your headphones
        </h2>

        <p className="text-muted-foreground max-w-[54ch] text-[13px] text-balance">
          {unsupported
            ? 'This browser has no Web Serial API, so it cannot reach your headphones.'
            : 'Connect a pair of headphones. The controls shown depend on what they report.'}
        </p>

        {!unsupported && (
          // A menu is a column; this is a pair of buttons, and 320px is as wide
          // as a button should be at any of the widths this renders at.
          <div className="mt-1 w-full max-w-xs">
            <AddDevice manager={manager} status={active.state.status} />
          </div>
        )}
      </div>
    </Card>
  )
}
