import { RiHeadphoneLine } from '@remixicon/react'

import { WearState } from '@/gaia/commands'
import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@/device/state'
import { artworkFor } from './artwork'
import type { Brand } from '@/device/brand'

interface DeviceImageProps {
  status: ConnectionStatus
  model: string | null
  /** False when no device has identified itself; shows a placeholder instead. */
  hasDevice?: boolean
  /** Selects which vendor's renders to use. */
  brand?: Brand
  /** Sony reports colour separately; Sennheiser encodes it in the model. */
  colourCode?: number | null
  /** 0–100, where 0 is full cancelling and 100 full transparency. */
  noiseLevel: number | null
  ancEnabled: boolean | null
  wearState: number | null
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
  noiseLevel,
  ancEnabled,
  wearState,
  className,
}: DeviceImageProps) {
  const connected = status === 'connected'
  const worn = wearState === null || wearState === WearState.OnHead
  const artwork = artworkFor(brand, model, colourCode)
  const level = noiseLevel ?? 50

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
        src={connected ? artwork.hero : artwork.heroInactive}
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
    battery === null
      ? 'bg-muted-foreground/30'
      : battery <= 15
        ? 'bg-destructive'
        : battery <= 30
          ? 'bg-amber-500'
          : 'bg-primary'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Battery"
        aria-valuenow={battery ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-700',
            tone,
            charging && 'animate-pulse',
          )}
          style={{ width: `${battery ?? 0}%` }}
        />
      </div>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {battery === null ? '—' : `${battery}%`}
      </span>
    </div>
  )
}
