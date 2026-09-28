import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The Mono block, DESIGN-GUIDE §5.1: a filled rounded block on the page
 * surface, grouped by fill and never by a border or a shadow.
 *
 * The padding is the guide's own width rule (DESIGN-GUIDE §3): 18px, tightening
 * to 14px on a phone. Fifteen of the seventeen driver sections are read on a
 * phone first, and 18px of inset around a 13px label is a lot of block and very
 * little content.
 *
 * `size` is the density knob the 17 driver sections already pass — mostly as a
 * raw `data-size="sm"` rather than the prop — so the small padding hangs off the
 * data attribute and both spellings land on the same 14px. The `md:` twin is not
 * redundant: a responsive variant sorts *after* an attribute variant of the same
 * specificity, so without it the small block would be 14px on a phone and 18px
 * on a desktop, which is not what "small" means anywhere else in the design.
 *
 * `size` is the density knob the 17 driver sections already pass — mostly as a
 * raw `data-size="sm"` rather than the prop — so the small padding hangs off
 * the data attribute and both spellings land on the same 14px.
 *
 * `variant` is additive. Each one supplies the whole background, never an
 * override of the base one: Tailwind emits background utilities in theme order,
 * so two of them on one element is a race decided by the stylesheet rather than
 * by this file.
 */
type CardVariant = "default" | "hero" | "inverted"

const CARD_VARIANTS: Record<CardVariant, string> = {
  default: "bg-card",
  /** The dotted texture marks the showpiece, and nothing else. */
  hero: "mono-dots",
  /** The battery block is inverted in both themes. */
  inverted: "bg-foreground text-background",
}

function Card({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  variant?: CardVariant
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(
        "group/card flex flex-col gap-3 overflow-hidden rounded-[26px] p-[14px] text-sm text-card-foreground md:p-[18px] data-[size=sm]:gap-2.5 data-[size=sm]:p-[14px] md:data-[size=sm]:p-[14px]",
        CARD_VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
}

/**
 * Title left, optional action right. The grid is what puts the action in the
 * second column while keeping `CardDescription` stacked under the title, which
 * a plain flex row would not do.
 */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className
      )}
      {...props}
    />
  )
}

/** The Caption role, DESIGN-GUIDE §4: 10px, 500, uppercase, wide tracking, muted. */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[11px] text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

/** No padding of its own — the block pads. `min-w-0` so a long row can shrink. */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("min-w-0", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
