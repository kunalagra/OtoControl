import { useState } from 'react'
import type { MouseEvent } from 'react'

/**
 * Open state for a menu of actions, closing once one is taken.
 *
 * A menu left open after Disconnect or a picker button sits over the page, or
 * over the browser's own chooser, until someone clicks away. Any button inside
 * the panel counts as an action; clicks on anything else leave it open.
 */
export function useActionMenu() {
  const [open, setOpen] = useState(false)
  const closeOnAction = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) setOpen(false)
  }
  return { open, onOpenChange: setOpen, closeOnAction }
}
