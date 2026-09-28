"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

/**
 * Popovers, for the shell's two disclosures: the device switcher and the
 * "Add device" pill. Kept as a primitive rather than open-coded in the top bar
 * because a disclosure that renders its content in the DOM while closed would
 * put two connection pickers on screen that cannot be reached.
 *
 * No guide entry of its own, so it takes the same block as everything else in
 * the palette: a 14px rounded popover on the popover surface. The focus ring
 * comes from the ring token, never from a border.
 *
 * **The `ring-1` stays and the `shadow-lg` goes**, which is a decision about
 * DESIGN-GUIDE §1.2 rather than an oversight. §1.2 retires outlines and drop
 * shadows as a way of *grouping*, and names two things that keep an edge: the
 * floating chrome (the pill bar) and dividers inside a list. A popover is the
 * first of those — it floats over the page, and the switcher opens over a
 * `#f2f2f2` block it would otherwise be indistinguishable from — so it keeps a
 * single hairline, the same exception the pill bar takes. A shadow is not that
 * exception: it is a soft gradient that adds depth the palette does not have,
 * and on the dark theme, which is the primary one, it renders as a black blur
 * on a black page and is literally invisible. So the ring carries the whole job.
 *
 * The same reasoning is applied to `select.tsx`'s popup, which is the same
 * primitive wearing a different face.
 */
const Popover = PopoverPrimitive.Root

function PopoverTrigger({
  className,
  ...props
}: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    />
  )
}

function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 8,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-(--anchor-width) min-w-44 origin-(--transform-origin) rounded-[14px] bg-popover text-popover-foreground ring-1 ring-border outline-none transition-[transform,scale,opacity] duration-150 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-open:scale-100 data-open:opacity-100 data-closed:scale-95 data-closed:opacity-0",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
