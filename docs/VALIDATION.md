# Validation

Checked on 2026-11-02 and 2026-11-03 in Chrome 156 on an Apple M4 Max Mac. **No real drum kit or cadence sensor has been used with these pages yet.** The checks a person can do with real gear are listed under each page.

## Nebula: input states

`tests/run_states.py` drives every drum input state on the rendered page, using the real browser path wherever one exists.

| State | How it was produced |
|---|---|
| Permission denied | Real. Chrome refuses in a profile with no grant |
| Device open, no signal | Real capture path, reading a silent WAV through Chrome's fake audio device |
| Audio live | Real capture path, reading a synthetic drum loop at a known 120 BPM |
| MIDI live | Real Web MIDI from a virtual CoreMIDI port, sent by a separate process |
| MIDI unplugged | Real. The virtual port closes while the page is open |
| No MIDI port | Real, because the test Mac had none |
| Audio and MIDI together | Both of the above at once |
| Demo | A real click |
| Replay | A session recorded in the page and played back |
| Plain http page | Real, through a local host mapping |
| No audio device | **Stubbed.** Chrome's device-count flag does not remove audio inputs, so `getUserMedia` was replaced |
| Browser with no Web MIDI | **Stubbed.** Safari could not be driven here, so the API was removed in Chrome |

All 49 checks passed on the current build. The run also checks that the picture itself responds, as the mean change in real pixels over a quarter second, on a 0 to 255 scale. On 2026-11-02 that read 1.20 at rest, 30.69 under audio hits and 55.48 under MIDI hits. On the same day the audio estimator, on a synthetic loop of about 8 kicks, 8 snares and 16 hats, read 9, 9 and 15, and tempo from that loop, whose true value is 120 BPM, read 120.00.

## Endless Cockpit: cadence states

Endless Cockpit takes its speed from cadence only. `tests/endless_states.py` drives it on the rendered page.

| State | How it was produced |
|---|---|
| At rest | Real |
| Pedaling by hand | A real held Space key |
| Steady cadence | A real slider |
| Demo, and ending it | Real clicks |
| A ride recorded and replayed | Recorded in the page and played back |
| No Web Bluetooth | **Stubbed**, by removing the API |
| Chooser closed with no sensor | **Stubbed** |
| Sensor connected, sending nothing | **Stubbed** |
| Live sensor at 80 rpm | **Stubbed**, with real CSC Measurement bytes |
| Sensor disconnects | **Stubbed** |

A browser test cannot pair a real Bluetooth sensor, and a real click on Connect opens a chooser that headless Chrome cannot show, so every sensor state uses a stub of `navigator.bluetooth`. All 17 checks passed, including one that the visible page says nothing about drums, MIDI or tempo. These checks found one defect, fixed on 2026-11-03: a sensor that connected in the page's first three seconds, before sending anything, read as live at 0 rpm. The check now connects right after load, where the old code failed every time.

## Flicker

`tests/flash_check.py` records the rendered page's brightness on every frame and applies the WCAG 2.2 general flash definition: a flash is a pair of opposing changes of at least 10% of maximum relative luminance, with the darker image below 0.80, and the limit is three a second over no more than 25% of a 10 degree field. Each third of the screen stands in for that field. It runs each page's demo and a deliberately hard case, with and without reduced motion. Nebula's hard case is crash, kick and snare together at full velocity on every eighth note at 140 BPM. Endless Cockpit's is a steady 130 rpm.

**The first published build failed this badly.** Up to 88% of a region flashed more than three times a second in the demo, and the whole frame flashed up to 7 times a second under the hard case, while the page claimed a cap that covered only the crash flash. It was live for about two hours on 2026-11-02 before the limiter described in [Methods](METHODS.md) replaced it. The check now passes and stays in this folder so that does not recur.

Worst share of any region flashing more than three times a second, on the current build. The limit is 25%:

| Page | Demo | Hard case | Demo, reduced motion | Hard, reduced motion |
|---|---|---|---|---|
| Nebula | 5% | 2% | 2% | 3% |
| Endless Cockpit | 2% | 7% | 2% | 7% |

The whole frame never flashed in any of these runs. It is a screen, not a certificate. It does not test saturated red flashes, and it says nothing about comfort.

## Numbers with known answers

- Nebula: tempo from a known 120 BPM audio loop and from the demo's known 108 BPM, tempo known answers from hit lists with octave folding, note 36 kick, 38 snare, 22 hat, 48 high tom, 51 ride, velocity zero as a release, MIDI clock as not playing, CC4 at 127 closed and at 0 open, and poly aftertouch cutting a crash.
- Endless Cockpit: the zoom curve is 0 below idle and 1 at the top, the grade's effect on speed is bounded, and distance does not count the idle drift.

## The app harness

`App_Validation_Harness/web_gate.py` (`endless_cockpit`, `nebula_web`). Gates that need a person are PARTIAL until the author signs. A0, A4 and A8 need the author, A5 and A9's keyboard pass need a person, and A6 runs only on the deployed pages. Neither page is OWNER-APPROVED yet.

## What only real gear can show

Nebula, with a drum kit:
1. Chrome reads your audio interface's first two inputs. The Connect sheet's level meter should move on the first hit, in both bars for a stereo kit.
2. The module's MIDI reaches the page, and the last-messages box shows it.
3. Every pad lands on the right drum. Press Learn for any that do not.
4. Opening the hi-hat pedal widens the sparkle. If it works backward, tick the flip option.
5. Grabbing a cymbal cuts its wash. Whether a module sends aftertouch varies.
6. With audio alone, the estimated hits are believable on a real module's samples. The rule was tuned on synthetic drums.
7. Hits feel immediate. The page measures hit to frame, and cannot measure the interface or the screen.

