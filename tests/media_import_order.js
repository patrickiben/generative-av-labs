#!/usr/bin/env node
'use strict';
// Execute the real file-input handlers, controlling decode/worker completion order without GPU or codecs.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
function section(file, start, end) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing handler section in ${file}`); return source.slice(a, b);
}
function dom() {
  const nodes = {};
  return id => nodes[id] ||= { textContent: '', value: '', listeners: {}, addEventListener(e, f) { this.listeners[e] = f; }, click() { return this.listeners.click?.(); } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const event = f => ({ target: { files: [f], value: 'selected' } });
const buffer = v => ({ sampleRate: 44100, length: 64, numberOfChannels: 1, getChannelData: () => new Float32Array(64).fill(v) });
const file = (name, d) => ({ name, arrayBuffer: () => d.promise });
let passed = 0;
const pass = name => { console.log('PASS ' + name); passed++; };
(async () => {
  const $ = dom(), F = {}, images = [], revoked = [];
  let worker = m => Promise.resolve({ result: { atoms: [m.data[0]], dur: .5 } });
  const n = { $, F, Float32Array, Image: class { constructor() { images.push(this); } },
    URL: { createObjectURL: f => f.name, revokeObjectURL: u => revoked.push(u) },
    window: { OfflineAudioContext: class { decodeAudioData(b) { return Promise.resolve(b); } } },
    workerCall: m => worker(m), liftMatch: () => { $('form-status').textContent = `Matched ${F.soundName || F.pictureName}`; },
    historyAtoms: () => ({ atoms: new Array(24).fill({}), dur: 12 }) };
  vm.createContext(n); vm.runInContext(section('nebula.js', '  const formRequests', '  function synthAtoms'), n);
  const sound = f => $('form-sound-file').listeners.change(event(f)), picture = f => $('form-image-file').listeners.change(event(f));
  let a = deferred(), b = deferred();
  let first = sound(file('old.wav', a)), second = sound(file('new.wav', b));
  b.resolve(buffer(.5)); await second; a.resolve(buffer(.2)); await first;
  assert.equal(F.soundName, 'new.wav'); pass('Nebula: latest sound wins when decoding completes out of order');
  a = deferred(); first = sound(file('bad.wav', a)); b = deferred(); second = sound(file('good.wav', b));
  b.resolve(buffer(.5)); await second; const status = $('form-status').textContent; a.reject(Error('old failure')); await first;
  assert.equal($('form-status').textContent, status); pass('Nebula: stale decode failure cannot replace the current status');
  const jobs = []; worker = () => { const d = deferred(); jobs.push(d); return d.promise; };
  first = sound(file('old-atoms.wav', { promise: Promise.resolve(buffer(.2)) })); await flush();
  second = sound(file('new-atoms.wav', { promise: Promise.resolve(buffer(.5)) })); await flush();
  jobs[1].resolve({ result: { atoms: [2], dur: .5 } }); await second;
  jobs[0].resolve({ result: { atoms: [1], dur: .5 } }); await first;
  assert.equal(F.soundName, 'new-atoms.wav'); assert.equal(F.sound.atoms[0], 2); pass('Nebula: stale atom extraction cannot replace a newer sound');
  a = deferred(); first = sound(file('pending.wav', a)); $('form-capture').click(); a.resolve(buffer(.5)); await first;
  assert.equal(F.soundName, 'your last 12 seconds'); pass('Nebula: live capture invalidates a pending file import');
  picture({ name: 'old.png' }); picture({ name: 'new.png' }); images[1].onload(); images[0].onload();
  assert.equal(F.pictureName, 'new.png'); assert.deepEqual(revoked, ['new.png', 'old.png']);
  pass('Nebula: latest picture wins and both object URLs are released');
  picture({ name: 'bad.png' }); picture({ name: 'good.png' }); images[3].onload(); const pictureStatus = $('form-status').textContent; images[2].onerror();
  assert.equal(F.pictureName, 'good.png'); assert.equal($('form-status').textContent, pictureStatus); assert(revoked.includes('bad.png'));
  pass('Nebula: failed stale picture cannot overwrite status or leak its object URL');

  const $e = dom(), Cast = {}, fields = [], atomJobs = [];
  let autoAtoms = true, casts = 0;
  const e = { $: $e, Cast, Float32Array, document: { querySelector: () => ({}) },
    decodeFile: f => f.promise,
    cast: { atoms: () => { if (autoAtoms) return Promise.resolve({ atoms: [1], dur: .5 }); const d = deferred(); atomJobs.push(d); return d.promise; } },
    setField: (...args) => { fields.push(args); $e('snd-status').textContent = args[3]; },
    updateSource() {}, shell: { toast() {} }, castNow: () => casts++, openAny() {}, rebuildVoices() {},
    builtInSound: () => ({ atoms: [99], dur: 8, rate: 44100 }) };
  vm.createContext(e); vm.runInContext(section('enter.js', '  let soundSeq', '  /* ---------- the picture world'), e);
  const decoded = { mono: new Float32Array(64).fill(.5), rate: 44100 };
  a = deferred(); b = deferred(); first = e.useSoundFile({ name: 'old.wav', promise: a.promise }, true); second = e.useSoundFile({ name: 'new.wav', promise: b.promise }, false);
  b.resolve(decoded); await second; a.resolve(decoded); await first;
  assert.equal(Cast.file.name, 'new.wav'); assert.equal(casts, 0); pass('Enter: latest sound wins and stale import cannot trigger a sculpture cast');
  autoAtoms = false;
  first = e.useSoundFile({ name: 'old-atoms.wav', promise: Promise.resolve(decoded) }, false); await flush();
  second = e.useSoundFile({ name: 'new-atoms.wav', promise: Promise.resolve(decoded) }, false); await flush();
  atomJobs[1].resolve({ atoms: [2], dur: 1 }); await second; atomJobs[0].resolve({ atoms: [1], dur: 1 }); await first;
  assert.equal(Cast.file.name, 'new-atoms.wav'); assert.equal(Cast.file.atoms[0], 2); pass('Enter: latest sound also wins after atom extraction');
  a = deferred(); first = e.useSoundFile({ name: 'pending.wav', promise: a.promise }, true); $e('snd-builtin').click(); a.resolve(decoded); await first;
  assert(fields.at(-1)[3].startsWith('Built-in sound')); assert.equal(casts, 0); pass('Enter: built-in sound selection cancels a pending import');
  a = deferred(); first = e.useSoundFile({ name: 'bad.wav', promise: a.promise }, false); $e('snd-builtin').click(); const kept = $e('snd-status').textContent; a.reject(Error('late failure')); await first;
  assert.equal($e('snd-status').textContent, kept); pass('Enter: stale failure cannot overwrite the built-in sound status');
  console.log(`${passed}/${passed} media import ordering checks passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
