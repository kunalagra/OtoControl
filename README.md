<h1 align="center">
  <br>
  <a href="https://github.com/kunalagra/OtoControl"><img src="https://raw.githubusercontent.com/kunalagra/OtoControl/main/public/favicon.svg" alt="OtoControl" width="200"></a>
  <br>
  OtoControl
  <br>
</h1>

<h4 align="center">An unofficial control panel for your headphones — straight from the browser</h4>

<p align="center">
  <a href="#supported-devices">Supported Devices</a> •
  <a href="#key-features">Key Features</a> •
  <a href="#how-to-use">How To Use</a> •
  <a href="#protocol-notes">Protocol Notes</a> •
  <a href="#credits">Credits</a> •
  <a href="#license">License</a>
</p>

![screenshot](https://raw.githubusercontent.com/kunalagra/OtoControl/main/docs/assets/screenshot.png)

## Supported Devices

| Brand | Example models | Status |
|---|---|---|
| **Sennheiser** | MOMENTUM 4 Wireless | ✅ Fully driven (noise dial, EQ, sidetone, wear detection…) |
| **Sony** | WH-1000X series, WF-1000X series, LinkBuds, INZONE… | ✅ Capability-probed on connect |
| **Nothing / CMF** | Ear (1)–(3), CMF Buds Pro, Headphone (a)… | ✅ Full controls incl. gestures & fit test |
| **Soundcore** | Liberty Air 2 Pro, Space One, and more | ✅ ANC, EQ, tap customization, LDAC |
| **OPPO / realme / OnePlus** (HeyMelody) | Enco Air / Free / Buds series, OnePlus Buds / Nord Buds, realme Buds… | 🧪 Battery, ANC, EQ presets and custom EQ, touch controls, feature switches, connected devices — tested on a realme Buds Air6 Pro, otherwise built from reverse-engineering |
| **Samsung Galaxy Buds** | Buds, Buds+, Live, Pro, Buds2 / 2 Pro, FE, Buds3 / 3 Pro, Buds4 / 4 Pro… | 🧪 Battery, noise control, ambient level, EQ, touch lock and hold actions, find — checked against GalaxyBudsClient's real captures, unverified on real hardware |
| **Google Pixel Buds** | Pixel Buds Pro, Pro 2 | 🧪 Battery, ANC incl. Adaptive, multipoint, on-head detection, EQ — checked against pbpctrl and real captures, unverified on real hardware |
| **Xiaomi / Redmi** | Redmi Buds 3 Pro–8, Xiaomi Buds 3/4 Pro… | 🧪 Battery, ANC with strength, EQ presets and custom curve, touch controls, find — checked against a real capture of the official app, unverified on real hardware |

> [!NOTE]
> Every model Sony's own catalog carries is recognized out of the box — its cloud catalog is the model list. Soundcore support targets the A3951 protocol family.
>
> 🧪 drivers have no maintainer hardware yet. Each one's System tab has a **protocol log** with a copy button: if something looks wrong on your earbuds, copying that log into an issue is the fastest way to get it fixed.

## Key Features

* Works entirely in the browser — **Web Serial** and **Web Bluetooth** (BLE GATT), nothing to install, no accounts
* **Live capability probing**: the UI is built from what your headphones actually report, not from a hardcoded spec sheet
* Per-brand drivers, each speaking the vendor's own protocol:
  * **Sennheiser (GAIA v3)** — noise control with transparency dial, EQ, bass boost, sidetone, wear detection, auto power off, low latency
  * **Sony (MDR)** — noise cancelling / ambient, EQ, auto power off, power off, DSEE upscaling, connection mode
  * **Nothing / CMF** — ANC modes, presets + custom EQ, Advanced EQ, Dirac Opteo, bass enhance, touch assignment, low latency, find my buds, ear tip fit test
  * **Soundcore (BLE)** — battery, ANC scenes & custom transparency, 8-band custom EQ + 29 presets (incl. artist profiles), tap customization with enable/disable, wear detection, voice prompts, LDAC toggle
  * **HeyMelody (SPP)** — the shared OPPO/realme/OnePlus app: identification via a 137-model catalog with product renders, battery, per-model ANC modes, EQ presets and editable custom EQ, touch controls limited to what each model accepts, game mode and other feature switches, connected devices
  * **Samsung Galaxy Buds (SPP)** — battery for each bud and the case, in-ear placement, noise control per model (ANC / ambient / adaptive), ambient level, EQ presets, touchpad lock and touch-and-hold actions, find my earbuds, product renders; Buds+, Live and Pro share the standard SPP service with HeyMelody and are told apart by listening to what the earbuds send
  * **Google Pixel Buds (Maestro)** — pw_rpc over HDLC on a Bluetooth Classic serial service: battery (case and each bud), noise control incl. Adaptive, multipoint, on-head detection, five-band EQ, product renders
  * **Xiaomi / Redmi (RCSP over RFCOMM)** — per-model options and product renders from the vendor catalog, battery, noise cancelling / transparency with strength, EQ presets and a 10-band custom curve, touch controls, in-ear detection, find my earbuds; protocol log and read-only query console on the System tab
* **Settings snapshots** cached locally per device, so last-known state survives reloads
* **Protocol log** on the System tab of the newer drivers: every byte sent and received since connect, with a copy button and a read-only query box
* **Frame-level debug console** for capturing raw protocol frames (`localStorage["otocontrol:debug-frames"] = "1"`)

## How To Use

To clone and run this application, you'll need [Git](https://git-scm.com), [Node.js](https://nodejs.org/en/download/) and a Chromium-based browser (Chrome, Edge, Brave…). From your command line:

```bash
# Clone this repository
$ git clone https://github.com/kunalagra/OtoControl

# Go into the repository
$ cd OtoControl

# Install dependencies
$ npm install

# Run the app
$ npm run dev
```

Then open the printed `localhost` URL and hit **Add device**, which opens the browser's serial picker. That is the way in for every brand except Soundcore and some Nothing models: for those, choose **My device isn't listed** and connect over Bluetooth instead. Later devices are added from the menu beside the device name.

> [!IMPORTANT]
> Web Serial and Web Bluetooth only work over **localhost or HTTPS**, and only in Chromium browsers. Your headphones must be paired to the OS as an audio device first.

> [!NOTE]
> For Soundcore earbuds over BLE, the buds may need to be advertising: open the case or re-enter pairing range before connecting.

## Protocol Notes

This project speaks vendor protocols that were never published. Everything known lives in [`docs/PROTOCOL-UNKNOWNS.md`](docs/PROTOCOL-UNKNOWNS.md) — including a list of gaps that take **two minutes of your headphones' time** to close.

If you own one of these devices: open the built-in debug console, capture the raw hex line for a setting you changed, and contribute it. Readings that come back empty are useful too.

## Credits

Protocol knowledge stands on these projects (read as reference, never copied):

* [OpenSCQ30](https://github.com/Oppzippy/OpenSCQ30) — Soundcore A3951 command tables
* [SoundcoreManager](https://github.com/gmallios/SoundcoreManager) — framing, test captures, device metadata
* [Gadgetbridge](https://codeberg.org/Freeyourgadget/Gadgetbridge) — Soundcore wire semantics
* [ear-web](https://gitlab.com/the-fonz/ear-web) & BudsLink — Nothing/CMF and Sony MDR specs
* [ZenControl](https://github.com/Oein/sennheiser-desktop-client) — Sennheiser audio modes
* [OppoPodsManager](https://github.com/Zhaoyi-ya/OppoPodsManager) and the OppoPods lineage it credits ([Leaf-lsgtky](https://github.com/Leaf-lsgtky/OppoPods), [1812z](https://github.com/1812z/OppoPods)) and [QuickBuds](https://github.com/spizganed/QuickBuds) — OPPO/realme/OnePlus protocol corroboration
* [GalaxyBudsClient](https://github.com/timschneeb/GalaxyBudsClient) — Galaxy Buds message layouts and per-model captures
* [pbpctrl](https://github.com/qzed/pbpctrl), [opencontrolpixelbudspro2](https://github.com/tedsluis/opencontrolpixelbudspro2) and [MagicPodsCore](https://github.com/steam3d/MagicPodsCore) — Pixel Buds Maestro protocol and captures
* [WinMi-Buds](https://github.com/ios7jbpro/WinMi-Buds), [MiBudsController](https://github.com/FallenLeeee/MiBudsController), [MiBudsClient](https://github.com/CesurPolat/MiBudsClient), [buds-control](https://github.com/0swift135/buds-control), [redmi-buds-6-active-linux-software](https://github.com/T0F1Q2007/redmi-buds-6-active-linux-software) and Gadgetbridge's Redmi Buds support — Xiaomi / Redmi protocol, handshake and captures

Built with:

* [React](https://react.dev/) · [Vite](https://vite.dev/) · [TypeScript](https://www.typescriptlang.org/)
* [Tailwind CSS v4](https://tailwindcss.com/)
* [shadcn/ui](https://ui.shadcn.com/) on [Base UI](https://base-ui.com/)
* [Remix Icon](https://remixicon.com/)

## You may also like...

* [Codegamy](https://github.com/kunalagra/codegamy) - A complete coding & interview platform
* [MediCall](https://github.com/kunalagra/MediCall) - An AIO medical platform to connect doctors and patients
* [Sikho](https://github.com/kunalagra/sikho) - Professional learning marketplace

## License

AGPL-3
