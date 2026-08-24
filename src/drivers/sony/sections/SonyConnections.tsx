import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingRow } from '@/ui/controls/SettingRow'
import type { SonyDevice, SonyState } from '../sony'

interface Props {
  device: SonyDevice
  state: SonyState
}

/**
 * The headphones' own paired-device list and audio routing — the phone app's
 * "multipoint connection" screens. Not the same as the pairings the OS
 * knows about.
 */
export function SonyConnections({ device, state }: Props) {
  const connections = state.connections
  const disabled = state.status !== 'connected'

  if (connections === null) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">
            These headphones do not report pairing-device management.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { devices, playbackMac, playbackFixed } = connections

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Paired devices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {devices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {disabled ? 'Connect to load the paired-device list.' : 'No paired devices.'}
            </p>
          ) : (
            <ul className="flex flex-col">
              {devices.map((entry) => {
                const isPlayback = entry.mac === playbackMac
                return (
                  <li
                    key={entry.mac}
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
                      <span className="truncate text-sm font-medium">{entry.name || entry.mac}</span>
                      <span className="text-muted-foreground text-xs">
                        {entry.connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>

                    {isPlayback && (
                      <Badge variant="secondary" className="shrink-0">
                        Audio here
                      </Badge>
                    )}

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          void device.setPairedDeviceConnected(entry.mac, !entry.connected)
                        }
                        className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                      >
                        {entry.connected ? 'Disconnect' : 'Connect'}
                      </button>
                      <button
                        type="button"
                        disabled={disabled || isPlayback}
                        onClick={() => void device.setPlaybackDevice(entry.mac)}
                        className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline disabled:opacity-40"
                      >
                        Route audio
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {playbackFixed !== null && (
            <SettingRow
              label="Keep audio routed"
              hint="Pin playback to the current device instead of following whichever connects next."
            >
              <Switch
                checked={playbackFixed === true}
                disabled={disabled || playbackFixed === null}
                onCheckedChange={(enabled) => void device.setPlaybackFixed(enabled)}
              />
            </SettingRow>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
