import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

/** The devices the earbuds are connected to. Read-only: this protocol path has no switch command wired up. */
export function HeyMelodyDevices({ state }: Props) {
  const connected = state.peers.filter((peer) => peer.connected)

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Connected devices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {connected.length === 0 ? (
            <p className="text-muted-foreground">No other devices connected.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {connected.map((peer) => (
                <li key={peer.mac} className="flex items-center justify-between gap-2">
                  <span className="truncate">{peer.name}</span>
                  <span className="flex shrink-0 gap-1">
                    {peer.isThisDevice && <Badge variant="secondary">This device</Badge>}
                    {peer.audioActive && <Badge variant="secondary">Playing audio</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">Switching devices from here isn't supported yet.</p>
        </CardContent>
      </Card>
    </div>
  )
}
