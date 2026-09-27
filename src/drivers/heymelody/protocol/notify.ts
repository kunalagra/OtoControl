/** Notification subscribe handshake and `0x0204` push event ids. */

export interface NotificationSupportReply {
  status: number;
  ids: number[];
}

/**
 * `0x0200` -> `0x8200` reply: `[status(1)][count(1)][id1, id2, …]` — the
 * notification ids this device can push. Cross-checked directly against
 * 1812z/OppoPods's actual runtime connect sequence (`RfcommController.kt`),
 * not just its packet-definitions file: it queries this before ever
 * registering for anything, then subscribes to whatever comes back (minus
 * debug channels, see `encodeRegisterNotify`). Not independently confirmed
 * against the APK itself.
 */
export function decodeNotificationSupport(payload: Uint8Array): NotificationSupportReply {
  if (payload.length < 2) {
    throw new Error(`notification-support payload too short: expected at least 2 bytes, got ${payload.length}`);
  }
  const status = payload[0];
  const count = payload[1];
  const ids = Array.from(payload.slice(2, 2 + count));
  return { status, ids };
}

/**
 * `0x0205` request payload: `[count(1)][id1, id2, …]` — subscribe to exactly
 * these notification ids. Replaces this driver's earlier empty-payload
 * request, which 1812z/OppoPods's source suggests never actually subscribes
 * to anything on real hardware. Ids `>= 0xF0` are debug/internal channels,
 * filtered out the same way 1812z's own connect sequence does.
 */
export function encodeRegisterNotify(ids: number[]): number[] {
  const wanted = ids.filter((id) => id < 0xf0);
  return [wanted.length, ...wanted];
}

/** `0x0204` event ids (realme `NotificationCommandManager.k():184-226`). */
export const PushEvent = { Battery: 0x01, Wear: 0x02, Anc: 0x03 } as const;
