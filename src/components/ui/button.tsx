import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Buttons, DESIGN-GUIDE §5.2. The default is inverted — a white (or black)
 * block on a dark tile — because a filled block is the only grouping the guide
 * allows. Red is not a button colour: `--signal` is reserved for *selected*,
 * *live*, and *the value you are changing*, so only the two variants that
 * state something carry it.
 *
 * Focus is drawn with a ring rather than a border, so the base has no
 * `border border-transparent` to override and no variant has to opt out of one.
 * The ring is spec §8's: 2px of `--ring`, 2px clear of the button. The offset is
 * not decoration — the default variant *is* `bg-foreground`, so a foreground ring
 * with no gap between it and the button is the button's own colour against
 * itself, and the one control whose focus must never be missed is the one that
 * would lose it.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[14px] text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-[2px] focus-visible:ring-ring focus-visible:ring-offset-[2px] focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background font-bold",
        outline: "bg-surface-raised text-foreground hover:bg-accent",
        // No guide entry, so it lands on the raised surface with `outline`
        // rather than on a fill the palette has no room for.
        secondary: "bg-surface-raised text-foreground hover:bg-accent",
        ghost: "hover:bg-accent hover:text-foreground",
        destructive: "bg-signal text-black font-bold",
        /** The "selected" state for segment-like buttons. Additive. */
        signal: "bg-signal text-black font-bold",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "gap-1.5 rounded-[14px] px-3 py-2.5 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "gap-1 rounded-full px-2.5 py-1 text-[11px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        // A pill, per the guide. A caller that needs 44px on a phone adds
        // `min-h-11 min-w-11` — hit slop where the button has room around it
        // (the top bar's own controls), the taller button where it fills its row
        // and slop would land on a neighbour's tap (the two pickers, the preset
        // chips). Both spellings are in `DeviceMenu`, and
        // the choice between them is written down where it is made.
        sm: "gap-1 rounded-full px-3 py-1.5 text-[11px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "gap-1.5 rounded-[14px] px-4 py-3 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9 rounded-[14px]",
        "icon-xs": "size-6 rounded-[14px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[14px]",
        "icon-lg": "size-10 rounded-[14px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
