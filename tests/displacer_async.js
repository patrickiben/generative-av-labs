/* Real async handlers with controlled decode/worker completion order. No GPU or codec dependency. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('src/displacer.js', 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const functions = section('  async function loadFile(', '  /* thumbnails:') +
  section('  function loadBuiltIn()', '  let distCache') +
  section('  async function saveSweep()', '  async function savePoster()') +
  section('  async function gpTarget()', '  function drawGP(');
const S = { built: { A: true }, audA: new Float32Array([1]), audB: new Float32Array([2]), audRate: 44100, gp: { source: 'blend' } };
let queued, downloads = [], updates = [], tag = 'original_t50';
const c = { S, Blob, sourceRequests: { A: 0, B: 0 }, NOFX: {},
  work: msg => new Promise(resolve => { queued = { msg, resolve }; }),
  decodeSound: f => f.promise, isSoundFile: () => true, isImageFile: () => false,
  setAudio: (slot, data, name) => updates.push({ slot, data, name }), synthVoice: () => 1, synthBells: () => 2,
  busy: () => {}, shell: { toast: () => {} }, tag: () => tag,
  E: { encodeWav: (data, rate) => { assert.equal(rate, 44100); return new Uint8Array([1, 2]); } },
  download: (blob, name) => downloads.push({ blob, name }) };
vm.createContext(c); vm.runInContext(functions, c);
(async () => {
  const sweep = c.saveSweep(); assert.equal(queued.msg.rate, 44100);
  S.audRate = 22050; tag = 'new-sound_t80'; queued.resolve({ data: new Float32Array([0.1]) }); await sweep;
  assert.equal(downloads[0].name, 'original_sweep_A_to_B.wav');
  console.log('PASS sweep keeps its requested sample rate and filename during source replacement');
  S.audRate = 44100; const target = c.gpTarget(); S.audRate = 22050;
  queued.resolve({ data: new Float32Array([0.2]) }); assert.equal((await target).rate, 44100);
  console.log('PASS Genopatch target keeps worker sample rate');
  let first, second;
  const a = c.loadFile({ name: 'first.wav', promise: new Promise(r => first = r) }, 'A');
  const b = c.loadFile({ name: 'second.wav', promise: new Promise(r => second = r) }, 'A');
  second(2); await b; first(1); await a;
  assert.deepEqual(updates.map(u => u.name), ['second.wav']);
  console.log('PASS slow earlier decode cannot replace newer source choice');
  const pending = c.loadFile({ name: 'pending.wav', promise: new Promise(r => first = r) }, 'B');
  c.loadBuiltIn(); first(3); await pending;
  assert.equal(updates.at(-1).name, 'Glass bells');
  console.log('PASS restoring built-ins cancels pending file replacement');
  updates = [];
  const left = c.loadFile({ name: 'left.wav', promise: new Promise(r => first = r) }, 'A');
  const right = c.loadFile({ name: 'right.wav', promise: new Promise(r => second = r) }, 'B');
  second(2); first(1); await Promise.all([left, right]);
  assert.equal(updates.length, 2);
  console.log('PASS independent source slots both complete');
  const projSrc = section('  function encodePcm16(', '  if ($(\'save-project\'))');
  const pCtx = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    Int16Array, Uint8Array, Float32Array, Float64Array, JSON, Math, Object, Array, String, Error,
    S: {
      view: 'space', t: 0.72, method: 'mp', phasemode: 'pv', xlaw: 'lin', mpMix: 0.4, scope: false,
      names: { A: 'Bowed cello', B: 'Rain & chimes' }, built: { A: true, B: false },
      srcA: { data: new Float32Array([0.25, -0.5, 0.75]), rate: 22050 },
      srcB: { data: new Float32Array([-0.25, 0.5, -0.75]), rate: 22050 },
      fx: { sat: { on: true, drive: 0.6, type: 'tape', mix: 0.7 }, trans: { on: false, attack: 0, sustain: 0 }, gran: { on: false, density: 18, size: 80, pitch: 0, spray: 0.3, reverse: 0, mix: 0.7 } },
      space: { cloud: 'ab', depth: 0.85, size: 1.2, sway: false, yaw: 0.5, pitch: -0.2, dist: 3.1 },
      gp: { source: 'A', effort: 'deep', keys: true, best: new Float64Array(16).fill(0.42), bestLoss: 0.12 },
    },
    sourceRequests: { A: 0, B: 0 }, FXK: [],
    stopSweep: () => {}, setView: v => { pCtx.S.view = v; }, syncMethod: () => {}, setT: v => { pCtx.S.t = v; },
    sourcesChanged: () => {}, fxChanged: () => {}, syncCloud: () => {}, drawGP: () => {},
    gpTarget: async () => null,
    $: () => ({ value: '', checked: false, textContent: '', setAttribute: () => {} }),
    document: { querySelectorAll: () => [] },
    shell: { syncRange: () => {} },
    E: { prepAudio: () => {}, specDescriptor: () => new Float32Array(32), candSpec: () => new Float32Array(32), specCorr: () => 0.9 },
  };
  vm.createContext(pCtx); vm.runInContext(projSrc, pCtx);
  const saved = JSON.parse(JSON.stringify(pCtx.serializeProject()));
  pCtx.S.t = 0.1; pCtx.S.method = 'xfade'; pCtx.S.names.A = 'Other'; pCtx.S.srcA = null; pCtx.S.gp.best = null;
  await pCtx.applyProject(saved);
  assert.equal(pCtx.S.method, 'mp');
  assert.equal(pCtx.S.t, 0.72);
  assert.equal(pCtx.S.names.A, 'Bowed cello');
  assert.equal(pCtx.S.srcA.data.length, 3);
  assert.ok(Math.abs(pCtx.S.srcA.data[0] - 0.25) < 1e-4);
  assert.ok(Math.abs(pCtx.S.gp.best[0] - 0.42) < 1e-6);
  console.log('PASS editable Displacer project (.displacer.json) round-trips sources, blend state, effects, space and Genopatch');
  console.log('6/6 async and project integrity checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
