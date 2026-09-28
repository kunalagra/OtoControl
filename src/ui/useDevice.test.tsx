// @vitest-environment jsdom
/**
 * The silent reconnect runs once per page load. React's StrictMode mounts
 * effects twice in development, and two concurrent `autoConnect`s race to open
 * the same serial port — the second fails with "already open".
 */
import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DeviceManager } from '@/core/manager'

describe('useDevices', () => {
  it('starts the silent reconnect once, however many times it mounts', async () => {
    const autoConnect = vi.spyOn(DeviceManager.prototype, 'autoConnect').mockResolvedValue(false)
    const { useDevices } = await import('./useDevice')

    renderHook(() => useDevices(), { wrapper: StrictMode })
    renderHook(() => useDevices())

    expect(autoConnect).toHaveBeenCalledTimes(1)
  })
})
