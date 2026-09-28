/**
 * Mono restyle of the shadcn primitives — DESIGN-GUIDE §5.1–5.5, spec §6.2.
 *
 * There is no jsdom in this project's test setup (vitest runs in the node
 * environment), so nothing here "computes" a colour or measures a box. What it
 * can do — and what actually protects the design — is pin the **class
 * contract** each primitive promises: which utility carries which intent. The
 * utilities are the values; `--segment-off`, `bg-signal` and `rounded-[26px]`
 * are all that stand between the design guide and a generic button, and a
 * regression that swaps one for another has to fail here.
 *
 * Assertions are written against rendered markup rather than against the
 * `cva` class functions wherever the rendered element is what ships, so that a
 * component which computes the right classes and then drops them on the floor
 * still fails.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const ENTITIES: Array<[RegExp, string]> = [
  [/&quot;/g, '"'],
  [/&#x27;/g, "'"],
  [/&#39;/g, "'"],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&amp;/g, '&'],
]

const decode = (value: string): string =>
  ENTITIES.reduce((acc, [find, put]) => acc.replaceAll(find, put), value)

/**
 * Every opening tag that carries `attribute` *as an attribute*. The negative
 * lookahead is what keeps `data-pressed:bg-signal` inside a class list from
 * being read as `data-pressed` on the element.
 */
