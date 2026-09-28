// @vitest-environment jsdom
/**
 * The App block at the foot of System: settings about this app rather than
 * the headphones, starting with the theme.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AppSettings } from '@/ui/sections/AppSettings'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('AppSettings', () => {
  it('offers Auto, Light and Dark, with the current one pressed', () => {
    const view = render(<AppSettings />)
    const group = within(view.getByRole('group', { name: 'Appearance' }))
    const buttons = group.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Auto', 'Light', 'Dark'])
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })

  it('switches the theme when a segment is tapped', () => {
    const view = render(<AppSettings />)
    const group = within(view.getByRole('group', { name: 'Appearance' }))
    fireEvent.click(group.getByText('Dark'))
    expect(group.getByText('Dark').closest('button')?.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('otocontrol:theme')).toBe('dark')
  })
})
