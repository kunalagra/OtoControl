/**
 * Generates `src/drivers/boat/products.generated.ts` from the boAt Hearables
 * app's own `hearables` catalog (authenticated `GET
 * wearable.boat-lifestyle.com/api/2/hearables`, saved as JSON).
 *
 * Usage:
 *   node scripts/generate-boat-catalog.mjs [input.json] [output.ts]
 *
 * Defaults read `../android-testing/boat/boat_hearables_catalog.json`
 * (sibling checkout) and write beside the boat driver. Regenerate rather
 * than editing the output. No token is involved — the image URLs are public
 * CloudFront paths.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(here, process.argv[2] ?? '../../android-testing/boat/boat_hearables_catalog.json');
const output = resolve(
  here,
  process.argv[3] ?? '../src/drivers/boat/products.generated.ts',
);

const raw = JSON.parse(readFileSync(input, 'utf8'));
const products = raw.data ?? raw.products ?? raw;
if (!Array.isArray(products)) throw new Error(`unexpected catalog shape in ${input}`);

const str = (v) => (typeof v === 'string' && v.length > 0 ? JSON.stringify(v) : 'null');

const entries = products.map((p) => {
  const fields = [
    `id: ${JSON.stringify(p.id ?? p.hearable_name)}`,
    `name: ${str(p.hearable_name)}`,
    `bleName: ${str(p.hearable_ble_name)}`,
    `sdkType: ${str(p.hearable_sdk_type)}`,
    `category: ${str(p.category_name)}`,
    `image: ${str(p.product_image_1 ?? p.product_image)}`,
    `leftImage: ${str(p.hearable_left_bud_image)}`,
    `rightImage: ${str(p.hearable_right_bud_image)}`,
  ];
  return `  { ${fields.join(', ')} },`;
});

const header = `/**
 * boAt Hearables product index: marketing name, BLE name, SDK (chip-stack)
 * type and public CloudFront imagery per model. GENERATED FILE — regenerate
 * with \`node scripts/generate-boat-catalog.mjs\` rather than editing here.
 *
 * Source: the app's own \`hearables\` catalog (authenticated, see
 * android-testing/boat/BOAT_ANALYSIS.md); image URLs need no token.
 */
export interface BoatProduct {
  id: number | string;
  name: string | null;
  /** The BLE name the app matches on (\`hearable_ble_name\`), when the model has one. */
  bleName: string | null;
  /** Chip-stack dispatch (\`BLUETRUM_SDK\`, \`BES_SDK\`, …) — see \`Constants.E1()\`. */
  sdkType: string | null;
  category: string | null;
  image: string | null;
  leftImage: string | null;
  rightImage: string | null;
}

export const BOAT_PRODUCTS: readonly BoatProduct[] = [
${entries.join('\n')}
];
`;

writeFileSync(output, header);
console.log(`wrote ${products.length} products to ${output}`);
