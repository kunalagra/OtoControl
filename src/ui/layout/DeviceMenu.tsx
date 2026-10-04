import { useState } from 'react'
import { RiArrowDownSLine, RiCheckLine, RiRefreshLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { isWebBluetoothSupported } from '@/core/gattTransport'
import type { ConnectionStatus } from '@/core/connection'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { M4_SERVICE_UUID } from '@/core/transport'
import { cn } from '@/lib/utils'

import { useActionMenu } from './useActionMenu'

interface Props {
  manager: DeviceManager
  active: ActiveDevice
}

/**
 * The menu beside the device name: whether it is live, the granted devices to
 * switch between, adding a new one, and refresh / disconnect.
 *
 * One place for all of it, on every width. It replaced three controls that said
 * the same thing twice over — a LIVE token in the bar, the rail's connection
 * button and the phone's ⋯ menu — and it is shown with a single device too,
 * because adding the next one starts here.
 */
export function DeviceMenu({ manager, active }: Props) {
  const menu = useActionMenu()
  const status = active.state.status
  const available = manager.available
  const current = currentUuid(manager, active)

  return (
    <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Devices and connection"
            data-slot="device-menu-trigger"
            // The 44px floor as hit slop on a phone, the guide's 32px from `md`.
            className="text-muted-foreground hover:text-foreground min-h-11 min-w-11 md:min-h-8 md:min-w-8"
          >
            {status === 'connecting' ? <Spinner className="size-4" /> : <RiArrowDownSLine />}
          </Button>
        }
      />
      <PopoverContent align="start" className="flex w-72 flex-col gap-3 p-3" onClick={menu.closeOnAction}>
        {/* Connected needs no word for it: the page is live, and Refresh and Disconnect below only exist then.
            The other states are worth saying, since nothing else in the bar says them. */}
        {status !== 'connected' && <StatusLine status={status} />}

        {available.length > 1 && (
          <ul className="flex flex-col gap-0.5" aria-label="Devices">
            {available.map(({ uuid, label }) => {
              const isCurrent = uuid === current
              return (
                <li key={uuid}>
                  <button
                    type="button"
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => {
                      if (!isCurrent) void manager.select(uuid)
                    }}
                    className={cn(
                      'flex min-h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm md:min-h-8',
                      'hover:bg-surface-raised focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      isCurrent && 'font-semibold',
                    )}
                  >
                    {label}
                    {isCurrent && <RiCheckLine aria-hidden className="size-4" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-border border-t pt-3">
          <AddDevice manager={manager} status={status} />
        </div>

        {status === 'connected' && (
          <div className="border-border flex gap-2 border-t pt-3">
            <Button variant="outline" size="sm" className="min-h-11 flex-1 md:min-h-0" onClick={() => void manager.refresh()}>
              <RiRefreshLine data-icon="inline-start" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11 flex-1 md:min-h-0" onClick={() => void manager.disconnect()}>
              Disconnect
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Adding a device: the serial picker first, since nearly every brand answers
 * there, and Bluetooth behind "My device isn't listed" — people reached for
 * Bluetooth by default, and it is only right for Soundcore and some Nothing
 * models. Shared with the empty state, so both ask the question the same way.
 */
export function AddDevice({ manager, status }: { manager: DeviceManager; status: ConnectionStatus }) {
  const [showBluetooth, setShowBluetooth] = useState(false)
  const connecting = status === 'connecting'
  const bluetooth = isWebBluetoothSupported()

  return (
    <div data-slot="add-device" className="flex flex-col gap-2">
      <Button className="min-h-11 w-full md:min-h-0" disabled={connecting} onClick={() => void manager.connect()}>
        {connecting ? (
          <>
            <Spinner data-icon="inline-start" />
            Connecting
          </>
        ) : (
          'Add device'
        )}
      </Button>
      {showBluetooth ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-[12px]">
            Soundcore and some Nothing models connect over Bluetooth instead. The buds may need to be advertising:
            open the case.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 w-full md:min-h-0"
            disabled={connecting || !bluetooth}
            title={bluetooth ? undefined : 'This browser has no Web Bluetooth API.'}
            onClick={() => void manager.connectBluetooth()}
          >
            Connect over Bluetooth
          </Button>
        </div>
      ) : (
        <button
          type="button"
          data-keep-open
          aria-expanded={false}
          onClick={() => setShowBluetooth(true)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring self-center rounded px-1 text-[12px] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          My device isn’t listed
        </button>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  unsupported: 'Unsupported browser',
}

/** The connection state when it is not simply live: connecting, disconnected or an unsupported browser. */
function StatusLine({ status }: { status: ConnectionStatus }) {
  return (
    <p
      data-slot="device-menu-status"
      data-state={status}
      className={cn(
        'flex items-center gap-1.5 text-[11px] uppercase tracking-[.1em]',
        status === 'connected' ? 'text-signal-strong font-bold' : 'text-muted-foreground',
      )}
    >
      {status === 'connected' && <span aria-hidden className="bg-signal size-2 rounded-full" />}
      {status === 'connecting' && <Spinner className="size-3" />}
      {STATUS_LABEL[status]}
    </p>
  )
}

/** The granted entry in use, identified by brand — as precise as a port's service ID allows. */
function currentUuid(manager: DeviceManager, active: ActiveDevice): string | undefined {
  const available = manager.available
  return (
    available.find((entry) => entry.brand === active.driver.brand)?.uuid ??
    (active.driver.brand === 'sennheiser' ? M4_SERVICE_UUID : available[0]?.uuid)
  )
}
