import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import type { NothingCapability, NothingDevice, NothingState } from '@/drivers/nothing/device'
import { profileFor } from '@/core/profiles'
import { SystemTail } from '@/ui/sections/SystemTail'
import { SettingRow } from '@/ui/controls/SettingRow'
import { DeviceInfoPanel } from '@/ui/panels/DeviceInfoPanel'

interface Props {
  device: NothingDevice
  state: NothingState
}

/** The capabilities worth naming when listing what the probe found. */
const NAMED_CAPABILITIES: Array<[NothingCapability, string]> = [
  ['battery', 'Battery'],
  ['anc', 'Noise control'],
  ['eq', 'Equalizer presets'],
  ['customEq', 'Custom equalizer'],
  ['advancedEq', 'Advanced EQ'],
  ['diracEq', 'Dirac Opteo EQ'],
  ['enhancedBass', 'Bass enhance'],
  ['inEarDetection', 'In-ear detection'],
  ['latency', 'Low latency'],
  ['personalizedAnc', 'Personalized ANC'],
  ['gestures', 'Gesture assignment'],
  ['earFitTest', 'Ear tip fit test'],
  ['caseLed', 'Case LED'],
]

/** Gesture inputs a bud recognises, with the actions ear-web can assign. */
const GESTURE_TYPES: Array<[number, string]> = [
  [2, 'Double pinch'],
  [3, 'Triple pinch'],
  [7, 'Pinch and hold'],
  [9, 'Double pinch and hold'],
]

const GESTURE_ACTIONS: Array<[number, string]> = [
  [8, 'Play / pause'],
  [9, 'Next track'],
  [11, 'Previous track'],
  [18, 'Volume down'],
  [19, 'Volume up'],
  [1, 'Voice assistant'],
  [10, 'ANC cycle'],
]

const fitLabel = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  // ear-web shows the raw byte; 1 is the only "good" value observed.
  return value === 1 ? 'Good fit' : `Result ${value}`;
}

export function NothingSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  const cell = (value: { level: number; charging: boolean } | null): string =>
    value === null ? '—' : `${value.level}%${value.charging ? ' ⚡' : ''}`

  const details: Array<[string, string]> = [
    ['Model', state.info.model ?? 'Unknown (Nothing/CMF)'],
    ['Firmware', state.info.firmware ?? '—'],
    ['Left earbud', cell(state.battery.left)],
    ['Right earbud', cell(state.battery.right)],
    ['Case', cell(state.battery.case)],
  ]

  const capabilities = (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Probed capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">
          Nothing reports no capability table — each feature was asked for, and
          one the model lacks simply did not answer.
        </p>
      </CardHeader>
      <CardContent>
        {state.capabilities.size === 0 ? (
          <p className="text-muted-foreground text-sm">Connect to probe the device.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {NAMED_CAPABILITIES.filter(([id]) => state.capabilities.has(id)).map(([id, name]) => (
              <span
                key={id}
                className="border-primary/40 bg-primary/10 rounded-full border px-2.5 py-1 text-xs"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  const hasInEar = state.capabilities.has('inEarDetection')
  const hasGestures = state.capabilities.has('gestures')
  const hasEarFit = state.capabilities.has('earFitTest')

  return (
    <div className="flex flex-col gap-4">
      <DeviceInfoPanel
        rows={details.map(([label, value]) => ({ label, value }))}
        footnote={
          state.info.model === null
            ? 'The model is not readable over serial — it is remembered from the Nothing app only if a snapshot names it.'
            : undefined
        }
      />

      {hasInEar && (
        <Card data-size="sm">
          <CardContent>
            <SettingRow
              label="In-ear detection"
              hint="Plays only while the buds are in your ears."
            >
              <Switch
                checked={state.inEarDetection === true}
                disabled={disabled || state.inEarDetection === null}
                onCheckedChange={(on) => void device.setInEarDetection(on)}
              />
            </SettingRow>
          </CardContent>
        </Card>
      )}

      {hasGestures && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Gestures</CardTitle>
            <p className="text-muted-foreground text-xs">
              What each pinch does, per bud.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {[2, 3].map((bud) => (
              <div key={bud} className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  {bud === 2 ? 'Left bud' : 'Right bud'}
                </span>
                {GESTURE_TYPES.map(([type, label]) => {
                  const current = state.gestures?.find(
                    (g) => g.device === bud && g.type === type,
                  )
                  return (
                    <SettingRow key={type} label={label}>
                      <select
                        className="border-border bg-background rounded-md border px-2 py-1.5 text-sm"
                        value={current?.action ?? ''}
                        disabled={disabled}
                        aria-label={`${label}, ${bud === 2 ? 'left' : 'right'} bud`}
                        onChange={(event) =>
                          void device.setGesture({
                            device: bud,
                            common: current?.common ?? 1,
                            type,
                            action: Number(event.target.value),
                          })
                        }
                      >
                        <option value="" disabled>
                          Not reported
                        </option>
                        {GESTURE_ACTIONS.map(([action, name]) => (
                          <option key={action} value={action}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                  )
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Find my earbuds</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
            onClick={() => void device.ringBuds(true, true)}
          >
            Ring left
          </button>
          <button
            type="button"
            disabled={disabled}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
            onClick={() => void device.ringBuds(true)}
          >
            Ring right
          </button>
          <button
            type="button"
            disabled={disabled}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
            onClick={() => void device.ringBuds(false, true)}
          >
            Stop
          </button>
        </CardContent>
      </Card>

      {hasEarFit && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Ear tip fit test</CardTitle>
            <p className="text-muted-foreground text-xs">
              Takes a few seconds per bud; the buds play a chime while testing.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <button
              type="button"
              disabled={disabled}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
              onClick={() => void device.startEarFitTest()}
            >
              Start test
            </button>
            {state.earFitResult && (
              <p className="text-muted-foreground text-sm">
                Left: {fitLabel(state.earFitResult.left)} · Right:{' '}
                {fitLabel(state.earFitResult.right)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <SystemTail capabilities={capabilities} profile={profileFor('nothing', state.info.model)} />
    </div>
  )
}
