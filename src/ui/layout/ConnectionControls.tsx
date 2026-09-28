import { RiRefreshLine, RiErrorWarningLine } from '@remixicon/react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { isWebBluetoothSupported } from '@/core/gattTransport'

/**
 * What to do about the connection, given the state it is in.
 *
 * Lives on its own since the sidebar it grew out of is gone (spec §4 replaces
 * that shell). The phone top bar's ⋯ menu renders it as-is — a column is
 * exactly what a menu wants — and the desktop bar lays the same set out as a row
 * of pills, drawing the refresh, disconnect and add affordances from
 * `DevicePickers` below. There is one definition of what each button *does*; the
 * two layouts are the only thing that differs.
 */
export function ConnectionControls({
  manager,
  active,
  compact = false,
}: {
  manager: DeviceManager
  active: ActiveDevice
  compact?: boolean
}) {
  const status = active.state.status

  if (status === 'unsupported') {
    return compact ? null : (
      <Alert variant="destructive">
        <RiErrorWarningLine />
        <AlertDescription>
          This browser has neither Web Serial nor Web Bluetooth. Use Chrome, Edge or another
          Chromium browser.
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'connected') {
    return (
      <div className={compact ? 'flex gap-2' : 'flex flex-col gap-2'}>
        <ButtonGroup
          {...(compact ? {} : { className: '[&>button]:flex-1' })}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className={PICKER_HEIGHT}
                  onClick={() => void manager.refresh()}
                >
                  <RiRefreshLine data-icon="inline-start" />
                  {!compact && 'Refresh'}
                </Button>
              }
            />
            <TooltipContent>Re-read every setting. Needed for settings the device never announces.</TooltipContent>
          </Tooltip>
          {!compact && (
            <Button
              variant="ghost"
              size="sm"
              className={PICKER_HEIGHT}
              onClick={() => void manager.disconnect()}
            >
              Disconnect
            </Button>
          )}
        </ButtonGroup>
        {/* Being connected is not a reason to hide the pickers: granting a
            second device does not disturb the first. Only in the roomy
            layout — the compact one has no space and can disconnect first. */}
        {!compact && <DevicePickers manager={manager} status={status} verb="Add" />}
      </div>
    )
  }

  return (
    <div className={compact ? 'flex gap-2' : 'flex flex-col gap-2'}>
      <Button
        size={compact ? 'sm' : 'default'}
        className={compact ? undefined : `${PICKER_WIDTH} ${PICKER_HEIGHT}`}
        disabled={status === 'connecting'}
        onClick={() => void manager.connect()}
      >
        {status === 'connecting' ? (
          <>
            <Spinner data-icon="inline-start" />
            {!compact && 'Connecting'}
          </>
        ) : (
          'Connect over serial'
        )}
      </Button>
      {!compact && (
        <Button
          variant="outline"
          size="default"
          // The same size as the serial button, so the pair reads as one decision
          // with a primary and a secondary rather than as a big button and a
          // caption under it — and so both clear spec §8's 44px floor. The
          // hierarchy is the fill (inverted against raised), which is the guide's
          // own rule: size and red are for state, and this pair is not a state.
          className={`${PICKER_WIDTH} ${PICKER_HEIGHT}`}
          disabled={status === 'connecting' || !isWebBluetoothSupported()}
          onClick={() => void manager.connectBluetooth()}
          title={BLUETOOTH_HINT}
        >
          Connect over Bluetooth
        </Button>
      )}
    </div>
  )
}

export const BLUETOOTH_HINT =
  'For Soundcore, which has no serial service, and for Nothing devices that answer over GATT. The buds may need to be advertising: open the case or re-enter pairing range.'

/**
 * The two ways in, on a phone.
 *
 * **The 44px floor** (spec §8) is grown onto the button rather than added as
 * invisible slop: each of these is the full width of its row, in a menu or in
 * the empty-state hero, so overflow would swallow the tap on whatever sits
 * beside it. `md:min-h-0` puts the guide's own 36px back from the breakpoint,
 * where the pointer is a mouse and the same control is one row among several —
 * or, for `DevicePickers`, one pill in a bar whose height is the guide's.
 *
 * **The full width** is the menu's own column stretching, which is what makes the
 * pair read as one decision with a primary and a secondary.
 *
 * Every row of the roomy layout carries `PICKER_HEIGHT`, not only the two
 * pickers: a menu whose first pair is 31px and whose second is 44px is two menus
 * in one, and the connected branch is the state people are in most often.
 */
const PICKER_WIDTH = 'w-full'
const PICKER_HEIGHT = 'min-h-11 md:min-h-0'

/**
 * The two ways to grant a device, for use while one is already connected.
 *
 * `manager.connect()`/`connectBluetooth()` grant, select and adopt without
 * closing an existing session — the private `#select` only moves which driver
 * is active — so adding a device of another brand leaves the first one live in
 * the background. A second device of the *same* brand replaces that brand's
 * session, because one driver instance holds one connection.
 *
 * Getting *back* to the first device works only for serial ones:
 * `DeviceSelect` lists `manager.available`, which comes from
 * `listGrantedPorts()` and so has no BLE entries. Switching through it also
 * calls the public `select`, which disconnects every device first. So a
 * Soundcore added here is reachable until you switch away from it — see the
 * gap noted in `DeviceSelect`.
 *
 * Exported because the desktop bar's "Add device" popover holds exactly these
 * two buttons, and the phone menu is `ConnectionControls` itself.
 */
export function DevicePickers({
  manager,
  status,
  verb,
}: {
  manager: DeviceManager
  status: string
  verb: string
}) {
  const bluetooth = isWebBluetoothSupported()
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className={`flex-1 ${PICKER_HEIGHT}`}
        disabled={status === 'connecting'}
        onClick={() => void manager.connect()}
      >
        {verb} over serial
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={`flex-1 ${PICKER_HEIGHT}`}
        disabled={status === 'connecting' || !bluetooth}
        onClick={() => void manager.connectBluetooth()}
        title={bluetooth ? BLUETOOTH_HINT : 'This browser has no Web Bluetooth API.'}
      >
        {verb} over Bluetooth
      </Button>
    </div>
  )
}
