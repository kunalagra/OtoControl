import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * An inline message. The destructive variant's text goes through
 * `--signal-strong`, not `--destructive` (spec §8): the alert sits on a block,
 * and `#ff4d3d` on `#f2f2f2` is 2.9 : 1, which fails AA for body text, while
 * `--signal-strong` on the same ground is 5.1 : 1. In dark the two tokens are the
 * same value, so one class is right in both themes and the mistake cannot be
 * made twice. The description is *not* the same colour at 90% — an alpha'd red
 * over a light block lands at about 4.4 : 1, which is under AA, and the
 * description is where the actual sentence is.
 *
 * The light-theme token was `#d92b1c` until the last review, and the comment
 * here said 4.9 : 1 for it. That figure is real and it is measured on **white**:
 * on this alert's own `#f2f2f2` the same red is 4.35 : 1, and on the raised
 * `#e6e6e6` it is 3.90 : 1 — both under AA, which is what the token is here to
 * prevent. The token is `#c72414` (5.08 and 4.56 on those grounds); the numbers
 * are computed in `theme.test.ts` rather than quoted in a comment.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-2xl border px-4 py-3 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-signal-strong *:data-[slot=alert-description]:text-signal-strong *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
