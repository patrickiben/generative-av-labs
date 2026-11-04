/* Import failures must not poison the animation loop or replace an existing replay. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 1000, passed = 0;
const c = { console, performance: { now: () => now }, navigator: {}, localStorage: { getItem: () => null }, atob, btoa };
c.window = c;
vm.createContext(c);
vm.runInContext(fs.readFileSync('src/kit.js', 'utf8'), c);
const kit = c.createKit();
const valid = () => ({ schema: 'generative-av-labs/session@1', app: 'nebula', durationMs: 1000,
  bands: 64, frameRate: 30, hits: [{ t: 10, pad: 'kick', voice: 'kick', vel: 0.75, note: 36 }],
  ctrl: [{ t: 15, k: 'pedal', v: 64 }, { t: 20, k: 'choke', v: 'crash' }],
  lanes: { shape: [[0, 0], [30, 1]], mode: [[0, 'field']] }, spectrumBase64: btoa(String.fromCharCode(...new Uint8Array(64 * 30).fill(128))) });
function check(name, run) { run(); passed++; console.log('PASS ' + name); }
check('replays exact stored spectrum without applying the idle decay', () => {
  kit.tick(now); kit.startReplay(valid()); now += 20; kit.tick(now);
  assert.equal(kit.hits, 1); assert.equal(kit.replayOn, true);
  assert.ok(kit.spectrum.every(v => Math.abs(v - 128 / 255) < 1e-7));
});
const bad = [
  ['missing arrays', s => { delete s.hits; }],
  ['null event', s => { s.hits = [null]; }],
  ['negative duration', s => { s.durationMs = -1; }],
  ['nonfinite duration', s => { s.durationMs = Infinity; }],
  ['unsorted events', s => { s.hits.push({ ...s.hits[0], t: 1 }); }],
  ['event after end', s => { s.hits[0].t = 1500; }],
  ['nonfinite velocity', s => { s.hits[0].vel = NaN; }],
  ['HTML voice label', s => { s.hits[0].voice = '<img src=x onerror=alert(1)>'; }],
  ['malformed lane', s => { s.lanes.shape = [null]; }],
  ['unknown render mode', s => { s.lanes.mode = [[0, 'bad-mode']]; }],
  ['invalid shape', s => { s.lanes.shape = [[0, 'a']]; }],
  ['invalid control', s => { s.ctrl[0].v = 'bad'; }],
  ['wrong band count', s => { s.bands = 32; }],
  ['invalid rate', s => { s.frameRate = 0; }],
  ['invalid base64', s => { s.spectrumBase64 = '*'; }],
  ['partial spectrum frame', s => { s.spectrumBase64 = btoa('x'); }],
];
for (const [name, corrupt] of bad) check('rejects ' + name + ' without stopping current replay', () => {
  const s = valid(); corrupt(s); assert.throws(() => kit.startReplay(s)); assert.equal(kit.replayOn, true);
  now++; assert.doesNotThrow(() => kit.tick(now));
});
check('replay ends at recorded duration', () => { now = 2001; kit.tick(now); assert.equal(kit.replayOn, false); });
check('actual freshly recorded session round-trips', () => {
  kit.startRecording('nebula'); now += 20; kit.pad('snare'); kit.noteLane('shape', 1); kit.tick(now);
  now += 100; const recorded = kit.stopRecording();
  assert.doesNotThrow(() => kit.startReplay(recorded));
  const hits = kit.hits; now += 21; kit.tick(now); assert.equal(kit.hits, hits + 1);
  now += 100; kit.tick(now); assert.equal(kit.replayOn, false);
});
console.log(`${passed}/${passed} session integrity checks passed`);
