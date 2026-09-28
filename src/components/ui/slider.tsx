import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * The Mono slider, DESIGN-GUIDE §5.5: an 8px track in the unlit segment
 * colour, a foreground fill, and a 20px round thumb separated from the track by
 * a 3px background ring.
 *
 * While the pointer is down, the fill and the thumb go signal — red marks the
 * value you are changing, which is the third of the three meanings the guide
 * allows it. Base UI puts `data-dragging` on the root, the track, the indicator
 * and the thumb alike, so each of them styles itself.
 *
 * Nothing transitions. The thumb follows the finger, and any easing on it would
 * be lag (DESIGN-GUIDE §6).
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-segment-off select-none data-horizontal:h-2 data-horizontal:w-full data-vertical:h-full data-vertical:w-2"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-foreground select-none data-dragging:bg-signal data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            // The thumb's own 3px `ring-background` is the guide's separation
            // between the thumb and the fill (DESIGN-GUIDE §5.5); the focus
            // outline is spec §8's, 2px of `--ring` with a 2px gap.
            className="block size-5 shrink-0 rounded-full bg-foreground ring-[3px] ring-background select-none data-dragging:bg-signal not-dark:bg-clip-padding focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-vertical:h-5 data-vertical:w-5"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
