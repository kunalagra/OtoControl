// @vitest-environment jsdom
/**
 * `useTheme` is one preference for the whole app, not one per caller.
 *
 * The theme control lives on the System tab, and something that stays mounted
 * (the shell) keeps the page following the OS. With a copy of the preference in
 * each hook, a choice made on System would leave the shell's copy stale, and
 * the next OS change would repaint the page in the theme the user just left.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useTheme } from './theme'

afterEach(() => {
  localStorage.clear()
})

describe('useTheme', () => {
  it('shares one preference between every caller', () => {
    const shell = renderHook(() => useTheme())
    const control = renderHook(() => useTheme())

    act(() => control.result.current.setTheme('light'))

    expect(shell.result.current.preference).toBe('light')
    expect(control.result.current.preference).toBe('light')

    act(() => shell.result.current.setTheme('dark'))
    expect(control.result.current.preference).toBe('dark')
  })

  it('remembers the choice across a reload', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('dark'))
    expect(localStorage.getItem('otocontrol:theme')).toBe('dark')
  })
})
