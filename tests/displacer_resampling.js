/* Known-tone checks: a high-rate file beside a built-in sound must not alias into the blend. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/displacer-engine.js'), 'utf8'), context);
const E = context.window.DisplacerEngine.createEngine({});
const tone = (f, sr) => Float32Array.from({length: sr}, (_, i) => Math.sin(2 * Math.PI * f * i / sr));
const rms = (x, skip = 300) => Math.sqrt(x.slice(skip, -skip).reduce((s, v) => s + v * v, 0) / (x.length - 2 * skip));
for (const [from, to, high] of [[44100, 22050, 16000], [48000, 22050, 16000], [96000, 44100, 35000]]) {
  const low = E.resampleAudio(tone(1000, from), from, to);
  const alias = E.resampleAudio(tone(high, from), from, to);
  const expected = tone(1000, to);
  const error = Float32Array.from(low, (v, i) => v - expected[i]);
  assert.equal(low.length, to);
  assert.ok(rms(error) < 0.001, `1 kHz waveform error: ${rms(error)}`);
  assert.ok(rms(alias) < 0.0001, `high-frequency alias: ${rms(alias)}`);
  console.log(`PASS ${from}→${to}: passband error ${rms(error).toExponential(2)}, rejected tone ${rms(alias).toExponential(2)}`);
}
const dc = E.resampleAudio(new Float32Array(4000).fill(0.25), 48000, 22050);
assert.ok(dc.every(v => Math.abs(v - 0.25) < 1e-6));
const original = tone(440, 22050), copy = E.resampleAudio(original, 22050, 22050);
assert.notEqual(copy, original);
assert.ok(copy.every((v, i) => v === original[i]));
const state = {srcA: {data: tone(16000, 44100), rate:44100}, srcB: {data: tone(440, 22050), rate:22050}};
context.window.DisplacerEngine.createEngine(state).prepAudio();
assert.equal(state.audRate, 22050);
assert.ok(rms(state.audA) < 0.0001);
assert.equal(state.audA.length, state.audB.length);
console.log('PASS DC, identity copy, and mixed-rate source preparation');
