import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EQ_CUSTOM_ID, EQ_PRESETS } from '@/drivers/soundcore/commands'
import type { SoundcoreDevice } from '@/drivers/soundcore/device'
import type { SoundcoreState } from '@/drivers/soundcore/device'
import { Fader } from '@/ui/controls/Fader'

interface Props {
  device: SoundcoreDevice
  state: SoundcoreState
}

/** The wire clamps each band at −12.0…+6.0 dB; gains travel as signed tenths. */
const DB_RANGE = { min: -12, max: 6 }

const REGULAR_PRESETS = EQ_PRESETS.filter((preset) => !preset.artist)
const ARTIST_PRESETS = EQ_PRESETS.filter((preset) => preset.artist)

export function SoundcoreSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const eq = state.eq

  const preset = eq ? EQ_PRESETS.find((candidate) => candidate.id === eq.profile) : undefined
  const custom = eq?.profile === EQ_CUSTOM_ID
  // The protocol writes both ears in one packet: a linked edit sends the
  // same curve twice, and when the ears already differ an edit restates the
  // left and leaves the right untouched.
  const perSide =
    custom && (eq!.left.length !== eq!.right.length || eq!.left.some((value, band) => value !== eq!.right[band]))

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Equalizer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {eq === null ? (
            <p className="text-muted-foreground text-sm">
              {state.status === 'connected'
                ? 'The device did not report an equalizer.'
                : 'Connect to load the equalizer.'}
            </p>
          ) : (
            <>
              {/* The fader row IS the visualization. Locked while a preset
                  plays — its curve comes from the table, not from you — and
                  unlocked only under Custom. */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between gap-1">
                  {eq.left.map((tenths, band) => (
                    <Fader
                      key={band}
                      value={tenths / 10}
                      range={DB_RANGE}
                      step={0.5}
                      disabled={disabled || !custom || eq.left.length !== 8}
                      label={`Band ${band + 1} gain`}
                      caption={`${band + 1}`}
                      height={104}
                      onChange={(db) => {
                        const left = [...eq.left];
                        left[band] = Math.round(db * 10);
                        void device.setEqCustom(left, perSide ? eq.right : left);
                      }}
                    />
                  ))}
                </div>
                <p className="text-muted-foreground min-h-4 text-xs">
                  {!custom
                    ? preset?.artist
                      ? `${preset.name} — curve stored on the earbuds`
                      : `${preset?.name ?? 'Preset'} — pick Custom to edit`
                    : perSide
                      ? 'Custom — the ears differ; the faders edit the left'
                      : 'Custom — both ears together'}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <PresetGroup
                  label="Presets"
                  presets={REGULAR_PRESETS}
                  activeId={eq.profile}
                  disabled={disabled}
                  onSelect={(id) => void device.setEqPreset(id)}
                />
                <PresetGroup
                  label="Artist — stored on the earbuds"
                  presets={ARTIST_PRESETS}
                  activeId={eq.profile}
                  disabled={disabled}
                  onSelect={(id) => void device.setEqPreset(id)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * One labelled row of preset pills.
 *
 * The groups are visually separate but semantically one choice — only one
 * profile can be active — so each group reports the shared active id and
 * ignores deselects (an empty selection would mean no profile at all, which
 * the wire has no concept of).
 */
function PresetGroup({
  label,
  presets,
  activeId,
  disabled,
  onSelect,
}: {
  label: string
  presets: typeof REGULAR_PRESETS
  activeId: number
  disabled: boolean
  onSelect(id: number): void
}) {
  const active = presets.find((preset) => preset.id === activeId)
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={2}
        className="w-full flex-wrap"
        value={active ? [String(active.id)] : []}
        disabled={disabled}
        aria-label={label}
        onValueChange={(values: string[]) => {
          if (values.length === 0) return
          onSelect(Number(values[values.length - 1]))
        }}
      >
        {presets.map((preset) => (
          <ToggleGroupItem key={preset.id} value={String(preset.id)} className="rounded-full">
            {preset.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
