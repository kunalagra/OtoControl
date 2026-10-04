import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

/** Every device the earbuds are paired with, each marked connected or not. Read-only: this protocol path has no switch command wired up. */
export function HeyMelodyDevices({ state }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Paired devices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {state.peers.length === 0 ? (
            <p className="text-muted-foreground">No paired devices.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.peers.map((peer) => (
                <li key={peer.mac} className="flex items-center justify-between gap-2">
                  <span className="truncate">{peer.name}</span>
                  <span className="flex shrink-0 gap-1">
                    <Badge variant={peer.connected ? 'default' : 'outline'}>{peer.connected ? 'Connected' : 'Not connected'}</Badge>
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
