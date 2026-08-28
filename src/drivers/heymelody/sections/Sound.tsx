import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodySound({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  // Only assert absence once something has actually been probed — before that,
  // fall through to the "Connect to load..." / "did not answer" messaging below.
  if (state.capabilities.size > 0 && !state.capabilities.has('eq')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  // The optimistic write in `setEqPreset` patches `eqCurrentPreset`, not any
  // preset's own `isSelected` — that flag only ever comes from the device's
  // last `0x0122` reply. Preferring the optimistic field is what makes a click
  // show up immediately; falling back to `isSelected` is what shows the
  // device's own answer before any click has happened.
  //
  // Note: `0x010F` (QueryEqCurrent, `eqCurrentPreset`'s source) is documented
  // as a "preset index", while `eqId` is a per-preset byte from `0x0122`
  // (QueryEqAll). Comparing them assumes both share one namespace — an
  // untested assumption, not confirmed by the spec.
  const selectedEqId = state.eqCurrentPreset ?? state.eqPresets.find((p) => p.isSelected)?.eqId ?? null

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent>
        {state.eqPresets.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The device did not return an EQ preset list.'
              : 'Connect to load the equalizer.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {state.eqPresets.map((preset) => (
              <button
                key={preset.eqId}
                type="button"
                disabled={disabled}
                aria-pressed={selectedEqId === preset.eqId}
                onClick={() => void device.setEqPreset(preset.eqId)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2',
                  'disabled:cursor-default disabled:opacity-50',
                  selectedEqId === preset.eqId
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'border-border hover:border-muted-foreground/40',
                )}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
