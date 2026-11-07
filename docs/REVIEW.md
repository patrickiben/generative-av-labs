# Application review — 2026-11-04

This pass covers Nebula, Enter, Chimera Synth, Detail Forge Analog and Displacer, following the Forge and Displacer redesign. It concentrates on source loading, saved work, asynchronous rendering, recording and replay. It is a code/browser review, not a subjective listening study or a physical-device test.

## Repairs

| App | Problem | Result |
| --- | --- | --- |
| Chimera | Saved patches omitted the Garden genome; reloading could open a different voice or mode. | Version 3 patches carry the active 20-gene voice and Garden controls. Older Morph files and links remain readable. |
| Chimera | Unicode share names could break base64 encoding; sample labels could become markup. | Links encode UTF-8, labels display literally, and sample-dependent patches explain that raw audio must be reloaded. |
| Enter | Concurrent depth requests could receive each other's replies or replace a newly chosen picture. | Requests have individual IDs, inference runs in sequence, and only the current picture can be installed. Restoring the painted scene cancels the pending choice. |
| Enter | Imported names were interpolated as HTML. | Picture, sound and cast labels display literal filenames. |
| Nebula / Enter | Slow earlier media imports could replace a more recent file, live capture or built-in source. | Request ordering now extends through decode and atom extraction, and stale failures cannot replace current status. |
| Nebula | Stopping video recording accessed a cleared recorder; adjacent takes shared chunks. | Each take retains its recorder, chunks and owned capture tracks. Stopping one take leaves the audio source and next take intact. Encoder failure still allows the session JSON to be saved. |
| Nebula | Malformed sessions reached the animation loop; live/idle analysis could change the recorded spectrum. | Import validation happens before replacing the current input. Replay uses its stored spectrum without running the live analyser over it. |
| Displacer | Changing sources while a sweep or blended Genopatch target rendered could attach the new sample rate to old samples. | Each job keeps the rate it started with; sweep filenames also describe the requested export. |
| Displacer | A slow earlier file decode could replace the latest source choice. | Per-source request ordering preserves the latest choice, including restoring the built-ins. |

Detail Forge Analog's existing source-preservation, residual-only audition and guarded-synthesis checks remain part of validation. This pass did not identify a further confirmed Forge defect.

## Completed expansions & QC refinements (2026-11-07)

1. **Editable Displacer projects (`.displacer.json`).** Saves both source sounds (embedded as 16-bit PCM), blend/effect settings, 3D cloud view, and any grown Genopatch voice together, then reopens the exact working state. Also added 3 built-in sound pairs (`Sung ah × Glass bells`, `Bowed cello × Rain & chimes`, `Throat drone × FM crystal harp`).
2. **Cancellable fitting, casting, and analysis.** Added visible Cancel/Stop controls across Enter's 3D print casting (`#cast-cancel`), Chimera Synth's Genopatch search (`#gp-cancel`), Detail Forge Analog's worker processing (`#proc-cancel`), and Displacer's Genopatch search (`#gp-cancel`).
3. **Portable Chimera sample bundles (`.bundle.json`).** Added `#patch-save-bundle` (`serializeBundle()`) to embed mono PCM16 raw oscillator audio directly inside `.bundle.json` files while keeping plain `.patch.json` files and share links compact. Added built-in synthetic test samples (`Throat drone`, `Bell strike`, `Vowel choir`).
4. **Live Nebula Form audition & WAV export.** Refreshes the playing Form cloud buffer smoothly when the morph slider moves, exposes `#form-update` (`Update audition`) and `#form-wav` (`Save audio (.wav)`), adds built-in picture and sound presets, adds a 3rd 3D topology (`Vortex`), and introduces **Biofeedback Nebula** (`biofeedback-nebula.html`) uniting Nebula's 3D particle/fluid/OT engine with Body Signal Labs' heart-rate and Muse S EEG controls.
5. **Multi-material listening evaluation in Detail Forge Analog.** Added 5 band-limited synthetic evaluation materials (`Plucks`, `Vocal`, `Drums`, `Cymbals`, `Brass pad`) accessible in both the Source and Listen sheets, with material-specific listening notes alongside level-matched A/B and residual-only (`Hear added layer`) audition, plus `.analog.json` settings preset save/load.
6. **Enter per-quad relief tearing & PLY export.** Fixed per-vertex relief tearing in `RELIEF_VS` by evaluating `tearMetric` per quad and collapsing torn quads cleanly without diagonal stray triangles, added selectable built-in painted scenes and harmonic sound worlds, and added colored binary `.ply` point-cloud sculpture export alongside watertight `.stl`.

Measured checks and remaining hardware limitations are in [VALIDATION.md](VALIDATION.md).
