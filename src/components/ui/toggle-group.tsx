"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

/** 6px, the gap DESIGN-GUIDE §5.3 puts between the blocks. */
const DEFAULT_SPACING = 1.5

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: DEFAULT_SPACING,
  orientation: "horizontal",
})

/**
 * A segmented choice, DESIGN-GUIDE §5.3. The container is deliberately
 * unadorned — no fill, no radius, nothing between the blocks but the gap — so
 * that the blocks read as peers sitting straight on the tile.
 *
 * The gap is `spacing` Tailwind steps, applied through a custom property so the
 * class is a single `calc()` rather than one utility per possible value. It has
 * to be that `calc()`: `gap-(--gap)` alone would be spacing steps, not pixels,
 * and the author asking for `spacing={2}` means 8px.
 */
function ToggleGroup({
  className,
  variant,
  size,
  spacing = DEFAULT_SPACING,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[calc(var(--spacing)*var(--gap))] data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

/**
 * One block of the group. `flex-1` is what makes the blocks *equal* — but only
 * where the row has a width to divide, which is why the ANC-scene chip rows
 * (a `w-fit` group) keep their content-sized pills without having to opt out.
 */
function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "flex-1 min-w-0 focus-visible:z-10",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
