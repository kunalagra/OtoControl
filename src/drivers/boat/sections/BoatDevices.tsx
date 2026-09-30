import type { BoatDevice, BoatState } from '@/drivers/boat/device'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  device: BoatDevice
  state: BoatState
}

/** The buds' own paired-device table (cmd 51, infos 25/26). Read-only. */
export function BoatDevices({ state }: Props) {
  const peers = state.peers ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
      </CardHeader>
      <CardContent>
        {peers.length === 0 ? (
          <p>No paired devices reported yet.</p>
        ) : (
          <ul>
            {peers.map((peer) => (
              <li key={peer.mac}>
                {peer.name || peer.mac} · {peer.mac}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
