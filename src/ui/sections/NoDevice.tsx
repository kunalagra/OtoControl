import { RiHeadphoneLine } from '@remixicon/react'

import { Card, CardContent } from '@/components/ui/card'
import type { DeviceManager } from '@/device/manager'
import type { ActiveDevice } from '@/device/manager'
import { ConnectionControls } from '../layout/Sidebar'

interface Props {
  manager: DeviceManager
  active: ActiveDevice
}

/**
 * What the app shows before any device is known.
 *
 * Deliberately not a greyed-out copy of one brand's controls. Which sections
 * exist depends entirely on what the device reports, so rendering a Momentum
 * noise dial to someone who has not connected anything states something we do
 * not know. An empty state says the true thing instead.
 */
export function NoDevice({ manager, active }: Props) {
  const unsupported = active.state.status === 'unsupported'

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <RiHeadphoneLine className="text-muted-foreground/40 size-12" />

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">No device connected</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {unsupported
              ? 'This browser has no Web Serial API, so it cannot reach your headphones. Use Chrome, Edge or another Chromium browser.'
              : 'Connect a pair of headphones to get started. Which controls appear depends on what your headphones report.'}
          </p>
        </div>

        {!unsupported && (
          <div className="w-full max-w-56">
            <ConnectionControls manager={manager} active={active} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
