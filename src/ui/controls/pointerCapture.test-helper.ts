/**
 * The one pointer-capture rule, modelled for jsdom.
 *
 * jsdom implements `PointerEvent` but not capture, so a component that calls
 * `setPointerCapture` throws and one that does not behaves the same as a
 * browser without it. Both facts make the *mouse* release off a control
 * untestable in this environment — and that release is the whole point: a touch
 * gesture has implicit capture (the spec gives touch pointers it for free), a
 * mouse does not, so a drag that wanders off a 44px input and is released over
 * the page delivers its `pointerup` to the page. The component never sees it,
 * never commits, and leaves the caller holding a draft nothing will ever
 * confirm.
 *
 * So this installs the smallest thing that models capture's one observable
 * consequence — *while a pointer is captured, its events go to the capturing
 * element rather than to whatever is under them* — and nothing else:
 *
 * - `setPointerCapture` records the element. That record is the whole shim.
 * - `deliverPointer` sends the event to the recorded element if there is one,
 *   and to the node the caller names if there is not.
 *
 * A control that takes no capture therefore behaves exactly as a browser
 * treats an uncaptured pointer, and a test that releases off-element fails
 * against it — which is the failure this helper exists to make reproducible.
 * It is a model of a rule, not a stub: a stub (`() => undefined`) makes the
 * capture vanish and the test pass for the wrong reason.
 */
import { fireEvent } from '@testing-library/dom'

/** pointerId → the element holding capture on it. */
const captured = new Map<number, Element>()

/**
 * Patch the three capture methods onto `Element.prototype`, which is what
 * `Knob.test.tsx` does too — every capture call in the UI tier is unconditional
 * and a real browser has all three.
 */
export function installPointerCapture(): void {
  Element.prototype.setPointerCapture = function setPointerCapture(
    this: Element,
    pointerId: number,
  ) {
    captured.set(pointerId, this)
  }
  Element.prototype.releasePointerCapture = function releasePointerCapture(
    this: Element,
    pointerId: number,
  ) {
    if (captured.get(pointerId) === this) captured.delete(pointerId)
  }
  Element.prototype.hasPointerCapture = function hasPointerCapture(
    this: Element,
    pointerId: number,
  ) {
    return captured.get(pointerId) === this
  }
}

/** Forget every capture, so one test's gesture cannot deliver another's event. */
export function resetPointerCapture(): void {
  captured.clear()
}

/** The element a pointer's events currently go to, or null when uncaptured. */
export const capturingElement = (pointerId: number): Element | null =>
  captured.get(pointerId) ?? null

/**
 * Deliver a pointer event the way the browser delivers it: to the element
 * holding capture for that pointer, and to `otherwise` when nothing does.
 *
 * `otherwise` is the point of the helper — pass the node the pointer is really
 * over (the page, a neighbouring block, `document.body`) and the test is a
 * statement about a release that happened somewhere else.
 *
 * Testing Library names these `pointerUp`, not `pointerup`, so the event type
 * is translated rather than indexed: `fireEvent['pointerup']` is `undefined`
 * and throws, which is a confusing way to learn it.
 */
const FIRE = {
  pointerdown: fireEvent.pointerDown,
  pointermove: fireEvent.pointerMove,
  pointerup: fireEvent.pointerUp,
  pointercancel: fireEvent.pointerCancel,
} as const

export function deliverPointer(
  type: keyof typeof FIRE,
  init: { pointerId: number } & Record<string, unknown>,
  otherwise: Element,
): void {
  FIRE[type](captured.get(init.pointerId) ?? otherwise, init)
}
