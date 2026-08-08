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

/**
 * Gate in front of the debug console.
 *
 * The console can write arbitrary frames to the headphones, so it is kept out
 * of the navigation and behind an explicit acknowledgement rather than being
 * one click away from the noise controls.
 */
export function DebugEntry({ onOpen }: { onOpen(): void }) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm">
            Open
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open the debug console?</AlertDialogTitle>
          <AlertDialogDescription>
            This sends raw commands straight to your headphones. Sending something the firmware
            does not expect can leave a setting in a strange state — powering the headphones off
            and on again clears it.
            <br />
            <br />
            Firmware-upgrade, factory-reset and paired-device-delete commands are blocked in code
            and cannot be sent from here. Undocumented commands cannot be, by definition.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              onOpen()
            }}
          >
            I understand, open it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
