#!/usr/bin/env python3
"""Regenerate src/drivers/heymelody/heymelodyCatalog.generated.ts from the vendors' own catalogs.

Self-contained: standard library only, no files outside this repo.

Three sources, in order; a model keeps the first render found.

1. HeyTap — the HeyMelody app's `v1/earphone/firmwareCoverImage` endpoint (the
   call behind its "Supported Devices" screen). HMAC-SHA1-signed; returns
   unsigned heytapimg.com URLs. Every productId in
   docs/reference/heymelody-devices.json is tried against all four regions.
2. realme Link — `api/common/config/get`, type `rus_img_<marketing name>`.
   Anonymous but ECIES/AES-GCM-encrypted; returns unsigned r35.realme.net URLs
   per colour and render slot. A still-missing productId is joined to realme's
   model list (docs/reference/realme-models.json) by `modelId`, then tried
   under our own name. Every colour is kept for `QueryColourId` (0x010B).
3. realme Link's server device list, `api/v4/device/whitelist`: one `imageUrl`
   per model, covering older models; joined by name.

Only the URLs are shipped — no signing secret or key reaches the client.

The HeyTap per-region HMAC secrets are not in this repo. Set them in the
environment (a region without one is skipped):

    HEYTAP_SECRET_IN=… HEYTAP_SECRET_SG=… HEYTAP_SECRET_EU=… HEYTAP_SECRET_US=… \\
        python3 scripts/fetch-heymelody-catalog.py

    python3 scripts/fetch-heymelody-catalog.py --self-test   # offline crypto check
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

SOURCE = Path("docs/reference/heymelody-devices.json")
REALME_MODELS = Path("docs/reference/realme-models.json")
OUTPUT = Path("src/drivers/heymelody/heymelodyCatalog.generated.ts")

HEYTAP_REGIONS = ("in", "sg", "eu", "us")
HEYTAP_VERSION_CODE = "116009000"  # com.heytap.headset v116.9.0
HEYTAP_CHUNK = 50

REALME_REGION = "in"
REALME_OTA_HOST = "https://iot-in-ota.realme.com/"  # NetworkConstants: group `in`, service `ota`
REALME_APP_VERSION = "5.5.514.11421"
REALME_CHUNK = 10
# The whole product first, then the case. realme colour ids: 2 = BLACK.
REALME_SLOTS = ("main", "device", "box")
REALME_PREFERRED_COLOUR = "2"

HEADER = '''/**
 * HeyMelody product render URLs, from the vendors' own cloud catalogs: HeyTap's
 * `v1/earphone/firmwareCoverImage` (the HeyMelody app's "Supported Devices"
 * screen) first, then realme Link's `rus_img_<name>` config for models HeyTap
 * has no render for. GENERATED FILE — regenerate with
 * `python3 scripts/fetch-heymelody-catalog.py`.
 *
 * Keyed by productId (the 6-hex-digit id `QueryProductId` 0x0103 reports).
 * The default render per model. The URLs are unsigned heytapimg.com /
 * r35.realme.net paths; a model absent here has no render in any catalog.
 */
'''

COLOUR_HEADER = '''/**
 * Per-colour renders for the models realme Link's rus_img catalog covers:
 * productId, then the colour bucket `QueryColourId` (0x010B) reports
 * (1 WHITE, 2 BLACK, … 11 GOLDEN). A colour absent here falls back to the
 * default render above.
 */
'''


# --- AES-256-GCM, pure Python (FIPS-197, NIST SP 800-38D) -------------------

SBOX = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]
RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]


def _gmul(a: int, b: int) -> int:
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xff
        if hi:
            a ^= 0x1b
        b >>= 1
    return p


def _key_expansion(key: bytes) -> tuple[list[list[int]], int]:
    nk = len(key) // 4
    nr = nk + 6
    w = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
    for i in range(nk, 4 * (nr + 1)):
        temp = list(w[i - 1])
        if i % nk == 0:
            temp = [SBOX[b] for b in temp[1:] + temp[:1]]
            temp[0] ^= RCON[i // nk - 1]
        elif nk > 6 and i % nk == 4:
            temp = [SBOX[b] for b in temp]
        w.append([w[i - nk][j] ^ temp[j] for j in range(4)])
    return w, nr


def _aes_block(block: bytes, w: list[list[int]], nr: int) -> bytes:
    state = [[block[r + 4 * c] for c in range(4)] for r in range(4)]

    def add_round_key(rnd: int) -> None:
        for c in range(4):
            for r in range(4):
                state[r][c] ^= w[rnd * 4 + c][r]

    def sub_shift() -> None:
        for r in range(4):
            state[r] = [SBOX[b] for b in state[r]]
            state[r] = state[r][r:] + state[r][:r]

    add_round_key(0)
    for rnd in range(1, nr):
        sub_shift()
        for c in range(4):
            a = [state[r][c] for r in range(4)]
            state[0][c] = _gmul(a[0], 2) ^ _gmul(a[1], 3) ^ a[2] ^ a[3]
            state[1][c] = a[0] ^ _gmul(a[1], 2) ^ _gmul(a[2], 3) ^ a[3]
            state[2][c] = a[0] ^ a[1] ^ _gmul(a[2], 2) ^ _gmul(a[3], 3)
            state[3][c] = _gmul(a[0], 3) ^ a[1] ^ a[2] ^ _gmul(a[3], 2)
        add_round_key(rnd)
    sub_shift()
    add_round_key(nr)
    return bytes(state[r][c] for c in range(4) for r in range(4))


def _gf_mult(x: int, y: int) -> int:
    z, v = 0, y
    for i in range(128):
        if (x >> (127 - i)) & 1:
            z ^= v
        v = (v >> 1) ^ 0xE1000000000000000000000000000000 if v & 1 else v >> 1
    return z


def _ghash(h: int, aad: bytes, ciphertext: bytes) -> bytes:
    def pad16(b: bytes) -> bytes:
        return b + b"\x00" * (-len(b) % 16)

    blocks = pad16(aad) + pad16(ciphertext)
    y = 0
    for i in range(0, len(blocks), 16):
        y = _gf_mult(y ^ int.from_bytes(blocks[i:i + 16], "big"), h)
    lengths = (len(aad) * 8).to_bytes(8, "big") + (len(ciphertext) * 8).to_bytes(8, "big")
    return _gf_mult(y ^ int.from_bytes(lengths, "big"), h).to_bytes(16, "big")


def _gcm(key: bytes, iv: bytes, data: bytes, aad: bytes, decrypt: bool) -> tuple[bytes, bytes]:
    """CTR-transforms `data`; returns (output, tag over the ciphertext). 12-byte IVs only."""
    w, nr = _key_expansion(key)
    h = int.from_bytes(_aes_block(b"\x00" * 16, w, nr), "big")
    j0 = iv + b"\x00\x00\x00\x01"
    counter, out = int.from_bytes(j0, "big"), bytearray()
    for i in range(0, len(data), 16):
        counter = (counter & ~0xFFFFFFFF) | ((counter + 1) & 0xFFFFFFFF)
        keystream = _aes_block(counter.to_bytes(16, "big"), w, nr)
        out += bytes(a ^ b for a, b in zip(data[i:i + 16], keystream))
    ciphertext = data if decrypt else bytes(out)
    tag = bytes(a ^ b for a, b in zip(_ghash(h, aad, ciphertext), _aes_block(j0, w, nr)))
    return bytes(out), tag


def gcm_encrypt(key: bytes, iv: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    ciphertext, tag = _gcm(key, iv, plaintext, aad, decrypt=False)
    return ciphertext + tag


def gcm_decrypt(key: bytes, iv: bytes, ciphertext_with_tag: bytes, aad: bytes = b"") -> bytes:
    ciphertext, tag = ciphertext_with_tag[:-16], ciphertext_with_tag[-16:]
    plaintext, expected = _gcm(key, iv, ciphertext, aad, decrypt=True)
    if not hmac.compare_digest(expected, tag):
        raise ValueError("GCM tag mismatch")
    return plaintext


# --- realme request crypto (com.realme.link CryptInterceptor) ---------------
# ECIES exactly as the app's bundled BouncyCastle does it ("Cipher.ECIES" ->
# IESCipher$ECIES: IESEngine(ECDHBasicAgreement, KDF2BytesGenerator(SHA1),
# HMac(SHA1)), no block cipher, no IESParameterSpec -> 16-byte MAC key):
#   Z = V || sharedX, derived = KDF2-SHA1(Z), macKey = derived[:16],
#   keystream = derived[16:], tag = HMAC-SHA1(macKey, ct || 8 zero bytes),
#   output = V (0x04 || X || Y) || ct || tag.

_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_A = _P - 3
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551

# Server public key, base64 SPKI (ECCUtils.java:17). Public by nature — not a secret.
REALME_SERVER_KEY = (
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEybZKYxj9SvlAjwLylCX518ed8VFZjX6N7"
    "LYiLQlQzJyQeVWGeXFhmsD05fbYtGATO1wm5CT1DU6HYQIiSEYFPQ=="
)


def _ec_add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p1 == p2:
        lam = (3 * x1 * x1 + _A) * pow(2 * y1, _P - 2, _P) % _P
    else:
        lam = (y2 - y1) * pow(x2 - x1, _P - 2, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    return x3, (lam * (x1 - x3) - y1) % _P


def _ec_mul(k: int, point):
    result = None
    while k:
        if k & 1:
            result = _ec_add(result, point)
        point = _ec_add(point, point)
        k >>= 1
    return result


def _spki_point(spki_b64: str) -> tuple[int, int]:
    der = base64.b64decode(spki_b64)
    i = 2 + 2 + der[3] + 2  # outer SEQUENCE, AlgorithmIdentifier, BIT STRING header
    point = der[i + 1:]  # skip the unused-bits byte
    if point[0] != 0x04:
        raise ValueError("expected an uncompressed point")
    return int.from_bytes(point[1:33], "big"), int.from_bytes(point[33:65], "big")


def _kdf2_sha1(z: bytes, length: int) -> bytes:
    out, counter = b"", 1
    while len(out) < length:
        out += hashlib.sha1(z + counter.to_bytes(4, "big")).digest()
        counter += 1
    return out[:length]


def ecies_encrypt(plaintext: bytes, eph_d: int | None = None) -> bytes:
    d = eph_d if eph_d is not None else int.from_bytes(os.urandom(32), "big") % (_N - 1) + 1
    ex, ey = _ec_mul(d, (_GX, _GY))
    v = b"\x04" + ex.to_bytes(32, "big") + ey.to_bytes(32, "big")
    sx, _ = _ec_mul(d, _spki_point(REALME_SERVER_KEY))
    derived = _kdf2_sha1(v + sx.to_bytes(32, "big"), 16 + len(plaintext))
    mac_key, keystream = derived[:16], derived[16:]
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, keystream))
    tag = hmac.new(mac_key, ciphertext + b"\x00" * 8, hashlib.sha1).digest()
    return v + ciphertext + tag


def encrypt_body(key_hex: str, plaintext: bytes) -> str:
    """AESUtils.f(): `[ivLen][iv][ciphertext || tag]` as uppercase hex."""
    iv = os.urandom(12)
    return (bytes([len(iv)]) + iv + gcm_encrypt(bytes.fromhex(key_hex), iv, plaintext)).hex().upper()


def decrypt_body(key_hex: str, body: str) -> bytes:
    buf = bytes.fromhex(body.strip().strip('"'))
    iv_len = buf[0]
    return gcm_decrypt(bytes.fromhex(key_hex), buf[1:1 + iv_len], buf[1 + iv_len:])


# --- realme Link API ---------------------------------------------------------


def realme_post(path: str, payload: dict, query: dict | None = None) -> dict:
    key_hex = os.urandom(32).hex().upper()  # SecurityUtils: uppercase hex of a random AES-256 key
    body = encrypt_body(key_hex, json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    url = REALME_OTA_HOST + path + ("?" + urllib.parse.urlencode(query) if query else "")
    request = urllib.request.Request(
        url,
        data=body.encode("ascii"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Secure": "ECC",
            "SecureKey": base64.b64encode(ecies_encrypt(key_hex.encode("ascii"))).decode("ascii"),
            "client": "android",
            "region": REALME_REGION,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20, context=ssl.create_default_context()) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
    # CryptInterceptor.java:39 — a 2xx envelope comes back as plaintext JSON.
    if raw.lstrip().startswith("{"):
        return json.loads(raw)
    return json.loads(decrypt_body(key_hex, raw).decode("utf-8"))


def realme_image_manifests(models: list[str]) -> dict[str, dict[str, dict[str, str]]]:
    """{model: {colour id: {slot: url}}} from `rus_img_<model>` (HeadsetRusImg keys `img_<c>_<slot>`)."""
    reply = realme_post("api/common/config/get", {"typeList": [f"rus_img_{m}" for m in models], "queryType": 1})
    result = reply.get("result") or {}
    manifests = {}
    for model in models:
        blob = result.get(f"rus_img_{model}") or {}
        if isinstance(blob, str):
            blob = json.loads(blob or "{}")
        manifests[model] = {
            str(cid): {slot: blob[f"img_{cid}_{slot}"] for slot in REALME_SLOTS if blob.get(f"img_{cid}_{slot}")}
            for cid in blob.get("imgIdentifiers") or []
        }
    return manifests


def realme_device_list() -> list[dict]:
    reply = realme_post(
        "api/v4/device/whitelist",
        {"realmeId": "", "packageName": "com.realme.link", "osName": "Android", "appVersion": REALME_APP_VERSION},
        {"regionCode": REALME_REGION, "language": "en"},
    )
    return reply.get("result") or []


# --- HeyTap -----------------------------------------------------------------


def heytap_secrets() -> dict[str, str]:
    secrets = {r: os.environ[f"HEYTAP_SECRET_{r.upper()}"] for r in HEYTAP_REGIONS if os.environ.get(f"HEYTAP_SECRET_{r.upper()}")}
    if not secrets:
        sys.exit("set at least HEYTAP_SECRET_IN (see this script's docstring)")
    return secrets


def heytap_fetch(region: str, secret: str, product_ids: list[str]) -> dict[str, str]:
    body = json.dumps(
        {"platform": "android", "channel": "1", "versionCode": HEYTAP_VERSION_CODE, "productId": ",".join(product_ids)},
        separators=(",", ":"),
    )
    request = urllib.request.Request(
        f"https://iot-earbuds-{region}.allawnos.com/v1/earphone/firmwareCoverImage",
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "appid": "earphone",
            "ts": str(int(time.time() * 1000)),
            "nonce": str(uuid.uuid4()),
            "sv": "v1",
            "sign": hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha1).hexdigest(),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if payload.get("code") != 0:
        raise RuntimeError(f"{region}: server error {payload}")
    return {
        item["productId"].upper(): item["listCoverImage"].strip()
        for item in payload.get("data") or []
        if (item.get("listCoverImage") or "").strip().startswith("https://")
    }


def heytap_stage(secrets: dict[str, str], ids: list[str], images: dict[str, str]) -> None:
    for region in HEYTAP_REGIONS:
        pending = [pid for pid in ids if pid not in images]
        if not pending or region not in secrets:
            continue
        found = 0
        for start in range(0, len(pending), HEYTAP_CHUNK):
            for pid, url in heytap_fetch(region, secrets[region], pending[start:start + HEYTAP_CHUNK]).items():
                if pid in ids and pid not in images:
                    images[pid] = url
                    found += 1
        print(f"heytap {region}: {found} new renders")


# --- realme stages ----------------------------------------------------------


def squash(name: str) -> str:
    """'realme Buds Air6 Pro' and 'realme Buds Air 6 Pro' name the same model."""
    return "".join(name.lower().split())


def colour_renders(colours: dict[str, dict[str, str]]) -> dict[str, tuple[str, str]]:
    """{colour id: (url, slot)}, taking each colour's best slot."""
    out = {}
    for cid, slots in colours.items():
        for slot in REALME_SLOTS:
            url = (slots.get(slot) or "").strip()
            if url.startswith("https://"):
                out[cid] = (url, slot)
                break
    return out


