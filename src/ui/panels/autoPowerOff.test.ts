import { describe, expect, it } from 'vitest'

import { withReportedValue } from './autoPowerOff'

const OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
]

describe('withReportedValue', () => {
  it('returns the options unchanged when nothing is reported', () => {
    expect(withReportedValue(OPTIONS, null, String)).toEqual(OPTIONS)
  })

  it('returns the options unchanged when the reported value is already listed', () => {
    expect(withReportedValue(OPTIONS, 300, String)).toEqual(OPTIONS)
  })

  it('appends an entry for a reported value that is not listed', () => {
    expect(withReportedValue(OPTIONS, 42, (v) => `${v} seconds`)).toEqual([
      ...OPTIONS,
      { value: 42, label: '42 seconds' },
    ])
  })

  it('does not mutate the options it was given', () => {
    const copy = [...OPTIONS]
    withReportedValue(OPTIONS, 42, String)
    expect(OPTIONS).toEqual(copy)
  })

  it('treats 0 as a real reported value, not as absent', () => {
    expect(withReportedValue([{ value: 300, label: '5 minutes' }], 0, () => 'Off')).toEqual([
      { value: 300, label: '5 minutes' },
      { value: 0, label: 'Off' },
    ])
  })
})
