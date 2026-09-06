import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'
import { ANC_LABEL, buildAncCapabilities } from '../ancModel'
import type { AncKey, AncModeOption } from '../ancModel'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

const label = (key: string): string => ANC_LABEL[key as AncKey] ?? key

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

  // Per-model data (which named modes this specific device has, and which
  // bit each one is), not the device's own reply — that only ever reports
  // which bit is *currently* active, never which ones exist. Cheap to
  // recompute: at most a handful of entries, no memoization worth the noise.
  const capabilities = buildAncCapabilities(state.info.catalog?.noiseReductionMode)
  const hasModeIndex = state.ancModeIndex !== null
  const hasLevel = state.ancLevel !== null
  const activeKey = hasModeIndex ? (capabilities.indexToKey[state.ancModeIndex!] ?? null) : null

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Noise control</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {capabilities.options.length > 0 ? (
          capabilities.options.map((option) => (
            <ModeGroup
              key={option.key}
              option={option}
              activeKey={activeKey}
              disabled={disabled}
              onSelect={(key) => void device.setAncMode(key)}
            />
          ))
        ) : !hasModeIndex && !hasLevel ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The device did not answer the noise control query.'
              : 'Connect to load noise control.'}
          </p>
        ) : (
          // This model isn't in the bundled per-model catalog (or the
          // catalog just hasn't loaded yet) — fall back to showing whatever
          // the device itself reports, read-only, rather than nothing.
          <div className="flex flex-col gap-1 text-sm">
            {hasModeIndex && (
              <p>
                <span className="text-muted-foreground">Current mode </span>
                {activeKey ? label(activeKey) : state.ancModeIndex}
              </p>
            )}
            {hasLevel && (
              <p>
                <span className="text-muted-foreground">Current level </span>
                {state.ancLevel}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ModeGroup({
  option,
  activeKey,
  disabled,
  onSelect,
}: {
  option: AncModeOption
  activeKey: string | null
  disabled: boolean
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ModeButton option={option} active={activeKey === option.key} disabled={disabled} onSelect={onSelect} />
      {option.children.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pl-2">
          {option.children.map((child) => (
            <ModeButton
              key={child.key}
              option={child}
              active={activeKey === child.key}
              disabled={disabled}
              onSelect={onSelect}
              small
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ModeButton({
  option,
  active,
  disabled,
  onSelect,
  small,
}: {
  option: AncModeOption
  active: boolean
  disabled: boolean
  onSelect: (key: string) => void
  small?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={() => onSelect(option.key)}
      className={cn(
        'flex items-center rounded-lg border px-2.5 py-2 text-left transition-colors',
        'focus-visible:ring-ring outline-none focus-visible:ring-2',
        'disabled:cursor-default disabled:opacity-50',
        active ? 'border-primary bg-primary/10' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <span className={cn('font-medium', small ? 'text-xs' : 'text-sm')}>{label(option.key)}</span>
    </button>
  )
}
