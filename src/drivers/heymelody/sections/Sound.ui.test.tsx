// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { catalogEntryFor } from '../catalog'
import { initialHeyMelodyState } from '../state'
import type { HeyMelodyState } from '../state'
import type { EqPreset } from '../protocol/eq'
import { HeyMelodySound } from './Sound'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// 062414 is OnePlus Nord Buds 2: built-ins 0..3 and a real catalog cap of 2 custom presets.
const catalog = catalogEntryFor('062414')

const custom = (eqId: number, name: string, isSelected = false): EqPreset => ({
  isSelected,
  minValue: -6,
  maxValue: 6,
  eqId,
  name,
  bands: [{ frequency: 100, dbValue: 0 }],
})

const stateWith = (patch: Partial<HeyMelodyState>): HeyMelodyState => ({
  ...initialHeyMelodyState,
  status: 'connected',
  info: { ...initialHeyMelodyState.info, catalog },
  capabilities: new Set(['eq', 'eqCustom']),
  ...patch,
})

const makeDevice = () => ({ createCustomPreset: vi.fn(), deleteCustomPreset: vi.fn(), setEqPreset: vi.fn(), setEqCurve: vi.fn() })

describe('HeyMelody Sound tab, custom presets', () => {
  it('has a real catalog entry with a cap of 2', () => {
    expect(catalog?.customEqMax).toBe(2)
  })

  it('disables New preset at the catalog cap and ties it to the cap caption', () => {
    const device = makeDevice()
    render(<HeyMelodySound device={device as never} state={stateWith({ eqPresets: [custom(9, 'A'), custom(10, 'B')] })} />)
    const button = screen.getByRole('button', { name: 'New preset' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'New preset', description: 'Up to 2 custom presets' })).toBeTruthy()
  })

  it('leaves New preset enabled, with no caption link, below the cap', () => {
    render(<HeyMelodySound device={makeDevice() as never} state={stateWith({ eqPresets: [custom(9, 'A')] })} />)
    const button = screen.getByRole('button', { name: 'New preset' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-describedby')).toBeNull()
  })

  it('names Delete after the preset, and deletes only after confirming', () => {
    const device = makeDevice()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<HeyMelodySound device={device as never} state={stateWith({ eqCurrentPreset: 9, eqPresets: [custom(9, 'Mine', true)] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mine' }))
    expect(confirm).toHaveBeenCalledWith('Delete Mine?')
    expect(device.deleteCustomPreset).toHaveBeenCalledWith(9)
  })

  it('does not delete when the confirm is cancelled', () => {
    const device = makeDevice()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<HeyMelodySound device={device as never} state={stateWith({ eqCurrentPreset: 9, eqPresets: [custom(9, 'Mine', true)] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mine' }))
    expect(device.deleteCustomPreset).not.toHaveBeenCalled()
  })

  it('marks the built-in current when a custom is still flagged selected', () => {
    // eqCurrentPreset is the live answer; a stale isSelected flag on a custom must not win.
    render(<HeyMelodySound device={makeDevice() as never} state={stateWith({ eqCurrentPreset: 1, eqPresets: [custom(9, 'Mine', true)] })} />)
    expect(screen.getByRole('button', { name: 'Bass' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('does not show a built-in pill whose id is also a custom preset id', () => {
    render(<HeyMelodySound device={makeDevice() as never} state={stateWith({ eqPresets: [custom(1, 'Mine')] })} />)
    expect(screen.queryByRole('button', { name: 'Bass' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mine' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Balanced' })).toBeTruthy()
  })
})
