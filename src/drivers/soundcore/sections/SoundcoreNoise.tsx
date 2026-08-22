import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AncScene, CurrentMode, TransparencyMode } from '@/drivers/soundcore/commands'
import type { SoundcoreDevice, SoundcoreState } from '@/drivers/soundcore/device'
import { SettingRow } from '@/ui/controls/SettingRow'

interface Props {
  device: SoundcoreDevice
  state: SoundcoreState
}

const MODES = [
  { value: CurrentMode.Normal, label: 'Normal', hint: 'No processing' },
  { value: CurrentMode.Anc, label: 'Noise cancelling', hint: 'Blocks what is around you' },
  { value: CurrentMode.Transparency, label: 'Transparency', hint: 'Lets the room through' },
]

const ANC_SCENES = [
  { value: AncScene.Transport, label: 'Transport' },
  { value: AncScene.Outdoor, label: 'Outdoor' },
  { value: AncScene.Indoor, label: 'Indoor' },
  { value: AncScene.Custom, label: 'Custom' },
]

const TRANSPARENCY_MODES = [
  { value: TransparencyMode.FullyTransparent, label: 'Fully transparent' },
  { value: TransparencyMode.Vocal, label: 'Vocal' },
]

export function SoundcoreNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const mode = state.soundMode

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Noise control</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mode === null ? (
            <p className="text-muted-foreground text-sm">
              {state.status === 'connected'
                ? 'The device did not report a sound mode.'
                : 'Connect to load noise control.'}
            </p>
          ) : (
            <>
              {/* The three-way listening mode. Deselects are ignored — the
                  device is always in one of these modes. */}
              <ToggleGroup
                variant="outline"
                spacing={2}
                className="w-full [&>*>span]:flex [&>*>*>span]:flex [&_[data-slot=toggle-group-item]]:h-auto [&_[data-slot=toggle-group-item]]:w-full [&_[data-slot=toggle-group-item]]:flex-col [&_[data-slot=toggle-group-item]]:items-start [&_[data-slot=toggle-group-item]]:gap-0.5 [&_[data-slot=toggle-group-item]]:px-2.5 [&_[data-slot=toggle-group-item]]:py-2"
                value={[String(mode.current)]}
                disabled={disabled}
                aria-label="Listening mode"
                onValueChange={(values: string[]) => {
                  if (values.length === 0) return
                  void device.setSoundMode({ current: Number(values[values.length - 1]) })
                }}
              >
                {MODES.map(({ value, label, hint }) => (
                  <ToggleGroupItem key={value} value={String(value)} aria-label={label}>
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-muted-foreground text-[11px] leading-tight">{hint}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {mode.current === CurrentMode.Anc && (
                <SettingRow label="Scene" hint="Tuned for where you are.">
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    spacing={2}
                    className="flex-wrap justify-end"
                    value={[String(mode.ancScene)]}
                    disabled={disabled}
                    aria-label="Noise cancelling scene"
                    onValueChange={(values: string[]) => {
                      if (values.length === 0) return
                      void device.setSoundMode({ ancScene: Number(values[values.length - 1]) })
                    }}
                  >
                    {ANC_SCENES.map(({ value, label }) => (
                      <ToggleGroupItem key={value} value={String(value)} className="rounded-full">
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </SettingRow>
              )}

              {mode.current === CurrentMode.Transparency && (
                <SettingRow label="Transparency" hint="What comes through.">
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    spacing={2}
                    className="flex-wrap justify-end"
                    value={[String(mode.transparency)]}
                    disabled={disabled}
                    aria-label="Transparency mode"
                    onValueChange={(values: string[]) => {
                      if (values.length === 0) return
                      void device.setSoundMode({ transparency: Number(values[values.length - 1]) })
                    }}
                  >
                    {TRANSPARENCY_MODES.map(({ value, label }) => (
                      <ToggleGroupItem key={value} value={String(value)} className="rounded-full">
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </SettingRow>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
