# Inputs

What each page listens to, and which browsers can provide it. Checked on 2026-11-02 and 2026-11-03.

| Page | Listens to |
|---|---|
| Nebula | An electronic drum kit's audio and MIDI |
| Endless Cockpit | Your cadence: a Bluetooth cadence sensor or smart trainer, the pedal button or Space, or a steady setting |
| Enter | Pictures and sounds you open |
| Chimera Synth | See its own page |

## A drum kit for Nebula

- **Audio:** the module's main outputs to two line inputs on your audio interface. If an input shares a front instrument jack, leave the jack empty, because on many interfaces a plug there takes over the input.
- **MIDI:** many audio interfaces have no MIDI ports, and a module's USB port is not always MIDI. If so, run a 5-pin cable from the module's MIDI OUT into a USB-MIDI interface. The browser lists the interface's name, not the module's.
- **Note map:** modules let you change each pad's note, so the starting map is only a starting point. **Learn** in the Connect sheet replaces any of it.

The capture request turns off echo cancellation, noise suppression and automatic gain, because each of those would flatten a drum's attack. How a browser maps an interface with many inputs onto its stereo capture varies, and was not found in any source. The level meter in the Connect sheet settles it: it should move on the first hit.

## Cadence for Endless Cockpit

Endless Cockpit reads the standard Bluetooth Cycling Speed and Cadence profile, or a smart trainer's Fitness Machine indoor bike data, through Web Bluetooth. It needs no other software.

## Browsers

| Browser | Audio capture | Web MIDI | Web Bluetooth | Source |
|---|---|---|---|---|
| Chrome 43+ | Yes | Yes, behind a permission prompt since Chrome 124 | Yes, on a computer | [caniuse](https://caniuse.com/midi), [Chrome blog](https://developer.chrome.com/blog/web-midi-permission-prompt) |
| Edge 79+ | Yes | Yes | Yes | [caniuse](https://caniuse.com/midi) |
| Firefox 108+ | Yes | Only with a site permission add-on | No | [caniuse](https://caniuse.com/midi), [Mozilla bug 1795025](https://bugzilla.mozilla.org/show_bug.cgi?id=1795025) |
| Safari | Yes | No, on macOS or iOS through 27.x | No | [caniuse](https://caniuse.com/midi) |

Capture and Web MIDI need a secure context ([MDN, Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API), [MDN, getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)). GitHub Pages is HTTPS, and MDN counts `file://` and `localhost` as secure for capture.

Only Chrome 156 on macOS has actually been run. The other rows come from the sources above.