def realme_stage(realme_models: list[dict], names: dict[str, str], images: dict[str, str],
                 colour_images: dict[str, dict[str, str]]) -> None:
    # Candidate names per still-missing productId: realme's model list by modelId
    # (not unique — T300 Pro / T500 Pro share 066452 — so the one named like ours
    # goes first), then our own name, which finds models realme's list omits.
    candidates: dict[str, list[str]] = {pid: [] for pid in names if pid not in images}
    for entry in realme_models:
        if entry["modelId"] in candidates:
            candidates[entry["modelId"]].append(entry["model"])
    for pid, models in candidates.items():
        models.sort(key=lambda m: squash(m) != squash(names[pid]))
        if names[pid] not in models:
            models.append(names[pid])

    queried = sorted({m for models in candidates.values() for m in models})
    manifests: dict = {}
    for start in range(0, len(queried), REALME_CHUNK):
        manifests.update(realme_image_manifests(queried[start:start + REALME_CHUNK]))

    found = 0
    for pid in sorted(candidates):
        for model in candidates[pid]:
            renders = colour_renders(manifests.get(model) or {})
            if not renders:
                continue
            default = REALME_PREFERRED_COLOUR if REALME_PREFERRED_COLOUR in renders else next(iter(renders))
            images[pid] = renders[default][0]
            colour_images[pid] = {cid: url for cid, (url, _) in renders.items()}
            found += 1
            picked = ", ".join(f"{cid}:{slot}" for cid, (_, slot) in renders.items())
            print(f"  {pid}  {names[pid]:40s} <- rus_img '{model}' default {default} [{picked}]")
            break
    print(f"realme rus_img {REALME_REGION}: {found} new renders ({len(queried)} names queried)")


