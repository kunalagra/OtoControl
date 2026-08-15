import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { elements, ofType, text } from './tree.test-helper'

/**
 * Smoke tests for the traversal helper itself. `elements()` and `ofType()`
 * are exercised directly here even though Tasks 3 and 4 also lean on
 * `ofType` to find rendered components and assert on their props — a bug
 * here would otherwise surface as a confusing failure two tasks downstream
 * instead of here. `text()` gets its own cases too: every panel test that
 * uses it only ever hits its happy path (a couple of string leaves), never
 * the number-leaf branch or a case where the space separator is the only
 * thing distinguishing two possible joins.
 *
 * These build plain element trees with JSX and never call the component
 * functions — matching how the rest of the suite uses the helper (e.g.
 * `DeviceInfoPanel({...})` returns an element tree that is inspected,
 * not rendered).
 */

function A({ children }: { children?: ReactNode }) {
  return children
}
function B({ children }: { children?: ReactNode }) {
  return children
}
function C({ children }: { children?: ReactNode }) {
  return children
}

describe('elements', () => {
  it('returns a nested tree depth-first, root first', () => {
    const tree = (
      <A>
        <B>
          <C />
        </B>
      </A>
    )

    const found = elements(tree)

    expect(found.map((el) => el.type)).toEqual([A, B, C])
  })

  it('flattens arrays of children', () => {
    const tree = (
      <A>
        {[<B key="b" />, <C key="c" />]}
      </A>
    )

    expect(elements(tree).map((el) => el.type)).toEqual([A, B, C])
  })

  it('skips non-element children without throwing', () => {
    const tree = (
      <A>
        {'text'}
        {42}
        {null}
        {undefined}
        {false}
        <B />
      </A>
    )

    expect(() => elements(tree)).not.toThrow()
    expect(elements(tree).map((el) => el.type)).toEqual([A, B])
  })

  it('pushes a Fragment itself as a found element, and still recurses into it', () => {
    // isValidElement(<Fragment>) is true, so the traversal's `!isValidElement`
    // guard does not skip fragments: the fragment is pushed into the results
    // the same as any other element, and then visited for its children like
    // any other element. This is the behaviour Task 3 relies on — pinned
    // here rather than assumed.
    const tree = (
      <A>
        <>
          <B />
        </>
      </A>
    )

    const found = elements(tree)

    expect(found).toHaveLength(3)
    expect(found[0]?.type).toBe(A)
    expect(found[1]?.type).toBe(Fragment)
    expect(found[2]?.type).toBe(B)
  })
})

describe('text', () => {
  it('space-joins adjacent leaves, so text spanning two JSX children stays separated', () => {
    // With `join('')` this would read 'foobar' instead — indistinguishable
    // from a single leaf 'foobar', which defeats any assertion that spans
    // adjacent JSX leaves (e.g. a label rendered next to its value).
    expect(text(['foo', 'bar'])).toBe('foo bar')
  })

  it('includes number leaves, not only string leaves', () => {
    // Dropping the `typeof current === 'number'` branch would skip the
    // leading `1` entirely, leaving 'two' rather than '1 two'.
    expect(text([1, 'two'])).toBe('1 two')
  })
})

describe('ofType', () => {
  it('finds every instance of a given component type and nothing else', () => {
    const tree = (
      <A>
        <B />
        <C>
          <B />
        </C>
      </A>
    )

    const bees = ofType(tree, B)
    const cees = ofType(tree, C)

    expect(bees).toHaveLength(2)
    expect(bees.every((el) => el.type === B)).toBe(true)
    expect(cees).toHaveLength(1)
    expect(cees[0]?.type).toBe(C)
  })
})
