import { RiComputerLine, RiMoonLine, RiSunLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTheme } from '../theme'
import type { ThemePreference } from '../theme'

const ICONS: Record<ThemePreference, typeof RiSunLine> = {
  light: RiSunLine,
  dark: RiMoonLine,
  system: RiComputerLine,
}

/** "Auto" rather than "System", which would sit right under the System nav item. */
const LABELS: Record<ThemePreference, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'Auto theme',
}

/** Cycles light → dark → system. The current mode is named, not just drawn. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, cycle } = useTheme()
  const Icon = ICONS[preference]

  return (
    <Button
      variant="ghost"
      size={compact ? 'icon-sm' : 'sm'}
      onClick={cycle}
      className={cn(
        'text-muted-foreground',
        !compact && 'w-full justify-start gap-2.5 px-2.5',
      )}
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
      title={`Theme: ${LABELS[preference]}. Click to change.`}
    >
      <Icon className="size-4" />
      {!compact && <span className="text-sm">{LABELS[preference]}</span>}
    </Button>
  )
}
