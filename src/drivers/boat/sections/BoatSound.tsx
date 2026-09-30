import { useState } from 'react'
import type { BoatDevice, BoatState } from '@/drivers/boat/device'
import { EQ_BAND_COUNT, EQ_CUSTOM_START } from '@/drivers/boat/commands'
import { SettingRow } from '@/ui/controls/SettingRow'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  device: BoatDevice
  state: BoatState
}

/**
 * The curve the buds are playing (`[N][mode][gains]`), and a custom-curve
 * editor writing index 0 (`CustomEqRequest(0, gains)` → mode 32). Preset
 * names are not offered: the wire carries mode bytes, not names, and
 * inventing a table would be fabrication.
 */
export function BoatSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const live = state.eq?.gains ?? new Array<number>(EQ_BAND_COUNT).fill(0)
  const [draft, setDraft] = useState<number[] | null>(null)
  const gains = draft ?? live
  const modeLabel = state.eq === null ? 'Not reported yet.' : state.eq.custom
    ? `Custom ${state.eq.mode - EQ_CUSTOM_START}`
    : `Preset ${state.eq.mode}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sound</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingRow label="Playing" hint={modeLabel}>
          <span aria-hidden />
        </SettingRow>
        {gains.map((gain, i) => (
          <SettingRow key={i} label={`Band ${i + 1}`} hint={String(gain)}>
            <input
              type="range"
              min={-127}
              max={127}
              value={gain}
              disabled={disabled}
              onChange={(event) => {
                const next = [...gains]
                next[i] = Number(event.target.value)
                setDraft(next)
              }}
            />
          </SettingRow>
        ))}
        <Button
          disabled={disabled || draft === null}
          onClick={() => {
            if (draft) void device.setEq(0, draft, true).finally(() => setDraft(null))
          }}
        >
          Apply custom curve
        </Button>
      </CardContent>
    </Card>
  )
}
