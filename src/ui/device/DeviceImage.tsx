import { useState } from 'react'
import { RiHeadphoneLine } from '@remixicon/react'

import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@/core/connection'
import { Progress } from '@/components/ui/progress'
import { artworkFor } from './artwork'
import type { Brand } from '@/core/brand'

interface DeviceImageProps {
  status: ConnectionStatus
  model: string | null
  /** False when no device has identified itself; shows a placeholder instead. */
  hasDevice?: boolean
  /** Selects which vendor's renders to use. */
  brand?: Brand
  /** Sony reports colour separately; Sennheiser encodes it in the model. */
  colourCode?: number | null
  /**
   * Soundcore's Anker product code ("a3951"), read off the serial. The one
   * model identity its wire protocol offers — artwork resolves from this in
   * preference to the advertised name, which can be absent or truncated.
   */
  productCode?: string | null
  /** 0–100, where 0 is full cancelling and 100 full transparency. */
  noiseLevel: number | null
  ancEnabled: boolean | null
  /**
   * Whether the device is on the wearer's head; dims the render when it is
   * not. Defaults to true, because a driver that cannot tell should not dim.
   *
   * A boolean rather than the raw wear state this used to take: deciding
   * `wearState === WearState.OnHead` here meant a shared component importing
   * the GAIA enum, and neither of the two callers could pass anything but
   * `null` for Sony anyway. `DeviceDriver.worn` answers it per driver now.
   */
  worn?: boolean
  className?: string
}

/**
 * The product render, lit by noise-control state.
 *
 * The frame takes its aspect from the artwork itself (Sennheiser 2.016:1, Sony
 * 2.561:1) and the image fills it — a square frame would shrink the device to
 * the height and waste the width. Battery lives beside this as a bar rather
 * than a ring around it, for the same reason: a ring forces a square.
 */
export function DeviceImage({
  status,
  model,
  hasDevice = true,
  brand = 'sennheiser',
  colourCode,
  productCode,
  noiseLevel,
  ancEnabled,
  worn = true,
  className,
}: DeviceImageProps) {
  const connected = status === 'connected'
  const artwork = artworkFor(brand, model, colourCode, productCode)
  const level = noiseLevel ?? 50

  // CDN-served artwork can fail to load — offline, or a URL the vendor has
  // rotated. The swap order: remote hero → bundled fallback → placeholder
  // frame. Each failure is remembered so a failing src does not loop; the
  // comparison against the current hero self-heals when the src changes.
  const [failedHeroSrc, setFailedHeroSrc] = useState<string | null>(null)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const heroSrc = connected ? artwork.hero : artwork.heroInactive
  const heroFailed = failedHeroSrc === heroSrc
  const src = !heroFailed
    ? heroSrc
    : !fallbackFailed && artwork.fallback
      ? artwork.fallback
      : ''

  const cancelling = ancEnabled && connected ? Math.max(0, (50 - level) / 50) : 0
  const transparency = ancEnabled && connected ? Math.max(0, (level - 50) / 50) : 0

  // Showing a product render for a device we have never spoken to implies a
  // device is attached when none is.
  if (!hasDevice) {
    return (
      <div
        className={cn(
          'border-border text-muted-foreground/50 flex w-full items-center justify-center',
          'rounded-xl border border-dashed',
          className,
        )}
        style={{ aspectRatio: artwork.aspect }}
      >
        <RiHeadphoneLine className="size-8" aria-hidden />
        <span className="sr-only">No device connected</span>
      </div>
    )
  }

  // Artwork that failed with nowhere local to fall back to — say so with the
  // placeholder rather than an empty frame.
  if (src === '') {
    return (
      <div
        className={cn(
          'border-border text-muted-foreground/50 flex w-full items-center justify-center',
          'rounded-xl border border-dashed',
          className,
        )}
        style={{ aspectRatio: artwork.aspect }}
      >
        <RiHeadphoneLine className="size-8" aria-hidden />
        <span className="sr-only">Product art unavailable</span>
      </div>
    )
  }

  return (
    <div
      className={cn('relative w-full', className)}
      style={{ aspectRatio: artwork.aspect }}
    >
      {/* Cancelling: light gathering behind the cups. */}
      <div
        className="bg-primary/40 absolute inset-x-[15%] inset-y-[5%] rounded-full blur-2xl transition-opacity duration-500"
        style={{ opacity: cancelling }}
      />

      {/* Transparency: sound coming in, so rings radiate outward. */}
      {transparency > 0 && (
        <svg
          viewBox="-100 -50 200 100"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          <g className="text-primary" opacity={transparency}>
            {[34, 44, 54].map((radius, index) => (
              <ellipse
                key={radius}
                rx={radius * 1.7}
                ry={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={0.7}
                opacity={0.5 - index * 0.14}
              />
            ))}
          </g>
        </svg>
      )}

      <img
        src={src}
        onError={() => (heroFailed ? setFallbackFailed(true) : setFailedHeroSrc(heroSrc))}
        alt={model ?? 'Connected headphones'}
        draggable={false}
        className={cn(
          'relative size-full object-contain transition-opacity duration-500',
          connected && !worn && 'opacity-60',
        )}
      />
    </div>
  )
}

interface BatteryBarProps {
  battery: number | null
  charging: boolean | null
  className?: string
}

/** Battery as a bar, so the device render is not constrained to a square. */
export function BatteryBar({ battery, charging, className }: BatteryBarProps) {
  const tone =
    battery !== null && battery <= 15
      ? '[&_[data-slot=progress-indicator]]:bg-destructive'
      : battery !== null && battery <= 30
        ? '[&_[data-slot=progress-indicator]]:bg-amber-500'
        : undefined

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Progress
        value={battery ?? 0}
        aria-label="Battery"
        className={cn(
          'flex-1 [&_[data-slot=progress-track]]:h-1.5',
          tone,
          charging && 'animate-pulse',
        )}
      />
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {battery === null ? '—' : `${battery}%`}
      </span>
    </div>
  )
}
