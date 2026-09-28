import { useCallback, useState } from 'react'

/**
 * Draft-while-interacting, commit-on-release, for controls that write to a
 * device — spec §7.2.
 *
 * A slider's `onValueChange` fires on every tick of a drag. Writing to the
 * headphones from there sends a burst of writes whose replies arrive out of
 * order, and the last one to land wins — so the control snaps back to a value
 * the user moved past. The same shape is spelled out in HeyMelody's
 * `CurveEditor`; this is the shared version of it, so six sections do not each
 * re-derive it.
 *
 * ```tsx
 * const [level, setDraftLevel, commitLevel] = useCommittedValue(sidetone ?? 0)
 * <Slider
 *   value={[level]}
 *   onValueChange={(next) => setDraftLevel(pick(next))}
 *   onValueCommitted={(next) => {
 *     // The committed value, not `level`: a key press fires both handlers in
 *     // one event, before React has re-rendered the draft.
 *     const settled = pick(next)
 *     commitLevel(settled)
 *     void device.setSidetone(settled)
 *   }}
 * />
 * ```
 *
 * While a draft is set the value prop is ignored, so a device reply or a
 * preset click arriving mid-drag cannot move the control. The first render
 * after a commit goes back to the prop, which is the whole point: the commit
 * is the moment the caller takes ownership.
 */
export function useCommittedValue<T>(value: T): [T, (value: T) => void, (committed: T) => void] {
  // `null` rather than a flag: a draft of `0` or `false` is a real draft, and
  // only "no draft" hands rendering back to the prop.
  const [draft, setDraft] = useState<T | null>(null)

  const commit = useCallback((_committed: T) => setDraft(null), [])

  return [draft ?? value, setDraft, commit]
}