Endless Cockpit, with a cadence sensor:
1. The sensor appears in Chrome's chooser and connects.
2. The cadence readout matches the sensor's own app.
3. Stopping the crank brings the road to rest within about three seconds.

## Not tested

Firefox, Edge, Safari, and any phone hardware. Phone width was checked by layout only. Video capture was not exercised end to end.

## Enter

Enter takes a picture or a sound, as the desktop app does. It has no drum or live input. Drum input belongs only in Nebula, and it was taken out of Enter on 2026-11-03. Checked in Chrome on an Apple M4 Max Mac. **No outside visitor has used it yet.**

`tests/run_enter.py` downloads the real model, so it is run by hand. It passed 24 of 24, locally and against the deployed page:

- With no picture chosen, the page made no outside request in any of the three worlds. No world asks for a microphone or MIDI, and no kit control is on the page.
- It asks before downloading, naming the size and both hosts, and shows byte progress to 76 of 76 MB.
- On WebGPU, with the half-precision model, a 1440 × 900 picture was estimated at 826 × 518 in about 100 to 150 ms after a 2 s start. Only GET requests went out, to huggingface.co, us.aws.cdn.hf.co and cdn.jsdelivr.net.
- Size and SHA-256 are checked against the files measured on 2026-11-02. A stored model is reused after a reload with no download, and it can be removed.
- On the painted scene, whose depth is known, the estimate correlated with the true depth at r = 0.95. That is one scene, not a measure of the model.
- With WebGPU removed from the page, which is **stubbed**, the processor path used the quantized model and estimated at 630 × 392 in about 2.6 s.
- With Hugging Face blocked, the page says the download failed and keeps the last relief. The brightness rule still works, and it is labeled as a rule.
- The cast of the built-in sound gave 242,496 faces. It is watertight by an edge check on the mesh, and every edge in the downloaded STL file is paired. The same sound gave the same shape.
- A 440 Hz test tone lifted to atoms averaging 431 Hz.

Measured while building: fp16 and fp32 depth correlate at 0.9997, and the quantized model against fp32 on the processor at 0.987.

Nothing on the page reacts to hits any more, so it adds no flashes. It still passes through the flicker limiter, and its camera drift stops under reduced motion.

`App_Validation_Harness/web_gate.py` (`enter_web`) gave A1, A3, A6 and A7 RUN, with no red, on the deployed page. A0, A2, A4, A5, A8, A9 and A10 are PARTIAL until the author signs. The open decisions under A10 are the 76 MB first download and a reading of jsDelivr's terms in a browser.

Not tested: Safari, Firefox, Edge, phone hardware, a real browser without WebGPU, a slow connection, and file:// with the model. The marching tetrahedra here are not the desktop app's marching cubes, so the two apps give different meshes for the same sound.

## Chimera Synth

Checked on 2026-11-02 in Chrome on the same Apple M4 Max Mac. **No real kit and no outside visitor has played it yet.**

`tests/chimera_states.py` passed 39 of 39, all by real clicks and keys:

- At load nothing claims to play, and no audio context exists until a click. Start sound plays the seed, and its low end is measured at about -4.5 dB with the sub reinforcing.
- The demo is labeled as the page playing itself, and ending it stops the riff and the sound it started.
- MIDI refused reads as permission denied. MIDI granted with no port reads as no device. A virtual CoreMIDI port from a separate process was picked up without a reload. Its 16 messages counted 13, because the three clock bytes are not playing. Drums landed on the stated map (kick -12, snare +2, hat edge +10), the hat pedal and a choke were read, and unplugging read as disconnected.
- Arrow keys and Enter grew a seed, and undo stepped back. In Morph, a click put the puck where it landed.
- One short sound in eight formats went through the real file input. Chrome decoded WAV, M4A, MP3, FLAC, Ogg and Opus, and said plainly that it could not open AIFF or CAF. Playwright's WebKit opened AIFF and CAF; its Firefox did not. A text file got a plain message. Growing a seed from an MP3 by differential evolution took 3.6 s.
- The WAV render, a recording, the picture and the patch file all arrived as downloads. A share link restored the patch on a fresh load and in an open tab.
- Playwright's WebKit, standing in for Safari and not Safari itself, said Safari has no Web MIDI and played sound from a click. Firefox waited on its MIDI add-on prompt, which a headless run never shows.

`tests/flash_check.py` with Chimera's own worst case passed: hard hits, the sub held near 180° so the measured cancellation shatters the creature, full chaos, and per-note bud flashes. The worst region was 6.7 % against the 25 % limit, with no whole-frame flash, in both motion settings.

`App_Validation_Harness/web_gate.py` (`chimera_web`), on the local file: A1, A3 and A7 RUN, with no red and no amber. A0, A2, A4, A5, A8, A9 and A10 are PARTIAL until the author signs. A6 is NOT RUN until it is deployed. Sixteen known answers matched, among them the genome round trip, the log-frequency morph midpoint (671 Hz between 900 and 500), the sub's octave folding, E(5,16) and the phase verdict's range.

Not tested: a real drum kit or keyboard, Safari itself, Edge, phone hardware and Bluetooth MIDI. The desktop app's own page is unchanged and is kept in `legacy/`.
