import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { AncLevel } from '@/drivers/nothing/commands'
import type { NothingDevice, NothingState } from '@/drivers/nothing/device'
import { SettingRow } from '@/ui/controls/SettingRow'

interface Props {
  device: NothingDevice
  state: NothingState
}

/** ear-web's six levels, grouped the way the official app presents them. */
const LEVELS = [
  { value: AncLevel.Off, label: 'Off', hint: 'No processing' },
  { value: AncLevel.Transparency, label: 'Transparency', hint: 'Lets the room through' },
  { value: AncLevel.NcLow, label: 'Noise cancelling · low' },
  { value: AncLevel.NcMid, label: 'Noise cancelling · medium' },
  { value: AncLevel.NcHigh, label: 'Noise cancelling · high' },
  { value: AncLevel.Adaptive, label: 'Adaptive', hint: 'Adjusts to your surroundings' },
]

export function NothingNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const hasAnc = state.capabilities.has('anc')
  const hasPersonalized = state.capabilities.has('personalizedAnc')

  if (!hasAnc && !hasPersonalized) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This device reports no noise control.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {hasAnc && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Noise control</CardTitle>
          </CardHeader>
          <CardContent>
            {state.anc === null ? (
              <p className="text-muted-foreground text-sm">
                {state.status === 'connected'
                  ? 'The device did not answer the noise control query.'
                  : 'Connect to load noise control.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {LEVELS.map(({ value, label, hint }) => (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={state.anc === value}
                    onClick={() => void device.setAncLevel(value)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      'focus-visible:ring-ring outline-none focus-visible:ring-2',
                      'disabled:cursor-default disabled:opacity-50',
                      state.anc === value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-muted-foreground/40',
                    )}
                  >
                    <span className="text-sm font-medium">{label}</span>
                    {hint && (
                      <span className="text-muted-foreground text-[11px] leading-tight">{hint}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasPersonalized && (
        <Card data-size="sm">
          <CardContent>
            <SettingRow
              label="Personalized ANC"
              hint="Tunes the cancellation to the shape of your ears. Ear (2) only."
            >
              <Switch
                checked={state.personalizedAnc === true}
                disabled={disabled || state.personalizedAnc === null}
                onCheckedChange={(on) => void device.setPersonalizedAnc(on)}
              />
            </SettingRow>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
