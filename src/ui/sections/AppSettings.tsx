import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useTheme } from '../theme'
import type { ThemePreference } from '../theme'

const APPEARANCE: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * Settings about this app rather than the headphones, at the foot of System.
 *
 * Rendered by the shell after whichever driver's System section is showing,
 * outside the dim that section wears while disconnected — the theme is not a
 * device setting, and it must stay changeable with nothing connected.
 */
export function AppSettings() {
  const { preference, setTheme } = useTheme()

  return (
    <Card data-size="sm" data-slot="app-settings">
      <CardHeader>
        <CardTitle>App</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <span id="appearance-label" className="text-sm font-medium">
          Appearance
        </span>
        <div role="group" aria-labelledby="appearance-label" className="flex gap-1.5">
          {APPEARANCE.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={preference === option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                'min-h-9 rounded-[14px] px-3 text-[12px] outline-none transition-colors duration-150 ease-out',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                preference === option.value
                  ? 'bg-signal font-bold text-black'
                  : 'bg-surface-raised text-foreground hover:bg-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
