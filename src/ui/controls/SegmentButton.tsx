import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

interface SegmentButtonProps {
  /** The option's own name — the accessible name unless `ariaLabel` overrides it. */
  label: string
  /**
   * The second line a mode card carries, e.g. "Follows your surroundings".
   * Omitted for a plain chip, which is the same control with one line.
   */
  hint?: string
  pressed: boolean
  disabled?: boolean
  onSelect(): void
  /**
   * A spoken name for an option whose visible text is not the whole name —
   * Sony's prompt volume shows `+1` and reads "Prompt volume +1".
   */
  ariaLabel?: string
  /**
   * The primitive's three sizes, which is also the *type* size: `sm` is the
   * guide's small chip (11px), `default` a 12px chip, `lg` a 14px label. The
   * label takes no size class of its own so that one prop decides the
   * typography, and a call site overrides only the padding (`className`) when
   * its old geometry differed.
   */
  size?: 'sm' | 'default' | 'lg'
  className?: string
}

/**
 * One option in a driver's own set of choices — a noise mode, an EQ preset, a
 * touch assignment, a codec preference. DESIGN-GUIDE §5.3's segmented control,
 * minus the group.
 *
 * **Why a component and not a `ToggleGroupItem`.** These are fourteen
 * single-select controls across nine driver sections that each own their
 * callback, and the drivers have always fired it on *every* click — including a
 * click on the option already chosen, which re-sends the write. A `ToggleGroup`
 * is a multi-select value array with roving focus, a deselect path and a
 * wrapper element, so routing these through it would change the callback
 * semantics the fix has to leave alone. A standalone `Toggle` renders the same
 * `<button aria-pressed>` the code had and takes the same selected recipe, so
 * nothing about the control changes but its paint.
 *
 * The other two of the sixteen sites the final review counted are the Sony and
 * Nothing *capability chips* — `<span>`s carrying the same red wash for an
 * unrelated reason, which are the raised surface now (`selectedLook.test.tsx`
 * says why) and have nothing to do with this component.
 *
 * The pair that used to be open-coded at every site —
 * `border-primary bg-primary/10` for selected, `border-border
 * hover:border-muted-foreground/40` for the rest — was the *pre-Mono* selected
 * look, and a red outline over a 10% wash is not a thing in this design
 * system: §1.1 reserves red for selected / live / the value being changed and
 * §1.2 retires outlines, so both halves are now the primitive's.
 */
export function SegmentButton({
  label,
  hint,
  pressed,
  disabled = false,
  onSelect,
  ariaLabel,
  size = 'default',
  className,
}: SegmentButtonProps) {
  return (
    <Toggle
      pressed={pressed}
      disabled={disabled}
      onClick={onSelect}
      aria-label={ariaLabel}
      size={size}
      // A two-line card is a column, left-aligned, at the padding these have
      // always had, and *all* of these are overrides of the primitive's own
      // recipe rather than additions — which is the part worth knowing, because
      // each one is load-bearing and none of them looks like it:
      //
      // - `whitespace-normal`, for every option, chip or card. The primitive is
      //   `whitespace-nowrap`, and a nowrap line in a 129px content box does not
      //   shrink or ellipsise, it overflows. Measured in Chrome on Nothing's ANC
      //   levels: "Noise cancelling · medium" is 177.5px of 14px text in a 149.2px
      //   card, and it ran off the right edge over the neighbouring card. The
      //   open-coded buttons these replaced wrapped, so this restores that.
      // - `items-stretch` and `justify-start`, for the card. A column flex's
      //   cross axis is horizontal, so the primitive's `items-center` sizes each
      //   line to its own content rather than the card's — the same overflow by
      //   a different route — and `justify-center` is right for a chip and wrong
      //   for a two-line block.
      className={cn(
        'whitespace-normal',
        hint && 'flex-col items-stretch justify-start gap-0.5 text-left',
        className,
      )}
    >
      {/* No size class: the button's `size` sets the type scale, and the
          pressed weight has to be restated here because this span carries its
          own `font-medium` and would otherwise win over the inherited bold. */}
      <span className="font-medium group-data-pressed/toggle:font-bold">{label}</span>
      {hint && (
        <span className="text-muted-foreground text-[11px] leading-tight group-data-pressed/toggle:text-black/80">
          {hint}
        </span>
      )}
    </Toggle>
  )
}
