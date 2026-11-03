# Methods

Everything in Nebula and Endless Cockpit is a stated rule. Nothing is learned, and neither page uses a model. Enter's depth estimate is the one model in this collection.

## Nebula: one bus for every source

In Nebula, real audio, real MIDI, the demo, keyboard pads and session replay all end in the same hit bus and the same 64-band spectrum (`src/kit.js`), so the pictures do not need to know where a hit came from. The page labels the source separately.

When MIDI notes have arrived within the last 15 seconds, audio onsets stop producing hits and audio only shapes the spectrum. This is what keeps one drum stroke from firing twice.

## Nebula: onsets from audio

An AudioWorklet (`kit-onset`) runs on the audio thread and reads about every 5.3 ms.

1. The two input channels are mixed and split into four bands: low pass 110 Hz, band pass 260 Hz, band pass 1.8 kHz, high pass 6.5 kHz.
2. Each band has a peak follower with its own decay, from 30 ms in the lows to 6 ms in the highs, so a low sine's ripple does not read as new energy.
3. The onset function is the largest band's rise in dB over the last few frames, plus a quarter of the sum across bands. It must clear an adaptive threshold between 9 and 22 dB, the band must be above -62 dBFS, and a 45 ms refractory period follows each hit.
4. Three frames later, the peak levels in the four bands choose a voice with the rule in `classify()`. High-only hits that are still ringing 170 ms later also send a soft crash.

This is a heuristic. A ride is not told apart, and a low tom can read as a kick. It was tuned on synthetic drums, not on a real module.

## Nebula: spectrum

An AnalyserNode with a 2048-point FFT gives the frame's spectrum, read into 64 log-spaced bands from 30 Hz to 16 kHz, with a 3 dB per octave tilt so cymbals read beside the kick. The top of the range follows the loudest recent level and falls at 1.2 dB per second, so a quiet kit and a loud kit both fill it. A floor of -55 dB on that top keeps a noise floor from being stretched to full scale.

With MIDI and no audio, each hit paints a stated shape in place of a measured spectrum.

## Nebula: input states

An open audio input reads as **no signal** until its peak passes -65 dBFS, and goes back after 6 seconds below it. An open MIDI port reads as no signal until a message that is not clock or active sensing arrives, and goes back after 8 seconds. Permission and device errors come directly from the browser's exception names.

## Nebula: tempo

All pairs of hits in the last 8 seconds that are under 2.2 seconds apart vote in a histogram, folded by octaves into 70 to 180 BPM, weighted by drum and by how close the pair is. The peak is refined by a parabola. It is an estimate, and the page shows it as one. A 60 BPM pulse reads as 120.

## Nebula: the picture

Particle positions and velocities live in floating-point textures updated by a shader: 16,384, 65,536 or 262,144 particles, chosen by frame rate.

In Field mode each particle has a fixed age and frequency. Its home is on a two-armed spiral, or on a plane in River, and its brightness and lift come from the spectrum history at its age and frequency. So a hit shows up at the core and travels outward over about 12.8 seconds, without the particles having to carry it.

Each drum pushes the particles in its stated way (see the About sheet). Hits also inject velocity into a small fluid simulation, with semi-Lagrangian advection and 10 Jacobi pressure steps on a 160 by 160 grid, which the particles sample.

Form mode carries over the desktop Nebula's method. A picture lifts to a cloud by a stated rule (position from the pixel, depth from brightness). A sound lifts by matching pursuit into Gabor atoms (time, log-frequency, salience). The two clouds are matched by sliced optimal transport over position and color, 32 iterations in a Web Worker, and the slider moves the mass along those transport vectors. The picture's relief is a heuristic, not a reconstructed scene.

## Endless Cockpit

The road and its hills are a raymarched height field. The scene passes through a feedback loop like Milkdrop's: the last frame is zoomed toward the vanishing point, slightly warped, and mixed under the new frame. Only emitters leave long trails, tracked in the alpha channel, so the sun and sky never smear over the land.

`motion01(rpm)` maps cadence to a 0 to 1 motion value with a set idle, top and response curve. Zoom per frame is exactly that value times the maximum. The road's grade changes speed by a factor from 0.6 to 1.35 after the mapping, so the curve stays truthful. Motion runs on a fixed 1/120 s step, so a replay lands in the same place at any frame rate. Distance counts driven speed only, never the slow drift shown at rest.

Cadence comes from a Bluetooth CSC or FTMS sensor, the hold-to-pedal button at 88 rpm, or a steady setting, in that order. A sensor reading older than 3 seconds counts as stopped. Each full crank revolution sends one ring of light down the road, and the road's dashes are spaced one per revolution. The ridge on the horizon is stated value noise that drifts past as you ride. It is not a measurement.

## What is stored

In Nebula, a session file holds hit times, velocities, pedal moves and 30 Hz spectrum levels. In Endless Cockpit, it holds cadence and scene and route changes. Neither holds audio. Video capture runs only if you tick it, and saves to your own computer. Settings, such as Nebula's device choice and pad map, stay in the browser's local storage.

## Safety

A limiter in the final pass holds each region of the finished picture, on a grid 128 cells wide, to a change of 0.36 in relative luminance per second, in either direction, whatever caused it. A 10% swing therefore takes more than a quarter of a second, which keeps a large area under three flashes a second by construction. Small sparks barely move a region's mean, so they stay instant. The limit tightens to 0.16 under the system's reduced-motion setting, which also removes the crash flash and reduces the camera's shake, surge and rotation.

Nebula's gas follows slow averages of the bands instead of each hit, and older sound blurs as it winds outward, so bright bands dissolve rather than sweeping across a fixed spot at the hit rate. Endless Cockpit's far range is slow procedural noise rather than live sound, and its rings of light fade before they reach the horizon, where they would stack.

`tests/flash_check.py` measures the result on the rendered page with the WCAG 2.2 general flash definition. See [Validation](VALIDATION.md).
