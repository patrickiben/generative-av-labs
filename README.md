# Generative AV Labs

**[Open the home page](https://patrickiben.github.io/generative-av-labs/)** · [Nebula](https://patrickiben.github.io/generative-av-labs/nebula.html) · [Enter](https://patrickiben.github.io/generative-av-labs/enter.html) · [Chimera Synth](https://patrickiben.github.io/generative-av-labs/chimera.html) · [Detail Forge Analog](https://patrickiben.github.io/generative-av-labs/analog.html) · [Displacer](https://patrickiben.github.io/generative-av-labs/displacer.html) · [Field guide](https://patrickiben.github.io/generative-av-labs/field-guide.html)

Browser instruments for light and sound. Each page runs in your browser. There is no helper app and no server, and your audio, MIDI and pictures never leave the browser. Nebula, Chimera Synth, Detail Forge Analog and Displacer use no model. Enter uses one, a depth estimate for your own picture, which downloads only when you ask.

![Nebula during the demo](docs/nebula.jpg)

**Nebula** hangs the last twelve seconds of your playing in the air. Every hit is born at the core and winds outward along a spiral, with color set by frequency and brightness by loudness. Hits stir a small fluid field. Form mode lifts a picture and a sound into clouds, matches them by sliced optimal transport, and lets you move the mass between them.

**Enter** lets you walk into a picture and fly through a sound. The sound world is a synesthetic map: time runs along X, pitch climbs and salience comes toward you, and the same sound lies below as terrain. Enter takes a picture or a sound, and it has no drum input. The picture world is a depth relief you walk through. Your own picture gets its depth from Depth Anything V2 Small (Apache-2.0) on ONNX Runtime Web. The first time, the page asks and then downloads about 76 MB from Hugging Face and jsDelivr. Without WebGPU, it downloads about 41 MB and runs on the processor. The print world casts a sound into a watertight STL. Grow World and Make 3D Object stay in the desktop app, because no browser path was found for SDXL or TripoSR.

![Enter's painted scene](docs/enter.jpg)

![Chimera Synth during the demo](docs/chimera.jpg)

**Chimera Synth** is a bass you breed by ear. A genome of 20 genes grows the voice: drag a bud toward its tip and hear the seed lean that way, then let go to grow a new seed. Morph mode blends fifteen animal voices, from a mallard to a dolphin, by sliding their formants along a log-frequency axis. A phase check measures the low end and locks the sub where it adds up. A MIDI keyboard plays it over Web MIDI, and so do the computer keys. It came from the desktop Bio-Bass Chimera Lab, whose page is kept in `legacy/` with one hardware comment removed.

![Displacer's two built-in pictures halfway through moving into each other](docs/displacer.jpg)

**Displacer** blends two pictures or two sounds without a crossfade. It moves the mass along an optimal-transport map: colors slide toward the other picture's palette, pixels travel to new places, and a sound's energy moves along frequency. The Space view lifts the pair into a 3D cloud of splats that you can turn while the slider carries one into the other. Genopatch grows a playable FM voice that fits a sound, and every blend saves as a PNG, a WAV or a point cloud. The mod wheel moves the blend. It came from the desktop Displacer, whose page is kept unchanged in `legacy/`; two defects there, sound blends about 250 times too quiet and a granular effect that did not repeat, are fixed here.

![Detail Forge Analog's before and after spectrograms](docs/analog.jpg)

**Detail Forge Analog** brightens a dull, band-limited recording and labels what it did. It measures the cutoff, then runs one of four engines: Floor, a high shelf that invents nothing, Transient, which lifts attacks and whose moving gain also spreads some new energy above the cutoff, and two that synthesize detail above the cutoff, a 4x oversampled Exciter and spectral band replication (SBR). Before and after spectrograms show the change, a loudness-matched A/B lets you hear it, and every number is measured on the output. The processing is the desktop app's, ported line by line and checked against it number for number by `tests/analog_numbers.py`; the desktop original is kept in `legacy/analog/` with one comment reworded. Files are read and decoded in the browser at their own sample rate, and the result saves as a 24-bit WAV.

## Wire a drum kit for Nebula

- **Audio:** the module's main outputs to two line inputs on your audio interface.
- **MIDI:** many audio interfaces have no MIDI ports, and a module's USB port is not always MIDI. If so, run a 5-pin cable from the module's MIDI OUT into a USB-MIDI interface.
- **Browser:** Chrome or Edge. Safari has no Web MIDI, and Firefox asks for a site permission add-on.

[Inputs](docs/INPUTS.md) has the browser support, with sources.

## What it tells you

Nebula says at all times which of these it is in, for audio and MIDI separately: not connected, waiting for permission, **permission denied**, **no device**, **device open with no signal**, live, or disconnected. A demo and a replay carry their own labels, so synthetic drums can never read as your kit.

## Open it locally

The instrument pages are self-contained. Open `nebula.html` or `chimera.html` directly, or serve the folder:

```sh
python3 -m http.server 8090
```

Edit `src/`, then run `python3 build.py`, which inlines everything into the pages.

## Read more

- [Field guide](field-guide.html): wiring, statuses, what each drum does in Nebula, connecting Chimera Synth, and Detail Forge Analog.
- [Inputs](docs/INPUTS.md): wiring a kit and browser support, with sources.
- [Methods](docs/METHODS.md): onset detection, tempo, the fluid field, the feedback loop and transport.
- [Validation](docs/VALIDATION.md): what was tested, how, and what still needs real gear.

## Elsewhere

Endless Cockpit moved on 2026-11-03 to [Body Signal Labs](https://github.com/patrickiben/body-signal-labs), with Autonomic Telemetry and Biofeedback Path Cockpit. Its old address here forwards there.

## Credit

No outside code is included. Ideas came from [Butterchurn](https://github.com/jberg/butterchurn) (MIT), [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT), [paper-cranes](https://github.com/loqwai/paper-cranes) (BSD-3-Clause), [@audio/beat](https://github.com/audiojs/beat) and [realtime-bpm-analyzer](https://github.com/dlepaux/realtime-bpm-analyzer) (Apache-2.0).

MIT license.
