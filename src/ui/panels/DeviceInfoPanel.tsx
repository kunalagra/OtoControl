import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface DeviceInfoRow {
  label: string
  value: string
}

export interface DeviceInfoPanelProps {
  /** Card heading. Defaults to "Device"; drivers may rename it. */
  title?: string
  rows: readonly DeviceInfoRow[]
  /** Rendered under the list. Sony uses it for the unmapped-colour note. */
  footnote?: ReactNode
}

/**
 * A label/value table for whatever a driver knows about the connected device.
 *
 * Takes already-formatted strings: every value here is a display decision the
 * driver has already made (codec names, battery phrasing, em-dash for absent),
 * and re-deriving any of it inside a shared panel would be the panel knowing
 * which driver it is in.
 */
export function DeviceInfoPanel({ title = 'Device', rows, footnote }: DeviceInfoPanelProps) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col">
          {rows.map(({ label, value }) => (
            <div
              key={label}
              className="border-border flex items-baseline justify-between gap-4 border-b py-1.5 text-[13px] last:border-b-0"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-mono text-xs break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {footnote !== undefined && (
          <p className="text-muted-foreground mt-3 text-xs">
            {footnote}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
