import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { DeviceManager } from '@/core/manager'
import type { ActiveDevice } from '@/core/manager'

/** One manager per page — the headphones accept a single control connection. */
const manager = new DeviceManager()

/** A full poll is many round trips, so don't repeat it on every focus flicker. */
const REFRESH_THROTTLE_MS = 3000

export function useDevices(): { manager: DeviceManager; active: ActiveDevice } {
  // A counter rather than the state object: granting or revoking a port
  // changes what the shell renders without touching any device state.
  useSyncExternalStore(
    useCallback((onChange) => manager.subscribe(onChange), []),
    () => manager.version,
  )

  useEffect(() => {
    // Reconnect silently if a port was granted in a past session.
    void manager.autoConnect()
  }, [])

  useEffect(() => {
    // Most settings have no notification in firmware, so a change made in the
    // phone app is invisible until we poll. Re-reading when the window regains
    // focus makes switching back from the phone show current values.
    let last = 0
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last < REFRESH_THROTTLE_MS) return
      last = now
      void manager.refresh()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  return { manager, active: manager.active }
}
