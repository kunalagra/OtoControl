import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodyNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  // Only assert absence once something has actually been probed — before that,
  // fall through to the "Connect to load..." / "did not answer" messaging below.
  if (state.capabilities.size > 0 && !state.capabilities.has('anc')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no noise control.</p>
        </CardContent>
      </Card>
    )
  }

  const supportedModes = state.ancSupportedModes
  const hasModes = supportedModes !== null && supportedModes.length > 0
  // `ancSupportedModes` and `ancLevel` are mutually exclusive per DTO variant
  // (spec §3.6): `mType==1` gives a bitmask into `ancSupportedModes`, leaving
  // `ancLevel` null; `mType==2` gives a single `ancLevel`, leaving
  // `ancSupportedModes` null. A device that only ever reports `mType==2` still
  // has something to show — just not a button grid, since the valid range for
  // that variant's level was never captured.
  const hasLevelOnly = !hasModes && state.ancLevel !== null

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Noise control</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasModes && !hasLevelOnly ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The device did not answer the noise control query.'
              : 'Connect to load noise control.'}
          </p>
        ) : hasLevelOnly ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Current level </span>
            {state.ancLevel}
          </p>
        ) : hasModes && supportedModes ? (
          <div className="grid grid-cols-2 gap-2">
            {supportedModes.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                aria-pressed={state.ancLevel === mode}
                onClick={() => void device.setAncMode(mode)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2',
                  'disabled:cursor-default disabled:opacity-50',
                  state.ancLevel === mode
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/40',
                )}
              >
                {/* The device reports which mode indices exist but never
                    names them, and the bit-index -> label mapping was never
                    captured (spec §7) — a numbered mode is the honest label
                    until that mapping is confirmed against hardware. */}
                <span className="text-sm font-medium">Mode {mode}</span>
              </button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