def unbranded(name: str) -> str:
    """The server list names some models with a 'TechLife' sub-brand ours omits."""
    return squash(name).replace("techlife", "")


def whitelist_stage(names: dict[str, str], images: dict[str, str]) -> None:
    by_name: dict[str, str] = {}
    for group in realme_device_list():
        for device in group.get("deviceList") or []:
            url = (device.get("imageUrl") or "").strip()
            if device.get("name") and url.startswith("https://"):
                by_name.setdefault(unbranded(device["name"]), url)
    found = 0
    for pid in sorted(pid for pid in names if pid not in images):
        url = by_name.get(unbranded(names[pid]))
        if url:
            images[pid] = url
            found += 1
            print(f"  {pid}  {names[pid]:40s} <- whitelist")
    print(f"realme whitelist {REALME_REGION}: {found} new renders ({len(by_name)} models listed)")


# --- output -----------------------------------------------------------------


def write_catalog(images: dict[str, str], colour_images: dict[str, dict[str, str]]) -> None:
    defaults = [f"  '{pid}': {json.dumps(images[pid])}," for pid in sorted(images)]
    colours = [
        f"  '{pid}': {{ "
        + ", ".join(f"'{cid}': {json.dumps(url)}" for cid, url in sorted(colour_images[pid].items(), key=lambda kv: int(kv[0])))
        + " },"
        for pid in sorted(colour_images)
    ]
    OUTPUT.write_text(
        HEADER
        + "export const HEYMELODY_CATALOG_IMAGES: Record<string, string> = {\n" + "\n".join(defaults) + "\n};\n\n"
        + COLOUR_HEADER
        + "export const HEYMELODY_COLOUR_IMAGES: Record<string, Record<string, string>> = {\n" + "\n".join(colours) + "\n};\n",
        encoding="utf-8",
    )


