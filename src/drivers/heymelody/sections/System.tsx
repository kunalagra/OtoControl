import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { ToggleRow } from '@/ui/controls/SettingRow'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { SystemTail } from '@/ui/sections/SystemTail'
import { OEM_BRAND_NAME } from '../catalog'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'
import { BATTERY_LABEL } from '../protocol/battery'
import { ALERT_VOLUME_RANGE, FeatureId, gameModeIds } from '../protocol/feature'
import type { BatteryDevice } from '../protocol/battery'
import type { HeyMelodyCapability } from '../state'
import { TouchControls } from './TouchControls'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodySystem({ device, state }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Model </span>
            {state.info.catalog?.name ?? 'Unknown'}
          </p>
          <p>
            <span className="text-muted-foreground">Brand </span>
            {state.info.catalog ? OEM_BRAND_NAME[state.info.catalog.brand] : 'Unknown'}
          </p>
          <p>
            <span className="text-muted-foreground">Product ID </span>
            {state.info.productId ?? '—'}
          </p>
          {state.info.version.length > 0 && (
            <p>
              <span className="text-muted-foreground">Firmware </span>
              {state.info.version
                .map((entry) => `${entry.device === 'other' ? '' : `${BATTERY_LABEL[entry.device]} `}${entry.version}`)
                .join(' · ')}
            </p>
          )}
        </CardContent>
      </Card>

      <Controls device={device} state={state} />
      {state.gestures.length > 0 && <TouchControls device={device} state={state} />}

      {state.battery.length > 0 && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Battery</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.battery.map((cell) => (
              <div key={cell.device} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {BATTERY_LABEL[cell.device]}
                  {wearLabel(state.wear, cell.device)}
                  {cell.charging && ' · Charging'}
                </span>
                <BatteryBar battery={cell.level} charging={cell.charging} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {state.capabilities.has('find') && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Find my earbuds</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">Remove the earbuds before ringing them.</p>
            <Button
              variant={state.finding ? 'destructive' : 'outline'}
              disabled={state.status !== 'connected'}
              onClick={() => void device.setFinding(!state.finding)}
            >
              {state.finding ? 'Stop ringing' : 'Ring earbuds'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* No model profiles yet, so no not-supported-yet list: the tail shows
          what the device reported and the shared About. */}
      <SystemTail capabilities={<Capabilities reported={state.capabilities} />} profile={null} />
    </div>
  )
}

/** The feature switches and levels the device reported; nothing is shown for one it did not. */
function Controls({ device, state }: Props) {
  const { features } = state
  const game = gameModeIds(features)
  const disabled = state.status !== 'connected'
  const hasAutoPlay = features.has(FeatureId.AutoPlay)
  const hasBass = features.has(FeatureId.BassWave)
  if (!hasAutoPlay && game.main === null && !hasBass && state.alertVolume === null) return null

  const toggle = (id: number, label: string, hint: string) => (
    <ToggleRow
      label={label}
      hint={hint}
      value={features.get(id) ?? null}
      disabled={disabled}
      onChange={(value) => void device.setFeature(id, value)}
    />
  )

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Controls</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        {hasAutoPlay && toggle(FeatureId.AutoPlay, 'Auto play/pause', 'Pauses when you take an earbud out.')}
        {game.main !== null && toggle(game.main, 'Game mode', 'Lower audio delay for games.')}
        {game.lowLatency !== null && toggle(game.lowLatency, 'Low latency', 'A second low-latency setting on this model.')}
        {hasBass && toggle(FeatureId.BassWave, 'BassWave', 'Extra low end.')}
        {hasBass && state.bassLevel && (
          <LevelSlider
            label="BassWave level"
            min={state.bassLevel.min}
            max={state.bassLevel.max}
            value={state.bassLevel.level}
            disabled={disabled}
            onCommit={(level) => void device.setBassLevel(level)}
          />
        )}
        {state.alertVolume !== null && (
          <LevelSlider
            label="Alert volume"
            min={ALERT_VOLUME_RANGE.min}
            max={ALERT_VOLUME_RANGE.max}
            value={state.alertVolume}
            disabled={disabled}
            onCommit={(level) => void device.setAlertVolume(level)}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** A slider that holds a local draft while dragging and writes once, on release. */
function LevelSlider({
  label,
  min,
  max,
  value,
  disabled,
  onCommit,
}: {
  label: string
  min: number
  max: number
  value: number
  disabled: boolean
  onCommit: (level: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  return (
    <div className="border-border flex items-center gap-3 border-b py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-sm font-medium">{label}</span>
      <Slider
        value={[shown]}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        aria-label={label}
        onValueChange={(next) => setDraft(Array.isArray(next) ? next[0] : next)}
        onValueCommitted={(committed) => {
          // The committed value, not `draft`: keyboard input fires change and commit together.
          onCommit(Array.isArray(committed) ? committed[0] : committed)
          setDraft(null)
        }}
      />
      <span className="w-8 shrink-0 text-right text-xs tabular-nums">{shown}</span>
    </div>
  )
}

/** What each capability is called, in the order the card lists them. */
const CAPABILITY_NAMES: ReadonlyArray<[HeyMelodyCapability, string]> = [
  ['version', 'Firmware version'],
  ['battery', 'Battery'],
  ['wear', 'Wear detection'],
  ['find', 'Find my earbuds'],
  ['anc', 'Noise control'],
  ['eq', 'EQ presets'],
  ['eqCustom', 'Custom EQ'],
  ['bassLevel', 'BassWave level'],
  ['alertVolume', 'Alert volume'],
  ['gestures', 'Touch controls'],
]

/** The features the device's command table (0x0100) says it supports. */
function Capabilities({ reported }: { reported: ReadonlySet<HeyMelodyCapability> }) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Reported capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">
          Read from the command table the earbuds send when they connect.
        </p>
      </CardHeader>
      <CardContent>
        {reported.size === 0 ? (
          <p className="text-muted-foreground text-sm">Connect to read the device's capabilities.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {CAPABILITY_NAMES.filter(([id]) => reported.has(id)).map(([id, name]) => (
              <span key={id} className="bg-surface-raised rounded-full px-2.5 py-1 text-xs">
                {name}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function wearLabel(wear: HeyMelodyState['wear'], device: BatteryDevice): string {
  const cell = wear.find((entry) => entry.device === device);
  if (!cell) return '';
  return cell.inEar ? ' · In ear' : cell.inBox ? ' · In case' : '';
}
