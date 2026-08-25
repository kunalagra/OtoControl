/**
 * Nothing/CMF product render URLs, straight from the official Nothing X app's
 * `devices_info_list.json` (com.nothing.smartcenter, extracted from the APK's
 * flutter assets). GENERATED FILE — regenerate with scripts/gen-nothing-cdn.py
 * rather than editing here.
 *
 * Keyed by the lowercased B1xx base code (the artwork slug `PROFILES` carries
 * for this brand), then by the official colourId — two hex digits, exactly
 * what `decodeColourId` returns.
 *
 * An earlier version of this comment said the colourId was "only readable
 * over BLE, never over serial", so the picker defaulted to black. That was
 * wrong: `GET_REMOTE_COLOR_ID 0xc00c` is an ordinary control-channel query
 * (the official app's `TWSDeviceExtKt.remoteColor`), and the driver now reads
 * it. The default is still the fallback for a device that does not answer, or
 * a colour this table has no render for.
 *
 * Nothing's own app loads these same URLs at runtime; the CDN serves them
 * unauthenticated. One bundled webp (fallback.webp) covers offline use.
 */
export const NOTHING_CDN_IMAGES: Record<string, Record<string, string>> = {
  'b181': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741748587140_Model=ear (1)_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741748500238_Model=ear (1)_White, Status=Group.png",
  },
  'b157': {
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741749145198_Model=ear (1)_Stick, Status=Group.png",
  },
  'b155': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744032848673_Model=ear (2)_White, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744032893429_Model=ear (2)_Black, Status=Group.png",
  },
  'b162': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741749876861_Model=Cleffa_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741749823800_Model=Cleffa_White, Status=Group.png",
    '08': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741749930563_Model=Cleffa_Yellow, Status=Group.png",
  },
  'b171': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741749604146_Model=Entei_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741749521587_Model=ear (2)_White, Status=Group.png",
  },
  'b174': {
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1743583621333_Model=ear (open), Status=Group.png",
    '03': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1777347516490_Ear%20open%20blue%20-%20group.png",
  },
  'b163': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741768231106_Model=Buds Pro_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741768151061_Model=Buds Pro_White, Status=Group.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741767800384_Model=Buds Pro_Orange, Status=Group.png",
  },
  'b168': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769684352_Model=Buds_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769629251_Model=Buds_White, Status=Group.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769556748_Model=Buds_Orange, Status=Group.png",
  },
  'b172': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769767287_Model=Buds Pro 2_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769879554_Model=Buds Pro 2_White, Status=Group.png",
    '03': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769974135_Model=Buds Pro 2_Blue, Status=Group.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769918851_Model=Buds Pro 2_Orange, Status=Group.png",
  },
  'b164': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741769049849_Colour=Black.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741768999178_Colour=White.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741768937776_Colour=Orange.png",
  },
  'b173': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1756293884673_Nothing.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1756293927722_devices.png",
  },
  'b183': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741770389279_Model=Cleffa_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741770432533_Model=Cleffa_White, Status=Group.png",
    '08': "https://dmen2t88o28qi.cloudfront.net/device_sku/1741770484761_Model=Cleffa_Yellow, Status=Group.png",
  },
  'b190': {
    '01': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1780404737992_Jumpluff%20-%20black%402x.png",
    '02': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1780404094640_Jumpluff%20-%20White%402x.png",
    '08': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1780405716955_Jumpluff%20-%20Yellow%402x.png",
    '10': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1780405080197_Jumpluff%20-%20Pink%402x.png",
  },
  'b179': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744011121959_Buds 2_Dark grey, Status=Group.png",
    '06': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744011152606_Buds 2_Light green, Status=Group.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744011177324_Buds 2_Orange, Status=Group.png",
  },
  'b184': {
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744787153027_20250416-150326.png",
    '03': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744788228233_Buds2plusGroup.png",
  },
  'b185': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744791169426_blackbuds.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744791094137_lightgreybuds.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1744790726389_orange buds.png",
  },
  'b187': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1742438265648_Model=Buds Pro 2_Black, Status=Group.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1742438313475_Model=Buds Pro 2_White, Status=Group.png",
    '03': "https://dmen2t88o28qi.cloudfront.net/device_sku/1742438482898_Model=Buds Pro 2_Blue, Status=Group.png",
    '07': "https://dmen2t88o28qi.cloudfront.net/device_sku/1742438425427_Model=Buds Pro 2_Orange, Status=Group.png",
  },
  'b189': {
    '01': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1783652965522_Igglybuff - Black@2x.png",
    '02': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1783652947858_Igglybuff - Black@2x (2).png",
    '03': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1783652915691_Igglybuff - Black@2x (1).png",
    '07': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1783652936180_Igglybuff - Black@2x (3).png",
  },
  'b193': {
    '01': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1778663698029_Larvitar%20-%20Dark%20grey@2x%20(1).png",
    '02': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1778675656352_Larvitar%20-%20Orange@2x.png",
    '03': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1778732704815_Larvitar%20-%20Blue@2x.png",
  },
  'b170': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1750670100575_Elekid-Black.png",
    '09': "https://dmen2t88o28qi.cloudfront.net/device_sku/1750670036075_Elekid-White.png",
  },
  'b186': {
    '01': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408980339_Elekid%20-%20Black.png",
    '02': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408937554_Elekid%20-%20White.png",
    '10': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408841600_Elekid%20-%20Pink.png",
  },
  'b198': {
    '01': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408980339_Elekid%20-%20Black.png",
    '02': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408937554_Elekid%20-%20White.png",
    '08': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408702018_Elekid%20-%20Yellow.png",
    '10': "https://d1zc89dd4u2mk2.cloudfront.net/device_sku/1769408841600_Elekid%20-%20Pink.png",
  },
  'b175': {
    '01': "https://dmen2t88o28qi.cloudfront.net/device_sku/1755252113794_01.png",
    '02': "https://dmen2t88o28qi.cloudfront.net/device_sku/1755252092399_02.png",
    '06': "https://dmen2t88o28qi.cloudfront.net/device_sku/1755252068443_06.png",
  },
};

/**
 * The colour to show when the device's own colour is unknowable over serial.
 * Prefers a URL that names black outright — B155's config has colourId 01
 * pointing at a "White" file, so the id alone is not trustworthy.
 */
export function defaultColourUrl(colours: Record<string, string>): string | null {
  const black = Object.values(colours).find((url) => /black/i.test(url))
  return black ?? Object.values(colours)[0] ?? null
}
