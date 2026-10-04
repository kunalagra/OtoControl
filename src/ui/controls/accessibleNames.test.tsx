// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { XiaomiTouchControls } from '@/drivers/xiaomi/sections/XiaomiTouchControls'
import { initialXiaomiState } from '@/drivers/xiaomi/state'
import { TouchControls as HeyMelodyTouchControls } from '@/drivers/heymelody/sections/TouchControls'
import { initialHeyMelodyState } from '@/drivers/heymelody/state'
import { SettingRow, ToggleRow } from './SettingRow'

afterEach(cleanup)

const device = new Proxy({}, { get: () => () => undefined }) as never

describe('accessible names for shared controls', () => {
  it('names a ToggleRow switch after its label', () => {
    render(<ToggleRow label="Game mode" hint="Lower latency." value={true} onChange={() => undefined} />)
    expect(screen.getByRole('switch', { name: 'Game mode' })).toBeTruthy()
  })

  it('names a Select trigger after its SettingRow, or after an explicit name', () => {
    render(
      <>
        <SettingRow label="Wind">
          <Select items={[{ value: 'a', label: 'A' }]} value="a">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="a">A</SelectItem></SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Left" name="Left single tap">
          <Select items={[{ value: 'a', label: 'A' }]} value="a">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="a">A</SelectItem></SelectContent>
          </Select>
        </SettingRow>
      </>,
    )
    expect(screen.getByRole('combobox', { name: 'Wind' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Left single tap' })).toBeTruthy()
  })

  it('names each HeyMelody touch-control select with its side', () => {
    render(
      <HeyMelodyTouchControls
        device={device}
        state={{
          ...initialHeyMelodyState,
          status: 'connected',
          gestures: [
            { deviceType: 1, button: 1, action: 1, fn: 0 },
            { deviceType: 2, button: 1, action: 1, fn: 0 },
          ],
        }}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Left Single tap' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Right Single tap' })).toBeTruthy()
  })

  it('names each Xiaomi gesture select with its side and tap', () => {
    render(
      <XiaomiTouchControls
        device={device}
        state={{ ...initialXiaomiState, status: 'connected', gestures: [{ tap: 1, left: 0, right: 0 }] }}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Left Double tap' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Right Double tap' })).toBeTruthy()
  })
})
