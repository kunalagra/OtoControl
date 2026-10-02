/**
 * What colour a unit is, by the id its earbuds report in `ExtendedStatus`
 * (left earbud's int16, `decode.ts`). The ids and their names are
 * GalaxyBudsClient's `DeviceIds` (`Model/Constants.cs`), which Samsung's own
 * app uses; seven real captures read back colour 260, 279, 298, 316, 326, 330
 * and 340 as Black, White, Black, Green, Grey, Graphite and Silver, matching
 * the units they came from (`fixtures.test.ts`).
 */

/** The finish each id names, lower case. Ids Samsung leaves "unknown" are left out. */
export const COLOUR_NAMES: Readonly<Record<number, string>> = {
  258: 'blue', 259: 'pink', 260: 'black', 261: 'white', 262: 'thom browne', 263: 'red', 264: 'deep blue', 265: 'olympic', 266: 'purple',
  278: 'black', 279: 'white', 280: 'bronze', 281: 'red', 282: 'blue', 283: 'thom browne', 284: 'grey',
  298: 'black', 299: 'silver', 300: 'violet', 301: 'white',
  313: 'white', 314: 'black', 315: 'yellow', 316: 'green', 317: 'violet', 318: 'thom browne', 319: 'maison kitsune', 320: 'absolute black', 321: 'grey',
  322: 'onyx', 323: 'white',
  326: 'grey', 327: 'white', 328: 'violet',
  330: 'graphite', 331: 'white',
  333: 'silver', 334: 'white',
  340: 'silver', 341: 'white',
  347: 'silver', 348: 'white',
  355: 'black', 356: 'white',
  359: 'black', 360: 'white', 361: 'apricot',
};

/**
 * Names Samsung and its app use for the same finish. A unit's id says "Silver"
 * where the storefront says "gray" (Buds3 FE), or "Apricot" for what the store
 * sells as "pink gold" (Buds4 Pro), so a match is by group rather than by word.
 */
const SAME_FINISH: readonly (readonly string[])[] = [
  ['gray', 'grey', 'graphite', 'silver'],
  ['black', 'onyx', 'absolute black'],
  ['apricot', 'pink gold', 'pink', 'gold'],
  ['violet', 'purple', 'lavender', 'bora purple'],
];

const group = (name: string): string => SAME_FINISH.find((names) => names.includes(name))?.[0] ?? name;

/** Whether two finish names are the same finish. */
export const sameFinish = (a: string, b: string): boolean => group(a) === group(b);
