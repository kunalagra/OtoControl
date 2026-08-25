import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { NothingCapability, NothingDevice, NothingState } from '@/drivers/nothing/device'
import { profileFor } from '@/core/profiles'
import { SystemTail } from '@/ui/sections/SystemTail'
import { SettingRow } from '@/ui/controls/SettingRow'
import { DeviceInfoPanel } from '@/ui/panels/DeviceInfoPanel'
import { modelForBase } from '@/drivers/nothing/models'
import { nothingHasColourRender } from '@/drivers/nothing/artwork'
import * as G from '@/drivers/nothing/commands'

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
  ['wearState', 'Wear detection'],
  ['multipoint', 'Multipoint'],
  ['clarityBoost', 'Clarity boost'],
  ['smartAnc', 'Smart noise cancelling'],
  ['smartFree', 'Smart free'],
  ['lhdc', 'LHDC codec'],
  ['earFitTest', 'Ear tip fit test'],
  ['caseLed', 'Case LED'],
]

const fitLabel = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  // ear-web shows the raw byte; 1 is the only "good" value observed.
  return value === 1 ? 'Good fit' : `Result ${value}`;
}

export function NothingSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const [confirmReset, setConfirmReset] = useState(false)

  const cell = (value: { level: number; charging: boolean } | null): string =>
    value === null ? '—' : `${value.level}%${value.charging ? ' ⚡' : ''}`

  // A single-body device — the over-ears — reports one cell and no pair, so
  // the earbud/case rows would all read "—" for it. Show whichever shape the
  // device actually reported rather than a fixed three rows.
  const batteryRows: Array<[string, string]> = state.battery.single
    ? [['Battery', cell(state.battery.single)]]
    : [
        ['Left earbud', cell(state.battery.left)],
        ['Right earbud', cell(state.battery.right)],
        ['Case', cell(state.battery.case)],
      ]

  const wearRow = (): Array<[string, string]> => {
    const st = state.earphoneStatus
    if (!st) return []
    const cell = st.single ?? st.left ?? st.right
    if (!cell) return []
    return [['Worn', cell.inEar ? 'Yes' : cell.inCase ? 'In case' : 'No']]
  }

  // Naming the colour and having a picture of it are separate — the render
  // table only covers the colourways that had shipped by the app build it was
  // generated from, so a newer one is named but shown in the default finish.
  const colourName = G.nothingColourName(state.info.colourId)
  const colourRow =
    colourName === null
      ? state.info.colourId === null
        ? null
        : `Unknown (${state.info.colourId})`
      : nothingHasColourRender(state.info.model, state.info.colourId)
        ? colourName
        : `${colourName} — no render for this colour yet`

  const details: Array<[string, string]> = [
    ['Model', state.info.model ?? 'Unknown (Nothing/CMF)'],
    ['Firmware', state.info.firmware ?? '—'],
    ...(colourRow ? ([['Colour', colourRow]] as Array<[string, string]>) : []),
    ...(state.info.hardware ? ([['Hardware', state.info.hardware]] as Array<[string, string]>) : []),
    ...(state.info.serial ? ([['Serial', state.info.serial]] as Array<[string, string]>) : []),
    ...batteryRows,
    ...wearRow(),
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

  const model = modelForBase(state.info.modelBase)

  // The probe decides, and nothing overrides it. This used to be
  // `&& model.inEarDetection`, added because `GET_EXTRA_FEATURE_STATUS 0xc00e`
  // is a *generic* multi-feature read and answering it proved nothing. That is
  // no longer true: `decodeInEarDetection` addresses feature id 1 inside the
  // list and returns null when the device does not mention it, so the
  // capability is now only set when the device really reported it. The model
  // flag would only be able to *hide* something the device just told us it
  // has, which is the one direction worth refusing.
  const hasInEar = state.capabilities.has('inEarDetection')
  // No longer suppressed for single-body devices: the card renders the records
  // the device reports, so an over-ear shows its button, wheel and slider
  // instead of eight empty per-bud rows.
  const hasGestures = state.capabilities.has('gestures')
  const hasEarFit = state.capabilities.has('earFitTest')

  return (
    <div className="flex flex-col gap-4">
      <DeviceInfoPanel
        rows={details.map(([label, value]) => ({ label, value }))}
        footnote={
          state.info.model === null
            ? 'This device did not answer the model query, and gave no Bluetooth name to fall back on.'
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

      {state.capabilities.has('multipoint') && (
        <Card data-size="sm">
          <CardContent>
            <SettingRow
              label="Multipoint"
              hint="Stay connected to two devices at once."
            >
              <Switch
                checked={state.multipoint === true}
                disabled={disabled || state.multipoint === null}
                onCheckedChange={(on) => void device.setMultipoint(on)}
              />
            </SettingRow>
          </CardContent>
        </Card>
      )}

      {hasGestures && state.gestures && state.gestures.length > 0 && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <p className="text-muted-foreground text-xs">
              What each control does. The device reports its own slots.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Grouped by the device byte the records carry — 2 and 3 for a
                pair of earbuds, 6 for a single-body headphone. Rendering the
                reported records rather than a fixed left/right × four-pinches
                matrix is what makes the over-ears' button, wheel and slider
                appear at all. */}
            {[...new Set(state.gestures.map((g) => g.device))].map((deviceId) => (
              <div key={deviceId} className="flex flex-col gap-2">
                {[...new Set(state.gestures!.map((g) => g.device))].length > 1 && (
                  <span className="text-sm font-medium">{G.gestureDeviceLabel(deviceId)}</span>
                )}
                {state.gestures!
                  .filter((g) => g.device === deviceId)
                  .map((gesture) => (
                    <SettingRow
                      key={`${gesture.button}:${gesture.gesture}`}
                      label={G.gestureLabel(gesture)}
                    >
                      <select
                        className="border-border bg-background rounded-md border px-2 py-1.5 text-sm"
                        value={gesture.operation}
                        disabled={disabled}
                        aria-label={`${G.gestureLabel(gesture)}, ${G.gestureDeviceLabel(deviceId)}`}
                        onChange={(event) =>
                          void device.setGesture({
                            ...gesture,
                            operation: Number(event.target.value),
                          })
                        }
                      >
                        {/* The device's current value may be one this build has
                            no name for; keep it selectable rather than
                            silently rewriting it. */}
                        {!(gesture.operation in G.GESTURE_OPERATION_NAMES) && (
                          <option value={gesture.operation}>
                            Unknown ({gesture.operation})
                          </option>
                        )}
                        {Object.entries(G.GESTURE_OPERATION_NAMES).map(([value, name]) => (
                          <option key={value} value={value}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                  ))}
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
          {/* A single-body device has one ringer, addressed as 0x06 — two
              side-labelled buttons would both mean the same thing. */}
          {model?.singleBody ? (
            <button
              type="button"
              disabled={disabled}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
              onClick={() => void device.ringBuds(true)}
            >
              Ring
            </button>
          ) : (
            <>
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
            </>
          )}
          <button
            type="button"
            disabled={disabled}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
            onClick={() => void device.ringBuds(false)}
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

      <Card data-size="sm">
        <CardContent>
          <SettingRow
            label="Factory reset"
            hint="Clears the device's own settings and pairings. Not undoable."
          >
            {/* Two steps rather than a dialog: the confirm state lives here,
                so nothing can fire it on a single stray click. */}
            <Button
              variant={confirmReset ? 'destructive' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  return
                }
                setConfirmReset(false)
                void device.factoryReset()
              }}
            >
              {confirmReset ? 'Tap again to reset' : 'Reset'}
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      <SystemTail capabilities={capabilities} profile={profileFor('nothing', state.info.model)} />
    </div>
  )
}
