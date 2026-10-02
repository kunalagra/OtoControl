#!/usr/bin/env python3
"""Regenerate src/drivers/xiaomi/catalog.generated.ts from the vendor's own product catalog.

Self-contained: standard library only. The vendor app (com.mi.earphone 1.37.1i)
fetches its catalog with `DeviceService.getDeviceConfigList` — a form POST of
`data={"app_version":…,"app_platform":…,"last_modify_time":0}` to
`product/get_product_list`, annotated loginPolicy=MEYBE, so it answers with no
login. The live host is `pv.tws.wear.xiaomiwear.com` (the app's documented
`tws.` host no longer resolves). The app also sends a static `auth_key` cookie
on every DeviceService call (`DeviceService.java:50-62`). Like the HeyTap
secrets, it is not kept in this repo: set it in the environment for a live
fetch. Only image URLs and capability data are shipped to the client.

The two platforms (0 = Android, 1 = iOS) list slightly different products, so
both are fetched and merged by PID.

Each product carries the app's own per-model capability list (`func_list`, ids
from `com.mi.earphone.device.manager.export.Function`): which noise-control
gears a model offers, which EQ presets, which gestures take which actions, and
whether it has find-my-earbuds. That is the authoritative gate for the driver,
so it is what is generated here, beside the product renders (one per colour id,
the id the earbuds report in `GetInfo` TLV 13).

    XIAOMI_AUTH_KEY=… python3 scripts/fetch-xiaomi-catalog.py   # fetch, then regenerate both files
    python3 scripts/fetch-xiaomi-catalog.py --offline  # regenerate from docs/reference/xiaomi-catalog.json
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API_URL = "https://pv.tws.wear.xiaomiwear.com/twswear/product/get_product_list"
APP_VERSION = "1.37.1i"
UA = "okhttp/4.12.0"
PLATFORMS = (0, 1)

RAW = Path("docs/reference/xiaomi-catalog.json")
OUTPUT = Path("src/drivers/xiaomi/catalog.generated.ts")

# Catalog names that are Chinese-market strings. English forms follow Xiaomi's
# own global naming (活力版 = Active, 青春版 = Lite).
NAME_FIXES = {
    "Redmi Buds 4 哈利·波特版": "Redmi Buds 4 Harry Potter Edition",
    "Xiaomi 真无线降噪耳机 3 迪士尼100周年限定版": "Xiaomi Buds 3 Disney 100th Anniversary",
    "Redmi Buds 4活力版": "Redmi Buds 4 Active",
    "Redmi Buds 6 活力版": "Redmi Buds 6 Active",
    "Redmi Buds 6 青春版": "Redmi Buds 6 Lite",
    "Xiaomi 开放式耳机": "Xiaomi Open-Ear Earbuds",
    "小米 Air4 SE": "Xiaomi Air4 SE",
    "REDMI Buds 6 Pro 电竞版": "REDMI Buds 6 Pro Gaming",
    "Xiaomi 骨传导耳机2": "Xiaomi Bone Conduction Earbuds 2",
    "Xiaomi 开放式耳机 Pro": "Xiaomi Open-Ear Earbuds Pro",
    "REDMI Buds 8 活力版": "REDMI Buds 8 Active",
    "REDMI Buds 8 青春版": "REDMI Buds 8 Lite",
    "Xiaomi 耳夹式耳机": "Xiaomi Clip-on Earbuds",
    "REDMI 头戴降噪耳机": "REDMI Over-Ear ANC Headphones",
    "Redmi AirDots 3 Pro 原神版": "Redmi AirDots 3 Pro Genshin Edition",
}

# PIDs seen on hardware that the catalog lists under another id, and the entry they share.
# 0x508B: Redmi Buds 6 Lite, fw 1.0.5.1 / 0.5.0.3 — Gadgetbridge PR #6818
# (https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/6818). The catalog's
# "Redmi Buds 6 青春版" (Lite) is 0x508A.
ALIASES = {"508b": ("508a", "Redmi Buds 6 Lite")}

# Gesture function ids -> the tap code the earbuds use in config 2. The older
# models list PRESS_TWICE / PRESS_TRIPLE (4004 / 4005) where newer ones list
# DOUBLE / TRIPLE_CLICK (4001 / 4002); Gadgetbridge's Redmi Buds 3 Pro offers
# "double, triple and long" over the same tap codes 1, 2 and 3. The first
# function listed for a code wins, so 4001 / 4002 beat the older ids.
TAP_FUNCS = {4006: 4, 4001: 1, 4004: 1, 4002: 2, 4005: 2, 4003: 3, 4011: 5}
NC_FUNCS = (1002, 1003, 1006, 1007)
TP_FUNCS = (1004, 1005)
EFFECT_FUNCS = (2016, 2006)
FIND_FUNC = 5001


def fetch():
    products = {}
    for platform in PLATFORMS:
        body = urllib.parse.urlencode({"data": json.dumps({
            "app_version": APP_VERSION, "app_platform": platform, "last_modify_time": 0,
        })}).encode()
        request = urllib.request.Request(API_URL, data=body, method="POST", headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": "auth_key=" + auth_key(),
            "User-Agent": UA,
        })
        payload = None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                break
            except OSError as error:  # the host's TLS handshake times out now and then
                print(f"platform {platform}, attempt {attempt + 1}: {error}", file=sys.stderr)
                time.sleep(2)
        if payload is None:
            raise RuntimeError("the catalog host did not answer; try again, or use --offline")
        if payload.get("code") != 0:
            raise RuntimeError("API error: " + json.dumps(payload)[:300])
        for product in payload["result"]["tw_product_list"]:
            products.setdefault((product["vid"], product["pid"]), product)
    return products


def slim(product):
    """Only what the generator reads, so the checked-in JSON stays small."""
    return {
        "vid": product["vid"],
        "pid": product["pid"],
        "name": product["name"],
        "model": product.get("model"),
        "extra_info": {"default_color": (product.get("extra_info") or {}).get("default_color")},
        "func_list": [
            {"func_id": f["func_id"], "extra_data": f.get("extra_data") or "{}"}
            for f in product.get("func_list") or []
        ],
        "icon_static": product.get("icon_static") or [],
    }


def extra(func):
    try:
        data = json.loads(func.get("extra_data") or "{}")
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def clean_name(name):
    name = name.replace("\xa0", " ")
    return NAME_FIXES.get(name, NAME_FIXES.get(name.replace(" ", " "), name))


def entry_for(product):
    funcs = {f["func_id"]: extra(f) for f in product["func_list"]}

    def widest(ids, key):
        lists = [funcs[i].get(key) for i in ids if isinstance(funcs.get(i, {}).get(key), list)]
        return max(lists, key=len) if lists else None

    entry = {"name": clean_name(product["name"]), "funcs": sorted(funcs)}
    if (gear := widest(NC_FUNCS, "tws_gear")) is not None:
        entry["ncGear"] = gear
    if (gear := widest(TP_FUNCS, "tws_gear")) is not None:
        entry["tpGear"] = gear
    for fid in EFFECT_FUNCS:
        effects = (funcs.get(fid, {}).get("sound_effect") or {}).get("effects")
        if isinstance(effects, list):
            entry["effects"] = effects
            break
    taps = {}
    for fid, tap in TAP_FUNCS.items():
        if fid not in funcs or str(tap) in taps:
            continue
        # No list: the model takes the common set (an empty list; see XiaomiTapChoices).
        # 4004 / 4005 list a narrower set per gesture than Gadgetbridge's hardware-tested
        # Redmi Buds 3 Pro offers on the same taps (all five), so for them the list is not trusted.
        actions = None if fid in (4004, 4005) else funcs[fid].get("click_action")
        tap_entry = {"actions": actions if isinstance(actions, list) else []}
        if fid == 4003 and isinstance(funcs[fid].get("noise_ctrl"), list):
            tap_entry["cycle"] = len(funcs[fid]["noise_ctrl"]) > 2
        taps[str(tap)] = tap_entry
    if taps:
        entry["taps"] = taps
    images = {}
    for icon in product["icon_static"]:
        # A render per colour id; a colour listed twice keeps its first.
        if icon.get("icon_url") and icon["icon_url"].lower().endswith(".png"):
            images.setdefault(str(icon["color"]), icon["icon_url"])
    default = (product.get("extra_info") or {}).get("default_color")
    entry["defaultColour"] = default if default is not None else (int(min(images, key=int)) if images else 0)
    entry["images"] = images
    return entry


def ts_value(value, indent=0):
    pad = "  " * indent
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = ",\n".join(f"{pad}  {json.dumps(k) if not k.isidentifier() else k}: {ts_value(v, indent + 1)}" for k, v in value.items())
        return "{\n" + inner + f",\n{pad}}}"
    if isinstance(value, list):
        return "[" + ", ".join(ts_value(v, indent) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def generate(raw):
    catalog = {}
    for product in raw:
        if product["vid"].lower() != "2717":
            continue
        catalog[product["pid"].lower()] = entry_for(product)
    for alias, (source, name) in ALIASES.items():
        if source in catalog:
            catalog[alias] = {**catalog[source], "name": name}
    body = ",\n".join(f"  '{pid}': {ts_value(catalog[pid], 1)}" for pid in sorted(catalog))
    return f"""/**
 * Xiaomi / Redmi earbud capabilities and product renders, from the vendor app's own
 * product catalog (`product/get_product_list`, the call behind its device list).
 * GENERATED FILE — regenerate with `python3 scripts/fetch-xiaomi-catalog.py`.
 *
 * Keyed by PID, lowercase hex, as `GetInfo` TLV 3 reports it (VID is always
 * 0x2717). `funcs` are the app's `Function` ids, which the driver gates on;
 * `ncGear` / `tpGear` are the noise-cancelling and transparency strength ids a
 * model offers, in the app's display order; `effects` the EQ preset ids; `taps`
 * the action ids each gesture accepts, keyed by the tap code config 2 uses;
 * `images` one render per colour id (TLV 13). Only URLs and capability data are
 * shipped — no login, key or token reaches the client.
 */

