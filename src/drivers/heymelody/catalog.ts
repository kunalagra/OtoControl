import { HEYMELODY_CATALOG } from './catalog.generated';
import type { HeyMelodyCatalogEntry } from './catalog.generated';

export const OEM_BRAND_NAME: Record<HeyMelodyCatalogEntry['brand'], string> = {
  oppo: 'OPPO',
  realme: 'realme',
  oneplus: 'OnePlus',
};

const BY_PRODUCT_ID = new Map(HEYMELODY_CATALOG.map((entry) => [entry.productId, entry]));

/**
 * Looks up a device by its `0x0103`-reported productId. Never infer brand
 * from the id's own bytes — see
 * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md §3.5 for why
 * that correlation is not a rule.
 */
export function catalogEntryFor(productId: string): HeyMelodyCatalogEntry | null {
  return BY_PRODUCT_ID.get(productId) ?? null;
}
