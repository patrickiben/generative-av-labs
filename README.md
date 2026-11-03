# Generative AV Labs

**[Open the home page](https://patrickiben.github.io/generative-av-labs/)** · [Nebula](https://patrickiben.github.io/generative-av-labs/nebula.html) · [Endless Cockpit](https://patrickiben.github.io/generative-av-labs/endless-cockpit.html) · [Enter](https://patrickiben.github.io/generative-av-labs/enter.html) · [Chimera Synth](https://patrickiben.github.io/generative-av-labs/chimera.html) · [Field guide](https://patrickiben.github.io/generative-av-labs/field-guide.html)

Browser instruments for light and sound. Each page runs in your browser. There is no helper app and no server, and your audio, MIDI and pictures never leave the browser. Nebula, Endless Cockpit and Chimera Synth use no model. Enter uses one, a depth estimate for your own picture, which downloads only when you ask.

![Nebula during the demo](docs/nebula.jpg)

**Nebula** hangs the last twelve seconds of your playing in the air. Every hit is born at the core and winds outward along a spiral, with color set by frequency and brightness by loudness. Hits stir a small fluid field. Form mode lifts a picture and a sound into clouds, matches them by sliced optimal transport, and lets you move the mass between them.

![Endless Cockpit during the demo](docs/endless-cockpit.jpg)

**Endless Cockpit** is a road at dusk that keeps your pace. Your cadence sets the speed, from a Bluetooth cadence sensor or smart trainer connected straight from the browser, the pedal button, or a steady setting. Each crank revolution sends a ring of light down the road. The scene is raymarched each frame and fed through a zoom-feedback loop.

**Enter** lets you walk into a picture and fly through a sound. The sound world is a synesthetic map: time runs along X, pitch climbs and salience comes toward you, and the same sound lies below as terrain. Enter takes a picture or a sound, and it has no drum input. The picture world is a depth relief you walk through. Your own picture gets its depth from Depth Anything V2 Small (Apache-2.0) on ONNX Runtime Web. The first time, the page asks and then downloads about 76 MB from Hugging Face and jsDelivr. Without WebGPU, it downloads about 41 MB and runs on the processor. The print world casts a sound into a watertight STL. Grow World and Make 3D Object stay in the desktop app, because no browser path was found for SDXL or TripoSR.

![Enter's painted scene](docs/enter.jpg)

![Chimera Synth during the demo](docs/chimera.jpg)

**Chimera Synth** is a bass you breed by ear, and the one page here that makes sound. A genome of 20 genes grows the voice: drag a bud toward its tip and hear the seed lean that way, then let go to grow a new seed. Morph mode blends fifteen animal voices, from a mallard to a dolphin, by sliding their formants along a log-frequency axis. A phase check measures the low end and locks the sub where it adds up. A MIDI keyboard plays it over Web MIDI, and so do the computer keys. It came from the desktop Bio-Bass Chimera Lab, whose page is kept unchanged in `legacy/`.

## Wire a drum kit for Nebula

- **Audio:** the module's main outputs to two line inputs on your audio interface.
- **MIDI:** many audio interfaces have no MIDI ports, and a module's USB port is not always MIDI. If so, run a 5-pin cable from the module's MIDI OUT into a USB-MIDI interface.
- **Browser:** Chrome or Edge. Safari has no Web MIDI, and Firefox asks for a site permission add-on.

[Inputs](docs/INPUTS.md) has the browser support, with sources.

## What it tells you

Nebula says at all times which of these it is in, for audio and MIDI separately: not connected, waiting for permission, **permission denied**, **no device**, **device open with no signal**, live, or disconnected. A demo and a replay carry their own labels, so synthetic drums can never read as your kit.

## Open it locally

The two instrument pages are self-contained. Open `nebula.html` or `endless-cockpit.html` directly, or serve the folder:

```sh
python3 -m http.server 8090
```

Edit `src/`, then run `python3 build.py`, which inlines everything into the pages.

## Read more

- [Field guide](field-guide.html): wiring, statuses, what each drum does in Nebula, and riding Endless Cockpit.
- [Inputs](docs/INPUTS.md): wiring a kit, Bluetooth cadence and browser support, with sources.
- [Methods](docs/METHODS.md): onset detection, tempo, the fluid field, the feedback loop and transport.
- [Validation](docs/VALIDATION.md): what was tested, how, and what still needs real gear.

## Credit

No outside code is included. Ideas came from [Butterchurn](https://github.com/jberg/butterchurn) (MIT), [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT), [paper-cranes](https://github.com/loqwai/paper-cranes) (BSD-3-Clause), [@audio/beat](https://github.com/audiojs/beat) and [realtime-bpm-analyzer](https://github.com/dlepaux/realtime-bpm-analyzer) (Apache-2.0).

MIT license.
