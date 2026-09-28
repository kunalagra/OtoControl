/**
 * Theme preference: light, dark, or follow the system.
 *
 * The stylesheet keys dark mode off a `.dark` class on the root element
 * (`@custom-variant dark (&:is(.dark *))`), so applying a theme is just
 * toggling that class.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'

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

/**
 * The preference, held once for the whole app.
 *
 * Every `useTheme` caller reads this one value. The control that changes it
 * lives on the System tab, while the shell keeps a caller mounted so the page
 * follows the OS on any tab; per-caller state would let those two disagree,
 * and the shell's stale copy would repaint the page on the next OS change.
 * Read from storage on first use, not at import, so a test that seeds storage
 * before its first render sees what it seeded.
 */
let shared: ThemePreference | null = null
const listeners = new Set<() => void>()

const currentPreference = (): ThemePreference => (shared ??= readStored())

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function choose(next: ThemePreference): void {
  shared = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not being able to remember the choice is not worth failing over.
  }
  for (const listener of listeners) listener()
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, currentPreference, currentPreference)
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

  return { preference, resolved, setTheme: choose, cycle: () => choose(nextTheme(preference)) }
}
