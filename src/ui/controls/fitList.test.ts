import { describe, expect, it } from 'vitest'

import { fitCount } from './fitList'

describe('fitCount', () => {
  it('keeps every row that ends inside the space', () => {
    expect(fitCount(200, [40, 80, 120, 160])).toBe(4)
  })

  it('drops the rows that would end past the bottom, from the end', () => {
    expect(fitCount(130, [40, 80, 120, 160])).toBe(3)
    expect(fitCount(100, [40, 80, 120, 160])).toBe(2)
  })

  it('always keeps the first row, so a tile is never an empty frame', () => {
    expect(fitCount(10, [40, 80])).toBe(1)
  })

  it('forgives a sub-pixel overrun, which is rounding rather than overflow', () => {
    // Measured in Chrome: a 70.4px box holding rows that round to 36 + 35 —
    // the last row "ends" at 71 and was hidden though it fitted.
    expect(fitCount(70.4, [35.6, 70.9])).toBe(2)
    expect(fitCount(70, [36, 72])).toBe(1)
  })

  it('keeps nothing when there is nothing', () => {
    expect(fitCount(100, [])).toBe(0)
  })
})
