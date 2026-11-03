#!/usr/bin/env node
/* Runs src/analog-dsp.js, the page's processing, on the jobs tests/analog_numbers.py writes, and writes the results back.
   usage: node tests/analog_run.js <job.json>      Audio travels as raw little-endian float32, one file per channel. */
'use strict';
const fs = require('fs');
const path = require('path');
const DSP = require(path.join(__dirname, '..', 'src', 'analog-dsp.js'));

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dir = path.dirname(process.argv[2]);
const readF32 = (f) => { const b = fs.readFileSync(path.join(dir, f)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const readF64 = (f) => { const b = fs.readFileSync(path.join(dir, f)); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const writeF32 = (f, a) => fs.writeFileSync(path.join(dir, f), Buffer.from(a.buffer, a.byteOffset, a.byteLength));

const inputs = {};
for (const inp of job.inputs) inputs[inp.name] = { sr: inp.sr, ch: inp.files.map(readF32) };
const results = {};
for (const r of job.runs) {
  const { sr, ch } = inputs[r.input];
  const prm = { ...r.params };
  if (r.phases) prm.phases = r.phases.map(readF64);
  const t = process.hrtime.bigint();
  const res = DSP.run(ch, sr, prm);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  res.out.forEach((c, i) => writeF32(`js_${r.id}_${i}.f32`, c));
  const m = res.metrics;
  results[r.id] = {
    fc: res.fc, ms, selective: res.selective,
    bw_before: m.bw_before, bw_after: m.bw_after, hb_before: m.hb_before, hb_after: m.hb_after,
    lsd: m.lsd, flatness: m.nr.flatness, verdict: m.nr.verdict, ok: m.nr.ok, gain: m.gain,
  };
  if (r.spectrogram) {
    const sb = DSP.spectrogram(ch, sr), sa = DSP.spectrogram(res.out, sr);
    writeF32(`js_${r.id}_specb.f32`, sb.S); writeF32(`js_${r.id}_speca.f32`, sa.S);
    results[r.id].spec = [sb.bins, sb.frames];
  }
}
for (const e of job.wav || []) {
  const { sr, ch } = inputs[e.input];
  fs.writeFileSync(path.join(dir, e.file), Buffer.from(DSP.encodeWav24(ch, sr)));
}
fs.writeFileSync(path.join(dir, 'js_results.json'), JSON.stringify(results));
