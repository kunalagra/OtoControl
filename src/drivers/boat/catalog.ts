import { BOAT_PRODUCTS } from './products.generated';
import type { BoatProduct } from './products.generated';

const norm = (name: string): string => name.trim().toLowerCase();

const BY_BLE_NAME = new Map(
  BOAT_PRODUCTS.filter((p) => p.bleName !== null).map((p) => [(p.bleName as string).toLowerCase(), p]),
);
const BY_NAME = new Map(
  BOAT_PRODUCTS.filter((p) => p.name !== null).map((p) => [(p.name as string).toLowerCase(), p]),
);

/**
 * Looks up a device by its Bluetooth name: the app's own `hearable_ble_name`
 * first (the key its local `ProductsInfo` DB resolves through), then the
 * marketing `hearable_name`. Never infer the chip stack from the name —
 * `sdkType` on the entry is the dispatch key.
 */
export function lookupBoatProduct(bluetoothName: string | null | undefined): BoatProduct | null {
  if (!bluetoothName) return null;
  return BY_BLE_NAME.get(norm(bluetoothName)) ?? BY_NAME.get(norm(bluetoothName)) ?? null;
}

/** Whether this model speaks the Bluetrum SPP stack this driver implements. */
export function isBluetrumProduct(product: BoatProduct | null): boolean {
  return product?.sdkType === 'BLUETRUM_SDK';
}
