import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@/core/connection'

interface StatusTokenProps {
  status: ConnectionStatus
  /** False when nothing is granted at all, which is its own state. */
  hasDevice: boolean
}

/**
 * The one indicator for whether what you are looking at is live — spec §4.4,
 * DESIGN-GUIDE §5.11.
 *
 * The four states are told apart by *shape*, not only by colour, because the
 * one that matters most is also the one most likely to be missed: a device that
 * has gone away is the only state that inverts, because the page keeps showing
 * it and its last-known settings, and without a strong signal those cached
 * values would read as current ones. With no device at all there is nothing to
 * be disconnected from, so that state stays quiet.
 */
export function StatusToken({ status, hasDevice }: StatusTokenProps) {
  // `unsupported` lands in the same bucket as no device: a browser with neither
  // transport cannot be holding one, and the destructive banner under the bar is
  // what names the real problem.
  const state: TokenState =
    !hasDevice || status === 'unsupported'
      ? 'empty'
      : status === 'connected'
        ? 'live'
        : status

  return (
    <span
      data-slot="status-token"
      data-state={state}
      className={cn(
        // The nav-label role: 11px, uppercase, wide tracking (DESIGN-GUIDE §4).
        'flex items-center gap-1.5 text-[11px] uppercase tracking-[.1em]',
        // One class, not a `dark:` twin. `--signal-strong` *is* the signal in
        // dark (DESIGN-GUIDE §2 gives both `#ff4d3d`), and it is the only value
        // that is also legible in light, where the signal is 3.3 : 1 on white
        // (spec §8) — so naming the strong token everywhere is not a compromise
        // between the themes, it is the one class both themes agree on.
        state === 'live' && 'text-signal-strong',
        state === 'live' || state === 'disconnected'
          ? 'font-bold'
          : 'text-muted-foreground',
        state === 'disconnected' && 'rounded-full bg-foreground px-2.5 py-1 text-background',
      )}
    >
      {state === 'live' && (
        // An 8px dot, and it does not pulse: a pulsing dot reads as loading
        // (DESIGN-GUIDE §5.11).
        <span data-slot="status-dot" aria-hidden className="size-2 rounded-full bg-signal" />
      )}
      {state === 'connecting' && <Spinner className="size-3" />}
      {LABELS[state]}
    </span>
  )
}

type TokenState = 'live' | 'connecting' | 'disconnected' | 'empty'

const LABELS: Record<TokenState, string> = {
  live: 'Live',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  empty: 'No device',
}
