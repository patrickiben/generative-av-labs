# Validation

Checked on 2026-11-02 in Chrome 156 on an Apple M4 Max Mac. **No real drum kit has been played through these pages yet.** A person's check with the real kit is listed at the end.

## Input states

`tests/run_states.py` drives every state on both rendered pages, using the real browser path wherever one exists.

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

All 98 checks passed on the final build, 49 on each page.

The same run measures that the picture itself responds, as the mean change in real pixels over a quarter second, on a 0 to 255 scale:

| Page | At rest | Audio hits | MIDI hits |
|---|---|---|---|
| Endless Cockpit | 1.42 | 8.15 | 14.05 |
| Nebula | 1.20 | 30.69 | 55.48 |

The audio estimator, on a synthetic loop of about 8 kicks, 8 snares and 16 hats, read 9, 8 and 16 on one page and 9, 9 and 15 on the other. Tempo from that loop, whose true value is 120 BPM, read 119.98 and 120.00.

## Flicker

`tests/flash_check.py` records the rendered page's brightness on every frame and applies the WCAG 2.2 general flash definition: a flash is a pair of opposing changes of at least 10% of maximum relative luminance, with the darker image below 0.80, and the limit is three a second over no more than 25% of a 10 degree field. Each third of the screen stands in for that field. It runs the demo and a deliberately brutal case, crash, kick and snare together at full velocity on every eighth note at 140 BPM, with and without reduced motion.

**The first published build failed this badly.** Up to 88% of a region flashed more than three times a second in the demo, and the whole frame flashed up to 7 times a second under the brutal case, while the page claimed a cap that covered only the crash flash. It was live for about two hours on 2026-11-02 before the limiter described in [Methods](METHODS.md) replaced it. The check now passes and stays in this folder so that does not recur.

It is a screen, not a certificate. It does not test saturated red flashes, and it says nothing about comfort.

## Numbers with known answers

- Tempo from a known 120 BPM audio loop, and from the demo's known 108 BPM.
- Tempo known answers from hit lists, and octave folding of eighth notes.
- Note 36 kick, 38 snare, 22 hat, 48 high tom, 51 ride. Velocity zero is a release. MIDI clock is not playing.
- CC4 at 127 reads closed and at 0 reads open. Poly aftertouch cuts a crash.
- The zoom curve is 0 below idle and 1 at the top. Distance does not count the idle drift.

## The app harness

`App_Validation_Harness/web_gate.py` (`endless_cockpit`, `nebula_web`), on the local files. Gates that need a person are PARTIAL until the author signs.

| Gate | Result |
|---|---|
| A0 Purpose | PARTIAL, needs the author |
| A1 Boot in a fresh profile | RUN |
| A2 Render at 1440 and 390 | PARTIAL, screenshots looked at |
| A3 Failure and offline | RUN. The pages make no network requests after load |
| A4 Honesty | PARTIAL, needs the author's read |
| A5 Real clicks and first task | PARTIAL, needs a person |
| A6 Ship surface | NOT RUN until deployed |
| A7 Numbers | RUN |
| A8 Design floor | PARTIAL, needs the author |
| A9 Accessibility | PARTIAL. axe is clean, and the keyboard pass needs a person |
| A10 Sources | PARTIAL. Ideas only, no outside code or hosts |

Neither page is LIVE-VERIFIED or OWNER-APPROVED yet.

## What only the real kit can show

1. Chrome reads the Apollo Solo's first two inputs. The Connect sheet's level meter should move on the first hit, in both bars for a stereo kit.
2. The module's MIDI reaches the page through the USB-MIDI interface, and the last-messages box shows it.
3. Every pad lands on the right drum. Press Learn for any that do not.
4. Opening the hi-hat pedal widens the sparkle. If it works backward, tick the flip option.
5. Grabbing a cymbal cuts its wash. Whether this module sends aftertouch comes from owner reports, not from Pearl.
6. With audio alone, the estimated hits are believable on real Slate samples. The rule was tuned on synthetic drums.
7. Hits feel immediate. The page measures hit to frame, and cannot measure the interface or the screen.

## Not tested

Firefox, Edge, Safari, and any phone hardware. Phone width was checked by layout only. Bluetooth cadence was ported unchanged from the earlier version and has not been run against a real sensor here. Video capture was not exercised end to end.
