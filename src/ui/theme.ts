/**
 * Theme preference: light, dark, or follow the system.
 *
 * The stylesheet keys dark mode off a `.dark` class on the root element
 * (`@custom-variant dark (&:is(.dark *))`), so applying a theme is just
 * toggling that class.
 */

import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'otocontrol:theme'

export const THEME_ORDER: ThemePreference[] = ['light', 'dark', 'system']

/** What a preference actually renders as, given the current system setting. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

/** The next preference when cycling through the toggle. */
export function nextTheme(current: ThemePreference): ThemePreference {
  const index = THEME_ORDER.indexOf(current)
  return THEME_ORDER[(index + 1) % THEME_ORDER.length]
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * Whether the system currently prefers dark.
 *
 * `matchMedia` is optional-called because a browser may not have it, but the
 * `window` it hangs off is not optional at all — and `renderToStaticMarkup` in
 * the node test environment has none. Guarding here rather than at each caller
 * is what lets the shared UI tier be asserted against static markup, which is
 * the pattern most of its tests use.
 */
const systemPrefersDark = (): boolean =>
  typeof window === 'undefined' ? false : window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

function readStored(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    // Private browsing or blocked storage — fall back rather than crash.
    return 'system'
  }
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStored)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  // Follow the system while the preference is 'system'.
  useEffect(() => {
    const query =
      typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(preference, prefersDark)

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  function choose(next: ThemePreference) {
    setPreference(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
  }

  return { preference, resolved, setTheme: choose, cycle: () => choose(nextTheme(preference)) }
}
