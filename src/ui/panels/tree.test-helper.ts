import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

const childrenOf = (element: ReactElement): ReactNode =>
  (element.props as { children?: ReactNode }).children

/** Depth-first list of every element in the tree, root first. */
export function elements(node: ReactNode): ReactElement[] {
  const found: ReactElement[] = []
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!isValidElement(current)) return
    found.push(current)
    visit(childrenOf(current))
  }
  visit(node)
  return found
}

/** Every element of a given component type, e.g. `ofType(tree, Fader)`. */
export function ofType(node: ReactNode, type: unknown): ReactElement[] {
  return elements(node).filter((element) => element.type === type)
}

/** All string and number leaves, space-joined — the tree's visible text. */
export function text(node: ReactNode): string {
  const parts: string[] = []
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (typeof current === 'string' || typeof current === 'number') {
      parts.push(String(current))
      return
    }
    if (!isValidElement(current)) return
    visit(childrenOf(current))
  }
  visit(node)
  return parts.join(' ')
}
