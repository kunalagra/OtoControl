/**
 * The accessibility rules that are properties of the whole source tree rather
 * than of one component — spec §8, DESIGN-GUIDE §6.
 *
 * Everything else about §8 is testable where it lives: a tile's classes, a
 * fader's commit, a nav's `aria-current`. These three are not, because each one
 * is a rule about *every* control and about a stylesheet the components never
 * read. A `focus-visible:ring-[3px] focus-visible:ring-ring/30` on one primitive
 * is invisible to any test that renders that primitive alone, and it is wrong
 * for the same reason as the identical class on the next one — so the rules are
 * checked over the tree instead, once, here.
 *
 * A source scan and not a computed style, because that is what can run without
 * a browser: the tree is scanned for the *old* recipe and for the new one, so a
 * component that keeps the old one fails even if nothing else in the file
 * mentions a ring.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'src')

/** Every non-test source file, by path relative to the project root. */
const files = (dir = SRC): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return files(path)
    if (extname(path) !== '.tsx' && extname(path) !== '.ts') return []
    // This file asserts about sources; its own needles would read as hits.
    if (/\.test(-helper)?\.tsx?$/.test(path)) return []
    return [path]
  })

const read = (path: string) => readFileSync(path, 'utf8')
const name = (path: string) => relative(process.cwd(), path)

/** The files whose contents match `needle`, by name. */
const withNeedle = (needle: RegExp): string[] =>
  files().filter((path) => needle.test(read(path))).map(name)

describe('the focus ring (spec 8)', () => {
  it('is 2px in the foreground with a 2px offset, wherever it is drawn', () => {
    // Both halves matter and neither implies the other: a 2px ring with no
    // offset is drawn *over* the control's own edge, which is invisible on a
    // control that fills its own colour — the default button is
    // `bg-foreground`, so a foreground ring on it is the same colour as the
    // button. The offset is what puts a contrasting gap between the two.
    //
    // The rule is asserted as "a file that draws a 2px focus ring also offsets
    // it, or draws it inset" — the second form has one legitimate home, pinned
    // by the test below — so every site is covered without a list of them to
    // fall out of date. Both spellings of the width are in the needle, because
    // `ring-2` and `ring-[2px]` are the same rule written two ways and a needle
    // that knows only one of them passes over whichever half the codebase
    // happens to use today.
    const sites = withNeedle(/focus-visible:ring-(?:2|\[2px\])|focus-visible:outline-(?:2|\[2px\])/)
    expect(sites.length).toBeGreaterThan(0)
    for (const file of sites) {
      const css = read(join(process.cwd(), file))
      expect(
        css,
        file,
      ).toMatch(
        /focus-visible:ring-offset-(?:2|\[2px\])|focus-visible:outline-offset-(?:2|\[2px\])|focus-visible:ring-inset/,
      )
    }
  })

  it('draws its ring inside the control only where the control is the whole block', () => {
    // `ring-inset` is the one legal exception and it is geometric: an offset
    // ring around a full-bleed control is outside its parent's box, and the
    // block clips overflow, so it would be drawn and then cut in half. Home's
    // EQ preview and connections tiles are exactly that — a button filling a
    // block. Asserting the exception is confined to the one file that explains
    // it means a new `ring-inset` anywhere else has to be argued for.
    expect(withNeedle(/focus-visible:ring-inset/)).toEqual(['src/ui/sections/Home.tsx'])
  })

  it('is never the stock 3px ring at 30% opacity', () => {
    // What `shadcn add` writes, and what the redesign retired: three pixels of
    // ring at 30% alpha is a halo, not a ring, and at 30% over a black page it
    // is close to invisible. Any file still carrying it is a control whose focus
    // is hard to find.
    //
    // Anchored on `focus-visible:` rather than on the ring alone, because a 3px
    // `ring-background` is a legitimate part of the slider thumb (the guide's
    // separation between the thumb and the fill) and is not a focus ring.
    expect(
      withNeedle(/focus-visible:ring-\[3px\]|focus-visible:ring-ring\/(30|50|60)/),
    ).toEqual([])
  })
})

describe('red text (spec 8)', () => {
  it('goes through the strong token, never the signal fill', () => {
    // `--signal` is 3.3 : 1 on white, so it is a fill and a mark; red *text* in
    // light mode is `--signal-strong` at 4.9 : 1 on white (4.35 : 1 on a
    // `--card` block — see `alert.tsx`). In dark the two are the same
    // value, so a single class is correct in both themes — which means the
    // classes that reach for the fill token directly are wrong in one theme and
    // only wrong there, which is exactly the sort of thing nobody sees until a
    // light-mode screenshot.
    //
    // `text-signal` is in the needle, and it is the one that was missing: it is
    // the *fill* token, and reaching for it as a text colour is the mistake this
    // rule exists to catch — 3.3 : 1 on white. A needle of `text-destructive` and
    // `text-primary` alone would not notice a component writing `text-signal`,
    // which is the class most of the places this pass changed *had* before.
    //
    // The boundary is `(?![-\\w])`, not `\\b`, and the difference is the whole
    // needle: `\\b` is a boundary between a word and a non-word character, and
    // `-` is a non-word character, so `\\btext-signal\\b` happily matches the
    // first half of `text-signal-strong` — the *correct* class, which at the time
    // sat in seven files (`Fader`, `StatusToken`, `AppShell`, `alert`, `empty`,
    // `ProbePanel`, `Debug`) plus the one allowlisted below, and all eight
    // would have been flagged.
    const FILL_AS_TEXT = /\btext-(?:destructive|primary|signal)(?![-\w])/
    expect(withNeedle(FILL_AS_TEXT)).toEqual(['src/ui/device/DeviceImage.tsx'])
  })

  it('uses it on the one place that is allowed to be a graphic', () => {
    // The incoming-sound rings inside the product render are a *mark* on an
    // SVG, not text, and red on white is a fill. Named here so the allowlist
    // above is a decision rather than a leftover.
    const image = read(join(SRC, 'ui/device/DeviceImage.tsx'))
    expect(image).toMatch(/<g className="text-primary"/)
  })
})

describe('motion (DESIGN-GUIDE 6)', () => {
  const css = read(join(SRC, 'index.css'))

  it('is switched off wholesale under prefers-reduced-motion', () => {
    // The guide's last row is "disable all of the above" — selection colour, the
    // switch knob, the menus' slide — and the whole table is transitions. A
    // component-level opt-out would have to be remembered at every site, and
    // three were added after the question was first asked; one block is the
    // only form that also covers whatever comes next.
    //
    // `0.01ms` rather than `0s`: a transition whose duration is exactly zero
    // never fires `transitionend`, and a menu or a knob waiting on that event
    // would hang in its opening state.
    //
    // Unlayered, and the check is on its position: Tailwind's utilities live in
    // `@layer utilities`, and CSS reverses the layer order for `!important`
    // declarations — so a block wrapped in `@layer base` would *lose* to a
    // utility that declared itself important, and the guard would be decorative.
    // The one thing this block outranks is every rule in the file, which is why
    // it is written outside them all.
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(-1)
    const block = css.slice(at)
    expect(block.slice(0, 600)).toMatch(/transition-duration:\s*0\.01ms\s*!important/)
    expect(block.slice(0, 600)).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
    expect(block.slice(0, 600)).toMatch(/scroll-behavior:\s*auto\s*!important/)
    expect(at).toBeLessThan(css.indexOf('@layer'))
  })
})
