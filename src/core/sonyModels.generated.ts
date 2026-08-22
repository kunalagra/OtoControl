/**
 * Every headphone-class model in Sony's Sound Connect catalog, with its form
 * factor derived from Sony's own naming convention (WF-/LinkBuds/INZONE Buds
 * are earbuds; WH-/MDR-/WI-neckbands/INZONE H are head-worn). GENERATED FILE
 * — regenerate with `SONY_API_KEY=<key> python3 scripts/fetch-sony-catalog.py`.
 *
 * Speakers (SRS-, ULT FIELD/TOWER, BRAVIA Theatre) are excluded: they do not
 * speak this driver's serial protocol.
 *
 * These entries carry NO feature claims — the driver reads each device's
 * capability table live on connect, which always wins. A profile exists so
 * an untested model still presents itself correctly: name, form factor,
 * battery layout, square catalog render.
 */
export interface SonyCatalogModel {
  name: string
  form: 'earbuds' | 'over-ear'
}

export const SONY_CATALOG_MODELS: readonly SonyCatalogModel[] = [
  { name: "1000X THE COLLEXION", form: "over-ear" },
  { name: "INZONE Buds", form: "earbuds" },
  { name: "INZONE H9 II", form: "over-ear" },
  { name: "LinkBuds", form: "earbuds" },
  { name: "LinkBuds Clip", form: "earbuds" },
  { name: "LinkBuds Fit", form: "earbuds" },
  { name: "LinkBuds Open", form: "earbuds" },
  { name: "LinkBuds S", form: "earbuds" },
  { name: "LinkBuds UC", form: "earbuds" },
  { name: "MDR-XB950B1", form: "over-ear" },
  { name: "MDR-XB950N1", form: "over-ear" },
  { name: "ULT WEAR", form: "over-ear" },
  { name: "WF-1000X", form: "earbuds" },
  { name: "WF-1000XM3", form: "earbuds" },
  { name: "WF-1000XM4", form: "earbuds" },
  { name: "WF-1000XM5", form: "earbuds" },
  { name: "WF-1000XM6", form: "earbuds" },
  { name: "WF-C500", form: "earbuds" },
  { name: "WF-C510", form: "earbuds" },
  { name: "WF-C700N", form: "earbuds" },
  { name: "WF-C710N", form: "earbuds" },
  { name: "WF-H800", form: "earbuds" },
  { name: "WF-SP700N", form: "earbuds" },
  { name: "WF-SP800N", form: "earbuds" },
  { name: "WF-SP900", form: "earbuds" },
  { name: "WH-1000XM2", form: "over-ear" },
  { name: "WH-1000XM3", form: "over-ear" },
  { name: "WH-1000XM4", form: "over-ear" },
  { name: "WH-1000XM5", form: "over-ear" },
  { name: "WH-1000XM6", form: "over-ear" },
  { name: "WH-CH520", form: "over-ear" },
  { name: "WH-CH700N", form: "over-ear" },
  { name: "WH-CH720N", form: "over-ear" },
  { name: "WH-H800", form: "over-ear" },
  { name: "WH-H810", form: "over-ear" },
  { name: "WH-H900N", form: "over-ear" },
  { name: "WH-H910N", form: "over-ear" },
  { name: "WH-XB700", form: "over-ear" },
  { name: "WH-XB900N", form: "over-ear" },
  { name: "WH-XB910N", form: "over-ear" },
  { name: "WI-1000X", form: "over-ear" },
  { name: "WI-1000XM2", form: "over-ear" },
  { name: "WI-C100", form: "over-ear" },
  { name: "WI-C600N", form: "over-ear" },
  { name: "WI-H700", form: "over-ear" },
  { name: "WI-SP600N", form: "over-ear" },
] as const;
