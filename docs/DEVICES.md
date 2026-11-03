# Devices

The route was checked on 2026-11-02 against makers' documents and on one real Mac. A real Mimic Pro has not yet been played through these pages.

## Universal Audio Apollo Solo

- UA's [product page](https://www.uaudio.com/products/apollo-solo) calls it a "Desktop 2 x 4 Thunderbolt 3-powered audio interface", with two Unison preamps and a front panel Hi-Z input. The word MIDI does not appear in the page's source.
- [Sound On Sound's review](https://www.soundonsound.com/reviews/universal-audio-apollo-solo) lists combi jack/XLR inputs and a separate instrument socket on the first input, and mentions no MIDI.
- Connected to the test Mac, it registered no MIDI port.
- UA's own Apollo Solo manual could not be fetched. UA's [Apollo Twin X Gen 2 manual](https://media.uaudio.com/support/manuals/hardware/gen2/Apollo+Twin+X+Gen+2+Hardware+Manual+260619.pdf), a sibling model, says the rear combo inputs switch between MIC (XLR) and LINE (1/4 inch), and that a plug in the Hi-Z jack overrides channel 1.

On macOS it appears as **Universal Audio Thunderbolt**, with ten input channels, as read from Core Audio on the test Mac:

| Channel | Name |
|---|---|
| 1 | MIC/LINE/HIZ 1 |
| 2 | MIC/LINE 2 |
| 3, 4 | MON L, MON R |
| 5, 6 | VIRTUAL 1, VIRTUAL 2 |
| 7, 8 | AUX1 L, AUX1 R |
| 9, 10 | AUX2 L, AUX2 R |

The first two are the line inputs this route uses. How Chrome maps a ten-input device onto its stereo capture was not found in any source and has not been measured. The level meter in the Connect sheet settles it: it should move on the first hit.

## Pearl Mimic Pro

From the [user manual, version 1.03](https://im.static-thomann.de/pics/atg/atgdata/document/manual/pearl_mimic_pro_en.pdf):

- "Line Out 1-2 carry the Main Mix."
- "MIDI IN/OUT – Use a standard five-pin MIDI cable to transfer MIDI data to and from an external MIDI source."
- USB 2.0 slot "For library and sample installation."
- The MIDI tab sets notes and channels for each pad zone, and the manual publishes no default note table.

So MIDI has to leave the module on its 5-pin MIDI OUT, through a USB-MIDI interface. The browser lists that interface's name, not the module's.

The starting map in the pages (kick 36, snare 38 and 40, cross-stick 37, brush 23, hats 42 and 22, toms 48, 45, 43 and 41, crashes 49, 57 and 52, ride 51, 53 and 59, hi-hat openness on CC4, chokes as poly aftertouch) comes from earlier owner reports, not from Pearl. Treat it as a starting point: **Learn** in the Connect sheet replaces any of it.

## Browsers

| Browser | Audio capture | Web MIDI | Source |
|---|---|---|---|
| Chrome 43+ | Yes | Yes, behind a permission prompt since Chrome 124 | [caniuse](https://caniuse.com/midi), [Chrome blog](https://developer.chrome.com/blog/web-midi-permission-prompt) |
| Edge 79+ | Yes | Yes | [caniuse](https://caniuse.com/midi) |
| Firefox 108+ | Yes | Only with a site permission add-on | [caniuse](https://caniuse.com/midi), [Mozilla bug 1795025](https://bugzilla.mozilla.org/show_bug.cgi?id=1795025) |
| Safari | Yes | No, on macOS or iOS through 27.x | [caniuse](https://caniuse.com/midi) |

Both APIs need a secure context ([MDN, Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API), [MDN, getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)). GitHub Pages is HTTPS, and MDN counts `file://` and `localhost` as secure for capture.

Only Chrome 156 on macOS has actually been run. The other rows come from the sources above.

The capture request turns off echo cancellation, noise suppression and automatic gain, because each of those would flatten a drum's attack.
