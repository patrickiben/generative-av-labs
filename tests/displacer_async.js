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
  console.log('5/5 async integrity checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
