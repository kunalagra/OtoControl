import { cn } from '@/lib/utils'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { DeviceImage } from '../device/DeviceImage'
import type { Section } from '../sections/registry'
import { summarise } from '../device/summary'
import { ConnectionControls } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'

/**
 * Small-screen header: the device summary condensed into one row, so the
 * controls themselves get the vertical space.
 */
export function MobileHeader({
  manager,
  active,
}: {
  manager: DeviceManager
  active: ActiveDevice
}) {
  const summary = summarise(active)
  const status = active.state.status

  return (
    <header className="bg-sidebar border-border sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-2.5 md:hidden">
      {/* `DriverId` literal rather than the id off a descriptor, as in
          `Sidebar.tsx` — see `ui/device/summary.ts` for the reasoning. */}
      <DeviceImage
        brand={active.driver.brand}
        status={status}
        model={summary.model}
        hasDevice={summary.hasDevice}
        colourCode={summary.colourCode}
        noiseLevel={active.id === 'sennheiser-gaia' ? active.state.noise.transparencyLevel : null}
        ancEnabled={active.id === 'sennheiser-gaia' ? active.state.noise.ancEnabled : null}
        worn={summary.worn}
        className="w-20 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{summary.model}</p>
        <p
          className={cn(
            'truncate text-xs tabular-nums',
            status === 'disconnected' && manager.hasDevice
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {status === 'connected'
            ? [
                summary.battery === null ? null : `${summary.battery}%`,
                summary.charging ? 'charging' : null,
                summary.detail,
              ]
                .filter(Boolean)
                .join(' · ') || 'Connected'
            : status === 'connecting'
              ? 'Connecting…'
              : manager.hasDevice
                ? 'Disconnected'
                : 'No device'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle compact />
        <ConnectionControls manager={manager} active={active} compact />
      </div>
    </header>
  )
}

/** Bottom tab bar, within thumb reach and clear of the home indicator. */
export function MobileNav({
  sections,
  hasDevice,
  active,
  onSelect,
}: {
  /** Resolved by the shell, so the tab bar and the sidebar cannot disagree. */
  sections: Section[]
  /** No device means no known section list; the bar is hidden rather than faked. */
  hasDevice: boolean
  active: string
  onSelect(id: string): void
}) {
  if (!hasDevice) return null

  return (
    <nav className="bg-sidebar border-border sticky bottom-0 z-20 flex border-t pb-[env(safe-area-inset-bottom)] md:hidden">
      {sections
        .filter((section) => !section.hidden)
        .map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors',
                'focus-visible:ring-sidebar-ring outline-none focus-visible:ring-2 focus-visible:ring-inset',
                isActive ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {/* Short labels only; the sidebar spells them out in full. */}
              {label.split(' ')[0]}
            </button>
          )
        })}
    </nav>
  )
}
