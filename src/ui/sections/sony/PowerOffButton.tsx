import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface Props {
  disabled: boolean
  onConfirm(): void
}

/**
 * Confirmation in front of power-off.
 *
 * Worth a prompt because it is not undoable from here: the command is
 * fire-and-forget, the link drops immediately, and getting back means reaching
 * for the earbuds rather than clicking anything in this app.
 */
export function PowerOffButton({ disabled, onConfirm }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={disabled}>
            Turn off
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn the earbuds off?</AlertDialogTitle>
          <AlertDialogDescription>
            They will power down and disconnect straight away. There is no way to turn them back
            on from here — put them in the case and take them out again to reconnect.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            Turn off
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
