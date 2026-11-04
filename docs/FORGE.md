# Detail Forge Analog: guarded audio detail

Forge applies the organizing idea of image Detail Forge to sound: keep the original as a structure anchor, synthesize a separate layer of fine detail, and restrict that layer to a higher-frequency band. The previous Floor, Exciter, Transient and SBR processors remain under **Compare effects**. Forge is the default workflow.

This is **procedural synthesis**, entirely in a browser worker. It is not neural super-resolution and cannot recover the original missing recording. No model, service, download or upload is involved. The source rate and duration stay unchanged. There is no upsampling: when the sample rate or chosen ceiling leaves no room above the guard, the result is the original sound.

## Signal path

1. Estimate a bandwidth edge from channel-averaged Welch power, or use the listener's chosen guard frequency. The estimate is a heuristic, not knowledge of a recording's original bandwidth. For long recordings, 64 windows span the entire duration so a silent introduction does not determine the estimate.
2. Analyze 2,048-sample Hann tiles with 75% overlap. Resolved spectral peaks supply phase-linked odd harmonic continuations. Spectral flatness, local high-band activity and attacks determine how much diffuse texture to synthesize. The seed controls that texture; the source controls its envelope and phase. Identical stereo channels remain identical, and opposite-polarity channels remain opposite.
3. Overlap-add only the new layer, then apply a 513-tap linear-phase high-pass guard using FFT convolution. The guard has a finite transition above the requested cutoff; it is not an ideal brick-wall guarantee. Its actual low-band leakage is measured and shown.
4. Add the residual to the original samples. If peaks would exceed available headroom, reduce **only the entire new layer**, equally across channels. Do not normalize, limit or turn down the source. A source with no headroom can suppress the layer entirely; the Forge sheet explains that outcome. Amount zero is an exact no-op.
5. For a selected time range, apply 50 ms cosine fades to the residual at its ends. Samples outside the range remain identical to the source.

**Amount**, **guard**, **ceiling**, and **seed** expose the main decisions. **A** is the source, **B** the result, and **Δ / Hear added layer** auditions the raw result minus source at its actual level. Loudness matching applies only to B, not Δ. This makes it possible to hear whether the addition is useful texture or unwanted hiss. The synthetic demo is limited to 6 kHz so its added band is easier to audition.

## Readouts and limits

- *Invented layer*: residual energy divided by output energy. This is not a fraction of audio recovered and is not a perceptual quality score.
- *Guard leakage*: residual Welch energy below the guard, relative to source energy in that band. More negative is less intrusion. The finite window and filter affect this measurement.
- *Detail headroom*: how much of the candidate residual was retained to protect output peaks.
- *Original band*: log-spectral distance. Low drift establishes fidelity in that band; it cannot establish naturalness of the invented band.
- *Added band*: spectral flatness described as tonal, mixed, or noise-like. None of those labels proves quality.

Spectrograms use channel energy rather than a stereo downmix so opposite-polarity stereo does not disappear. Forge's loudness estimate also averages channel energy. The inherited K-weighting coefficients are those for 48 kHz at every source rate, so matching at other rates is approximate. The browser WAV export stays 24-bit at the source rate. Exported JSON includes the seed, settings, cutoff provenance, algorithm version, headroom gain and measured leakage.

The harmonic/noise model can sound artificial on unusual timbres, sparse pure tones or already-bright masters. A scalar cutoff does not locate holes within an otherwise wide spectrum. There is no claim to preserve stereo perception perfectly beyond the tested channel symmetries, and no listening study establishes perceptual improvement. Use the difference audition, A/B and amount control to judge a particular source.

## Reproducible checks

Run from the repository root:

```sh
python3 build.py
node tests/analog_forge.js
python3 tests/analog_numbers.py
python3 tests/analog_states.py /tmp/analog-browser-check
```

- `analog_forge.js`: 9 integrity checks covering real high-band addition, low-band leakage, exact zero amount, silence, deterministic/changing seeds, stereo identity/polarity and visible stereo spectra, selected-range boundaries, no-room bypass, headroom and a long silent introduction. Its band-limited fixture measured approximately −101 dB low-band leakage with 0.50% residual energy at amount 80%.
- `analog_numbers.py`: all 230 legacy parity checks pass; the legacy SBR random seed and four comparison processors retain their prior behavior.
- `analog_states.py`: 56 browser checks include source decoding, exports, range selection, keyboard playback, raw Δ gains, seed repeatability, chosen-cutoff labeling and the amount-zero bypass. Chrome desktop/390 px phone, Playwright WebKit and Firefox are covered. Those automation checks verify state and signal integrity, not subjective sound quality.
