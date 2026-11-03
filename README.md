# Generative AV Labs

**[Open the home page](https://patrickiben.github.io/generative-av-labs/)** · [Nebula](https://patrickiben.github.io/generative-av-labs/nebula.html) · [Endless Cockpit](https://patrickiben.github.io/generative-av-labs/endless-cockpit.html) · [Field guide](https://patrickiben.github.io/generative-av-labs/field-guide.html)

Two browser instruments that turn an electronic drum kit into light. Plug audio and MIDI into your computer and open a page. There is no helper app, no server and no model, and nothing leaves the browser.

![Nebula during the demo](docs/nebula.jpg)

**Nebula** hangs the last twelve seconds of your playing in the air. Every hit is born at the core and winds outward along a spiral, with color set by frequency and brightness by loudness. Hits stir a small fluid field. Form mode lifts a picture and a sound into clouds, matches them by sliced optimal transport, and lets you move the mass between them.

![Endless Cockpit during the demo](docs/endless-cockpit.jpg)

**Endless Cockpit** is a road at dusk that keeps time. Your tempo sets the speed, the kick surges you forward and sends a ring of light down the road, and the horizon is your live spectrum. The scene is raymarched each frame and fed through a zoom-feedback loop. Ride mode takes speed from a Bluetooth cadence sensor instead, directly from the browser.

## Wire it

For a Pearl Mimic Pro and a Universal Audio Apollo Solo:

- **Audio:** Mimic Pro Line Out 1 and 2 (the main mix) to Apollo Solo rear Mic/Line 1 and 2, set to Line. Leave the front Hi-Z jack empty.
- **MIDI:** the Apollo Solo has no MIDI ports, and the Mimic Pro's USB slot is for installing samples. Run a 5-pin cable from the module's MIDI OUT into a USB-MIDI interface.
- **Browser:** Chrome or Edge. Safari has no Web MIDI, and Firefox asks for a site permission add-on.

Any audio interface and any kit with MIDI works the same way. [DEVICES](docs/DEVICES.md) has the sources for all of this.

## What it tells you

Each page says at all times which of these it is in, for audio and MIDI separately: not connected, waiting for permission, **permission denied**, **no device**, **device open with no signal**, live, or disconnected. A demo and a replay carry their own labels, so synthetic drums can never read as your kit.

## Open it locally

The two instrument pages are self-contained. Open `nebula.html` or `endless-cockpit.html` directly, or serve the folder:

```sh
python3 -m http.server 8090
```

Edit `src/`, then run `python3 build.py`, which inlines everything into the pages.

## Read more

- [Field guide](field-guide.html): wiring, statuses and what each drum does.
- [Devices](docs/DEVICES.md): the hardware route and browser support, with sources.
- [Methods](docs/METHODS.md): onset detection, tempo, the fluid field, the feedback loop and transport.
- [Validation](docs/VALIDATION.md): what was tested, how, and what still needs a real kit.

## Credit

No outside code is included. Ideas came from [Butterchurn](https://github.com/jberg/butterchurn) (MIT), [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT), [paper-cranes](https://github.com/loqwai/paper-cranes) (BSD-3-Clause), [@audio/beat](https://github.com/audiojs/beat) and [realtime-bpm-analyzer](https://github.com/dlepaux/realtime-bpm-analyzer) (Apache-2.0).

MIT license.
