import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { SectionProps } from './types'

/**
 * The headphones' own paired-device list — what the phone app calls connection
 * management. Not the same as the Bluetooth pairings the OS knows about.
 */
export function Devices({ device, state }: SectionProps) {
  const { devices, maxConnections, ownIndex } = state.connections
  const disabled = state.status !== 'connected'
  const connectedCount = devices.filter((entry) => entry.connected).length

  return (
    <Card data-size="sm">
      <CardContent className="flex flex-col gap-4">
        {devices.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The headphones did not return a paired-device list.'
              : 'Connect to load the paired-device list.'}
          </p>
        ) : (
          <>
            <ul className="flex flex-col">
              {devices.map((entry) => {
                const isSelf = entry.index === ownIndex
                return (
                  <li
                    key={entry.index}
                    className="border-border flex items-center gap-3 border-b py-2 last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        entry.connected ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                    />

                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {entry.name || `Device ${entry.index + 1}`}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {entry.connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>

                    {isSelf && (
                      <Badge variant="secondary" className="shrink-0">
                        This Mac
                      </Badge>
                    )}

                    {/* Disconnecting ourselves would drop the control link this
                        page runs on, so that action is withheld. */}
                    {isSelf && entry.connected ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          void device.setDeviceConnected(entry.index, !entry.connected)
                        }
                      >
                        {entry.connected ? 'Disconnect' : 'Connect'}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>

            <p className="text-muted-foreground text-xs">
              {connectedCount} connected
              {maxConnections !== null && ` of ${maxConnections} at once`}
              {maxConnections !== null && maxConnections > 1 && ' · multipoint'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
