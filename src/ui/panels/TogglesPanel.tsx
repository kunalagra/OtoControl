import { Card, CardContent } from '@/components/ui/card'
import { ToggleRow } from '../controls/SettingRow'

export interface ToggleItem {
  /** React key and the caller's own identifier; never read by this panel. */
  key: string
  label: string
  hint?: string
  /** `null`/`undefined` means not reported — the row renders disabled. */
  value: boolean | null | undefined
  disabled?: boolean
  onChange(value: boolean): void
}

export interface TogglesPanelProps {
  toggles: readonly ToggleItem[]
  disabled: boolean
}

/**
 * A card of switch rows.
 *
 * Renders nothing at all for an empty list, so a caller can hand it a
 * capability-filtered array without also writing the `length > 0 &&` guard
 * every driver was writing.
 */
export function TogglesPanel({ toggles, disabled }: TogglesPanelProps) {
  if (toggles.length === 0) return null

  return (
    <Card data-size="sm">
      <CardContent className="flex flex-col">
        {toggles.map(({ key, label, hint, value, disabled: rowDisabled, onChange }) => (
          <ToggleRow
            key={key}
            label={label}
            hint={hint ?? ''}
            value={value ?? null}
            disabled={disabled || rowDisabled === true}
            onChange={onChange}
          />
        ))}
      </CardContent>
    </Card>
  )
}