def self_test() -> None:
    # FIPS-197 Appendix C.3: AES-256 known-answer vector.
    key = bytes(range(32))
    w, nr = _key_expansion(key)
    assert _aes_block(bytes.fromhex("00112233445566778899aabbccddeeff"), w, nr).hex() == "8ea2b7ca516745bfeafc49904b496089"
    iv, aad, message = bytes(range(12)), b"aad", b"The quick brown fox jumps over the lazy dog."
    sealed = gcm_encrypt(key, iv, message, aad)
    assert gcm_decrypt(key, iv, sealed, aad) == message
    try:
        gcm_decrypt(key, iv, sealed[:-1] + bytes([sealed[-1] ^ 1]), aad)
        raise AssertionError("GCM tag tampering went undetected")
    except ValueError:
        pass
    # ECIES: recompute the keystream and MAC from IESEngine's layout and check both.
    d = 0x1234
    blob = ecies_encrypt(b"0123456789ABCDEF", eph_d=d)
    v, ciphertext, tag = blob[:65], blob[65:-20], blob[-20:]
    sx, _ = _ec_mul(d, _spki_point(REALME_SERVER_KEY))
    derived = _kdf2_sha1(v + sx.to_bytes(32, "big"), 16 + len(ciphertext))
    assert hmac.new(derived[:16], ciphertext + b"\x00" * 8, hashlib.sha1).digest() == tag
    assert bytes(a ^ b for a, b in zip(ciphertext, derived[16:])) == b"0123456789ABCDEF"
    print("self-test passed: AES-256 FIPS-197 vector, GCM round trip + tamper, ECIES re-derivation")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true", help="check the crypto offline and exit")
    if parser.parse_args().self_test:
        self_test()
        return

    secrets = heytap_secrets()
    devices = json.loads(SOURCE.read_text(encoding="utf-8"))["devices"]
    names = {d["productId"].upper(): d["name"] for d in devices}
    realme_models = json.loads(REALME_MODELS.read_text(encoding="utf-8"))["models"]
    images: dict[str, str] = {}
    colour_images: dict[str, dict[str, str]] = {}

    heytap_stage(secrets, list(names), images)
    realme_stage(realme_models, names, images, colour_images)
    whitelist_stage(names, images)
    write_catalog(images, colour_images)
    print(f"\nwrote {OUTPUT} ({len(images)}/{len(names)} models)")

    missing = sorted(pid for pid in names if pid not in images)
    if missing:
        print(f"\nno render in any catalog ({len(missing)}):")
        for pid in missing:
            print(f"  {pid}  {names[pid]}")


if __name__ == "__main__":
    main()
