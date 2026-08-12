# Vendor reference data

Files here are **dated snapshots taken from vendor apps**, kept so the protocol
work can be checked against something concrete. They are evidence, not truth.

| File | What it is |
|---|---|
| `m4.json` | The SmartControl-Desktop property dump for the MOMENTUM 4. Command IDs, payload shapes, per-setting firmware gates. |
| `m4-app-config.json` | The Sennheiser Smart Control app's own product config for the M4 — feature variants, EQ presets, minimum firmware versions. |

## These are snapshots, and the app they came from does not use them as truth

The Smart Control app ships its configs only as a **fallback**. At runtime it
fetches current ones from a server — `root.json` in the app's assets is an
Azure App Configuration manifest, mapping product keys to etags with a
`last_modified` of **2024-10-22**.

So a feature granted to a product after that date exists in **no** copy of the
app, decrypted or not. This is not hypothetical: a MOMENTUM 4 on current
firmware answers for two GAIA features (16 and 20) that appear in `m4.json`,
in both app versions examined, and in ZenControl's independent analysis —
none of them. See `docs/PROTOCOL-UNKNOWNS.md`.

**A feature missing from these files is not absent from the device.** Treat
them as good evidence about the past and weak evidence about the present, and
prefer a hardware reading whenever the two disagree.

The reverse also holds: a value present here is not confirmed either. Anything
this project has not verified against real hardware belongs in
`docs/PROTOCOL-UNKNOWNS.md`, not in code.
