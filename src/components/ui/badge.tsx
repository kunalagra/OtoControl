import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A status pill, DESIGN-GUIDE §3: "Pills (tabs, sm buttons, status)". Only the
 * `destructive` badge is red — red means a state the user has to react to, and
 * a badge that is red in every state teaches them to ignore it. The default
 * badge is the inverted block, the same pairing the default button and the
 * active tab use, so "this is the one" looks the same everywhere.
 *
 * The focus ring is spec §8's 2px foreground rule with its 2px offset, which
 * matters more here than anywhere else: the default badge is `bg-foreground`, so
 * an unoffset foreground ring on it is the same colour as the badge.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-[2px] focus-visible:ring-ring focus-visible:ring-offset-[2px] focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background [a]:hover:bg-foreground/80",
        secondary:
          "bg-surface-raised text-foreground [a]:hover:bg-accent",
        destructive:
          // No `focus-visible:ring-destructive/20` here, which the stock shadcn
          // variant carries and which the redesign dropped everywhere else: the
          // badge *is* `--signal`, so a red ring at 20% is red on red — and
          // because tailwind-merge reads the two ring colours as one property,
          // writing it here deletes the base's `ring-ring` rather than losing a
          // cascade, taking the visible ring with it. The red ring that does
          // belong to a state is in the base, keyed on `aria-invalid`.
          "bg-signal text-black [a]:hover:bg-signal/80",
        // Kept bordered: the outline badge is floating chrome — the connection
        // status token in the top bar — and the guide allows a 1px border
        // there. `AppShell`'s status pill still sets a border colour.
        outline:
          "border-border text-foreground [a]:hover:bg-accent [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-accent hover:text-muted-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
