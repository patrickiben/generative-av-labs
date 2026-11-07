#!/usr/bin/env node
'use strict';
// Integrity tests for the audio analogue of Detail Forge. These do not claim perceptual recovery.
const assert = require('node:assert/strict');
const D = require('../src/analog-dsp.js');
const sr = 48000, n = 65536;
let rng = 17;
const rand = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const x = Float32Array.from({ length: n }, (_, i) => .13 * Math.sin(2 * Math.PI * 1500 * i / sr) + .08 * Math.sin(2 * Math.PI * 3000 * i / sr) + .08 * rand());
const re = new Float64Array(n / 2 + 1), im = new Float64Array(re.length);
D.rfft(x, re, im);
for (let k = Math.ceil(4000 * n / sr); k < re.length; k++) re[k] = im[k] = 0;
D.irfft(re, im, x);
const p = { mode: 'forge', cutoff_hz: 4200, target_hz: 19000, amount: .8, seed: 17 };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const maxDiff = (a, b) => a.reduce((v, z, i) => Math.max(v, Math.abs(z - b[i])), 0);
let count = 0;
function check(name, fn) { fn(); console.log('PASS ' + name); count++; }
const r = D.run([x], sr, p);
check('real new high-band content with a quiet protected low band', () => {
  assert(r.info.added_energy_percent > .01);
  assert(r.metrics.hb_after - r.metrics.hb_before > 20);
  assert(r.info.guard_error_db < -70, `guard leakage ${r.info.guard_error_db}`);
  assert(r.metrics.lsd < .1, `LSD ${r.metrics.lsd}`);
});
check('zero amount is sample-identical, including selected seams', () => {
  assert(same(D.run([x], sr, { ...p, amount: 0 }).out[0], x));
  assert(same(D.run([x], sr, { ...p, amount: 0, sel: [.2, 1] }).out[0], x));
});
check('silence stays exactly silent', () => assert(D.run([new Float32Array(n)], sr, p).out[0].every(v => v === 0)));
check('same seed repeats, a new texture seed changes only the added layer', () => {
  assert(same(r.out[0], D.run([x], sr, p).out[0]));
  const another = D.run([x], sr, { ...p, seed: 18 });
  assert(maxDiff(r.out[0], another.out[0]) > 1e-5);
  assert(another.info.guard_error_db < -70);
});
check('identical stereo stays identical and antiphase stereo does not vanish', () => {
  const stereo = D.run([x, x], sr, p); assert(same(stereo.out[0], stereo.out[1]));
  const anti = D.run([x, x.map(v => -v)], sr, p);
  assert(maxDiff(anti.out[0], anti.out[1].map(v => -v)) < 1e-7);
  assert(anti.info.added_energy_percent > .01);
  assert(Number.isFinite(anti.metrics.gain) && anti.metrics.gain > .9);
  const image = D.spectrogram([x, x.map(v => -v)], sr, 1024, 100, true);
  assert(image.S.some(v => v > .5), 'antiphase display must remain visible');
  assert(D.linkedK([x, x.map(v => -v)]) > .001, 'antiphase level must remain audible');
});
check('only the selected time range changes; seams return to original samples', () => {
  const range = D.run([x], sr, { ...p, sel: [.2, 1] });
  assert(same(range.out[0].subarray(0, 9600), x.subarray(0, 9600)));
  assert(same(range.out[0].subarray(48000), x.subarray(48000)));
  assert.equal(range.out[0][9600], x[9600]); assert.equal(range.out[0][47999], x[47999]);
  assert(range.info.guard_error_db < -65);
});
check('insufficient bandwidth is an exact no-op', () => {
  const noRoom = D.run([x], sr, { ...p, cutoff_hz: 20000, target_hz: 18000 });
  assert(same(noRoom.out[0], x)); assert.match(noRoom.info.reason, /no room/);
});
check('headroom changes the new layer only and never clips a clean source', () => {
  let peak = x.reduce((m,v) => Math.max(m,Math.abs(v)),0);
  const loud = x.map(v => v * .999 / peak), result = D.run([loud], sr, p);
  assert(result.out[0].every(v => Number.isFinite(v) && Math.abs(v) <= 1));
  assert(result.info.headroom_gain <= 1);
  assert(result.info.guard_error_db < -65);
});
check('long recordings are probed beyond a silent opening', () => {
  const long = new Float32Array(sr * 8); long.set(x, sr * 6);
  const cutoff = D.cutoffFromWelch(D.energyWelch([long], sr), sr);
  assert(cutoff > 3900 && cutoff < 4400, `cutoff ${cutoff}`);
});
check('all four Forge synthesis characters preserve low-band guard and antiphase stereo', () => {
  const chars = ['balanced', 'harmonic', 'air', 'crystalline'];
  const outs = chars.map((character) => {
    const res = D.run([x], sr, { ...p, character });
    assert.equal(res.info.character, character);
    assert(res.info.guard_error_db < -70, `${character} guard leakage ${res.info.guard_error_db}`);
    assert(res.info.added_energy_percent > 0.01);
    const anti = D.run([x, x.map((v) => -v)], sr, { ...p, character });
    assert(maxDiff(anti.out[0], anti.out[1].map((v) => -v)) < 1e-7);
    return res.out[0];
  });
  for (let i = 1; i < outs.length; i++) assert(maxDiff(outs[0], outs[i]) > 1e-4, `character ${chars[i]} must differ from balanced`);
});
console.log(`${count} Forge integrity checks passed; example guard error ${r.info.guard_error_db.toFixed(1)} dB, added energy ${r.info.added_energy_percent.toFixed(3)}%.`);