const tagsWithAttribute = (markup: string, attribute: string): string[] => {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\s${escape(attribute)}(?![-\\w:])`)
  return (markup.match(/<[a-z][^>]*>/g) ?? []).filter((tag) => pattern.test(decode(tag)))
}

/** The opening tag of the element carrying `data-slot="<slot>"`. */
const tagOf = (markup: string, slot: string): string => {
  const tag = tagsWithAttribute(markup, `data-slot="${slot}"`)[0]
  if (!tag) throw new Error(`no element with data-slot="${slot}" in:\n${markup}`)
  return decode(tag)
}

/** The class list of the element carrying `data-slot="<slot>"`. */
const classesOf = (markup: string, slot: string): string[] => {
  const match = tagOf(markup, slot).match(/class="([^"]*)"/)
  if (!match?.[1]) throw new Error(`the element with data-slot="${slot}" has no class attribute`)
  return match[1].split(/\s+/).filter(Boolean)
}

/** The class list of the first element carrying `attribute` as an attribute. */
const classesWhere = (markup: string, attribute: string): string[] => {
  const tag = tagsWithAttribute(markup, attribute)[0]
  if (!tag) throw new Error(`no element carries ${attribute} in:\n${markup}`)
  const match = decode(tag).match(/class="([^"]*)"/)
  if (!match?.[1]) throw new Error(`the element carrying ${attribute} has no class attribute`)
  return match[1].split(/\s+/).filter(Boolean)
}

/** The utility a class token sets, with any `variant:` prefix stripped. */
const utilityOf = (token: string): string => token.split(':').pop() ?? token

/**
 * Design-guide §1.2: "Blocks, not borders. Group with filled rounded blocks on
 * a darker ground. Don't use outlines or drop shadows." A single `ring-1` on a
 * card is exactly the decoration the guide retires, and it is invisible in the
 * Mono palette anyway — so its presence is asserted absent.
 */
const ringOrShadow = (tokens: string[]): string[] =>
  tokens.filter((token) => /^(ring|shadow)(-|$)/.test(utilityOf(token)))

const borders = (tokens: string[]): string[] =>
  tokens.filter((token) => /^border(-|$)/.test(utilityOf(token)))

/** Badge renders through `useRender`, so it is read the same way as the rest. */
const badge = (variant: 'default' | 'secondary' | 'destructive') =>
  classesOf(renderToStaticMarkup(<Badge variant={variant}>LIVE</Badge>), 'badge')

describe('Card (DESIGN-GUIDE 5.1)', () => {
  const markup = renderToStaticMarkup(
    <Card>
      <CardHeader>
        <CardTitle>Battery</CardTitle>
        <CardDescription>Left, right, case</CardDescription>
      </CardHeader>
      <CardContent>78%</CardContent>
    </Card>,
  )

  it('is a 26px block on the card surface, 14px in on a phone and 18px from md', () => {
    // DESIGN-GUIDE §3 gives block padding as "18px (phone 14px)", and fifteen of
    // the seventeen driver sections are read on a phone first.
    const tokens = classesOf(markup, 'card')
    for (const wanted of ['rounded-[26px]', 'bg-card', 'p-[14px]', 'md:p-[18px]']) {
      expect(tokens).toContain(wanted)
    }
  })

  it('carries no ring and no shadow', () => {
    expect(ringOrShadow(classesOf(markup, 'card'))).toEqual([])
  })

  it('tightens to 14px on the small block, at both widths', () => {
    // 17 call sites pass `data-size="sm"` as a raw prop rather than `size`, so
    // the small padding has to hang off the data attribute, not the prop. The
    // `md:` twin is the part that is easy to leave off: a responsive variant
    // sorts *after* an attribute variant of equal specificity, so the small
    // block silently becomes 18px on a desktop and 14px on a phone — a density
    // that changes with the width, which is not what any other "sm" means.
    const small = renderToStaticMarkup(
      <Card data-size="sm">
        <CardContent>x</CardContent>
      </Card>,
    )
    expect(classesOf(small, 'card')).toContain('data-[size=sm]:p-[14px]')
    expect(classesOf(small, 'card')).toContain('md:data-[size=sm]:p-[14px]')
  })

  it('keeps the header a title-left/action-right row', () => {
    // The guide asks for a row; the existing grid mechanism already puts the
    // title left and `CardAction` right, and it also stacks `CardDescription`
    // under the title, which a plain flex row would not.
    expect(classesOf(markup, 'card-header')).toContain(
      'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
    )
  })

  it('sets CardTitle in the caption role: 10px, 500, uppercase, wide tracking, muted', () => {
    const tokens = classesOf(markup, 'card-title')
    for (const wanted of ['text-[10px]', 'font-medium', 'uppercase', 'tracking-[.14em]']) {
      expect(tokens).toContain(wanted)
    }
    expect(tokens).toContain('text-muted-foreground')
  })

  it('sets CardDescription at 11px muted', () => {
    const tokens = classesOf(markup, 'card-description')
    expect(tokens).toContain('text-[11px]')
    expect(tokens).toContain('text-muted-foreground')
  })

  it('leaves the padding to the block: CardContent adds none of its own', () => {
    expect(borders(classesOf(markup, 'card-content'))).toEqual([])
    for (const token of classesOf(markup, 'card-content')) {
      expect(utilityOf(token)).not.toMatch(/^p[trblxy]?(-|$)/)
    }
  })

  it('dresses the hero block with the dotted texture', () => {
    const hero = renderToStaticMarkup(
      <Card variant="hero">
        <CardContent>x</CardContent>
      </Card>,
    )
    expect(classesOf(hero, 'card')).toContain('mono-dots')
    // The texture utility carries the surface colour itself; asserting `hero`
    // is distinct from the plain block keeps the two from collapsing.
    expect(classesOf(hero, 'card')).toContain('rounded-[26px]')
  })

  it('inverts the battery block: foreground ground, background text', () => {
    const inverted = renderToStaticMarkup(
      <Card variant="inverted">
        <CardContent>78%</CardContent>
      </Card>,
    )
    const tokens = classesOf(inverted, 'card')
    expect(tokens).toContain('bg-foreground')
    expect(tokens).toContain('text-background')
  })
})

describe('Button (DESIGN-GUIDE 5.2)', () => {
  const markup = (props: Record<string, unknown>) =>
    renderToStaticMarkup(<Button {...props}>Press</Button>)
  const classes = (props: Record<string, unknown>) => classesOf(markup(props), 'button')

  it('inverts the default button: foreground ground, background text, bold', () => {
    const tokens = classes({})
    for (const wanted of ['bg-foreground', 'text-background', 'font-bold']) expect(tokens).toContain(wanted)
    // `bg-primary` is the red fill the redesign retires: red means selected,
    // live, or the value being changed — never "this is a button".
    expect(tokens).not.toContain('bg-primary')
  })

  it('makes the outline button a borderless raised block', () => {
    const tokens = classes({ variant: 'outline' })
    expect(tokens).toContain('bg-surface-raised')
    expect(tokens).toContain('text-foreground')
    expect(borders(tokens)).toEqual([])
  })

  it('keeps the ghost button text-only, with a raised hover', () => {
    const tokens = classes({ variant: 'ghost' })
    // "Ghost | text only, hover:bg-accent" — a ghost that carried a fill would
    // stop being the quiet variant and start competing with the default. Only
    // an *unprefixed* background counts; the hover surface is part of the
    // recipe.
    expect(tokens.filter((token) => !token.includes(':') && /^bg(-|$)/.test(token))).toEqual([])
    expect(tokens).toContain('hover:bg-accent')
  })

  it('paints destructive as the signal fill with black bold text', () => {
    for (const variant of ['destructive', 'signal'] as const) {
      const tokens = classes({ variant })
      for (const wanted of ['bg-signal', 'text-black', 'font-bold']) expect(tokens).toContain(wanted)
    }
  })

  it('offers signal as an additive variant alongside every variant it already had', () => {
    // The API is additive only: a caller that never asks for `signal` must keep
    // compiling and keep its look.
    for (const variant of ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const) {
      expect(buttonVariants({ variant })).toContain('inline-flex')
    }
    for (const size of ['xs', 'sm', 'default', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const) {
      expect(buttonVariants({ size })).toContain('inline-flex')
    }
    // Secondary has no guide entry, so it lands on the raised surface with
    // outline rather than on a red or bordered fill.
    expect(buttonVariants({ variant: 'secondary' })).toContain('bg-surface-raised')
    // Red is reserved for state, so a link reads as text, not as a red flag.
    expect(buttonVariants({ variant: 'link' })).not.toContain('text-primary')
  })

  it('rounds the sm button into a pill at 11px', () => {
    const tokens = classes({ size: 'sm' })
    expect(tokens).toContain('rounded-full')
    expect(tokens).toContain('text-[11px]')
    expect(tokens).not.toContain('rounded-[14px]')
  })

  it('rounds every other size to the 14px chip radius', () => {
    expect(classes({})).toContain('rounded-[14px]')
    expect(classes({ size: 'lg' })).toContain('rounded-[14px]')
  })

  it('takes its focus ring from the ring token rather than a border', () => {
    const tokens = classes({})
    expect(borders(tokens)).toEqual([])
    expect(tokens.some((token) => token.startsWith('focus-visible:ring'))).toBe(true)
  })

  it('rings focus 2px in the foreground with a 2px offset', () => {
    // Spec §8's exact recipe, and both halves of it are load-bearing: the
    // default button *is* `bg-foreground`, so an unoffset foreground ring on it
    // is the button's own colour against itself.
    const tokens = classes({})
    for (const wanted of [
      'focus-visible:ring-[2px]',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-[2px]',
      'focus-visible:ring-offset-background',
    ]) {
      expect(tokens).toContain(wanted)
    }
    // The stock 3px halo at 30% alpha is what this replaces.
    expect(tokens.some((token) => /ring-\[3px\]|ring-ring\/\d/.test(token))).toBe(false)
  })
})

describe('Switch (DESIGN-GUIDE 5.4)', () => {
  const markup = (checked: boolean) => renderToStaticMarkup(<Switch checked={checked} />)

  it('is a 40x24 track', () => {
    const tokens = classesOf(markup(false), 'switch')
    expect(tokens).toContain('data-[size=default]:h-6')
    expect(tokens).toContain('data-[size=default]:w-10')
  })

  it('keeps the small switch, at 32x20', () => {
    const tokens = classesOf(renderToStaticMarkup(<Switch size="sm" checked={false} />), 'switch')
    expect(tokens).toContain('data-[size=sm]:h-5')
    expect(tokens).toContain('data-[size=sm]:w-8')
  })

  it('is the unlit segment colour when off and the foreground when on', () => {
    const tokens = classesOf(markup(false), 'switch')
    expect(tokens).toContain('data-unchecked:bg-segment-off')
    expect(tokens).toContain('data-checked:bg-foreground')
    // The old track drew a 2px border to get its inset; the guide's track is
    // a plain filled pill.
    expect(borders(tokens)).toEqual([])
  })

  it('has an 18px knob: grey when off, background when on', () => {
    const tokens = classesOf(markup(false), 'switch-thumb')
    // The knob carries its own `data-size` rather than reaching through a group
    // variant, so the size rule is keyed on the knob itself.
    expect(tokens).toContain('data-[size=default]:size-[18px]')
    expect(tokens).toContain('data-unchecked:bg-[#777]')
    expect(tokens).toContain('data-checked:bg-background')
  })

  it('slides the knob 16px when checked — 3px inset, 18px knob, 40px track', () => {
    // Without a stated translation the knob would sit flush against the end of
    // the track, which is the off inset (3px) in the on state too.
    const tokens = classesOf(markup(true), 'switch-thumb')
    expect(tokens).toContain('data-[size=default]:data-checked:translate-x-4')
    expect(tokens).toContain('data-unchecked:translate-x-0')
  })

  it('animates the knob for 150ms and nothing else', () => {
    const tokens = classesOf(markup(false), 'switch-thumb')
    expect(tokens).toContain('transition-transform')
    expect(tokens).toContain('duration-150')
  })

  it('emits the state attributes the class contract keys off', () => {
    // Guards the assertions above from passing on classes that never match:
    // Base UI is what puts `data-checked` on the track and the knob.
    expect(markup(true)).toContain('data-checked')
    expect(markup(false)).toContain('data-unchecked')
  })
})

describe('Slider (DESIGN-GUIDE 5.5)', () => {
  const markup = renderToStaticMarkup(<Slider defaultValue={[40]} />)

  it('is an 8px track in the unlit segment colour', () => {
    const tokens = classesOf(markup, 'slider-track')
    expect(tokens).toContain('data-horizontal:h-2')
    expect(tokens).toContain('rounded-full')
    expect(tokens).toContain('bg-segment-off')
  })

  it('fills from the left in the foreground colour', () => {
    expect(classesOf(markup, 'slider-range')).toContain('bg-foreground')
  })

  it('takes a 20px round thumb in the foreground, ringed in the background colour', () => {
    const tokens = classesOf(markup, 'slider-thumb')
    for (const wanted of ['size-5', 'rounded-full', 'bg-foreground', 'ring-[3px]', 'ring-background']) {
      expect(tokens).toContain(wanted)
    }
  })

  it('turns the fill and the thumb signal while dragging', () => {
    expect(classesOf(markup, 'slider-range')).toContain('data-dragging:bg-signal')
    expect(classesOf(markup, 'slider-thumb')).toContain('data-dragging:bg-signal')
  })

  it('moves the thumb with no transition at all', () => {
    // Design-guide §6: motion is for selection colour only. A transition on
    // position is lag under the finger, which is the one thing the redesign
    // is meant to remove.
    const tokens = classesOf(markup, 'slider-thumb')
    expect(tokens.filter((token) => /^transition(-|$)/.test(utilityOf(token)))).toEqual([])
  })
})

describe('ToggleGroup (DESIGN-GUIDE 5.3)', () => {
  const markup = renderToStaticMarkup(
    <ToggleGroup defaultValue={['anc']}>
      <ToggleGroupItem value="anc">ANC</ToggleGroupItem>
      <ToggleGroupItem value="trans">Transparency</ToggleGroupItem>
    </ToggleGroup>,
  )

  it('lays the blocks out in a row with no container of its own', () => {
    // "No container background; the blocks sit directly on the tile." The group
    // must not paint anything behind the blocks.
    const tokens = classesOf(markup, 'toggle-group')
    expect(tokens.filter((token) => /^bg(-|$)/.test(utilityOf(token)))).toEqual([])
    expect(tokens).toContain('flex')
  })

  it('gaps the blocks by 6px, and says so in the markup', () => {
    // `spacing` is expressed in Tailwind spacing steps, so the default 1.5 is
    // 6px. The class has to consume `--gap`, or the number is decoration.
    expect(markup).toContain('--gap:1.5')
    expect(classesOf(markup, 'toggle-group').some((token) => token.startsWith('gap-[calc('))).toBe(true)
  })

  it('gives every block the same width, a 14px radius and the raised surface', () => {
    // `flex-1` is what makes the blocks equal *when the row has a width to
    // divide* (Soundcore's mode picker passes `w-full`); a `w-fit` row keeps
    // its content-sized chips, which is what the ANC-scene rows need.
    const tokens = classesOf(markup, 'toggle-group-item')
    for (const wanted of ['flex-1', 'rounded-[14px]', 'bg-surface-raised', 'text-center']) {
      expect(tokens).toContain(wanted)
    }
    expect(borders(tokens)).toEqual([])
  })

  it('marks the selected block signal with black bold text', () => {
    // Base UI's Toggle emits `data-pressed`, not the Radix `data-state="on"`,
    // so a `data-[state=on]:` rule would never match and the selection would
    // silently vanish.
    const selected = classesWhere(markup, 'data-pressed')
    for (const wanted of ['data-pressed:bg-signal', 'data-pressed:text-black', 'data-pressed:font-bold']) {
      expect(selected).toContain(wanted)
    }
  })

  it('is the selected block that carries the state attribute', () => {
    // Otherwise the assertion above would be reading a class list off whichever
    // element happens to be marked, pressed or not.
    const pressed = tagsWithAttribute(markup, 'data-pressed')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toContain('data-slot="toggle-group-item"')
  })
})

describe('Select, Badge, Tabs and Separator (spec 6.2)', () => {
  it('raises the select trigger onto a 14px block', () => {
    const markup = renderToStaticMarkup(
      <Select items={[{ value: 'a', label: 'A' }]} value="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectItem value="a">A</SelectItem>
      </Select>,
    )
    const trigger = classesOf(markup, 'select-trigger')
    expect(trigger).toContain('bg-surface-raised')
    expect(trigger).toContain('rounded-[14px]')
    expect(borders(trigger)).toEqual([])
  })

  it('rounds the menu to the same 14px block', () => {
    const item = classesOf(
      renderToStaticMarkup(
        <Select items={[{ value: 'a', label: 'A' }]} value="a" open>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectItem value="a">A</SelectItem>
        </Select>,
      ),
      'select-item',
    )
    expect(item.some((token) => /^rounded-\[/.test(token))).toBe(true)
  })

  it('makes badges pills on the raised surface, and keeps red for state', () => {
    expect(badge('secondary')).toContain('bg-surface-raised')
    for (const wanted of ['rounded-full', 'bg-foreground', 'text-background']) {
      expect(badge('default')).toContain(wanted)
    }
    for (const wanted of ['rounded-full', 'bg-signal', 'text-black']) {
      expect(badge('destructive')).toContain(wanted)
    }
  })

  it('keeps the focus ring readable on the one badge that is red', () => {
    // `bg-signal` with a `ring-destructive/20` focus ring is red on red, and
    // tailwind-merge is what makes it happen: the variant's colour is written
    // after the base's `ring-ring`, so the base ring is *deleted* from the class
    // list rather than losing the cascade. The badge whose focus is hardest to
    // see would be the one carrying it.
    //
    // The destructive *state* still has its own red ring, from `aria-invalid` in
    // the base — that is a state, and red is the right colour for it.
    const tokens = badge('destructive')
    expect(tokens).toContain('focus-visible:ring-ring')
    expect(tokens.some((token) => /focus-visible:ring-(destructive|signal)/.test(token))).toBe(
      false,
    )
  })

  it('gives the tab list a raised pill and inverts the active tab', () => {
    const markup = renderToStaticMarkup(
      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Frame log</TabsTrigger>
        </TabsList>
        <TabsContent value="log">log</TabsContent>
      </Tabs>,
    )
    const list = classesOf(markup, 'tabs-list')
    expect(list).toContain('rounded-full')
    expect(list).toContain('bg-surface-raised')
    const trigger = classesOf(markup, 'tabs-trigger')
    for (const wanted of ['data-active:bg-foreground', 'data-active:text-background', 'data-active:font-bold']) {
      expect(trigger).toContain(wanted)
    }
    // Selection is the one thing that animates, per DESIGN-GUIDE §6.
    expect(trigger).toContain('transition-colors')
  })

  it('keeps the separator a 1px divider in the border token', () => {
    const tokens = classesOf(renderToStaticMarkup(<Separator />), 'separator')
    expect(tokens).toContain('bg-border')
    expect(tokens).toContain('data-horizontal:h-px')
  })
})
