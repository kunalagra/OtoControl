import { RiLinkM } from '@remixicon/react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { ActiveDevice, DeviceManager } from '@/core/manager'

import { ConnectionControls } from './ConnectionControls'
import { useActionMenu } from './useActionMenu'

interface ConnectionMenuProps {
  manager: DeviceManager
  active: ActiveDevice
}

const STATE_LABELS: Record<string, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  disconnected: 'Offline',
  unsupported: 'Unsupported',
}

/**
 * The rail's connection button: its face says whether the headphones are
 * live, and behind it is every connection action — connect, refresh,
 * disconnect, add another device — so the top bar keeps only the status and a
 * Reconnect for when a known device has gone away.
 *
 * Desktop only. A phone has no rail, and its top bar's ⋯ menu holds the same
 * `ConnectionControls`.
 */
export function ConnectionMenu({ manager, active }: ConnectionMenuProps) {
  const status = active.state.status
  const menu = useActionMenu()
  const label = STATE_LABELS[status] ?? status

  return (
    <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-slot="connection-menu"
            aria-label={`Connection: ${label}. Open connection actions.`}
            className={cn(
              'flex w-16 flex-col items-center gap-1 rounded-2xl py-2.5 text-muted-foreground outline-none',
              'transition-colors duration-150 ease-out hover:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              menu.open && 'bg-surface-raised text-foreground',
            )}
          >
            <span className="relative">
              {status === 'connecting' ? <Spinner className="size-5" /> : <RiLinkM className="size-5" />}
              {/* Filled red while live, hollow otherwise: the dot is never the
                  only signal — the label below says the same in words. */}
              <span
                aria-hidden
                className={cn(
                  'absolute -right-1 -top-0.5 size-2 rounded-full',
                  status === 'connected' ? 'bg-signal' : 'border border-muted-foreground bg-background',
                )}
              />
            </span>
            <span className="text-[9px] uppercase tracking-[.1em]">{label}</span>
          </button>
        }
      />
      <PopoverContent side="right" align="end" className="w-64 p-3" onClick={menu.closeOnAction}>
        <ConnectionControls manager={manager} active={active} />
      </PopoverContent>
    </Popover>
  )
}
