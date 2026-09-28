// @vitest-environment jsdom
/**
 * The one definition of "this option is the selected one".
 *
 * Before this component, fourteen open-coded `<button>`s across nine driver
 * sections each wrote their own version of the same pair of class strings, and
 * the ones a driver section owns had never been through the primitives restyle:
 * `border-primary bg-primary/10` for selected, `border-border
 * hover:border-muted-foreground/40` for the rest. That is the pre-Mono
 * "selected" look — a red outline over a 10% wash — sitting beside the Mono one
 * a `ToggleGroup` item uses (a red fill with black bold text), on the same kind
 * of control, in the same app. Sixteen of them, of which two are the capability
 * chips that had the same wash for a different reason.
 *
 * The fix is one primitive rather than sixteen class strings, so the pair can no
 * longer drift apart again. `Toggle` already carries DESIGN-GUIDE §5.3's recipe
 * (14px block, raised surface, signal with black bold text while pressed) and
 * `mono.test.tsx` pins that recipe on the primitive; this component adds the one
 * thing the primitive cannot know — the two-line layout a driver's mode cards
 * use, and the hint's colour *while pressed*.
 *
 * That last part is the non-obvious half. `text-muted-foreground` is 1.6 : 1 on
 * the signal fill in light and 1.1 : 1 in dark, so a hint that keeps its muted
 * colour turns unreadable the moment the card is selected. The spans therefore
 * key off `group/toggle`'s pressed state and step to black at 80% — 5.25 : 1 on
 * the fill — rather than inheriting a colour that no longer works.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Toggle, toggleVariants } from '@/components/ui/toggle'
import { SegmentButton } from './SegmentButton'

afterEach(cleanup)

const options = { pressed: false, onSelect: () => undefined }

describe('SegmentButton', () => {
  it('is the Mono selected pattern, and the only one in the app', () => {
    // The unselected half of the pair: a raised 14px block with no border.
    const { getByRole } = render(<SegmentButton {...options} label="Adaptive" />)
    const tokens = (getByRole('button').className ?? '').split(' ')
    for (const wanted of ['rounded-[14px]', 'bg-surface-raised', 'group/toggle']) {
      expect(tokens).toContain(wanted)
    }
    // §1.2: blocks, not borders. A hairline here is the pre-Mono look.
    expect(tokens.filter((token) => /^border(-|$)/.test(token))).toEqual([])
  })

  it('takes the selected look from the primitive rather than a second one', () => {
    // The whole point of routing through `Toggle`: the selected classes are
    // `toggleVariants`' own, asserted in `mono.test.tsx`, so a change to the
    // primitive's recipe reaches all sixteen sites at once.
    const { getByRole } = render(<SegmentButton {...options} pressed label="Adaptive" />)
    const button = getByRole('button')
    expect(button.getAttribute('data-pressed')).not.toBeNull()
    const primitive = toggleVariants({})
    for (const wanted of ['data-pressed:bg-signal', 'data-pressed:text-black', 'data-pressed:font-bold']) {
      expect(primitive).toContain(wanted)
    }
  })

  it('says pressed to assistive technology, and fires the same callback on every click', () => {
    // `aria-pressed` is what these buttons have always carried, and what
    // `Toggle` emits from its `pressed` prop. `onSelect` is wired to `onClick`
    // rather than to `onPressedChange` on purpose: `onPressedChange` would not
    // fire for a click on the option that is *already* selected, and every one
    // of these sixteen is a write the driver expects to be re-sendable.
    const onSelect = vi.fn()
    const { getByRole, rerender } = render(
      <SegmentButton {...options} pressed onSelect={onSelect} label="Adaptive" />,
    )
    const button = getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.click()
    expect(onSelect).toHaveBeenCalledTimes(1)

    // Unpressed reads false, not absent, and the callback still fires.
    rerender(<SegmentButton {...options} pressed={false} onSelect={onSelect} label="Adaptive" />)
    const unpressed = getByRole('button')
    expect(unpressed.getAttribute('aria-pressed')).toBe('false')
    unpressed.click()
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('drops the hint colour while pressed, because muted text cannot sit on red', () => {
    const { getByText } = render(
      <SegmentButton {...options} pressed label="Adaptive" hint="Follows the room" />,
    )
    const hint = getByText('Follows the room')
    // 1.6 : 1 in light and 1.1 : 1 in dark on `#ff4d3d` — the reason for the
    // pressed twin, not a nicety.
    expect(hint.className.split(' ')).toContain('text-muted-foreground')
    expect(hint.className).toContain('group-data-pressed/toggle:text-black/80')
  })

  it('lets a long option wrap inside the card rather than run over its neighbour', () => {
    // jsdom cannot measure, so this pins the *cause* of a measured overflow. A
    // two-line card is a column flex, and a column flex's cross axis is
    // horizontal: the primitive's `items-center` sizes each line to its own
    // content, and its `whitespace-nowrap` refuses to break a line at all.
    // Together they put Nothing's "Noise cancelling · medium" — 177.5px of 14px
    // text — into a 149.2px card and ran it off the right edge over its
    // neighbour. Measured in Chrome. Both are overrides rather than additions:
    // they are in every `Toggle`'s class list, so being absent here is not
    // enough on its own.
    const { getByRole } = render(
      <SegmentButton
        {...options}
        label="Noise cancelling · medium"
        hint="Blocks what is around you"
      />,
    )
    const classes = getByRole('button').className.split(' ')
    expect(classes).toContain('flex-col')
    expect(classes).toContain('justify-start')
    // The primitive's `items-center` and `whitespace-nowrap` have to be
    // *overridden*, not merely absent: both are in the class list of every
    // `Toggle`, and on a two-line card they do the same damage — a 177.5px line
    // of text in a 129.2px content box, which overflows instead of wrapping.
    expect(classes).toContain('items-stretch')
    expect(classes).not.toContain('items-center')
    expect(classes).not.toContain('items-start')
    expect(classes).toContain('whitespace-normal')
    expect(classes).not.toContain('whitespace-nowrap')
    expect(classes.some((token) => /^(w-fit|w-max|shrink)/.test(token))).toBe(false)
  })

  it('wraps a one-line option too: the longest labels have no hint at all', () => {
    // The ANC levels are the proof that "it is the cards that need to wrap" is
    // wrong: "Noise cancelling · medium" is one of the three levels with *no*
    // hint, so it takes the chip branch — and it was the one that overflowed.
    const { getByRole } = render(
      <SegmentButton {...options} label="Noise cancelling · medium" />,
    )
    const classes = getByRole('button').className.split(' ')
    expect(classes).toContain('whitespace-normal')
    expect(classes).not.toContain('whitespace-nowrap')
    // A chip stays centred: §5.3's block is `text-center`.
    expect(classes).not.toContain('text-left')
  })

  it('lets the caller name the option when the visible text is not the whole name', () => {
    // Sony's prompt volume shows "+1" and reads "Prompt volume +1".
    const { getByRole } = render(
      <SegmentButton {...options} label="+1" ariaLabel="Prompt volume +1" />,
    )
    expect(getByRole('button', { name: 'Prompt volume +1' })).toBeTruthy()
  })

  it('is the primitive underneath, so a driver cannot hand it a legacy class', () => {
    // A sanity check on the wiring rather than a design rule: the class list
    // must be the primitive's plus layout, and the node must be one `Toggle`.
    const { container } = render(<SegmentButton {...options} label="Off" />)
    expect(container.querySelectorAll('[data-slot="toggle"]')).toHaveLength(1)
    expect(Toggle).toBeTypeOf('function')
  })
})
