import { RiArrowLeftLine } from '@remixicon/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ActiveDevice } from '@/core/manager'
import { componentFor, sectionsForDevice } from '../sections/registry'
import { NoDevice } from '../sections/NoDevice'
import { useDevices } from '../useDevice'
import { MobileHeader, MobileNav } from './MobileChrome'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const { manager, active } = useDevices()
  const [activeId, setActiveId] = useState(() => sectionsForDevice(active)[0].id)

  const sections = sectionsForDevice(active)
  const section = sections.find((entry) => entry.id === activeId) ?? sections[0]

  // Drivers do not share a section list, so a stale id must not survive a switch.
  useEffect(() => {
    if (!sections.some((entry) => entry.id === activeId)) {
      setActiveId(sections[0].id)
    }
  }, [active.id, activeId, sections])

  const idle = active.state.status !== 'connected'
  // Nothing granted and nothing picked: there is no brand to render, so the
  // page shows an empty state rather than a disabled guess at one.
  const empty = !manager.hasDevice

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        manager={manager}
        active={active}
        activeSection={section.id}
        onSelect={setActiveId}
      />
      <MobileHeader manager={manager} active={active} />

      <main className="flex min-w-0 flex-1 flex-col md:h-dvh md:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 lg:p-6">
          {/* Hidden sections are not in the tab bar, so on mobile this header
              is the only way back out of them. */}
          <header
            className={cn(
              'flex items-baseline justify-between gap-4',
              !section.hidden && 'max-md:hidden',
            )}
          >
            <div className="flex items-baseline gap-3">
              {section.hidden && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -ml-2"
                  onClick={() => setActiveId('system')}
                >
                  <RiArrowLeftLine className="size-4" />
                  System
                </Button>
              )}
              <h1 className="text-base font-semibold tracking-tight">
                {empty ? 'No device' : section.label}
              </h1>
            </div>
            <StatusPill status={active.state.status} empty={empty} />
          </header>

          {/* Genuine failures only. Headphones being switched off is not one:
              the Disconnected badge says it, and the cached settings stay up. */}
          {active.state.error && (
            <p className="border-destructive/40 text-destructive rounded-lg border px-3 py-2 text-sm">
              {active.state.error}
            </p>
          )}

          {!empty && active.state.status === 'unsupported' && (
            <p className="border-destructive/40 text-destructive rounded-lg border px-3 py-2 text-sm">
              This browser has no Web Serial API. Use Chrome, Edge or another Chromium browser.
            </p>
          )}

          {empty ? (
            <NoDevice manager={manager} active={active} />
          ) : (
            <div className={idle ? 'pointer-events-none opacity-50' : undefined}>
              <SectionBody active={active} sectionId={section.id} onNavigate={setActiveId} />
            </div>
          )}
        </div>

        <MobileNav
          sections={sections}
          hasDevice={manager.hasDevice}
          active={section.id}
          onSelect={setActiveId}
        />
      </main>
    </div>
  )
}

interface SectionBodyProps {
  active: ActiveDevice
  sectionId: string
  onNavigate(id: string): void
}

/**
 * Renders whichever component `active`'s own driver declares for `sectionId`.
 *
 * No brand switch: every declared section has a component (`driver.test.ts`
 * checks that invariant per driver), so `sectionId` — always taken from
 * `sections.find(...)` above, never typed in by hand — resolves without one.
 */
function SectionBody({ active, sectionId, onNavigate }: SectionBodyProps) {
  const Component = componentFor(active, sectionId)
  if (!Component) return null
  return <Component device={active.device} state={active.state} onNavigate={onNavigate} />
}

const STATUS_LABELS: Record<string, string> = {
  unsupported: 'Unsupported browser',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
}

/**
 * The single indicator for whether what you are looking at is live.
 *
 * Disconnected is red because the page now keeps showing the device and its
 * last-known settings — without a strong signal, cached values would read as
 * current ones. With no device at all there is nothing to be disconnected
 * from, so that state stays neutral.
 */
function StatusPill({ status, empty }: { status: string; empty: boolean }) {
  const tone =
    empty || status === 'connecting'
      ? 'text-muted-foreground border-border'
      : status === 'connected'
        ? 'text-primary border-primary/40'
        : 'text-destructive border-destructive/40'

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {empty ? 'No device' : STATUS_LABELS[status]}
    </span>
  )
}
