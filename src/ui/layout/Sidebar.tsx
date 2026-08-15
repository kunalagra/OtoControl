import { RiLoader4Line, RiRefreshLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { BatteryBar, DeviceImage } from '../device/DeviceImage'
import { summarise } from '../device/summary'
import { sectionsForDevice } from '../sections/registry'
import { DeviceSelect } from './DeviceSelect'
import { ThemeToggle } from './ThemeToggle'

interface SidebarProps {
  manager: DeviceManager
  active: ActiveDevice
  activeSection: string
  onSelect(id: string): void
}

/** Desktop only; small screens get MobileHeader plus MobileNav instead. */
export function Sidebar({ manager, active, activeSection, onSelect }: SidebarProps) {
  const summary = summarise(active)
  const connected = active.state.status === 'connected'
  // With no device there is no brand, so there is no section list either —
  // showing one brand's would be a guess about hardware we have not seen.
  const sections = manager.hasDevice ? sectionsForDevice(active) : []

  return (
    <aside className="bg-sidebar text-sidebar-foreground border-border hidden h-dvh w-72 shrink-0 flex-col gap-4 border-r p-4 md:flex lg:w-80 lg:p-5">
      <div className="flex flex-col gap-2">
        {/* The noise props below compare `active.id` against a `DriverId`
            literal rather than reading the id off a driver descriptor — see
            the note in `ui/device/summary.ts` for why the shared tier must
            not import a whole descriptor to get one string out of it. */}
        <DeviceImage
          brand={active.driver.brand}
          status={active.state.status}
          model={summary.model}
          hasDevice={summary.hasDevice}
          colourCode={summary.colourCode}
          noiseLevel={active.id === 'sennheiser-gaia' ? active.state.noise.transparencyLevel : null}
          ancEnabled={active.id === 'sennheiser-gaia' ? active.state.noise.ancEnabled : null}
          worn={summary.worn}
          className="-mx-1"
        />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{summary.model}</p>
            {connected && summary.codec && (
              <span className="text-muted-foreground/70 shrink-0 text-[11px]">
                {summary.codec}
              </span>
            )}
          </div>

          {/* Battery and wear state are live-only — they change while the app
              is closed, so they are never cached. An empty gauge would read as
              "0% and broken", so the disconnected state says so in words. */}
          {connected ? (
            <>
              <BatteryBar battery={summary.battery} charging={summary.charging} />

              <p className="text-muted-foreground text-[11px]">
                {summary.charging && 'Charging · '}
                {summary.detail ?? '—'}
              </p>
            </>
          ) : (
            manager.hasDevice &&
            (active.state.status === 'connecting' ? (
              <p className="text-muted-foreground text-[11px]">Connecting…</p>
            ) : (
              <p className="text-destructive text-[11px]">Disconnected</p>
            ))
          )}
        </div>
      </div>

      {sections.length > 0 && (
        <>
          <Separator />

          <nav className="flex flex-col gap-0.5">
            {sections
              .filter((section) => !section.hidden)
              .map(({ id, label, icon: Icon }) => (
                <NavItem
                  key={id}
                  label={label}
                  icon={Icon}
                  active={activeSection === id}
                  onSelect={() => onSelect(id)}
                />
              ))}
          </nav>
        </>
      )}

      <div className="mt-auto flex flex-col gap-0.5">
        <ThemeToggle />
        <Separator className="my-2" />
        <div className="flex flex-col gap-2">
          <DeviceSelect manager={manager} active={active} />
          <ConnectionControls manager={manager} active={active} />
        </div>
      </div>
    </aside>
  )
}

interface NavItemProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onSelect(): void
}

function NavItem({ label, icon: Icon, active, onSelect }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
        'focus-visible:ring-sidebar-ring outline-none focus-visible:ring-2',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}

export function ConnectionControls({
  manager,
  active,
  compact = false,
}: {
  manager: DeviceManager
  active: ActiveDevice
  compact?: boolean
}) {
  const status = active.state.status

  if (status === 'unsupported') {
    return compact ? null : (
      <p className="text-destructive text-xs">
        This browser has no Web Serial API. Use Chrome, Edge or another Chromium browser.
      </p>
    )
  }

  if (status === 'connected') {
    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className={compact ? undefined : 'flex-1'}
          onClick={() => void manager.refresh()}
          title="Re-read every setting. Needed for settings the device never announces."
        >
          <RiRefreshLine className="size-3.5" />
          {!compact && 'Refresh'}
        </Button>
        {!compact && (
          <Button variant="ghost" size="sm" onClick={() => void manager.disconnect()}>
            Disconnect
          </Button>
        )}
      </div>
    )
  }

  return (
    <Button
      size={compact ? 'sm' : 'default'}
      className={compact ? undefined : 'w-full'}
      disabled={status === 'connecting'}
      onClick={() => void manager.connect()}
    >
      {status === 'connecting' ? (
        <>
          <RiLoader4Line className="size-4 animate-spin" />
          {!compact && 'Connecting'}
        </>
      ) : (
        'Connect'
      )}
    </Button>
  )
}
