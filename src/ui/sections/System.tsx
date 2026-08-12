import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  POWER_OFF_PRESETS,
  SIDETONE_MAX,
  codecName,
  formatDuration,
  wearStateName,
} from '@/gaia/commands'
import { qualcommFeatureName } from '@/gaia/features'
import { togglesFor } from '@/device/state'
import { SettingRow, ToggleRow } from '../controls/SettingRow'
import { SystemTail } from './SystemTail'
import { DebugEntry } from './DebugEntry'
import type { SectionProps } from './types'

export function System({ device, state, onNavigate }: SectionProps) {
  const disabled = state.status !== 'connected'
  const { powerOffSeconds } = state
  const behaviourToggles = togglesFor(state.info.model).filter(
    (toggle) => toggle.group === 'behaviour',
  )

  // The device may report a duration that is not one of our presets; keep it
  // rather than silently snapping the dropdown to a different value.
  const presets =
    powerOffSeconds === null || POWER_OFF_PRESETS.some((p) => p.seconds === powerOffSeconds)
      ? POWER_OFF_PRESETS
      : [
          ...POWER_OFF_PRESETS,
          { label: formatDuration(powerOffSeconds), seconds: powerOffSeconds },
        ]

  const details: Array<[string, string]> = [
    ['Model', state.info.model ?? '—'],
    ['Firmware', state.info.firmware ?? '—'],
    ['Serial', state.info.serial ?? '—'],
    ['Codec', state.info.codec === null ? '—' : codecName(state.info.codec)],
    ['Status', state.wearState === null ? '—' : wearStateName(state.wearState)],
  ]

  const advanced = (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Advanced</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingRow
          label="Debug console"
          hint="Raw frame log and command sweeping. Not needed for normal use."
        >
          <DebugEntry onOpen={() => onNavigate('debug')} />
        </SettingRow>
      </CardContent>
    </Card>
  )

  const capabilities = (
  <Card data-size="sm">
    <CardHeader>
      <CardTitle>Reported capabilities</CardTitle>
      <p className="text-muted-foreground text-xs">
        From <code>Core_GetSupportedFeatures</code>. These are Qualcomm GAIA{' '}
        <em>core</em> features, not Sennheiser's — the list omits battery and equaliser,
        which both work. Shown for reference; polling follows the command table.
      </p>
    </CardHeader>
    <CardContent>
      {state.supportedFeatures === null ? (
        <p className="text-muted-foreground text-sm">
          {state.status === 'connected'
            ? 'This firmware did not answer the capability query.'
            : 'Connect to read the capability table.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[...state.supportedFeatures]
              .sort(([a], [b]) => a - b)
              .map(([id, version]) => {
                const name = qualcommFeatureName(id)
                return (
                  <span
                    key={id}
                    className="border-border rounded-full border px-2.5 py-1 text-[11px]"
                    title={`feature 0x${id.toString(16)} version ${version}`}
                  >
                    <span className="font-mono">
                      0x{id.toString(16).padStart(2, '0')}
                    </span>
                    {name && <span> {name}</span>}
                    <span className="text-muted-foreground"> v{version}</span>
                  </span>
                )
              })}
          </div>
          <p className="text-muted-foreground text-xs">
            {state.supportedFeatures.size} features
            {state.apiVersion && ` · GAIA ${state.apiVersion.join('.')}`}
          </p>
        </div>
      )}
    </CardContent>
  </Card>
  )

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardContent className="flex flex-col">
          {behaviourToggles.map(({ key, label, description }) => (
            <ToggleRow
              key={key}
              label={label}
              hint={description}
              value={state.toggles[key]}
              disabled={disabled}
              onChange={(value) => void device.setToggle(key, value)}
            />
          ))}

          <SettingRow label="Auto power off" hint="When idle and not worn.">
            <Select
              items={presets.map(({ label, seconds }) => ({
                value: String(seconds),
                label,
              }))}
              value={powerOffSeconds === null ? undefined : String(powerOffSeconds)}
              disabled={disabled || powerOffSeconds === null}
              onValueChange={(value) => void device.setPowerOff(Number(value))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Not reported" />
              </SelectTrigger>
              <SelectContent>
                {presets.map(({ label, seconds }) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Sidetone" hint="How much of your own voice you hear on calls.">
            <div className="flex w-40 items-center gap-3">
              <Slider
                value={[state.sidetone ?? 0]}
                min={0}
                max={SIDETONE_MAX}
                step={1}
                disabled={disabled || state.sidetone === null}
                aria-label="Sidetone level"
                onValueChange={(value) =>
                  void device.setSidetone(Array.isArray(value) ? value[0] : value)
                }
              />
              <span className="text-muted-foreground w-4 text-right text-xs tabular-nums">
                {state.sidetone ?? '—'}
              </span>
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="border-border flex items-baseline justify-between gap-4 border-b py-1.5 text-[13px] last:border-b-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-mono text-xs break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <SystemTail
        advanced={advanced}
        capabilities={capabilities}
        brand="sennheiser"
        model={state.info.model}
      />
    </div>
  )
}
