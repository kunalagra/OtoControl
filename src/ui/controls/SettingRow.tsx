import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface SettingRowProps {
  label: string
  hint?: string
  children: React.ReactNode
}

/** One labelled setting per row, with its control on the right. */
export function SettingRow({ label, hint, children }: SettingRowProps) {
  return (
    <div className="border-border flex items-center justify-between gap-4 border-b py-2 last:border-b-0">
      <div className="flex min-w-0 flex-col">
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

interface ToggleRowProps {
  label: string
  hint: string
  /** Null means the headphones never reported it, so it cannot be toggled blind. */
  value: boolean | null
  disabled?: boolean
  onChange(value: boolean): void
}

export function ToggleRow({ label, hint, value, disabled, onChange }: ToggleRowProps) {
  return (
    <SettingRow
      label={label}
      hint={value === null ? 'Not reported by this firmware.' : hint}
    >
      <Switch
        checked={value === true}
        disabled={disabled || value === null}
        onCheckedChange={onChange}
      />
    </SettingRow>
  )
}
