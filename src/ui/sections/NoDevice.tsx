import { RiHeadphoneLine } from '@remixicon/react'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { DeviceManager, ActiveDevice } from '@/core/manager'
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
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiHeadphoneLine />
        </EmptyMedia>
        <EmptyTitle>No device connected</EmptyTitle>
        <EmptyDescription>
          {unsupported
            ? 'This browser has no Web Serial API, so it cannot reach your headphones. Use Chrome, Edge or another Chromium browser.'
            : 'Connect a pair of headphones to get started. Which controls appear depends on what your headphones report.'}
        </EmptyDescription>
      </EmptyHeader>
      {!unsupported && (
        <EmptyContent className="max-w-56">
          <ConnectionControls manager={manager} active={active} />
        </EmptyContent>
      )}
    </Empty>
  )
}
