<h1 align="center">
  <br>
  <a href="https://github.com/kunalagra/OtoControl"><img src="https://raw.githubusercontent.com/kunalagra/OtoControl/main/public/logo.svg" alt="OtoControl" width="200"></a>
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

<!-- Drop a screenshot at public/screenshot.png and uncomment:
![screenshot](https://raw.githubusercontent.com/kunalagra/OtoControl/main/public/screenshot.png)
-->

## Supported Devices

| Brand | Example models | Status |
|---|---|---|
| **Sennheiser** | MOMENTUM 4 Wireless | ✅ Fully driven (noise dial, EQ, sidetone, wear detection…) |
| **Sony** | WH-1000X series, WF-1000X series, LinkBuds, INZONE… | ✅ Capability-probed on connect |
| **Nothing / CMF** | Ear (1)–(3), CMF Buds Pro, Headphone (a)… | ✅ Full controls incl. gestures & fit test |
| **Soundcore** | Liberty Air 2 Pro, Space One, and more | ✅ ANC, EQ, tap customization, LDAC |

> [!NOTE]
> Every model Sony's own catalog carries is recognized out of the box — its cloud catalog is the model list. Soundcore support targets the A3951 protocol family.

## Key Features

* Works entirely in the browser — **Web Serial** and **Web Bluetooth** (BLE GATT), nothing to install, no accounts
* **Live capability probing**: the UI is built from what your headphones actually report, not from a hardcoded spec sheet
* Per-brand drivers, each speaking the vendor's own protocol:
  * **Sennheiser (GAIA v3)** — noise control with transparency dial, EQ, bass boost, sidetone, wear detection, auto power off, low latency
  * **Sony (MDR)** — noise cancelling / ambient, EQ, auto power off, power off, DSEE upscaling, connection mode
  * **Nothing / CMF** — ANC modes, presets + custom EQ, Advanced EQ, Dirac Opteo, bass enhance, touch assignment, low latency, find my buds, ear tip fit test
  * **Soundcore (BLE)** — battery, ANC scenes & custom transparency, 8-band custom EQ + 29 presets (incl. artist profiles), tap customization with enable/disable, wear detection, voice prompts, LDAC toggle
* **Settings snapshots** cached locally per device, so last-known state survives reloads
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

Then open the printed `localhost` URL and hit **Connect over serial** or **Connect over Bluetooth**.

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
