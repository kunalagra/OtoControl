export interface TimeoutOption {
  value: number
  label: string
}

/**
 * The option list to render, given what the device actually reported.
 *
 * A device may report a timeout outside our curated list; keep it rather than
 * silently snapping the dropdown to a different value, so the reported value
 * is appended instead. Both drivers had their own copy of this rule; this is
 * the only one.
 */
export function withReportedValue(
  options: readonly TimeoutOption[],
  reported: number | null,
  label: (value: number) => string,
): readonly TimeoutOption[] {
  if (reported === null) return options
  if (options.some((option) => option.value === reported)) return options
  return [...options, { value: reported, label: label(reported) }]
}