export interface XiaomiTapChoices {{
  /** Action ids this gesture accepts, in the app's display order; empty when the catalog lists none. */
  actions: number[];
  /** Long press only: the model offers a noise-control cycle to pick. */
  cycle?: boolean;
}}

export interface XiaomiCatalogEntry {{
  name: string;
  funcs: number[];
  ncGear?: number[];
  tpGear?: number[];
  effects?: number[];
  taps?: Record<string, XiaomiTapChoices>;
  defaultColour: number;
  images: Record<string, string>;
}}

export const XIAOMI_CATALOG: Record<string, XiaomiCatalogEntry> = {{
{body},
}};
"""


def auth_key() -> str:
    key = os.environ.get("XIAOMI_AUTH_KEY")
    if not key:
        sys.exit("set XIAOMI_AUTH_KEY for a live fetch, or pass --offline (see this script's docstring)")
    return key


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offline", action="store_true", help="regenerate from the checked-in JSON, no network")
    args = parser.parse_args()
    if args.offline:
        raw = json.loads(RAW.read_text(encoding="utf-8"))
    else:
        raw = [slim(p) for _, p in sorted(fetch().items())]
        RAW.write_text(json.dumps(raw, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{len(raw)} products -> {RAW}")
    OUTPUT.write_text(generate(raw), encoding="utf-8")
    print(f"wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
