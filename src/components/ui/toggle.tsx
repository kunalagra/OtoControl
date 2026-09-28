import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A segmented choice, DESIGN-GUIDE §5.3: a 14px block on the raised surface,
 * and signal with black bold text while it is the selected one.
 *
 * The selection keys off `data-pressed`, which is what Base UI's Toggle emits.
 * (`data-state="on"` is the Radix spelling and matches nothing here — the old
 * `aria-pressed:bg-muted` was doing all the work.)
 *
 * `hover:bg-accent` deliberately sits *before* the selected state in the class
 * list, and both are unprefixed background utilities, so which one wins is
 * decided by stylesheet order rather than by the order written here. Radix
 * users fix that with `data-[state=on]:` (a specific variant) beating
 * `hover:` (an at-rule variant); Base UI's bare `data-pressed:` does not, so
 * this is pinned by test instead.
 */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-[14px] bg-surface-raised text-center text-foreground whitespace-nowrap transition-colors duration-150 ease-out outline-none hover:bg-accent data-pressed:bg-signal data-pressed:text-black data-pressed:font-bold focus-visible:ring-[2px] focus-visible:ring-ring focus-visible:ring-offset-[2px] focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "",
        // The guide draws every segment the same way; the old outline existed
        // only to paint a border, which the design retires.
        outline: "",
      },
      size: {
        default:
          "px-3 py-2.5 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        sm: "px-2.5 py-1.5 text-[11px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "px-4 py-3 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
