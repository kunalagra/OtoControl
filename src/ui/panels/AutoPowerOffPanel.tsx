import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingRow } from '../controls/SettingRow'
import type { TimeoutOption } from './autoPowerOff'

export interface AutoPowerOffPanelProps {
  /** Already widened by `withReportedValue`. */
  options: readonly TimeoutOption[]
  value: number | null
  /** Driver's own wording — the two drivers mean different idle conditions. */
  hint: string
  disabled: boolean
  /** Trigger width, which differs between drivers' label lengths. */
  triggerClassName?: string
  onChange(value: number): void
}

/**
 * The "Auto power off" row: a labelled select over timeout options.
 *
 * Renders the row only; the caller decides which card it sits in and what it
 * sits next to, because that ordering is a page decision, not a panel one.
 */
export function AutoPowerOffPanel({
  options,
  value,
  hint,
  disabled,
  triggerClassName = 'w-40',
  onChange,
}: AutoPowerOffPanelProps) {
  return (
    <SettingRow label="Auto power off" hint={hint}>
      <Select
        items={options.map(({ value: seconds, label }) => ({ value: String(seconds), label }))}
        value={value === null ? undefined : String(value)}
        disabled={disabled || value === null}
        onValueChange={(next) => onChange(Number(next))}
      >
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder="Not reported" />
        </SelectTrigger>
        <SelectContent>
          {options.map(({ value: seconds, label }) => (
            <SelectItem key={seconds} value={String(seconds)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}
