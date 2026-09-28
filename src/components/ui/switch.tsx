import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * The Mono switch, DESIGN-GUIDE §5.4: a 40×24 track in the unlit segment
 * colour, an 18px knob inset by 3px, and the two states inverted against each
 * other — foreground track with a background knob when on, so the knob reads as
 * a hole rather than as a second block.
 *
 * The inset is padding on the track, not a border: a 2px border used to supply
 * it, which put a ring on a control the guide draws with fill alone. The
 * checked translation is therefore 40 − 18 − 2×3 = 16px.
 *
 * `size` is unchanged, and the small switch keeps the same relationship
 * (32 − 14 − 2×3 = 12px).
 *
 * The `after` pseudo-element is the touch target, not a decoration: the track is
 * 40×24 and spec §8 asks for 44×44 on a phone, so the box reaches 10px past the
 * track vertically (44px tall) and 12px each way horizontally (64px). It is
 * transparent and behind nothing, so it costs no layout and shows nothing.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full p-[3px] outline-none transition-colors after:absolute after:-inset-x-3 after:-inset-y-2.5 focus-visible:ring-[2px] focus-visible:ring-ring focus-visible:ring-offset-[2px] focus-visible:ring-offset-background aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-6 data-[size=default]:w-10 data-[size=sm]:h-5 data-[size=sm]:w-8 data-checked:bg-foreground data-unchecked:bg-segment-off data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        data-size={size}
        className={cn(
          // The knob's only motion is a selection state, so it animates for
          // 150ms. Nothing else about it moves.
          "pointer-events-none block rounded-full transition-transform duration-150 ease-out data-checked:bg-background data-unchecked:translate-x-0 data-unchecked:bg-[#777] data-[size=default]:size-[18px] data-[size=default]:data-checked:translate-x-4 data-[size=sm]:size-[14px] data-[size=sm]:data-checked:translate-x-3"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
