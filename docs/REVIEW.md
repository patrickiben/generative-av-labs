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

## Next improvements worth doing

1. **Editable Displacer projects.** Save both source sounds, blend/effect settings and the cloud view together, then reopen the exact working state. Current WAV/image/point exports capture results, not a resumable project.
2. **Cancellable fitting and analysis.** Give longer Genopatch/model jobs a visible Cancel control and a clear relationship to the current source or seed. Request ordering prevents stale results; cancellation would also avoid wasting compute and make experimentation easier.
3. **Portable Chimera sample patches.** Offer an optional bundle that includes raw oscillator samples. Plain patches and links should stay small and continue to disclose external sample dependencies.
4. **Live Nebula Form audition.** The current sound audition is a snapshot of the cloud/morph when playback starts. Refresh it as the visible blend moves, or expose an explicit Update audition action so sight and sound stay easy to compare.
5. **A listening evaluation of Forge.** Compare level-matched originals/results on speech, percussion, cymbals and sustained tones, including the added layer alone. Numerical integrity establishes preservation and bounds; it does not establish that invented texture improves every recording.

Measured checks and remaining hardware limitations are in [VALIDATION.md](VALIDATION.md). Changes are in the draft pull request; this review does not imply deployment.
