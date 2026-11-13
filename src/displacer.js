/* displacer.js: two sounds, blended by moving their energy instead of mixing it.
   The engine is the desktop Displacer's (displacer-engine.js). This page uses its sound parts only; the desktop app keeps
   its picture mode. The page adds the suite's stage: the blend's spectrogram, its Gabor atoms in 3D, the transport
   scope, and a MIDI controller's mod wheel. The desktop app's native parts become browser ones: Chrome decodes the sound
   (plus a small AIFF reader), saving is a download, and performance mode is full screen.
   Every link is a stated rule, and there is no model. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD } = GLKit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const SOUND_S = 6, CW = 0.0035;

  const S = {
    view: 'flat', t: 0.5, method: 'ot',
    phasemode: 'dominant', xlaw: 'ep', mpMix: 0.55,
    srcA: null, srcB: null, audA: null, audB: null, audRate: 0, audDirty: true, lastRender: null,
    names: { A: 'Sung ah', B: 'Glass bells' },
    built: { A: true, B: true },
    ver: 0,
    fx: { sat: { on: false, drive: 0.4, type: 'soft', mix: 0.85 }, trans: { on: false, attack: 0.35, sustain: 0 }, gran: { on: false, density: 18, size: 80, pitch: 0, spray: 0.3, reverse: 0, mix: 0.7 } },
    gp: { source: 'blend', effort: 'std', best: null, bestLoss: 0, target: null, running: false, keys: false },
    space: { cloud: 'ab', depth: 0.55, size: 1, sway: true, yaw: 0.32, pitch: 0.16, dist: 2.75, phase: 0 },
    sweep: false, sweepT: 0, bioAuto: false, bioDemo: false, eegBusy: false, perform: false, scope: innerWidth >= 1100,
    tMid: 0.5, tView: 0.5,   // what the stage shows: it follows t through two short glides, so fast scrubbing cannot flash the screen
  };
  const E = DisplacerEngine.createEngine(S);
  const eeg = typeof createEEGDrive === 'function' ? createEEGDrive() : null;

  /* ---------- the worker: sound blends, atoms and sliced OT, off the main thread ---------- */
  let worker = null, seq = 0;
  const pending = {};
  function work(msg, transfer) {
    if (!worker) {
      worker = new Worker(URL.createObjectURL(new Blob([DisplacerEngine.WORKER_SRC], { type: 'text/javascript' })));
      worker.onmessage = (e) => { const p = pending[e.data.id]; delete pending[e.data.id]; if (p) p(e.data); };
      worker.onerror = (e) => { e.preventDefault(); Object.keys(pending).forEach((id) => { pending[id]({ error: e.message || 'the worker stopped' }); delete pending[id]; }); worker = null; };
    }
    const id = ++seq;
    return new Promise((res) => { pending[id] = res; worker.postMessage({ ...msg, id }, transfer || []); });
  }

  /* ---------- built-in sources: two sounds with some motion, so their spectra and atoms have shape: a sung "ah" on a
     slow tune, and glass bells ---------- */
  function synthVoice() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), tune = [110, 131, 147, 165, 147, 123], F = [[700, 110], [1150, 140], [2600, 260]];
    let ph = 0;
    for (let i = 0; i < L; i++) {
      const t = i / rate, k = Math.min(tune.length - 1, Math.floor(t / 0.5)), u = (t % 0.5) / 0.5, prev = tune[Math.max(0, k - 1)];
      const f0 = (prev + (tune[k] - prev) * Math.min(1, u * 5)) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t * 2));
      ph += (2 * Math.PI * f0) / rate;
      let v = 0;
      for (let h = 1; h * f0 < 6000; h++) { const f = h * f0; let g = 0; F.forEach(([c, b]) => { g += Math.exp(-0.5 * ((f - c) / b) ** 2); }); v += ((0.15 + g) / h) * Math.sin(h * ph); }
      out[i] = v * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
    }
    return finish(out, rate);
  }
  function synthBells() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), notes = [880, 1175, 1319, 988, 1568, 1175], R = [[1, 1], [2.76, 0.55], [5.4, 0.32], [8.93, 0.18]];
    notes.forEach((f, n) => {
      const s0 = Math.round(n * 0.5 * rate);
      R.forEach(([r, a], j) => { const w = (2 * Math.PI * f * r) / rate, d = 1.6 + j * 1.4; for (let i = 0; s0 + i < L; i++) out[s0 + i] += a * Math.exp((-d * i) / rate) * Math.sin(w * i) * Math.min(1, i / 40); });
    });
    return finish(out, rate);
  }
  function synthCello() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), notes = [98, 110, 130.8, 146.8], body = [[240, 55], [520, 95], [1350, 210]];
    let ph = 0;
    for (let i = 0; i < L; i++) {
      const t = i / rate, k = Math.min(notes.length - 1, Math.floor(t / 0.75)), u = (t % 0.75) / 0.75, prev = notes[Math.max(0, k - 1)];
      const f0 = (prev + (notes[k] - prev) * Math.min(1, u * 6)) * (1 + 0.008 * Math.sin(2 * Math.PI * 5.6 * t));
      ph += (2 * Math.PI * f0) / rate;
      let v = 0;
      for (let h = 1; h * f0 < 5500; h++) { const f = h * f0; let g = 0.25; body.forEach(([c, b]) => { g += Math.exp(-0.5 * ((f - c) / b) ** 2); }); v += (g / Math.pow(h, 0.92)) * Math.sin(h * ph + 0.15 * h); }
      out[i] = v * Math.sin(Math.PI * Math.min(1, u * 1.1));
    }
    return finish(out, rate);
  }
  function synthChimes() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), notes = [1046.5, 1318.5, 1568, 1975.5, 1174.7, 1760, 2093, 1396.9];
    const r = E.mulberry32(707);
    notes.forEach((f, n) => {
      const s0 = Math.round(n * 0.36 * rate);
      [[1, 1], [2.41, 0.48], [4.12, 0.28], [6.55, 0.15]].forEach(([ratio, a], j) => {
        const w = (2 * Math.PI * f * ratio) / rate, d = 2.2 + j * 1.6;
        for (let i = 0; s0 + i < L; i++) out[s0 + i] += a * Math.exp((-d * i) / rate) * Math.sin(w * i) * Math.min(1, i / 30);
      });
    });
    for (let i = 0; i < L; i++) out[i] += (r() * 2 - 1) * 0.025 * (0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (rate * 0.9)));
    return finish(out, rate);
  }
  function synthThroat() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      const t = i / rate, f0 = 73.4 * (1 + 0.005 * Math.sin(2 * Math.PI * 3.8 * t));
      const f2 = 660 + 440 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.45 * t));
      let s = 0;
      for (let h = 1; h <= 28; h++) {
        const fh = f0 * h, g1 = Math.exp(-0.5 * ((fh - 290) / 60) ** 2), g2 = 1.45 * Math.exp(-0.5 * ((fh - f2) / 55) ** 2);
        s += ((0.18 + g1 + g2) / Math.pow(h, 0.65)) * Math.sin(2 * Math.PI * fh * t);
      }
      out[i] = Math.tanh(s * 0.65);
    }
    return finish(out, rate);
  }
  function synthCrystalHarp() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), notes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1567.98];
    notes.forEach((f, n) => {
      const s0 = Math.round(n * 0.46 * rate);
      for (let i = 0; i + s0 < L; i++) {
        const dt = i / rate, mod = 2.4 * Math.exp(-dt * 4.5) * Math.sin(2 * Math.PI * f * 3.01 * dt);
        out[s0 + i] += Math.exp(-dt * 1.9) * Math.sin(2 * Math.PI * f * dt + mod) * Math.min(1, i / 50);
      }
    });
    return finish(out, rate);
  }
  function synthBrass() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), chord = [110, 164.81, 220, 277.18];
    for (let i = 0; i < L; i++) {
      const t = i / rate, swell = Math.min(1, t / 0.35) * Math.exp(-0.25 * Math.max(0, t - 0.5));
      const cutoff = 320 + 2600 * Math.pow(swell, 1.5);
      let s = 0;
      for (const f0 of chord) {
        for (let h = 1; h * f0 < 6500; h++) {
          const fh = h * f0 * (1 + 0.003 * Math.sin(2 * Math.PI * 4.8 * t + h));
          const roll = 1 / (1 + Math.pow(fh / cutoff, 2.4));
          s += (roll / Math.pow(h, 0.75)) * Math.sin(2 * Math.PI * fh * t);
        }
      }
      out[i] = Math.tanh(s * swell * 0.32);
    }
    return finish(out, rate);
  }
  function synthBowedGlass() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), modes = [587.33, 880, 1396.91, 2093];
    for (let i = 0; i < L; i++) {
      const t = i / rate;
      let s = 0;
      modes.forEach((f, idx) => {
        const env = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - idx * 0.18) / (2.8 - idx * 0.15))));
        const shimmer = 1 + 0.004 * Math.sin(2 * Math.PI * (5.2 + idx * 0.7) * t);
        s += Math.max(0, env) * (0.65 / (1 + idx * 0.35)) * (Math.sin(2 * Math.PI * f * shimmer * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.76 * t));
      });
      out[i] = s;
    }
    return finish(out, rate);
  }
  function synthTaiko() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), hits = [0, 0.65, 1.3, 1.62, 1.95, 2.4];
    const r = E.mulberry32(909);
    hits.forEach((ht, idx) => {
      const s0 = Math.round(ht * rate), fBase = idx % 2 === 0 ? 68 : 92;
      for (let i = 0; s0 + i < L; i++) {
        const dt = i / rate;
        if (dt > 0.75) break;
        const f = fBase + 55 * Math.exp(-dt * 28);
        const body = Math.exp(-dt * 5.2) * (Math.sin(2 * Math.PI * f * dt) + 0.4 * Math.sin(2 * Math.PI * f * 1.58 * dt));
        const slap = Math.exp(-dt * 42) * (r() * 2 - 1) * 0.35;
        out[s0 + i] += (body + slap) * (idx === 3 ? 0.65 : 1);
      }
    });
    return finish(out, rate);
  }
  function synthChoirCluster() {
    const rate = 22050, L = rate * 3, out = new Float32Array(L), notes = [196, 246.94, 293.66, 369.99, 440];
    const formants = [[650, 90], [1180, 120], [2650, 180]];
    for (let i = 0; i < L; i++) {
      const t = i / rate;
      let s = 0;
      notes.forEach((f0, vIdx) => {
        const f = f0 * (1 + 0.005 * Math.sin(2 * Math.PI * (4.4 + vIdx * 0.35) * t + vIdx));
        for (let h = 1; h * f < 6000; h++) {
          const fh = h * f;
          let g = 0.08;
          for (const [fc, bw] of formants) g += Math.exp(-0.5 * ((fh - fc) / bw) ** 2);
          s += (g / Math.pow(h, 0.85)) * Math.sin(2 * Math.PI * fh * t + h * 0.4 + vIdx);
        }
      });
      out[i] = s * Math.sin(Math.PI * (t / 3));
    }
    return finish(out, rate);
  }
  function finish(out, rate) {
    const L = out.length; let pk = 0; for (let i = 0; i < L; i++) pk = Math.max(pk, Math.abs(out[i])); if (pk > 0) for (let i = 0; i < L; i++) out[i] *= 0.8 / pk;
    const fd = (rate * 0.04) | 0; for (let i = 0; i < fd; i++) { out[i] *= i / fd; out[L - 1 - i] *= i / fd; }
    return { data: out, rate };
  }
  function synthAud(coreHz, formants) {     // the desktop app's demo voices, kept for reference
    const rate = 22050, L = rate * 3, out = new Float32Array(L);
    for (let n = 1; n * coreHz < 8000; n++) {
      const f = n * coreHz; let amp = 1 / n, env = 0; formants.forEach((fc) => { env += Math.exp(-0.5 * Math.pow((f - fc[0]) / fc[1], 2)); }); amp *= 0.12 + env;
      const w = (2 * Math.PI * f) / rate; for (let i = 0; i < L; i++) out[i] += amp * Math.sin(w * i);
    }
    let pk = 0; for (let i = 0; i < L; i++) pk = Math.max(pk, Math.abs(out[i])); if (pk > 0) for (let i = 0; i < L; i++) out[i] *= 0.8 / pk;
    const fd = (rate * 0.04) | 0; for (let i = 0; i < fd; i++) { out[i] *= i / fd; out[L - 1 - i] *= i / fd; }
    return { data: out, rate };
  }

  /* ---------- sheets and the stage chrome ---------- */
  const hud = `
    <div class="ab">
      <div class="seg" id="view-seg" role="group" aria-label="View"><button data-view="flat" aria-pressed="true">Spectrogram</button><button data-view="space" aria-pressed="false">Atoms · 3D</button></div>
      <button class="ab-thumb" id="slot-A" data-slot="A"><canvas id="thumb-A" width="176" height="110" aria-hidden="true"></canvas><span class="ab-tag">A</span></button>
      <div class="ab-mid">
        <div class="ab-read"><span class="ab-name" id="name-A">Sung ah</span><b class="ab-t" id="t-val">0.50</b><span class="ab-name b" id="name-B">Glass bells</span></div>
        <input type="range" id="t" min="0" max="1000" value="500" aria-label="Blend position from A to B">
        <div class="ab-read sub"><span>A</span><span id="method-line">OT displacement</span><span>B</span></div>
      </div>
      <button class="ab-thumb b" id="slot-B" data-slot="B"><canvas id="thumb-B" width="176" height="110" aria-hidden="true"></canvas><span class="ab-tag">B</span></button>
      <button class="pill" id="hear">Hear</button>
    </div>`;

  const blendSheet = `
    <div class="src-grid">
      ${['A', 'B'].map((w) => `<div class="src-card" data-slot="${w}"><canvas id="sheet-thumb-${w}" width="168" height="104" aria-hidden="true"></canvas>
        <div class="src-info"><strong>${w} <span id="sheet-name-${w}"></span></strong><p class="why" id="sheet-info-${w}"></p></div>
        <button class="pill" data-pick="${w}">Choose ${w}</button></div>`).join('')}
    </div>
    <div class="row-actions"><button class="pill" id="swap">Swap A and B</button><select id="builtin-pair" aria-label="Built-in sound pair"><option value="default">Sung ah × Glass bells</option><option value="cello-chimes">Bowed cello × Rain &amp; chimes</option><option value="throat-harp">Throat drone × FM crystal harp</option><option value="brass-glass">Analog brass × Bowed glass</option><option value="taiko-choir">Taiko pulse × Choir cluster</option></select><button class="pill" id="builtin-audio">Built-in sounds</button></div>
    <p class="note">Two sounds. Drop files anywhere on the page. Each one uses its first six seconds. Files are decoded in this browser and never uploaded.</p>
    <div class="field"><span>Method</span><div class="row-actions" id="method-row" style="margin-top:4px">
      <button class="pill" data-m="ot">OT displacement</button><button class="pill" data-m="mp">MP hybrid</button><button class="pill" data-m="xfade">Crossfade</button></div></div>
    <p class="note" id="method-caption"></p>
    <label class="field"><div class="row"><span>From A to B</span><b id="t2-val">0.50</b></div><input type="range" id="t2" min="0" max="1000" value="500"></label>
    <div class="field" id="disp-bio-field"><span>Headband / biofeedback mod-wheel</span>
      <div class="row-actions" id="disp-bio-row" style="margin-top:4px;flex-wrap:wrap">
        <button class="pill" id="disp-bio-toggle" aria-pressed="false" title="Drive the optimal-transport blend position t from the synthetic Muse S / Athena preview; a real headset cannot connect to this page">Bio mod: off</button>
        <button class="pill" id="disp-bio-demo" aria-pressed="false" title="Run a labeled synthetic EEG + fNIRS + PRV + Stillness preview">Synthetic preview: off</button>
        <button class="pill on" data-athena="eeg" aria-pressed="true">EEG</button>
        <button class="pill" data-athena="fnirs" aria-pressed="false">fNIRS</button>
        <button class="pill" data-athena="prv" aria-pressed="false">PRV</button>
        <button class="pill" data-athena="stillness" aria-pressed="false">Stillness</button>
        <button class="pill" data-athena="fusion" aria-pressed="false">Fusion</button>
      </div>
      <p class="note" id="disp-bio-status" style="margin-top:6px">A real Muse S cannot connect to this page, so these modes run only as a labeled synthetic preview. The preview moves t by EEG balance, fNIRS optical, optical PRV, IMU stillness, or fusion.</p>
    </div>
    <div class="sig-title"><span>Transport scope · the map, drawn</span><span id="scope-means"></span></div>
    <canvas class="sig-canvas" id="scope-big" width="1400" height="440" role="img" aria-label="Distributions of A, B and the blend, with the transport map"></canvas>
    <p class="note">Teal is A, pink is B, violet is the blend. Under transport the violet hump slides from A to B as you move the slider, and its mean slides in a straight line. Under crossfade it is two fixed humps trading height. The thin rays are the map itself.</p>
    <label class="check"><input type="checkbox" id="scope-on"> Show the scope on the stage</label>
    <details id="aud-opts"><summary>Sound options</summary><div class="controls-grid">
      <label class="field">Phase<select id="phasemode"><option value="dominant">Dominant source, crisp</option><option value="pv">Phase vocoder, smoother</option></select></label>
      <label class="field"><div class="row"><span>MP hybrid: skeleton to field</span><b id="mpmix-v">55%</b></div><input type="range" id="mpmix" min="0" max="100" value="55"></label>
      <label class="field">Crossfade law<select id="xlaw"><option value="ep">Equal power</option><option value="lin">Linear</option></select></label>
    </div></details>`;

  const spaceSheet = `
    <div class="field"><span>Cloud</span><div class="row-actions" id="cloud-row" style="margin-top:4px"><button class="pill on" data-cloud="ab">A to B</button><button class="pill" data-cloud="A">A alone</button><button class="pill" data-cloud="B">B alone</button></div></div>
    <p class="note" id="cloud-note"></p>
    <div class="controls-grid" style="padding:12px 0 6px">
      <label class="field"><div class="row"><span>Depth</span><b id="depth-v"></b></div><input type="range" id="depth" min="0" max="140" value="55"></label>
      <label class="field"><div class="row"><span>Atom size</span><b id="size-v"></b></div><input type="range" id="size" min="30" max="250" value="100"></label>
      <label class="check" style="margin:0"><input type="checkbox" id="sway" checked> Sway slowly</label>
      <label class="check" style="margin:0"><input type="checkbox" id="sweep"> Visual sweep from A to B and back, 24 seconds</label>
    </div>
    <div class="row-actions" id="atom-actions"><button class="pill" id="atoms-play">Play the atoms</button></div>
    <p class="note">Drag the stage to turn the cloud and scroll to move closer. Hear holds the visual sweep at its current position; Save a sweep renders an audible journey from A to B. Depth is each atom's salience: a stated rule, not a learned estimate. A controller's mod wheel (CC1) moves the slider.</p>`;

  const patchSheet = `
    <div class="row-actions" style="margin-top:0"><div class="seg small" id="gp-src" role="group" aria-label="What to fit"><button data-s="blend" aria-pressed="true">The blend</button><button data-s="A" aria-pressed="false">A</button><button data-s="B" aria-pressed="false">B</button></div>
      <select id="gp-effort" aria-label="Effort"><option value="fast">Fast</option><option value="std" selected>Standard</option><option value="deep">Deep</option></select>
      <button class="pill primary" id="gp-grow">Grow a patch</button><button class="pill" id="gp-cancel" hidden>Stop search</button></div>
    <div class="statgrid" style="margin-top:14px">
      <div class="stat"><span class="k">Match</span><span class="v" id="gp-match">-</span><span class="n">spectrum correlation</span></div>
      <div class="stat"><span class="k">Search</span><span class="v" id="gp-stat">idle</span><span class="n" id="gp-cores">-</span></div>
    </div>
    <canvas class="sig-canvas" id="gp-spec" width="1400" height="380" role="img" aria-label="Target spectrum, the grown patch's spectrum and the gap between them"></canvas>
    <div class="row-actions"><button class="pill" id="gp-play">Play</button><button class="pill" id="gp-ab">Target, then patch</button><button class="pill" id="gp-wav">Save its sound (.wav)</button><button class="pill" id="gp-json">Save the patch (.json)</button><button class="pill" id="gp-load-json">Load patch (.json)</button></div>
    <input type="file" id="gp-patch-file" accept="application/json,.json" hidden>
    <div class="gpkb" id="gpkb" aria-label="Patch keyboard"></div>
    <p class="note">With this sheet open, keys Z to M and Q to U play the patch, two octaves around its pitch.</p>
    <label class="check"><input type="checkbox" id="gp-keys"> Play the patch from a MIDI keyboard, with middle C as its root</label>
    <details open><summary>Effects, baked into every sound you save</summary>
      <div class="fx" id="fx-sat"><label class="check"><input type="checkbox" id="fx-sat-on"> Saturate</label><select id="fx-sat-type" aria-label="Saturation type"><option value="soft">Soft</option><option value="tape">Tape</option><option value="hard">Hard</option></select>
        <div class="fx-knobs"><label class="field"><div class="row"><span>Drive</span><b id="fx-sat-drive-v"></b></div><input type="range" id="fx-sat-drive" min="0" max="100"></label><label class="field"><div class="row"><span>Mix</span><b id="fx-sat-mix-v"></b></div><input type="range" id="fx-sat-mix" min="0" max="100"></label></div></div>
      <div class="fx" id="fx-trans"><label class="check"><input type="checkbox" id="fx-trans-on"> Transient</label>
        <div class="fx-knobs"><label class="field"><div class="row"><span>Attack</span><b id="fx-trans-attack-v"></b></div><input type="range" id="fx-trans-attack" min="-100" max="100"></label><label class="field"><div class="row"><span>Sustain</span><b id="fx-trans-sustain-v"></b></div><input type="range" id="fx-trans-sustain" min="-100" max="100"></label></div></div>
      <div class="fx" id="fx-gran"><label class="check"><input type="checkbox" id="fx-gran-on"> Granular</label>
        <div class="fx-knobs">${[['density', 1, 80], ['size', 10, 300], ['pitch', -24, 24], ['spray', 0, 100], ['reverse', 0, 100], ['mix', 0, 100]].map(([k, a, b]) => `<label class="field"><div class="row"><span>${k[0].toUpperCase() + k.slice(1)}</span><b id="fx-gran-${k}-v"></b></div><input type="range" id="fx-gran-${k}" min="${a}" max="${b}"></label>`).join('')}</div></div>
      <p class="note">In order: saturate, transient, granular, on the rendered blend, the patch or the atoms. The same settings give the same file every time.</p>
    </details>
    <p class="note">Differential evolution fits an FM voice with three formants to the target's spectrum, spread across your processor's cores. Teal is the target, violet the patch, amber the gap. The patch makes its own clean phase, so it plays as an instrument. Evolutionary search, not a neural network.</p>`;

  const saveSheet = `
    <div class="row-actions" style="margin-top:0"><button class="pill primary" id="save-blend">Save the blend</button><button class="pill" id="save-sweep">Save a sweep</button><button class="pill" id="save-poster">Save a poster</button></div>
    <p class="note" id="save-what"></p>
    <div class="row-actions"><button class="pill" id="save-cloud">Cloud (.ply)</button><button class="pill" id="save-splats">Splats (.ply)</button><button class="pill" id="save-atoms">Atoms (.wav)</button></div>
    <p class="note">Cloud .ply is plain points with color, read by TouchDesigner (Point File In), Blender and CloudCompare. Splats .ply is the 3D Gaussian splat format for SuperSplat or PlayCanvas. Both hold the cloud at the slider's position. macOS Preview shows them as flat squares.</p>
    <div class="row-actions"><button class="pill" id="save-project">Save project (.displacer.json)</button><button class="pill" id="load-project">Open project</button><button class="pill" id="save-stage">A picture of the stage</button></div>
    <input type="file" id="project-file" accept="application/json,.json" hidden>
    <p class="note">A project file saves both sounds, the blend method, effects, 3D cloud settings, and any grown patch so you can reopen and keep editing later.</p>
    <p class="note" id="save-status" role="status">Files are made here and handed to your browser's downloads. The blend holds the exact result; the stage adds glow.</p>`;

  const about = `
    <p class="sheet-intro">Displacer moves mass instead of mixing it. Each blend is a stated computation, and there is no model.</p>
    <table class="maptable"><tbody>
      <tr><th>OT displacement</th><td>Each frame's spectrum moves along frequency toward B's, with its energy kept, so a resonance slides instead of fading.</td></tr>
      <tr><th>MP hybrid</th><td>The loudest partials, found by matching pursuit, keep their own clean phase and ride over the transported rest of the sound.</td></tr>
      <tr><th>Crossfade</th><td>The honest control. It adds the two, so both sound at once.</td></tr>
      <tr><th>Space</th><td>Gabor atoms placed by time, log frequency and salience, matched by sliced optimal transport over position and color.</td></tr>
      <tr><th>Patch</th><td>Differential evolution fits an FM voice with three formants to a spectrum.</td></tr>
    </tbody></table>
    <details><summary>What is exact, and what is approximate</summary>
      <p><b>Exact.</b> The 1D inverse-CDF map is the exact W2 optimal-transport map between 1D distributions (McCann's displacement interpolation): a theorem, not an approximation. Here it moves each frame's magnitude spectrum along frequency, with energy conserved per frame. The crossfade is the naive control: it sums the two and moves nothing.</p>
      <p><b>Approximate.</b> Sound phase is rebuilt by a heuristic, because a transported magnitude has no exact phase, so attacks can smear near the middle. One 1D transport per frame stands in for the full 2D Sinkhorn coupling, which is not run. Nothing here invents a new texture between A and B: expect clean migration, not a hybrid that a generative model would draw.</p>
      <p><b>Fixed from the desktop version.</b> Sound blends there divided by a nearly zero window at the first and last samples, which left them about 250 times too quiet with a click. The granular effect used an unseeded random source, so a saved sound did not repeat. Both are fixed here.</p>
    </details>
    <details><summary>The 1D map, in code</summary><pre class="monitor">// distributions p (from A) and q (from B) as normalized histograms, with CDFs F_p and F_q
// the exact W2 optimal map:  T(x) = Q_q(F_p(x)),  Q_q the inverse CDF of q
// displacement interpolation at blend t:
T_t(x) = (1 - t) * x + t * Q_q(F_p(x))
// x is a frequency bin (the axis is frequency), moving magnitude</pre></details>
    <details><summary>A MIDI controller</summary>
      <p>The mod wheel (CC1) moves the slider from A to B, as it did in the desktop app. With a patch grown, a MIDI keyboard can play it, with middle C as its root. Nothing here listens to your microphone.</p>
    </details>
    <p class="note">Keys: <b>Left</b> and <b>Right</b> move the slider, with <b>Shift</b> for bigger steps · <b>V</b> flat or space · <b>C</b> connect a controller · <b>F</b> full screen · <b>H</b> hide controls. To move mass between a picture and a sound, use <a href="nebula.html">Nebula</a>'s Form mode.</p>`;

  const TRUTH = 'Optimal transport with stated rules and no model. Your sounds stay in this browser, and saved files hold the exact blend.';
  const PRIVACY = "Sounds you open are decoded in this browser and never uploaded, and MIDI is read here and sent nowhere. The page makes no network requests after it loads. Your MIDI input choice and the reconnect setting stay in this browser's storage.";
  const CREDITS = "<p>No outside code is included. The engine is the desktop Displacer's, and its methods are named above: McCann's displacement interpolation, sliced optimal transport, matching pursuit for the Gabor atoms and differential evolution for the patch. The splat file follows the 3D Gaussian splat .ply layout that SuperSplat and PlayCanvas read.</p>";
  const BADGE = {
    'audio-ot': "OT displacement · exact transport of each frame's spectrum · phase is a heuristic",
    'audio-mp': 'MP hybrid · atoms keep their own phase · the rest is transported',
    'audio-xfade': 'Crossfade · the naive control · you hear both at once',
    'space-audio': 'Gabor atoms · time, log frequency, salience · a sparse decomposition, not the whole sound',
    'space-audio-solo': 'Gabor atoms of one sound · the slider raises salience from flat · not the whole sound',
  };
  const CAPTION = {
    ot: "OT displacement moves each frame's spectral energy from A's frequencies to B's, an exact 1D transport of magnitude. A resonance slides along the axis instead of fading. Phase is rebuilt by a heuristic, the approximate part.",
    mp: 'MP hybrid splits each sound. The loudest partials, found by matching pursuit, keep their own clean phase so attacks survive, and ride over the transported rest of the sound. The mix sets skeleton against field.',
    xfade: 'Crossfade adds the two recordings. At 0.50 you hear both at once. It is the baseline.',
  };
  const METHOD_NAME = { ot: 'OT displacement', mp: 'MP hybrid', xfade: 'Crossfade' };

  const kit = createKit();
  // Displacer never listens to a microphone. The shared reconnect setting can come from another page, so this page
  // reconnects MIDI alone, and opening audio input does nothing here.
  kit.connectAudio = async () => {};
  kit.tryReconnect = async () => { if (!kit.autoconnect.on) return; try { const m = await navigator.permissions.query({ name: 'midi' }); if (m.state === 'granted') kit.connectMidi(); } catch (e) { /* not available everywhere */ } };
  const brand = '<svg viewBox="0 0 24 28" aria-hidden="true"><circle cx="8.5" cy="14" r="5.5"/><circle cx="15.5" cy="14" r="5.5"/><path d="M8.5 14h7"/></svg>';
  const shell = mountShell({
    id: 'displacer', name: 'Displacer', brand, kit, signal: false, pads: false, hitStrip: false,
    intro: { eyebrow: 'Displacer · an optimal-transport blender for sound', title: "Don't crossfade. Move the mass.", subtitle: 'Drag from A to B, or bring two sounds of your own. Nothing is uploaded.' },
    hud, truth: TRUTH, privacy: PRIVACY, credits: CREDITS,
    sheets: [
      { id: 'blend', label: 'Blend', icon: 'sliders', title: 'Choose the two, and how.', html: blendSheet },
      { id: 'space', label: 'Space', icon: 'sliders', title: 'Shape the cloud.', intro: 'These change how the cloud looks. They never change the blend you save.', html: spaceSheet },
      { id: 'patch', label: 'Patch', icon: 'wave', title: 'Grow a voice.', intro: 'Fit a playable synth voice to the blend, to A or to B.', html: patchSheet },
      { id: 'save', label: 'Save', icon: 'play', title: 'Keep what you made.', html: saveSheet },
    ],
    about, canvas: () => cv, snapshot: (done) => { wantSnap = done; }, quality: () => (S.view === 'space' && spaceN ? `${spaceN.toLocaleString()} atoms` : `sound · ${METHOD_NAME[S.method]}`),
    onKey: (e, key) => {
      if (key === 'arrowleft' || key === 'arrowright') { e.preventDefault(); stopSweep(); setT(S.t + (key === 'arrowright' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01)); }
      else if (key === 'v') setView(S.view === 'space' ? 'flat' : 'space');
    },
  });

  /* own icons for the new dock items, and the stage furniture */
  const ICONS = {
    blend: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
    space: '<path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z"/><path d="M12 12l7.5-4M12 12v8.5M12 12 4.5 8"/>',
    save: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  };
  Object.entries(ICONS).forEach(([id, d]) => { const s = document.querySelector(`#${id}-button svg`); if (s) s.innerHTML = d; });
  $('blend-sheet').classList.add('wide');
  // Displacer takes sound files and a controller, not a drum kit. The shell's signal view, pad keys and hit strip are
  // switched off above. Its session recorder and its notes on drum input are removed here. Its drum demo and audio input
  // stay in the page but hidden, because the shell still updates them. The connect sheet keeps MIDI alone.
  document.body.classList.add('no-kit');
  $('session-sheet').remove(); $('session-button').remove();
  document.body.insertAdjacentHTML('beforeend', '<span id="replay-stop" hidden></span>');   // the shell's state renderer still sets this one
  [...document.querySelectorAll('#about-sheet summary')].filter((x) => /From MIDI, from audio/.test(x.textContent)).forEach((x) => x.closest('details').remove());
  $('demo-sheet').closest('.device-card').classList.add('kit-only');
  $('demo-audible').closest('label').classList.add('kit-only');
  { const s = [...document.querySelectorAll('#about-sheet summary')].find((x) => /Safety and privacy/.test(x.textContent));
    if (s) s.nextElementSibling.textContent = "A limiter slows any large change in brightness, and this page measures under the WCAG limit of three flashes a second, even with the slider dragged fast. That is a measured screen, not a medical guarantee. If flashing or moving light affects you, take care, and turn on your system's reduced-motion setting, which tightens the limiter and stills the cloud."; }
  $('connect-title').textContent = 'Connect a controller.';
  document.querySelector('#connect-sheet .sheet-intro').textContent = "A MIDI controller's mod wheel (CC1) moves the blend from A to B. With a patch grown, a MIDI keyboard can play it. Sounds come from files.";
  addEventListener('keydown', (e) => {     // the shell's drum demo key does nothing here
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea, dialog[open]'))) return;
    if (e.key.toLowerCase() === 'd') e.stopImmediatePropagation();
  }, true);
  // redraw a thumbnail whenever it gets a new size, however its sheet was opened, so it is always as sharp as the screen
  const thumbRO = new ResizeObserver(() => { cancelAnimationFrame(thumbRO.f); thumbRO.f = requestAnimationFrame(drawThumbs); });
  $('patch-sheet').classList.add('wide');
  const sceneEl = $('scene');
  document.querySelector('.header').insertAdjacentHTML('afterend', `
    <div id="method-badge" class="chrome" data-kind="space-audio"><span id="method-badge-text"></span></div>
    <div id="busy" class="chrome" role="status" hidden></div>`);
  sceneEl.insertAdjacentHTML('beforeend', `
    <div id="spectrogram-guide" class="chrome" hidden>
      <div class="spec-heading"><span>THE BLEND · SPECTROGRAM</span><strong id="spec-pair"></strong></div>
      <div id="spec-frequencies"></div><div id="spec-times"></div>
      <span class="spec-key" id="spec-cursor">Time → · frequency ↑ · brighter = stronger</span>
    </div>
    <div id="scope-card" class="chrome" hidden><canvas id="scope" width="560" height="300" role="img" aria-label="Transport scope"></canvas>
      <div class="scope-key"><span class="ka">A</span><span class="kb">B</span><span class="km">blend</span><span id="scope-mini"></span></div></div>
    <div id="drop" hidden><div data-slot="A"><b>A</b>Drop to replace A</div><div data-slot="B"><b>B</b>Drop to replace B</div></div>`);
  $('fs-button').insertAdjacentHTML('beforebegin', '<button class="top-action" id="perform-button" title="Full screen with only the stage. Esc leaves.">Perform</button>');
  document.body.insertAdjacentHTML('beforeend', '<input type="file" id="file-A" accept="audio/*,.aif,.aiff,.aifc" hidden><input type="file" id="file-B" accept="audio/*,.aif,.aiff,.aifc" hidden>');

  /* ---------- sources ---------- */
  const sourceRequests = { A: 0, B: 0 };
  function setAudio(which, obj, name, built) {
    if (which === 'A') S.srcA = obj; else S.srcB = obj;
    S.names[which] = name; S.built[which] = built;
    if (S.srcA && S.srcB) E.prepAudio();
    S.lastRender = null; S.audDirty = true;
    sourcesChanged();
  }
  function loadBuiltIn() { sourceRequests.A++; sourceRequests.B++; setAudio('A', synthVoice(), 'Sung ah', true); setAudio('B', synthBells(), 'Glass bells', true); }
  let distCache = { key: '', hA: null, hB: null };
  function sourcesChanged() {
    S.ver++;
    distCache.key = '';
    scopeDirty = true; spaceKey = ''; scheduleRender(30);
    drawThumbs();
  }
  async function decodeSound(f) {
    const ab = await f.arrayBuffer();
    const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [, 'this format'])[1].toUpperCase();
    let obj = E.decodeAiff(ab);
    if (!obj) {
      try {
        const buf = await new OfflineAudioContext(1, 2, 44100).decodeAudioData(ab);
        const n = Math.min(buf.length, Math.round(buf.sampleRate * SOUND_S)), mono = new Float32Array(n);
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
        obj = { data: mono, rate: buf.sampleRate };
      } catch (err) { throw new Error(`this browser could not decode ${ext}. WAV, MP3, AAC or M4A, FLAC, Ogg and AIFF work in Chrome`); }
    } else if (obj.data.length > obj.rate * SOUND_S) obj.data = obj.data.slice(0, Math.round(obj.rate * SOUND_S));
    let pk = 0; for (let i = 0; i < obj.data.length; i++) pk = Math.max(pk, Math.abs(obj.data[i]));
    if (pk < 1e-4) throw new Error('its first six seconds are silent');
    if (obj.data.length < obj.rate * 0.25) throw new Error('it is shorter than a quarter second');
    return obj;
  }
  const isImageFile = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|heic)$/i.test(f.name);
  const isSoundFile = (f) => /^audio\//.test(f.type) || /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff?|aifc|caf|webm)$/i.test(f.name);
  async function loadFile(f, which) {
    if (!f) return;
    if (!isSoundFile(f)) { shell.toast(isImageFile(f) ? `${f.name} is a picture. Displacer blends two sounds.` : `${f.name} is not a sound.`); return; }
    if (!which) which = S.built.A ? 'A' : 'B';
    const request = ++sourceRequests[which];
    busy(`Reading ${f.name}`);
    try {
      const sound = await decodeSound(f);
      if (request !== sourceRequests[which]) return;
      setAudio(which, sound, f.name, false);
      shell.toast(`${which}: ${f.name}`);
    } catch (err) { if (request !== sourceRequests[which]) return; shell.toast(`${f.name} was not loaded: ${err.message}.`, 5200); }
    busy(null);
  }

  /* thumbnails: each sound's spectrogram */
  function drawThumb(canvas, which) {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 3);   // a backing store as sharp as the screen
    if (r.width > 0 && r.height > 0) { const bw = Math.round(r.width * dpr), bh = Math.round(r.height * dpr); if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; } }
    else if (canvas.id.startsWith('sheet-') && canvas.width < 720) { canvas.width = 720; canvas.height = 446; }   // still hidden: sharp enough for any screen until it is measured
    const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    const obj = which === 'A' ? S.srcA : S.srcB; if (!obj) return;
    g.putImageData(specImage(spectrogram(obj.data, obj.rate, w, h), w, h), 0, 0);
  }
  function drawThumbs() {
    ['A', 'B'].forEach((w) => {
      drawThumb($(`thumb-${w}`), w); drawThumb($(`sheet-thumb-${w}`), w);
      const nm = S.names[w], built = S.built[w];
      $(`name-${w}`).textContent = nm; $(`sheet-name-${w}`).textContent = built ? `${nm} · built in` : nm;
      $(`slot-${w}`).setAttribute('aria-label', `Source ${w}: ${nm}${built ? ', built in' : ''}. Choose a file`);
      $(`slot-${w}`).classList.toggle('built', built);
      const o = w === 'A' ? S.srcA : S.srcB;
      $(`sheet-info-${w}`).textContent = o ? `${(o.data.length / o.rate).toFixed(1)} s at ${(o.rate / 1000).toFixed(1)} kHz, mono` : '';
    });
  }

  /* ---------- state changes ---------- */
  let scopeDirty = true, spaceKey = '', spaceN = 0, spaceBusy = '', renderTimer = 0, renderSeq = 0;
  function setT(v, src) {
    S.t = clamp(v, 0, 1);
    const r = $('t'), r2 = $('t2'), val = Math.round(S.t * 1000);
    if (+r.value !== val) { r.value = val; shell.syncRange(r); }
    if (+r2.value !== val) { r2.value = val; shell.syncRange(r2); }
    $('t-val').textContent = S.t.toFixed(2); $('t2-val').textContent = S.t.toFixed(2); syncHear();
    scopeDirty = true;
    S.audDirty = true; if (src !== 'sweep' || !playSrc) scheduleRender(src === 'sweep' ? 900 : 260);
    if (src !== 'sweep') moved();
  }
  function setMethod(m) {
    S.method = m; scopeDirty = true;
    S.audDirty = true; scheduleRender(30);
    syncMethod();
  }
  function badgeKind() {
    if (S.view === 'space') return S.space.cloud === 'ab' ? 'space-audio' : 'space-audio-solo';
    return `audio-${S.method}`;
  }
  function syncMethod() {
    document.querySelectorAll('#method-row [data-m]').forEach((b) => { b.classList.toggle('on', b.dataset.m === S.method); b.setAttribute('aria-pressed', String(b.dataset.m === S.method)); });
    $('method-caption').textContent = CAPTION[S.method] || '';
    $('method-line').textContent = S.view === 'space' ? 'Gabor atoms · sliced OT' : METHOD_NAME[S.method];
    const k = badgeKind(); $('method-badge').dataset.kind = k; $('method-badge-text').textContent = BADGE[k];
    describeSave();
  }
  function setView(v) {
    S.view = v;
    document.querySelectorAll('#view-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    document.body.dataset.view = v;
    syncMethod(); moved();
    if (G && Post) resize();
  }
  function moved() { if (!document.body.classList.contains('moved')) document.body.classList.add('moved'); }
  setTimeout(moved, 9000);
  function busy(msg) { const b = $('busy'); if (msg) { b.textContent = msg; b.hidden = false; } else b.hidden = true; }

  /* ---------- the flat view: the blend's spectrogram, computed by the engine ---------- */
  let flatW = 0, flatH = 0, flatSpec = false, flatMean = [0.05, 0.05, 0.08];
  /* the sound's flat view is its spectrogram: log frequency up, time across, the suite's color law */
  function spectrogram(data, rate, cols, rows) {
    const N = 1024, K = N / 2, re = new Float32Array(N), im = new Float32Array(N), win = new Float32Array(N), out = new Uint8Array(cols * rows), mags = new Float32Array(cols * rows);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const hop = Math.max(1, (data.length - N) / cols), lf0 = Math.log(40), lf1 = Math.log(rate / 2), bins = new Int32Array(rows);
    for (let y = 0; y < rows; y++) bins[y] = Math.min(K, Math.max(1, Math.round((Math.exp(lf0 + (y / (rows - 1)) * (lf1 - lf0)) / rate) * N)));
    let mx = 1e-9;
    for (let cx = 0; cx < cols; cx++) {
      const st = Math.floor(cx * hop); if (st + N > data.length) break;
      for (let i = 0; i < N; i++) { re[i] = data[st + i] * win[i]; im[i] = 0; }
      E.fft(re, im, false);
      for (let y = 0; y < rows; y++) { const m = Math.hypot(re[bins[y]], im[bins[y]]); mags[cx + y * cols] = m; if (m > mx) mx = m; }
    }
    for (let i = 0; i < mags.length; i++) out[i] = Math.round(255 * Math.min(1, Math.log(1 + (mags[i] / mx) * 300) / Math.log(301)));
    return out;
  }
  // the sound palette on the CPU, for thumbnails and the poster: low is warm, high is cool
  const LAW = [[255, 179, 122], [242, 166, 199], [184, 184, 255], [135, 224, 212]];
  function lawRGB(y) { const s = y < 0.33 ? 0 : y < 0.66 ? 1 : 2, f = clamp((y - [0, 0.33, 0.66][s]) / [0.33, 0.33, 0.34][s], 0, 1); return [0, 1, 2].map((k) => LAW[s][k] + (LAW[s + 1][k] - LAW[s][k]) * f); }
  function specImage(sp, cols, rows) {
    const id = new ImageData(cols, rows);
    for (let y = 0; y < rows; y++) { const c = lawRGB(y / (rows - 1)); for (let x = 0; x < cols; x++) { const m = Math.pow(sp[x + y * cols] / 255, 1.8), o = (x + (rows - 1 - y) * cols) * 4; id.data[o] = 12 + c[0] * m; id.data[o + 1] = 16 + c[1] * m; id.data[o + 2] = 32 + c[2] * m; id.data[o + 3] = 255; } }
    return id;
  }
  function showSpectrogram(r) {
    const cols = 640, rows = 256, sp = spectrogram(r.data, r.rate, cols, rows);
    flatW = cols; flatH = rows; flatSpec = true;
    uploadFlat(sp);
    flatMean = [0.03, 0.025, 0.07];
    const hi = r.rate / 2, span = Math.log(hi / 40);
    $('spec-pair').textContent = `${S.names.A} → ${S.names.B}`;
    $('spec-frequencies').innerHTML = [100, 1000, 10000].filter((hz) => hz < hi).map((hz) =>
      `<span style="bottom:${100 * Math.log(hz / 40) / span}%">${hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`}</span>`).join('');
    const duration = r.data.length / r.rate;
    $('spec-times').innerHTML = [0, 0.25, 0.5, 0.75, 1].map((t) => `<span style="left:${t * 100}%">${(t * duration).toFixed(2)} s</span>`).join('');
  }

  // Keep labels aligned with the actual WebGL image, including after a phone rotation.
  let guideRect = '';
  function placeSpectrogramGuide(rect, visible) {
    const guide = $('spectrogram-guide');
    guide.hidden = !visible || S.perform;
    if (guide.hidden) return;
    const css = `left:${rect[0] * 100}%;top:${(1 - rect[3]) * 100}%;width:${(rect[2] - rect[0]) * 100}%;height:${(rect[3] - rect[1]) * 100}%`;
    if (css !== guideRect) { guide.style.cssText = css; guideRect = css; }
  }
  // Cache and worker results belong to the complete input state, including source files and effects.
  // A render finishing after another slider/file change must never clear that change's dirty flag.
  const audioKey = () => JSON.stringify([S.ver, S.t, S.method, S.phasemode, S.mpMix, S.xlaw, S.fx]);
  let audioJob = null;
  function scheduleRender(ms) { clearTimeout(renderTimer); renderTimer = setTimeout(renderAudioNow, ms); }
  function renderAudioNow() {
    if (!S.audA || !S.audB) return Promise.resolve(null);
    const key = audioKey();
    if (audioJob && audioJob.key === key) return audioJob.promise;
    const id = ++renderSeq, t = S.t, method = S.method, rate = S.audRate, ver = S.ver;
    const job = { key, promise: null };
    busy('Rendering the blend');
    job.promise = (async () => {
      try {
        const r = await work({ type: 'audio', A: S.audA.slice(), B: S.audB.slice(), rate, t, method, phasemode: S.phasemode, mpMix: S.mpMix, xlaw: S.xlaw, fx: S.fx });
        if (id !== renderSeq || key !== audioKey()) return null;
        if (r.error) { shell.toast(`The blend could not render: ${r.error}`); return null; }
        S.lastRender = { data: r.data, rate, t, method, ver, key }; S.audDirty = false;
        showSpectrogram(S.lastRender);
        updateAudition(S.lastRender);
        return S.lastRender;
      } finally {
        if (audioJob === job) { audioJob = null; busy(null); }
      }
    })();
    audioJob = job;
    return job.promise;
  }
  async function currentRender() {
    // A click to hear/save follows the newest requested state even if its predecessor is still rendering.
    for (;;) {
      stopSweep();  // hearing or saving a fixed blend holds the visual-only sweep at this position
      const key = audioKey(), L = S.lastRender;
      if (L && !S.audDirty && L.key === key) return L;
      clearTimeout(renderTimer);
      const r = await renderAudioNow();
      if (r) return r;
      if (key === audioKey()) return null;  // a real render failure, not a superseded request
    }
  }

  /* ---------- the transport scope ---------- */
  const COL = { A: '#86e0d3', B: '#f3a6c8', M: '#b8b7ff' };
  function scopeData() {
    const key = `${S.ver}`;
    if (distCache.key !== key) {
      if (!S.audA || !S.audB) return null;
      distCache = { key, hA: E.distFromAudio(S.audA), hB: E.distFromAudio(S.audB) };
    }
    const { hA, hB } = distCache, t = S.t;
    let hM;
    if (S.method === 'xfade') { hM = new Float64Array(256); for (let v = 0; v < 256; v++) hM[v] = (1 - t) * hA[v] + t * hB[v]; }
    else hM = E.pushforward(hA, E.cdf256(hA), E.cdf256(hB), t);
    return { hA, hB, hM };
  }
  function axisLabel(v) {
    const K = 1024, k = Math.round(Math.pow(K, v / 255)), hz = (k * (S.audRate || 22050)) / 2048;
    return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
  }
  function drawScope(cv, big) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, d = scopeData();
    c.clearRect(0, 0, w, h);
    c.fillStyle = big ? '#0b0f1c' : 'rgba(9,12,24,.0)'; c.fillRect(0, 0, w, h);
    if (!d) return null;
    const sm = (hh) => { const o = new Float64Array(256); for (let v = 0; v < 256; v++) { let a = 0, w = 0; for (let k = -6; k <= 6; k++) { const j = v + k; if (j < 0 || j > 255) continue; const g = Math.exp(-(k * k) / 8); a += hh[j] * g; w += g; } o[v] = a / w; } return o; };
    const dA = sm(d.hA), dB = sm(d.hB), dM = sm(d.hM);
    const pad = big ? 34 : 18, base = h - pad, top = big ? 18 : 10, mx = Math.max(E.maxv(dA), E.maxv(dB), E.maxv(dM)) || 1, X = (v) => (v / 255) * w;
    const curve = (hh, col, alpha, fill) => {
      c.beginPath(); for (let v = 0; v < 256; v++) { const x = X(v), y = base - (hh[v] / mx) * (base - top); if (v) c.lineTo(x, y); else c.moveTo(x, y); }
      c.globalAlpha = alpha; c.strokeStyle = col; c.lineWidth = (fill ? 2.4 : 1.6) * (big ? 1.6 : 1.4); c.stroke();
      if (fill) { c.lineTo(w, base); c.lineTo(0, base); c.closePath(); c.globalAlpha = 0.18; c.fillStyle = col; c.fill(); }
      c.globalAlpha = 1;
    };
    c.strokeStyle = 'rgba(191,194,236,.16)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, base + 0.5); c.lineTo(w, base + 0.5); c.stroke();
    curve(dA, COL.A, 0.85); curve(dB, COL.B, 0.85); curve(dM, COL.M, 1, true);
    if (S.method !== 'xfade') {
      const cA = E.cdf256(d.hA), cB = E.cdf256(d.hB);
      c.strokeStyle = COL.M; c.globalAlpha = 0.45; c.lineWidth = big ? 1.6 : 1.2;
      for (let q = 1; q < 16; q++) { const p = q / 16, xa = E.invCDF256(cA, p), xb = E.invCDF256(cB, p), xt = (1 - S.t) * xa + S.t * xb; c.beginPath(); c.moveTo(X(xa), base + 4); c.lineTo(X(xt), base - 6); c.stroke(); }
      c.globalAlpha = 1;
    }
    const mA = E.mean256(d.hA), mB = E.mean256(d.hB), mM = E.mean256(d.hM);
    [[mA, COL.A], [mB, COL.B], [mM, COL.M]].forEach(([m, col]) => { c.fillStyle = col; c.beginPath(); c.arc(X(m), base + (big ? 14 : 8), big ? 5 : 3.5, 0, 7); c.fill(); });
    if (big) { c.fillStyle = 'rgba(238,237,251,.7)'; c.font = '22px ui-sans-serif, -apple-system, sans-serif'; c.fillText('frequency →', 8, h - 6); }
    return { mA, mB, mM };
  }
  function drawScopes() {
    const card = $('scope-card');
    card.hidden = !(S.scope && innerWidth >= 1100) || S.perform;
    let m = null;
    if (!card.hidden) m = drawScope($('scope'), false);
    if ($('blend-sheet').open) m = drawScope($('scope-big'), true) || m;
    if (m) {
      const txt = `mean A ${axisLabel(m.mA)} · blend ${axisLabel(m.mM)} · B ${axisLabel(m.mB)}`;
      $('scope-means').textContent = txt; $('scope-mini').textContent = `blend ${axisLabel(m.mM)}`;
    }
  }

  /* ---------- the space view: Gabor atoms, found and matched ---------- */
  let splat = null;     // CPU copy for exports and atoms: { A, disp, c0, c1, sz, n, atoms }
  const wantKey = () => `${S.space.cloud}|${S.ver}`;
  async function buildSpace() {
    const key = wantKey();
    if (spaceBusy === key) return;
    spaceBusy = key;
    try {
      let n, A3, D3, C0, C1, SZ, atoms = null;
      if (!S.audA || !S.audB) return;
      busy('Finding Gabor atoms');
      const KA = 340, rate = S.audRate;
      const [ra, rb] = await Promise.all([work({ type: 'atoms', data: S.audA.slice(), rate, k: KA }), work({ type: 'atoms', data: S.audB.slice(), rate, k: KA })]);
      if (ra.error || rb.error) throw new Error(ra.error || rb.error);
      const ea = ra.result, eb = rb.result, lf0 = Math.log(40), lf1 = Math.log(rate / 2);
      const mk = (e) => e.atoms.map((a) => { const v = ((Math.log(Math.max(40, a.f)) - lf0) / (lf1 - lf0)) * 2 - 1, c = lawRGB((v + 1) / 2), k = 0.45 + 0.55 * a.amp; return { p: [(a.time / e.dur) * 2 - 1, v, a.amp - 0.5], c: c.map((x) => x * k) }; });
      if (S.space.cloud === 'ab') {
        const A = mk(ea), B = mk(eb); n = Math.min(A.length, B.length); A.length = n; B.length = n;
        busy(`Matching ${n} atoms`);
        const { X, Y } = E.packClouds(A, B, n);
        const r = await work({ type: 'ot', X, Y, n }, [X.buffer, Y.buffer]);
        if (r.error) throw new Error(r.error);
        ({ A3, D3, C0, C1, SZ } = alloc(n));
        for (let i = 0; i < n; i++) { SZ[i] = 0.45 + 0.9 * (A[i].p[2] + 0.5); for (let k = 0; k < 3; k++) { A3[i * 3 + k] = A[i].p[k]; D3[i * 3 + k] = r.X[i * 6 + k] - A[i].p[k]; C0[i * 3 + k] = A[i].c[k]; C1[i * 3 + k] = clamp(r.X[i * 6 + 3 + k] / CW, 0, 255); } }
        atoms = { ea, eb, n };
      } else {
        const e = S.space.cloud === 'A' ? ea : eb, pts = mk(e);
        n = pts.length; ({ A3, D3, C0, C1, SZ } = alloc(n));
        for (let i = 0; i < n; i++) { SZ[i] = 0.45 + 0.9 * (pts[i].p[2] + 0.5); A3[i * 3] = pts[i].p[0]; A3[i * 3 + 1] = pts[i].p[1]; D3[i * 3 + 2] = pts[i].p[2] * 1.4; for (let k = 0; k < 3; k++) { C0[i * 3 + k] = pts[i].c[k]; C1[i * 3 + k] = pts[i].c[k]; } }
      }
      if (spaceBusy !== key || key !== wantKey()) return;
      splat = { A: A3, disp: D3, c0: C0, c1: C1, sz: SZ, n, atoms, kind: 'audio', solo: S.space.cloud !== 'ab' };
      uploadSpace(splat);
      spaceKey = key;
    } catch (err) {
      shell.toast(`The cloud could not be built: ${err.message}`);
      spaceKey = key;
    } finally {
      if (spaceBusy === key) { spaceBusy = ''; busy(null); }
    }
  }
  function alloc(n) { return { A3: new Float32Array(n * 3), D3: new Float32Array(n * 3), C0: new Float32Array(n * 3), C1: new Float32Array(n * 3), SZ: new Float32Array(n) }; }
  function syncCloud() {
    document.querySelectorAll('#cloud-row [data-cloud]').forEach((b) => { b.classList.toggle('on', b.dataset.cloud === S.space.cloud); b.setAttribute('aria-pressed', String(b.dataset.cloud === S.space.cloud)); });
    const solo = S.space.cloud !== 'ab';
    $('cloud-note').textContent = solo ? `${S.space.cloud} alone: the slider raises each atom by its salience.` : "Each sound is split into about 340 Gabor atoms, short sine bursts placed by time, log frequency and salience. The slider carries A's atoms into B's, and Play the atoms rebuilds a sound from them alone.";
    syncMethod();
  }

  /* ---------- WebGL ---------- */
  const cv = $('stage');
  const G = createGL(cv);
  let gl, Post, pFlat, pPts, scene, tFlat, ptsVao, ptsBuf, baseVao, rw = 0, rh = 0, wantSnap = null, safe = { top: 0.12, bottom: 0.68 };
  const BACK = `
uniform vec2 uRes; uniform vec3 uMean; uniform vec2 uCenter;
vec3 backdrop(vec2 uv){
  vec3 c=mix(vec3(.010,.012,.030),vec3(.004,.005,.013),uv.y);
  float d=length((uv-uCenter)*vec2(uRes.x/uRes.y,1.));
  return c+uMean*.09*exp(-d*d*1.8);
}
vec3 invAces(vec3 y){ y=clamp(y,0.,.94); vec3 a=2.43*y-2.51,b=.59*y-.03,c=.14*y; return (-b-sqrt(max(b*b-4.*a*c,vec3(0.))))/(2.*a); }`;
  const FLAT_FS = FS_HEAD + BACK + `
uniform sampler2D uImg; uniform vec4 uRect; uniform float uHas,uPlay,uLod;
// the color law for sound: low is warm, high is cool, in the suite's own colors
vec3 law(float y){ vec3 a=vec3(1.,.70,.48),b=vec3(.95,.65,.78),c=vec3(.72,.72,1.),d=vec3(.53,.88,.83); return y<.33?mix(a,b,y/.33):y<.66?mix(b,c,(y-.33)/.33):mix(c,d,(y-.66)/.34); }
void main(){
  vec3 col=backdrop(vUv);
  if(uHas>.5){
    vec2 p=(vUv-uRect.xy)/(uRect.zw-uRect.xy), cp=clamp(p,0.,1.);
    if(p==cp){
      float m=textureLod(uImg,p,uLod).r, a=pow(m,1.8);
      col=col*(1.-.6*a)+pow(law(p.y),vec3(2.2))*a*.95+vec3(.9,.88,1.)*pow(m,7.)*.22;
      if(uPlay>=0.){ float dx=(p.x-uPlay)*(uRect.z-uRect.x)*uRes.x; col+=vec3(.85,.85,1.)*.45*exp(-dx*dx*.35); }
    } else {
      float dd=length((p-cp)*(uRect.zw-uRect.xy)*uRes)/uRes.y;
      col+=vec3(.05,.045,.12)*textureLod(uImg,cp,5.).r*.3*exp(-dd*26.);
    }
  }
  o=vec4(col,1.);
}`;
  const PTS_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA; layout(location=1) in vec3 aD; layout(location=2) in vec3 aC0; layout(location=3) in vec3 aC1; layout(location=4) in vec2 aS;
uniform mat4 uVP; uniform float uT,uDepth,uBase,uPx,uTime;
out vec3 vC;
void main(){
  vec3 p=aA+uT*aD;
  vec3 w=vec3(p.x,p.y,p.z*uDepth);
  float ph=aS.y*6.2831;
  w.xy+=vec2(sin(uTime*.7+ph*1.7),cos(uTime*.9+ph*2.3))*.002;
  vec4 c=uVP*vec4(w,1.);
  gl_Position=c;
  gl_PointSize=clamp(uBase*aS.x*uPx/c.w*2.3,1.5,160.);
  vC=pow(clamp(mix(aC0,aC1,uT)/255.,0.,1.),vec3(2.2));
}`;
  const PTS_FS = `#version 300 es
precision highp float;
in vec3 vC; out vec4 o; uniform float uI;
void main(){
  vec2 q=gl_PointCoord*2.-1.; float r2=dot(q,q); if(r2>1.)discard;
  float g=exp(-r2*5.)+.3*exp(-r2*1.3); o=vec4(vC*g*uI,1.);
}`;

  function uploadFlat(spec) {
    if (!G) return;
    gl.bindTexture(gl.TEXTURE_2D, tFlat);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, flatW, flatH, 0, gl.RED, gl.UNSIGNED_BYTE, spec);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    flatReady = true;
  }
  let flatReady = false;
  function uploadSpace(sp) {
    if (!G) return;
    const n = sp.n, F = new Float32Array(n * 14), r = E.mulberry32(4242);
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      for (let k = 0; k < 3; k++) { F[o + k] = sp.A[i * 3 + k]; F[o + 3 + k] = sp.disp[i * 3 + k]; F[o + 6 + k] = sp.c0[i * 3 + k]; F[o + 9 + k] = sp.c1[i * 3 + k]; }
      F[o + 12] = sp.sz[i]; F[o + 13] = r();
    }
    gl.bindVertexArray(ptsVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ptsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, F, gl.STATIC_DRAW);
    gl.bindVertexArray(baseVao);
    spaceN = n;
    // the gap between neighbors, which sizes the atoms in a splat export
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { const x = sp.A[i * 3], y = sp.A[i * 3 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    sp.spacing = Math.sqrt(Math.max(1e-4, (x1 - x0) * (y1 - y0)) / n);
    let ex = 0.2, ey = 0.2;   // how far the cloud reaches, at either end of the slider, so the camera can frame it
    for (let i = 0; i < n; i++) for (const t of [0, 1]) { ex = Math.max(ex, Math.abs(sp.A[i * 3] + t * sp.disp[i * 3])); ey = Math.max(ey, Math.abs(sp.A[i * 3 + 1] + t * sp.disp[i * 3 + 1])); }
    sp.ex = ex; sp.ey = ey;
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < n; i += 7) { mr += sp.c0[i * 3] + sp.c1[i * 3]; mg += sp.c0[i * 3 + 1] + sp.c1[i * 3 + 1]; mb += sp.c0[i * 3 + 2] + sp.c1[i * 3 + 2]; }
    const cnt = Math.ceil(n / 7) * 2 * 255;
    sp.mean = [mr, mg, mb].map((v) => Math.pow(v / cnt, 2.2) * 0.3);
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.max(320, Math.round(cv.clientWidth * dpr)), H = Math.max(240, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const budget = S.view === 'flat' ? Infinity : 2.2e6, asp = W / H;
    let h = Math.round(Math.sqrt(budget / asp)), w = Math.round(h * asp);
    if (w > W) { w = W; h = H; }
    measureSafe();
    if (w === rw && h === rh) return;
    rw = w; rh = h;
    if (scene) G.freeTarget(scene);
    scene = G.target(rw, rh);
    Post.resize(rw, rh, 5);
  }
  function measureSafe() {
    if (S.perform) { safe = { top: 0.05, bottom: 0.95 }; return; }
    const H = innerHeight || 1, q = (sel) => document.querySelector(sel), ms = q('.mode-switch'), bd = $('method-badge'), dw = q('.dock-wrap');
    let top = ms ? ms.getBoundingClientRect().bottom : 80;
    if (bd && getComputedStyle(bd).display !== 'none') top = Math.max(top, bd.getBoundingClientRect().bottom);
    const bottom = dw ? dw.getBoundingClientRect().top : H * 0.7;
    safe = { top: (top + 12) / H, bottom: Math.max((top + 12) / H + 0.2, (bottom - 8) / H) };
  }
  function perspective(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
  function lookAt(e, c, u) {
    let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map((v) => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map((v) => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
  }
  function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }

  /* ---------- the frame ---------- */
  let last = performance.now(), frameIdx = 0, fails = 0, dragging = null;
  function render(now) {
    requestAnimationFrame(render);
    try {
      const dtMs = Math.min(100, now - last); last = now;
      kit.tick(now);
      shell.frame(now);
      if (!G || gl.isContextLost()) return;
      const dt = dtMs / 1000;
      frameIdx++;
      if (frameIdx % 30 === 0) measureSafe();
      if (eeg) {
        eeg.tick(dt, S.bioDemo && S.bioAuto);
        if (S.bioAuto) {
          const targetT = clamp(eeg.activeDrive(), 0, 1);
          setT(S.t + (targetT - S.t) * Math.min(1, dt * 2.4), 'bio');
        }
        if (frameIdx % 10 === 0) renderDispBio();
      }
      if (S.sweep) { S.sweepT += dt; setT(0.5 - 0.5 * Math.cos((S.sweepT / 24) * Math.PI * 2), 'sweep'); }
      // Two 0.1 s glides in a row: a hand's drag feels as it did through one 0.15 s glide, but scrubbing back and forth
      // several times a second moves the atoms about half as far, which keeps the cloud under the flash limit.
      if (S.tView !== S.t || S.tMid !== S.t) {
        const k = 1 - Math.exp(-dt / 0.1);
        S.tMid += (S.t - S.tMid) * k; S.tView += (S.tMid - S.tView) * k;
        if (Math.abs(S.t - S.tMid) < 1e-4 && Math.abs(S.t - S.tView) < 1e-4) { S.tMid = S.t; S.tView = S.t; }
      }
      // Also prepare the optional atom view in the background, without making it the first impression.
      if (spaceKey !== wantKey()) buildSpace();
      if (S.view === 'flat' && !flatReady && S.lastRender) showSpectrogram(S.lastRender);
      if (scopeDirty || $('blend-sheet').open) { scopeDirty = false; drawScopes(); }
      if (S.space.sway && !dragging && !RM.matches) S.space.phase += dt * 0.11;
      const sway = RM.matches ? 0 : Math.sin(S.space.phase) * 0.5;

      const W = rw, H = rh, asp = W / H, sh = safe.bottom - safe.top, dy = 1 - (safe.top + safe.bottom);
      const showFlat = S.view === 'flat' && flatReady;
      const showSpace = S.view === 'space' && spaceN > 0 && !!splat;
      const center = [0.5, 1 - (safe.top + safe.bottom) / 2]; let rect = [0, 0, 0, 0];
      if (showFlat) {
        const side = Math.max(66 / Math.max(1, innerWidth), $('scope-card').hidden ? 0.07 : Math.min(0.3, 318 / Math.max(1, innerWidth)));
        const aspect = innerWidth < 700 ? 1.25 : 1.9, aw = (1 - 2 * side) * W, ah = Math.max(80, sh * H - 110 * H / innerHeight);
        const k = Math.min(aw / flatW, ah / (flatW / aspect)), pw = flatW * k, ph = (flatW / aspect) * k;
        const cx = 0.5, cy = center[1];
        rect = [cx - pw / W / 2, cy - ph / H / 2, cx + pw / W / 2, cy + ph / H / 2];
      }
      placeSpectrogramGuide(rect, showFlat);
      const back = { uRes: [W, H], uMean: showSpace ? splat.mean : flatMean, uCenter: center };

      gl.disable(gl.BLEND);
      G.into(scene);
      if (!showSpace) {
        G.bindTex(0, tFlat);
        let play = -1;
        if (playSrc && AC && playKind === 'blend') play = clamp((AC.currentTime - playStart) / playDur, 0, 1);
        G.use(pFlat, { ...back, uImg: 0, uRect: rect, uHas: showFlat ? 1 : 0, uPlay: play, uLod: showFlat ? Math.max(0, Math.log2(flatH / Math.max(1, (rect[3] - rect[1]) * H))) : 0 });
        G.draw();
      } else {
        const yaw = S.space.yaw + sway, pitch = S.space.pitch, dist = S.space.dist;
        const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
        const th = Math.tan(0.425), fit = Math.min((0.8 * asp * 2.75 * th) / splat.ex, (0.86 * sh * 2.75 * th) / splat.ey);   // framed at the default distance, so zooming still zooms
        const T = [fit, 0, 0, 0, 0, fit, 0, 0, 0, 0, 1, 0, 0, dy, 0, 1];
        const fov = 0.85, VP = mul(T, mul(perspective(fov, asp, 0.05, 40), lookAt(eye, [0, 0, 0], [0, 1, 0])));
        const uPx = (1 / Math.tan(fov / 2)) * (H / 2) * fit;
        G.use(pFlat, { ...back, uHas: 0, uPlay: -1 }); G.draw();     // the backdrop, then the atoms added on top as glowing points
        gl.bindVertexArray(ptsVao);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        G.use(pPts, { uVP: VP, uT: S.tView, uDepth: S.space.depth, uBase: 0.042 * S.space.size, uPx, uTime: now / 1000, uI: 0.42 });
        gl.drawArrays(gl.POINTS, 0, spaceN);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(baseVao);
      }
      const bloom = Post.bloom(scene.tex, showSpace ? 0.75 : 0.85);
      Post.finish(scene.tex, bloom, {
        uBloomK: showSpace ? 0.3 : 0.08, uExposure: 1, uFlash: 0, uGrain: showSpace ? 0.012 : 0.004, uT: now / 1000, uVig: showSpace ? 0.38 : 0.14, uSat: 1, rate: RM.matches ? 0.16 : 0.36,
      }, dtMs / 1000);
      if (lumaRec) lumaRec(now);
      if (wantSnap) { const done = wantSnap; wantSnap = null; cv.toBlob((blob) => done(blob), 'image/png'); }
    } catch (e) {
      if (fails++ < 3) console.error(e);
    }
  }

  /* ---------- sound: hearing the blend, the atoms and the patch ---------- */
  let AC = null, playSrc = null, playGain = null, playStart = 0, playDur = 1, playKind = '';
  let playBlendT = null, playKey = '', auditionRequest = 0, auditionPending = false;
  const ensureAC = () => { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; };
  const FADE = 0.018;
  function fadeOut(src, gain) {
    if (!src) return;
    const now = AC.currentTime;
    if (gain) {
      if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(now);
      else { gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); }
      gain.gain.linearRampToValueAtTime(0, now + FADE);
    }
    try { src.stop(now + FADE); } catch (e) { /* already ended */ }
  }
  function startBuffer(data, rate, kind, offset = 0, blendT = null, key = '') {
    const now = AC.currentTime, previous = playSrc, previousGain = playGain;
    const buf = AC.createBuffer(1, data.length, rate); buf.getChannelData(0).set(data);
    const src = AC.createBufferSource(), gain = AC.createGain(); src.buffer = buf;
    src.connect(gain); gain.connect(AC.destination);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + FADE);
    src.start(now, offset);
    playSrc = src; playGain = gain; playStart = now - offset; playDur = data.length / rate; playKind = kind;
    playBlendT = blendT; playKey = key;
    fadeOut(previous, previousGain);
    src.onended = () => {
      src.disconnect(); gain.disconnect();
      if (playSrc === src) { playSrc = null; playGain = null; playBlendT = null; playKey = ''; syncHear(); }
    };
    syncHear();
  }
  function playBuffer(data, rate, kind, blendT = null, key = '') {
    ensureAC(); auditionRequest++; auditionPending = false;
    startBuffer(data, rate, kind, 0, blendT, key);
  }
  function stopAudio() {
    auditionRequest++; auditionPending = false;
    const src = playSrc, gain = playGain;
    playSrc = null; playGain = null; playBlendT = null; playKey = '';
    fadeOut(src, gain); syncHear();
  }
  function updateAudition(r) {
    if (!playSrc || playKind !== 'blend' || playKey === r.key) return;
    const offset = AC.currentTime - playStart;
    // Completing a worker job must never restart a stopped or naturally finished sound.
    if (offset >= playDur || offset >= r.data.length / r.rate) { stopAudio(); return; }
    startBuffer(r.data, r.rate, 'blend', offset, r.t, r.key);
  }
  function syncHear() {
    const active = !!(playSrc && playKind === 'blend'), b = $('hear');
    b.textContent = active ? `Stop ${playBlendT.toFixed(2)}` : auditionPending ? 'Cancel' : `Hear ${S.t.toFixed(2)}`;
    b.classList.toggle('on', active || auditionPending);
    b.title = active ? `Hearing blend ${playBlendT.toFixed(2)}. Slider changes update at the same playback position when rendered.` : 'Hear the current blend. Move the slider while listening to update the sound.';
    b.setAttribute('aria-label', active ? `Stop playback. Hearing blend ${playBlendT.toFixed(2)}${playKey !== audioKey() ? ', updating to the current controls' : ''}` : auditionPending ? 'Cancel pending playback' : `Hear blend ${S.t.toFixed(2)}`);
  }
  $('hear').addEventListener('click', async () => {
    if ((playSrc && playKind === 'blend') || auditionPending) { stopAudio(); return; }
    ensureAC();
    const request = ++auditionRequest; auditionPending = true; syncHear();
    const r = await currentRender();
    if (request !== auditionRequest) return;
    auditionPending = false;
    if (!r) { syncHear(); return; }
    playBuffer(r.data, r.rate, 'blend', r.t, r.key);
  });

  function atomMorph(t) {    // the desktop renderAtomMorph: each atom a windowed sine, at its transported place
    if (!splat || splat.kind !== 'audio' || !splat.atoms) return null;
    const rate = S.audRate, dur = Math.min(splat.atoms.ea.dur, splat.atoms.eb.dur), L = Math.floor(dur * rate), out = new Float32Array(L), lf0 = Math.log(40), lf1 = Math.log(rate / 2), r = E.mulberry32(4242), A = splat.A, D = splat.disp;
    for (let i = 0; i < splat.atoms.n; i++) {
      const tn = A[i * 3] + t * D[i * 3], lfn = A[i * 3 + 1] + t * D[i * 3 + 1], an = A[i * 3 + 2] + t * D[i * 3 + 2];
      const time = ((tn + 1) / 2) * dur, f = Math.exp(lf0 + ((lfn + 1) / 2) * (lf1 - lf0)), amp = Math.max(0, an / 0.8 + 0.5);
      const sg = 0.02 * rate, GL = Math.floor(sg * 6), t0 = Math.floor(time * rate - GL / 2), w = (2 * Math.PI * f) / rate, ph = r() * 6.2832;
      for (let j = 0; j < GL; j++) { const idx = t0 + j; if (idx < 0 || idx >= L) continue; out[idx] += amp * Math.exp(-0.5 * Math.pow((j - GL / 2) / sg, 2)) * Math.sin(w * j + ph) * 0.28; }
    }
    return E.applyFX(E.normalize(out), rate);
  }
  $('atoms-play').addEventListener('click', () => {
    if (S.space.cloud !== 'ab') { shell.toast('Choose A to B under Cloud first: atoms play from the matched pair.'); return; }
    const d = atomMorph(S.t); if (!d) { shell.toast('The atoms are still being found. Try again in a moment.'); setView('space'); return; }
    playBuffer(d, S.audRate, 'atoms');
  });

  /* ---------- Genopatch ---------- */
  const NOFX = { sat: { on: false }, trans: { on: false }, gran: { on: false } };
  async function gpTarget() {
    if (!S.audA || !S.audB) return null;
    if (S.gp.source === 'A') return { data: S.audA, rate: S.audRate };
    if (S.gp.source === 'B') return { data: S.audB, rate: S.audRate };
    const rate = S.audRate;
    const r = await work({ type: 'audio', A: S.audA.slice(), B: S.audB.slice(), rate, t: S.t, method: 'ot', phasemode: S.phasemode, mpMix: S.mpMix, xlaw: S.xlaw, fx: NOFX });
    return r.error ? null : { data: r.data, rate };
  }
  function drawGP(target, resyn, progress) {
    const c = $('gp-spec').getContext('2d'), w = c.canvas.width, h = c.canvas.height, lf0 = Math.log(40), lf1 = Math.log(11025);
    c.fillStyle = '#0b0f1c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(191,194,236,.13)'; c.lineWidth = 1; c.fillStyle = 'rgba(238,237,251,.6)'; c.font = '20px ui-sans-serif, -apple-system, sans-serif';
    [100, 300, 1000, 3000, 10000].forEach((f) => { const x = ((Math.log(f) - lf0) / (lf1 - lf0)) * w; c.beginPath(); c.moveTo(x, 8); c.lineTo(x, h - 30); c.stroke(); c.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 5, h - 8); });
    if (!target) { c.textAlign = 'center'; c.fillText('Grow a patch to fit an FM voice to the target spectrum.', w / 2, h / 2); c.textAlign = 'left'; return; }
    const NB = target.length, vmin = -7, vmax = 5, Y = (v) => h - 30 - ((clamp(v, vmin, vmax) - vmin) / (vmax - vmin)) * (h - 46);
    const path = (desc) => { c.beginPath(); for (let b = 0; b < NB; b++) { const x = (b / (NB - 1)) * w, y = Y(desc[b]); if (b) c.lineTo(x, y); else c.moveTo(x, y); } };
    path(target); c.strokeStyle = COL.A; c.lineWidth = 3; c.stroke(); c.lineTo(w, h - 30); c.lineTo(0, h - 30); c.closePath(); c.globalAlpha = 0.13; c.fillStyle = COL.A; c.fill(); c.globalAlpha = 1;
    if (resyn) {
      path(resyn); c.strokeStyle = COL.M; c.lineWidth = 2.6; c.stroke();
      c.beginPath(); for (let b = 0; b < NB; b++) { const x = (b / (NB - 1)) * w, d = Math.min(1, (Math.abs(target[b] - resyn[b]) / (vmax - vmin)) * 3), y = h - 30 - d * 40; if (b) c.lineTo(x, y); else c.moveTo(x, y); }
      c.lineTo(w, h - 30); c.lineTo(0, h - 30); c.closePath(); c.globalAlpha = 0.5; c.fillStyle = '#f1cf8e'; c.fill(); c.globalAlpha = 1;
    }
    if (progress != null) { c.fillStyle = COL.M; c.fillRect(0, 0, w * clamp(progress, 0, 1), 4); }
  }
  async function gpGrow() {
    if (S.gp.running) return;
    S.gp.running = true; S.gp.cancel = false;
    $('gp-grow').textContent = 'Growing'; $('gp-grow').disabled = true; $('gp-stat').textContent = 'starting';
    const cancelBtn = $('gp-cancel'); if (cancelBtn) cancelBtn.hidden = false;
    try {
      const tg = await gpTarget(); if (!tg) throw new Error('there is no target sound yet');
      const target = E.specDescriptor(tg.data, tg.rate); S.gp.target = target;
      E.initWorkers();
      $('gp-cores').textContent = E.workers ? `${E.workers} workers` : 'one thread';
      drawGP(target, null, 0);
      const res = await E.genopatch(target, (gen, Gn, loss, best) => {
        $('gp-stat').textContent = `${gen} of ${Gn}`;
        const bd = E.candSpec(best, target); $('gp-match').textContent = `${Math.round(Math.max(0, E.specCorr(bd, target)) * 100)}%`; drawGP(target, bd, gen / Gn);
      });
      S.gp.best = res.genome; S.gp.bestLoss = res.loss;
      const bd = E.candSpec(res.genome, target); drawGP(target, bd);
      $('gp-match').textContent = `${Math.round(Math.max(0, E.specCorr(bd, target)) * 100)}%`;
      $('gp-stat').textContent = res.cancelled ? 'stopped' : 'grown';
      shell.toast(res.cancelled ? 'Search stopped. Kept the best patch found so far.' : 'Patch grown. Play it from your computer keys, the keyboard below or a MIDI keyboard.');
    } catch (err) { $('gp-stat').textContent = 'failed'; shell.toast(`The patch could not grow: ${err.message}`); }
    S.gp.running = false; S.gp.cancel = false;
    $('gp-grow').textContent = 'Grow a patch'; $('gp-grow').disabled = false;
    if (cancelBtn) cancelBtn.hidden = true;
  }
  function gpNote(semis, vel) {
    if (!S.gp.best) { shell.toast('Grow a patch first.'); return; }
    const rate = S.audRate || 44100;
    let d = E.synthFromPatch(S.gp.best, 1.6, rate, semis || 0); d = E.applyFX(d, rate);
    if (vel != null && vel < 1) for (let i = 0; i < d.length; i++) d[i] *= 0.25 + 0.75 * vel;
    playBuffer(d, rate, 'patch');
  }
  const GPKEYS = { z: -12, s: -11, x: -10, d: -9, c: -8, v: -7, g: -6, b: -5, h: -4, n: -3, j: -2, m: -1, q: 0, 2: 1, w: 2, 3: 3, e: 4, r: 5, 5: 6, t: 7, 6: 8, y: 9, 7: 10, u: 11 };
  $('gpkb').innerHTML = Array.from({ length: 25 }, (_, i) => { const n = i - 12, black = [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12); return `<button class="${black ? 'blk' : ''}${n === 0 ? ' root' : ''}" data-semi="${n}" aria-label="${n === 0 ? 'Root note' : `${n > 0 ? '+' : ''}${n} semitones`}"></button>`; }).join('');
  $('gpkb').addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-semi]'); if (b) gpNote(+b.dataset.semi); });
  $('patch-sheet').addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.target.closest('input, select')) return;
    const k = e.key.toLowerCase(); if (k in GPKEYS) { e.preventDefault(); gpNote(GPKEYS[k]); }
  });
  $('gp-src').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; S.gp.source = b.dataset.s; document.querySelectorAll('#gp-src button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
  $('gp-effort').addEventListener('change', (e) => { S.gp.effort = e.target.value; });
  $('gp-grow').addEventListener('click', gpGrow);
  if ($('gp-cancel')) $('gp-cancel').addEventListener('click', () => { S.gp.cancel = true; });
  if ($('gp-load-json')) $('gp-load-json').addEventListener('click', () => $('gp-patch-file').click());
  if ($('gp-patch-file')) $('gp-patch-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!Array.isArray(p.genome) || p.genome.length < 16) throw new Error('not a valid Genopatch file');
      S.gp.best = new Float64Array(p.genome.slice(0, 16));
      S.gp.bestLoss = typeof p.loss === 'number' ? p.loss : 0;
      const tg = await gpTarget();
      if (tg) {
        const target = E.specDescriptor(tg.data, tg.rate); S.gp.target = target;
        const bd = E.candSpec(S.gp.best, target); drawGP(target, bd);
        $('gp-match').textContent = `${Math.round(Math.max(0, E.specCorr(bd, target)) * 100)}%`;
      }
      $('gp-stat').textContent = 'loaded';
      shell.toast(`Loaded patch from ${f.name}.`);
    } catch (err) { shell.toast(`Could not load patch: ${err.message}`); }
  });
  $('gp-play').addEventListener('click', () => gpNote(0));
  $('gp-ab').addEventListener('click', async () => {
    if (!S.gp.best) { shell.toast('Grow a patch first.'); return; }
    const tg = await gpTarget(); if (!tg) return;
    const rate = tg.rate, dur = 1.2, tgt = tg.data.subarray(0, Math.min(tg.data.length, Math.floor(rate * dur))), pat = E.applyFX(E.synthFromPatch(S.gp.best, dur, rate, 0), rate);
    const both = new Float32Array(tgt.length + Math.round(rate * 0.25) + pat.length); both.set(tgt, 0); both.set(pat, tgt.length + Math.round(rate * 0.25));
    playBuffer(both, rate, 'patch');
  });
  $('gp-keys').addEventListener('change', (e) => { S.gp.keys = e.target.checked; });
  drawGP(null);

  /* FX: three modules, each a switch and its settings */
  const FXK = [['sat', 'drive', 100, (v) => `${Math.round(v * 100)}%`], ['sat', 'mix', 100, (v) => `${Math.round(v * 100)}%`],
    ['trans', 'attack', 100, (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`], ['trans', 'sustain', 100, (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`],
    ['gran', 'density', 1, (v) => `${Math.round(v)} a second`], ['gran', 'size', 1, (v) => `${Math.round(v)} ms`], ['gran', 'pitch', 1, (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`],
    ['gran', 'spray', 100, (v) => `${Math.round(v * 100)}%`], ['gran', 'reverse', 100, (v) => `${Math.round(v * 100)}%`], ['gran', 'mix', 100, (v) => `${Math.round(v * 100)}%`]];
  function fxChanged() { S.audDirty = true; scheduleRender(300); ['sat', 'trans', 'gran'].forEach((m) => $(`fx-${m}`).classList.toggle('off', !S.fx[m].on)); }
  FXK.forEach(([m, k, scale, fmt]) => {
    const r = $(`fx-${m}-${k}`); r.value = Math.round(S.fx[m][k] * scale); $(`fx-${m}-${k}-v`).textContent = fmt(S.fx[m][k]);
    shell.bindRange(`fx-${m}-${k}`, (v) => { S.fx[m][k] = v / scale; $(`fx-${m}-${k}-v`).textContent = fmt(S.fx[m][k]); fxChanged(); });
  });
  ['sat', 'trans', 'gran'].forEach((m) => $(`fx-${m}-on`).addEventListener('change', (e) => { S.fx[m].on = e.target.checked; fxChanged(); }));
  $('fx-sat-type').addEventListener('change', (e) => { S.fx.sat.type = e.target.value; fxChanged(); });
  fxChanged();

  /* ---------- saving: downloads take the desktop app's save dialogs' place ---------- */
  const download = (blob, name) => { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); $('save-status').textContent = `Saved ${name}.`; };
  const tag = () => `${{ ot: 'displace', mp: 'mphybrid', xfade: 'crossfade' }[S.method]}_AxB_t${Math.round(S.t * 100)}`;
  const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
  function describeSave() {
    const el = $('save-what'); if (!el) return;
    el.textContent = 'The blend saves as a 16-bit WAV at the current position, effects included. A sweep is one WAV that rides from A to B. The poster shows the spectrogram and the scope.';
  }
  async function saveBlend() {
    const r = await currentRender(); if (r) download(new Blob([E.encodeWav(r.data, r.rate)], { type: 'audio/wav' }), `${tag()}.wav`);
  }
  async function saveSweep() {
    if (!S.audA || !S.audB) return;
    const rate = S.audRate, name = `${tag().replace(/_t\d+$/, '')}_sweep_A_to_B.wav`;
    busy('Rendering the sweep');
    const r = await work({ type: 'audio', sweep: true, A: S.audA.slice(), B: S.audB.slice(), rate, t: 0, method: S.method, phasemode: S.phasemode, mpMix: S.mpMix, xlaw: S.xlaw, fx: S.fx });
    busy(null);
    if (!r.error) download(new Blob([E.encodeWav(r.data, rate)], { type: 'audio/wav' }), name);
    else shell.toast(`The sweep could not render: ${r.error}`);
  }
  async function savePoster() {
    const w = 1600, h = 900, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = '#101525'; g.fillRect(0, 0, w, h);
    [[COL.A, 0.18, 0.3], [COL.B, 0.82, 0.32], [COL.M, 0.5, 0.92]].forEach(([col, x, y]) => { const gr = g.createRadialGradient(w * x, h * y, 10, w * x, h * y, w * 0.42); gr.addColorStop(0, `${col}55`); gr.addColorStop(1, `${col}00`); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    g.fillStyle = '#eeedfb'; g.font = '64px ui-sans-serif, -apple-system, sans-serif'; g.fillText('Displacer', 70, 118);
    g.fillStyle = '#b6b9cf'; g.font = '24px ui-sans-serif, -apple-system, sans-serif';
    g.fillText(`Two sounds · ${METHOD_NAME[S.method]} · t = ${S.t.toFixed(2)} · A: ${S.names.A} · B: ${S.names.B}`, 72, 162);
    let inset = null;
    const r = await currentRender();
    if (r) { const cols = 640, rows = 256, sp = spectrogram(r.data, r.rate, cols, rows); inset = document.createElement('canvas'); inset.width = cols; inset.height = rows; inset.getContext('2d').putImageData(specImage(sp, cols, rows), 0, 0); }
    if (inset) { const k = Math.min(920 / inset.width, 560 / inset.height); g.drawImage(inset, 70, 210, inset.width * k, inset.height * k); }
    const sc = document.createElement('canvas'); sc.width = 1400; sc.height = 440; drawScope(sc, true); g.drawImage(sc, 1030, 230, 500, 157);
    g.fillStyle = '#b6b9cf'; g.font = '15px ui-sans-serif, -apple-system, sans-serif';
    g.fillText('The transport scope: A, B and the blend, with the map drawn.', 1030, 412);
    g.fillText('The 1D inverse-CDF map is the exact W2 displacement map. No model.', 72, h - 44);
    g.fillText('Displacer · Generative AV Labs · patrickiben.github.io/generative-av-labs', 72, h - 20);
    download(await toBlob(c), `displacer_poster_sounds_t${Math.round(S.t * 100)}.png`);
  }
  async function needCloud() {
    if (splat && spaceKey === wantKey()) return true;
    shell.toast('Building the cloud first.');
    await buildSpace();
    return !!splat;
  }
  function cloudPos(i, t) { const sp = splat; return [sp.A[i * 3] + t * sp.disp[i * 3], sp.A[i * 3 + 1] + t * sp.disp[i * 3 + 1], (sp.A[i * 3 + 2] + t * sp.disp[i * 3 + 2]) * S.space.depth]; }
  function cloudCol(i, t) { const sp = splat; return [0, 1, 2].map((k) => clamp(Math.round(sp.c0[i * 3 + k] + (sp.c1[i * 3 + k] - sp.c0[i * 3 + k]) * t), 0, 255)); }
  async function saveCloud() {
    if (!(await needCloud())) return;
    const n = splat.n, t = S.t, head = `ply\nformat binary_little_endian 1.0\ncomment Displacer point cloud, t=${t.toFixed(2)}, Gabor atoms: stated mappings, not a learned model\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + n * 15), dv = new DataView(buf); new Uint8Array(buf).set(hb);
    let o = hb.length;
    for (let i = 0; i < n; i++) { const p = cloudPos(i, t), col = cloudCol(i, t); for (let k = 0; k < 3; k++) { dv.setFloat32(o, p[k], true); o += 4; } for (let k = 0; k < 3; k++) dv.setUint8(o++, col[k]); }
    download(new Blob([buf], { type: 'application/octet-stream' }), `displacer_cloud_t${Math.round(t * 100)}.ply`);
  }
  async function saveSplats() {
    if (!(await needCloud())) return;
    const n = splat.n, t = S.t, SH = 0.28209479177387814, fields = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const head = `ply\nformat binary_little_endian 1.0\ncomment Displacer splat export, stated lift and sliced OT, t=${t.toFixed(2)}${splat.solo ? `, ${S.space.cloud} alone` : ', A to B'}: not a reconstructed scene\nelement vertex ${n}\n${fields.map((f) => `property float ${f}`).join('\n')}\nend_header\n`;
    const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + n * 17 * 4), dv = new DataView(buf); new Uint8Array(buf).set(hb);
    const logit = (x) => Math.log(x / (1 - x)), base = (splat.spacing || 0.012) * 1.2 * S.space.size;
    let o = hb.length;
    for (let i = 0; i < n; i++) {
      const p = cloudPos(i, t), col = cloudCol(i, t).map((v) => v / 255), sc = Math.log(base * splat.sz[i]);
      for (const v of [p[0], p[1], p[2], 0, 0, 0, (col[0] - 0.5) / SH, (col[1] - 0.5) / SH, (col[2] - 0.5) / SH, logit(0.88), sc, sc, sc, 1, 0, 0, 0]) { dv.setFloat32(o, v, true); o += 4; }
    }
    download(new Blob([buf], { type: 'application/octet-stream' }), `displacer_splats_${splat.solo ? `${S.space.cloud}_alone` : 'AtoB'}_t${Math.round(t * 100)}.ply`);
  }
  $('save-blend').addEventListener('click', saveBlend);
  $('save-sweep').addEventListener('click', saveSweep);
  $('save-poster').addEventListener('click', savePoster);
  $('save-cloud').addEventListener('click', saveCloud);
  $('save-splats').addEventListener('click', saveSplats);
  $('save-atoms').addEventListener('click', async () => {
    if (S.space.cloud !== 'ab') { S.space.cloud = 'ab'; syncCloud(); }
    if (!(await needCloud())) return;
    const d = atomMorph(S.t); if (d) download(new Blob([E.encodeWav(d, S.audRate)], { type: 'audio/wav' }), `displacer_atoms_t${Math.round(S.t * 100)}.wav`);
  });
  $('save-stage').addEventListener('click', () => { wantSnap = (blob) => download(blob, `displacer_stage_${S.view}_t${Math.round(S.t * 100)}.png`); });
  $('gp-wav').addEventListener('click', () => { if (!S.gp.best) { shell.toast('Grow a patch first.'); return; } const rate = S.audRate || 44100; download(new Blob([E.encodeWav(E.applyFX(E.synthFromPatch(S.gp.best, 2, rate, 0), rate), rate)], { type: 'audio/wav' }), `genopatch_${S.gp.source}.wav`); });
  $('gp-json').addEventListener('click', () => { if (!S.gp.best) { shell.toast('Grow a patch first.'); return; } download(new Blob([JSON.stringify({ v: 1, app: 'displacer-genopatch', source: S.gp.source, loss: S.gp.bestLoss, genome: Array.from(S.gp.best), params: E.gpParams(S.gp.best) }, null, 2)], { type: 'application/json' }), `genopatch_${S.gp.source}.patch.json`); });

  /* ---------- editable Displacer projects (.displacer.json) ---------- */
  function encodePcm16(f32) {
    if (!f32 || !f32.length) return '';
    const pcm = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = clamp(f32[i], -1, 1);
      pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    const bytes = new Uint8Array(pcm.buffer);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function decodePcm16(b64) {
    if (!b64) return null;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    return f32;
  }
  function serializeProject() {
    return {
      v: 1,
      app: 'displacer-project',
      view: S.view,
      t: S.t,
      method: S.method,
      phasemode: S.phasemode,
      xlaw: S.xlaw,
      mpMix: S.mpMix,
      scope: S.scope,
      fx: JSON.parse(JSON.stringify(S.fx)),
      space: { cloud: S.space.cloud, depth: S.space.depth, size: S.space.size, sway: S.space.sway, yaw: S.space.yaw, pitch: S.space.pitch, dist: S.space.dist },
      gp: {
        source: S.gp.source,
        effort: S.gp.effort,
        keys: S.gp.keys,
        best: S.gp.best ? Array.from(S.gp.best) : null,
        bestLoss: S.gp.bestLoss,
      },
      sources: {
        A: S.srcA ? { name: S.names.A, built: !!S.built.A, rate: S.srcA.rate, pcm16: encodePcm16(S.srcA.data) } : null,
        B: S.srcB ? { name: S.names.B, built: !!S.built.B, rate: S.srcB.rate, pcm16: encodePcm16(S.srcB.data) } : null,
      },
    };
  }
  async function applyProject(p) {
    if (!p || p.app !== 'displacer-project') throw new Error('not a Displacer project file');
    stopSweep();
    if (p.sources && p.sources.A && p.sources.A.pcm16 && p.sources.B && p.sources.B.pcm16) {
      sourceRequests.A++; sourceRequests.B++;
      S.srcA = { data: decodePcm16(p.sources.A.pcm16), rate: p.sources.A.rate || 22050 };
      S.srcB = { data: decodePcm16(p.sources.B.pcm16), rate: p.sources.B.rate || 22050 };
      S.names.A = p.sources.A.name || 'Sound A';
      S.names.B = p.sources.B.name || 'Sound B';
      S.built.A = !!p.sources.A.built;
      S.built.B = !!p.sources.B.built;
      E.prepAudio();
    }
    if (['ot', 'mp', 'xfade'].includes(p.method)) S.method = p.method;
    if (['dominant', 'pv'].includes(p.phasemode)) { S.phasemode = p.phasemode; $('phasemode').value = p.phasemode; }
    if (['ep', 'lin'].includes(p.xlaw)) { S.xlaw = p.xlaw; $('xlaw').value = p.xlaw; }
    if (typeof p.mpMix === 'number') { S.mpMix = clamp(p.mpMix, 0, 1); const mv = Math.round(S.mpMix * 100); $('mpmix').value = mv; $('mpmix-v').textContent = `${mv}%`; shell.syncRange($('mpmix')); }
    if (typeof p.scope === 'boolean') { S.scope = p.scope; $('scope-on').checked = p.scope; }
    if (p.fx) {
      ['sat', 'trans', 'gran'].forEach((m) => { if (p.fx[m]) Object.assign(S.fx[m], p.fx[m]); $(`fx-${m}-on`).checked = !!S.fx[m].on; });
      $('fx-sat-type').value = S.fx.sat.type || 'soft';
      FXK.forEach(([m, k, scale, fmt]) => { const r = $(`fx-${m}-${k}`); r.value = Math.round(S.fx[m][k] * scale); $(`fx-${m}-${k}-v`).textContent = fmt(S.fx[m][k]); shell.syncRange(r); });
      fxChanged();
    }
    if (p.space) {
      if (['ab', 'A', 'B'].includes(p.space.cloud)) S.space.cloud = p.space.cloud;
      if (typeof p.space.depth === 'number') { S.space.depth = p.space.depth; $('depth').value = Math.round(S.space.depth * 100); $('depth-v').textContent = S.space.depth.toFixed(2); shell.syncRange($('depth')); }
      if (typeof p.space.size === 'number') { S.space.size = p.space.size; $('size').value = Math.round(S.space.size * 100); $('size-v').textContent = `${Math.round(S.space.size * 100)}%`; shell.syncRange($('size')); }
      if (typeof p.space.sway === 'boolean') { S.space.sway = p.space.sway; $('sway').checked = p.space.sway; }
      if (typeof p.space.yaw === 'number') S.space.yaw = p.space.yaw;
      if (typeof p.space.pitch === 'number') S.space.pitch = p.space.pitch;
      if (typeof p.space.dist === 'number') S.space.dist = p.space.dist;
      syncCloud();
    }
    if (p.gp) {
      if (['blend', 'A', 'B'].includes(p.gp.source)) {
        S.gp.source = p.gp.source;
        document.querySelectorAll('#gp-src button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.s === S.gp.source)));
      }
      if (['fast', 'std', 'deep'].includes(p.gp.effort)) { S.gp.effort = p.gp.effort; $('gp-effort').value = p.gp.effort; }
      if (typeof p.gp.keys === 'boolean') { S.gp.keys = p.gp.keys; $('gp-keys').checked = p.gp.keys; }
      if (Array.isArray(p.gp.best) && p.gp.best.length >= 16) {
        S.gp.best = new Float64Array(p.gp.best.slice(0, 16));
        S.gp.bestLoss = typeof p.gp.bestLoss === 'number' ? p.gp.bestLoss : 0;
        const tg = await gpTarget();
        if (tg) {
          const target = E.specDescriptor(tg.data, tg.rate); S.gp.target = target;
          const bd = E.candSpec(S.gp.best, target); drawGP(target, bd);
          $('gp-match').textContent = `${Math.round(Math.max(0, E.specCorr(bd, target)) * 100)}%`;
        }
        $('gp-stat').textContent = 'loaded';
      } else {
        S.gp.best = null; S.gp.bestLoss = 0; drawGP(null); $('gp-match').textContent = '-'; $('gp-stat').textContent = 'idle';
      }
    }
    if (['flat', 'space'].includes(p.view)) setView(p.view);
    syncMethod();
    setT(typeof p.t === 'number' ? p.t : 0.5);
    S.lastRender = null; S.audDirty = true;
    sourcesChanged();
  }
  if ($('save-project')) $('save-project').addEventListener('click', () => {
    download(new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' }), `${tag()}.displacer.json`);
  });
  if ($('load-project')) $('load-project').addEventListener('click', () => $('project-file').click());
  if ($('project-file')) $('project-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      await applyProject(p);
      shell.toast(`Opened project ${f.name}.`);
    } catch (err) { shell.toast(`Could not open project: ${err.message}`); }
  });

  /* ---------- controls ---------- */
  shell.bindRange('t', (v) => { stopSweep(); setT(v / 1000); });
  shell.bindRange('t2', (v) => { stopSweep(); setT(v / 1000); });
  $('view-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  $('method-row').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b && !b.hidden) setMethod(b.dataset.m); });
  $('scope-on').checked = S.scope;
  $('scope-on').addEventListener('change', (e) => { S.scope = e.target.checked; scopeDirty = true; });
  $('phasemode').addEventListener('change', (e) => { S.phasemode = e.target.value; S.audDirty = true; scheduleRender(60); });
  $('xlaw').addEventListener('change', (e) => { S.xlaw = e.target.value; S.audDirty = true; scheduleRender(60); });
  shell.bindRange('mpmix', (v) => { S.mpMix = v / 100; $('mpmix-v').textContent = `${v}%`; S.audDirty = true; scheduleRender(400); });
  $('cloud-row').addEventListener('click', (e) => { const b = e.target.closest('[data-cloud]'); if (!b) return; S.space.cloud = b.dataset.cloud; syncCloud(); if (S.view !== 'space') setView('space'); });
  const bindPct = (id, get, set, fmt) => { const r = $(id); r.value = get(); $(`${id}-v`).textContent = fmt(+r.value); shell.bindRange(id, (v) => { set(v); $(`${id}-v`).textContent = fmt(v); }); };
  bindPct('depth', () => S.space.depth * 100, (v) => { S.space.depth = v / 100; }, (v) => (v / 100).toFixed(2));
  bindPct('size', () => S.space.size * 100, (v) => { S.space.size = v / 100; }, (v) => `${Math.round(v)}%`);
  $('sway').addEventListener('change', (e) => { S.space.sway = e.target.checked; });
  function stopSweep() {
    if (S.sweep) { S.sweep = false; $('sweep').checked = false; }
    if (S.bioAuto) { S.bioAuto = false; renderDispBio(); }
  }
  $('sweep').addEventListener('change', (e) => { if (e.target.checked) S.bioAuto = false; S.sweep = e.target.checked; S.sweepT = Math.acos(clamp(1 - 2 * S.t, -1, 1)) / (2 * Math.PI) * 24; renderDispBio(); });
  if ($('disp-bio-toggle')) $('disp-bio-toggle').addEventListener('click', () => {
    S.bioAuto = !S.bioAuto;
    if (S.bioAuto) {
      if (S.sweep) { S.sweep = false; $('sweep').checked = false; }
      if (eeg && eeg.state.phase === 'disconnected') S.bioDemo = true;
    }
    renderDispBio();
  });
  if ($('disp-bio-demo')) $('disp-bio-demo').addEventListener('click', () => {
    S.bioDemo = !S.bioDemo;
    if (S.bioDemo && !S.bioAuto) {
      S.bioAuto = true;
      if (S.sweep) { S.sweep = false; $('sweep').checked = false; }
    }
    renderDispBio();
  });
  document.querySelectorAll('[data-athena]').forEach((b) => b.addEventListener('click', () => {
    if (!eeg) return;
    eeg.setSensorMode(b.dataset.athena);
    if (!S.bioAuto) S.bioAuto = true;
    renderDispBio();
  }));
  function renderDispBio() {
    if (!eeg) return;
    const q = eeg.state, sm = q.sensorMode || 'eeg', sens = q.sensors || {};
    if ($('disp-bio-toggle')) {
      $('disp-bio-toggle').textContent = `Bio mod: ${S.bioAuto ? 'on' : 'off'}`;
      $('disp-bio-toggle').classList.toggle('on', S.bioAuto);
      $('disp-bio-toggle').setAttribute('aria-pressed', String(S.bioAuto));
    }
    if ($('disp-bio-demo')) {
      $('disp-bio-demo').textContent = `Synthetic preview: ${S.bioDemo ? 'on' : 'off'}`;
      $('disp-bio-demo').classList.toggle('on', S.bioDemo);
      $('disp-bio-demo').setAttribute('aria-pressed', String(S.bioDemo));
    }
    document.querySelectorAll('[data-athena]').forEach((b) => {
      const on = b.dataset.athena === sm;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if ($('disp-bio-status')) {
      const se = sens.eeg || {}, sf = sens.fnirs || {}, sp = sens.prv || {}, ss = sens.stillness || {};
      const parts = [
        `EEG ${se.score != null ? `${se.score}/100` : '-'}`,
        `fNIRS ${sf.od != null ? `${sf.od >= 0 ? '+' : ''}${sf.od.toFixed(3)} OD` : '-'}`,
        `PRV ${sp.rmssd != null ? `${Math.round(sp.rmssd)} ms` : '-'}`,
        `Stillness ${ss.score != null ? `${ss.score}/100` : '-'}`,
      ];
      $('disp-bio-status').textContent = S.bioAuto
        ? `${S.bioDemo ? 'Synthetic preview' : 'Muse S Athena'} · ${q.activeLabel || sm.toUpperCase()} driving t = ${S.t.toFixed(2)} · ${parts.join(' · ')}`
        : 'A real Muse S cannot connect to this page, so these modes run only as a labeled synthetic preview. The preview moves t by EEG balance, fNIRS optical, optical PRV, IMU stillness, or fusion.';
    }
  }
  $('swap').addEventListener('click', () => {
    [S.srcA, S.srcB] = [S.srcB, S.srcA]; if (S.srcA && S.srcB) E.prepAudio(); S.lastRender = null; S.audDirty = true;
    const n = S.names, b = S.built; [n.A, n.B] = [n.B, n.A]; [b.A, b.B] = [b.B, b.A];
    sourcesChanged();
  });
  function loadBuiltInPair(pair) {
    sourceRequests.A++; sourceRequests.B++;
    if (pair === 'cello-chimes') { setAudio('A', synthCello(), 'Bowed cello', true); setAudio('B', synthChimes(), 'Rain & chimes', true); }
    else if (pair === 'throat-harp') { setAudio('A', synthThroat(), 'Throat drone', true); setAudio('B', synthCrystalHarp(), 'FM crystal harp', true); }
    else if (pair === 'brass-glass') { setAudio('A', synthBrass(), 'Analog brass', true); setAudio('B', synthBowedGlass(), 'Bowed glass', true); }
    else if (pair === 'taiko-choir') { setAudio('A', synthTaiko(), 'Taiko pulse', true); setAudio('B', synthChoirCluster(), 'Choir cluster', true); }
    else { setAudio('A', synthVoice(), 'Sung ah', true); setAudio('B', synthBells(), 'Glass bells', true); }
  }
  if ($('builtin-pair')) $('builtin-pair').addEventListener('change', (e) => loadBuiltInPair(e.target.value));
  $('builtin-audio').addEventListener('click', () => loadBuiltInPair($('builtin-pair') ? $('builtin-pair').value : 'default'));
  ['A', 'B'].forEach((w) => {
    $(`file-${w}`).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; loadFile(f, w); });
    $(`slot-${w}`).addEventListener('click', () => $(`file-${w}`).click());
  });
  ['thumb-A', 'thumb-B', 'sheet-thumb-A', 'sheet-thumb-B'].forEach((id) => thumbRO.observe($(id)));
  document.querySelector('.src-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) $(`file-${b.dataset.pick}`).click(); });

  /* drop anywhere: the left half is A, the right half is B; two files fill both */
  const drop = $('drop');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; drop.hidden = false; });
  addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); const right = e.clientX > innerWidth / 2; drop.dataset.side = right ? 'B' : 'A'; });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; });
  addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; drop.hidden = true;
    const files = [...e.dataTransfer.files];
    if (files.length >= 2) await Promise.all([loadFile(files[0], 'A'), loadFile(files[1], 'B')]);
    else await loadFile(files[0], e.clientX > innerWidth / 2 ? 'B' : 'A');
  });

  /* drag to turn the cloud, scroll to move closer; hover in spectrogram view to read time, frequency and pitch */
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function hzToNote(hz) {
    const m = Math.round(69 + 12 * Math.log2(Math.max(20, hz) / 440));
    return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
  }
  cv.addEventListener('pointerdown', (e) => { if (S.view !== 'space') return; dragging = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); moved(); });
  cv.addEventListener('pointermove', (e) => {
    if (S.view === 'flat' && $('spec-cursor') && S.lastRender) {
      const g = $('spectrogram-guide');
      if (g && !g.hidden) {
        const r = g.getBoundingClientRect();
        const u = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
        const v = clamp(1 - (e.clientY - r.top) / Math.max(1, r.height), 0, 1);
        const dur = S.lastRender.data.length / (S.lastRender.rate || 22050);
        const hi = (S.lastRender.rate || 22050) / 2;
        const hz = 40 * Math.pow(hi / 40, v);
        const hzTxt = hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
        $('spec-cursor').textContent = `Cursor: ${(u * dur).toFixed(2)} s · ${hzTxt} (${hzToNote(hz)}) · brighter = stronger`;
      }
    }
    if (!dragging) return;
    S.space.yaw += (e.clientX - dragging.x) * 0.006; S.space.pitch = clamp(S.space.pitch + (e.clientY - dragging.y) * 0.004, -1.2, 1.2); dragging = { x: e.clientX, y: e.clientY };
  });
  cv.addEventListener('pointerleave', () => { if ($('spec-cursor')) $('spec-cursor').textContent = 'Time → · frequency ↑ · brighter = stronger'; });
  cv.addEventListener('pointerup', () => { dragging = null; });
  cv.addEventListener('pointercancel', () => { dragging = null; });
  cv.addEventListener('wheel', (e) => { if (S.view !== 'space') return; e.preventDefault(); S.space.dist = clamp(S.space.dist * Math.exp(e.deltaY * 0.0009), 1.4, 7); }, { passive: false });
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, moved, { once: true, passive: true }));

  /* performance mode: the desktop app's borderless full screen, as the browser's Fullscreen API */
  function setPerform(on) {
    S.perform = on; document.body.classList.toggle('performance', on); $('perform-button').textContent = on ? 'Leave' : 'Perform';
    if (on) {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => shell.toast('Full screen is not available here, so only the controls are hidden. Press Esc to bring them back.'));
      shell.toast('Performing. Esc leaves. The mod wheel and the arrow keys still move the blend.');
    } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    measureSafe();
  }
  $('perform-button').addEventListener('click', () => setPerform(!S.perform));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.perform) setPerform(false); setTimeout(measureSafe, 60); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.perform) setPerform(false); });

  /* MIDI as a controller: the mod wheel moves the blend, as the desktop app's MIDI bridge did; a keyboard can play a grown patch */
  kit.on('cc', ({ cc, value }) => { if (cc === 1) { stopSweep(); setT(value / 127, 'midi'); } });
  kit.on('hit', (h) => { if (S.gp.keys && S.gp.best && h.src === 'midi' && h.note != null) gpNote(clamp(h.note - 60, -24, 24), Math.max(0.35, Math.min(1, h.vel * 2))); });

  /* ---------- boot ---------- */
  if (!G || !(G.floatRT || G.gl.getExtension('EXT_color_buffer_half_float'))) {
    shell.glFail('This page needs WebGL2 with floating-point render targets, which this browser did not provide. The Blend and Save sheets still work.');
    const idle = (now) => { requestAnimationFrame(idle); kit.tick(now); shell.frame(now); };
    requestAnimationFrame(idle);
  } else {
    gl = G.gl;
    try {
      Post = createPost(G);
      pFlat = G.program(FLAT_FS); pPts = G.program(PTS_FS, PTS_VS);
      baseVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      tFlat = G.tex(2, 2, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
      gl.bindTexture(gl.TEXTURE_2D, tFlat); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      ptsVao = gl.createVertexArray(); ptsBuf = gl.createBuffer();
      gl.bindVertexArray(ptsVao); gl.bindBuffer(gl.ARRAY_BUFFER, ptsBuf);
      [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 3, 9], [4, 2, 12]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 56, off * 4); });
      gl.bindVertexArray(baseVao);
      resize();
      addEventListener('resize', resize);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); shell.glFail('The graphics context was lost. Reload the page to get the stage back.'); });
      requestAnimationFrame(render);
    } catch (e) {
      console.error(e);
      shell.glFail(`The stage could not start on this graphics card: ${String(e.message).slice(0, 140)}`);
    }
  }
  document.body.dataset.view = S.view;
  loadBuiltIn(); syncCloud();
  { const q = new URLSearchParams(location.search); if (['flat', 'space'].includes(q.get('view'))) setView(q.get('view')); }
  syncHear();

  // For the flicker check: the stage's brightness on a small grid, every frame, straight after it is drawn.
  let lumaRec = null;
  function recordLuma(ms) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d', { willReadFrequently: true }), frames = [], t0 = performance.now();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    return new Promise((res) => {
      lumaRec = (now) => {
        g.drawImage(cv, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data, grid = [];
        for (let i = 0; i < d.length; i += 4) grid.push(+(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]).toFixed(1));
        frames.push({ t: +(now - t0).toFixed(1), grid });
        if (now - t0 > ms) { lumaRec = null; res(frames); }
      };
    });
  }

  window.__app = {
    S, kit, E, recordLuma, setT, setView, setMethod, loadFile, buildSpace, serializeProject, applyProject, loadBuiltInPair,
    get spaceN() { return spaceN; }, get spaceReady() { return spaceKey === wantKey() && !spaceBusy; }, get flat() { return { w: flatW, h: flatH, spec: flatSpec, ready: flatReady }; },
    get busy() { return !$('busy').hidden; }, get safe() { return safe; }, get playing() { return playSrc ? playKind : ''; }, currentRender,
    get audition() { return { playing: !!playSrc, pending: auditionPending, t: playBlendT, key: playKey, position: playSrc && AC ? AC.currentTime - playStart : 0, duration: playDur }; },
    pixel() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d');
      return new Promise((res) => { wantSnap = (blob) => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let sum = 0, min = 1e9, max = 0; const grid = []; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; sum += l; min = Math.min(min, l); max = Math.max(max, l); grid.push(l); } res({ mean: sum / (d.length / 4), min, max, grid }); }; im.src = URL.createObjectURL(blob); }; });
    },
  };
})();
