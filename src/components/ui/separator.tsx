"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

/**
 * Already the one primitive the Mono rules ask for, unchanged: DESIGN-GUIDE §1.2
 * allows a 1px border "on floating chrome (the pill bar) and dividers inside
 * lists", and this is that divider. `--border` is `#1f1f1f` on a `#111111`
 * block, which is what keeps the row seams visible without an outline.
 */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
