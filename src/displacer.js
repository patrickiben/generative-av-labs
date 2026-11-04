/* displacer.js: two pictures or two sounds, blended by moving mass instead of mixing it.
   The engine is the desktop Displacer's (displacer-engine.js). This page adds the suite's stage: the blend drawn large,
   its splat cloud in 3D, the transport scope, and the kit as a controller. The desktop app's native parts become browser
   ones: Chrome decodes the sound (plus a small AIFF reader), saving is a download, and performance mode is full screen.
   Every link is a stated rule, and there is no model. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD } = GLKit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const RES = 560, MAX_FULL = 8192, SOUND_S = 6, CW = 0.0035;
  const TOUCH = navigator.maxTouchPoints > 1;

  const S = {
    mode: 'image', view: 'space', t: 0.5, method: 'ot', compare: false,
    cspace: 'ycocg', quality: 'dither', phasemode: 'dominant', xlaw: 'ep', mpMix: 0.55, spComp: 'sharp', spAdapt: true,
    imgA: null, imgB: null, srcA: null, srcB: null, audA: null, audB: null, audRate: 0, audDirty: true, lastRender: null,
    names: { image: { A: 'Dusk', B: 'Tide' }, audio: { A: 'Sung ah', B: 'Glass bells' } },
    built: { image: { A: true, B: true }, audio: { A: true, B: true } },
    ver: { image: 0, audio: 0 },
    fx: { sat: { on: false, drive: 0.4, type: 'soft', mix: 0.85 }, trans: { on: false, attack: 0.35, sustain: 0 }, gran: { on: false, density: 18, size: 80, pitch: 0, spray: 0.3, reverse: 0, mix: 0.7 } },
    gp: { source: 'blend', effort: 'std', best: null, bestLoss: 0, target: null, running: false, keys: false },
    space: { cloud: 'ab', look: 'soft', depth: 0.55, size: 1, sway: true, yaw: 0.32, pitch: 0.16, dist: 2.75, phase: 0, points: 'auto' },
    sweep: false, sweepT: 0, perform: false, scope: innerWidth >= 1100,
    tView: 0.5,   // what the stage shows: it follows t with a 0.15 s glide, so fast scrubbing cannot flash the screen
  };
  const E = DisplacerEngine.createEngine(S);
  const NO_HITS = { kick: 0, snare: 0, hat: 0, hatOpen: 0, tom: 0, tomPos: 0.5, crash: 0, ride: 0, flash: 0 };   // the cloud does not react to drums

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

  /* ---------- built-in sources: two painted scenes and two sung vowels ---------- */
  const HI = 3;   // the built-in scenes are painted at three times the working size
  function paintDusk() {
    const c = document.createElement('canvas'); c.width = 560 * HI; c.height = 360 * HI; const g = c.getContext('2d'); g.scale(HI, HI);
    const sky = g.createLinearGradient(0, 0, 0, 260);
    sky.addColorStop(0, '#120d2e'); sky.addColorStop(0.38, '#3b1d57'); sky.addColorStop(0.72, '#a3416a'); sky.addColorStop(1, '#ffa25e');
    g.fillStyle = sky; g.fillRect(0, 0, 560, 360);
    const r = E.mulberry32(11); g.fillStyle = '#fff4e0';
    for (let i = 0; i < 46; i++) { g.globalAlpha = 0.25 + r() * 0.6; g.fillRect(r() * 560, r() * 120, 1.4, 1.4); }
    g.globalAlpha = 1;
    const sun = g.createRadialGradient(190, 236, 4, 190, 236, 120);
    sun.addColorStop(0, 'rgba(255,236,190,1)'); sun.addColorStop(0.28, 'rgba(255,214,150,.75)'); sun.addColorStop(1, 'rgba(255,160,90,0)');
    g.fillStyle = sun; g.fillRect(40, 100, 300, 260);
    g.fillStyle = '#ffe9bf'; g.beginPath(); g.arc(190, 236, 30, 0, 7); g.fill();
    const hill = (col, base, amp, f, ph) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, 360); for (let x = 0; x <= 560; x += 8) g.lineTo(x, base - amp * (0.6 * Math.sin(x * f + ph) + 0.4 * Math.sin(x * f * 2.3 + ph * 1.7))); g.lineTo(560, 360); g.fill(); };
    hill('#4a2450', 262, 22, 0.011, 1.2); hill('#2a1536', 292, 26, 0.008, 3.1); hill('#140b20', 326, 18, 0.014, 0.4);
    return c;
  }
  function paintTide() {
    const c = document.createElement('canvas'); c.width = 560 * HI; c.height = 360 * HI; const g = c.getContext('2d'); g.scale(HI, HI);
    const sky = g.createLinearGradient(0, 0, 0, 230);
    sky.addColorStop(0, '#08203d'); sky.addColorStop(0.55, '#1d5f86'); sky.addColorStop(1, '#a6e6e2');
    g.fillStyle = sky; g.fillRect(0, 0, 560, 230);
    const halo = g.createRadialGradient(408, 92, 6, 408, 92, 110);
    halo.addColorStop(0, 'rgba(240,252,255,.95)'); halo.addColorStop(0.25, 'rgba(200,240,250,.35)'); halo.addColorStop(1, 'rgba(160,220,240,0)');
    g.fillStyle = halo; g.fillRect(290, 0, 240, 220);
    g.fillStyle = '#f2fbff'; g.beginPath(); g.arc(408, 92, 24, 0, 7); g.fill();
    g.fillStyle = '#0d3550'; g.beginPath(); g.moveTo(40, 230); g.quadraticCurveTo(110, 196, 190, 230); g.fill();
    const sea = g.createLinearGradient(0, 230, 0, 360); sea.addColorStop(0, '#2b7f9e'); sea.addColorStop(1, '#04192c');
    g.fillStyle = sea; g.fillRect(0, 230, 560, 130);
    const r = E.mulberry32(29);
    for (let i = 0; i < 70; i++) {
      const y = 236 + Math.pow(r(), 1.6) * 120, near = (y - 230) / 130, x = 408 + (r() - 0.5) * (40 + near * 220);
      g.globalAlpha = 0.35 + 0.5 * (1 - near); g.fillStyle = '#d9f6ff'; g.fillRect(x, y, 6 + r() * 26 * (0.4 + near), 1.6);
    }
    g.globalAlpha = 1;
    return c;
  }
  // Built-in sounds with some motion, so their spectra and atoms have shape: a sung "ah" on a slow tune, and glass bells.
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
      <div class="seg" id="view-seg" role="group" aria-label="View"><button data-view="flat" aria-pressed="false">Flat</button><button data-view="space" aria-pressed="true">Space</button></div>
      <button class="ab-thumb" id="slot-A" data-slot="A"><canvas id="thumb-A" width="176" height="110" aria-hidden="true"></canvas><span class="ab-tag">A</span></button>
      <div class="ab-mid">
        <div class="ab-read"><span class="ab-name" id="name-A">Dusk</span><b class="ab-t" id="t-val">0.50</b><span class="ab-name b" id="name-B">Tide</span></div>
        <input type="range" id="t" min="0" max="1000" value="500" aria-label="Blend position from A to B">
        <div class="ab-read sub"><span>A</span><span id="method-line">OT displacement</span><span>B</span></div>
      </div>
      <button class="ab-thumb b" id="slot-B" data-slot="B"><canvas id="thumb-B" width="176" height="110" aria-hidden="true"></canvas><span class="ab-tag">B</span></button>
      <button class="pill" id="hear" hidden>Hear</button>
    </div>`;

  const blendSheet = `
    <div class="src-grid">
      ${['A', 'B'].map((w) => `<div class="src-card" data-slot="${w}"><canvas id="sheet-thumb-${w}" width="168" height="104" aria-hidden="true"></canvas>
        <div class="src-info"><strong>${w} <span id="sheet-name-${w}"></span></strong><p class="why" id="sheet-info-${w}"></p></div>
        <button class="pill" data-pick="${w}">Choose ${w}</button></div>`).join('')}
    </div>
    <div class="row-actions"><button class="pill" id="swap">Swap A and B</button><button class="pill" id="builtin-image">Built-in pictures</button><button class="pill" id="builtin-audio">Built-in sounds</button></div>
    <p class="note">Two pictures or two sounds. Drop files anywhere on the page, or paste a picture. A sound uses its first six seconds. Files are decoded in this browser and never uploaded.</p>
    <div class="field"><span>Method</span><div class="row-actions" id="method-row" style="margin-top:4px">
      <button class="pill" data-m="ot">OT displacement</button><button class="pill" data-m="spatial" data-only="image">Spatial OT</button><button class="pill" data-m="mp" data-only="audio">MP hybrid</button><button class="pill" data-m="xfade">Crossfade</button></div></div>
    <p class="note" id="method-caption"></p>
    <label class="check" id="compare-row"><input type="checkbox" id="compare"> Split compare: this method beside a crossfade</label>
    <label class="field"><div class="row"><span>From A to B</span><b id="t2-val">0.50</b></div><input type="range" id="t2" min="0" max="1000" value="500"></label>
    <div class="sig-title"><span>Transport scope · the map, drawn</span><span id="scope-means"></span></div>
    <canvas class="sig-canvas" id="scope-big" width="1400" height="440" role="img" aria-label="Distributions of A, B and the blend, with the transport map"></canvas>
    <p class="note">Teal is A, pink is B, violet is the blend. Under transport the violet hump slides from A to B as you move the slider, and its mean slides in a straight line. Under crossfade it is two fixed humps trading height. The thin rays are the map itself.</p>
    <label class="check"><input type="checkbox" id="scope-on"> Show the scope on the stage</label>
    <details id="img-opts"><summary>Picture options</summary><div class="controls-grid">
      <label class="field">Color space<select id="cspace"><option value="ycocg">YCoCg, keeps hues apart</option><option value="rgb">Each RGB channel</option></select></label>
      <label class="field">OT quality<select id="quality"><option value="dither">Dithered map, fast</option><option value="sliced">Sliced OT over 3D color</option></select></label>
      <label class="field">Splat size<select id="spadapt"><option value="adaptive">Per point, from local contrast</option><option value="global">One size for all</option></select></label>
    </div></details>
    <details id="aud-opts"><summary>Sound options</summary><div class="controls-grid">
      <label class="field">Phase<select id="phasemode"><option value="dominant">Dominant source, crisp</option><option value="pv">Phase vocoder, smoother</option></select></label>
      <label class="field"><div class="row"><span>MP hybrid: skeleton to field</span><b id="mpmix-v">55%</b></div><input type="range" id="mpmix" min="0" max="100" value="55"></label>
      <label class="field">Crossfade law<select id="xlaw"><option value="ep">Equal power</option><option value="lin">Linear</option></select></label>
    </div></details>`;

  const spaceSheet = `
    <div class="field"><span>Cloud</span><div class="row-actions" id="cloud-row" style="margin-top:4px"><button class="pill on" data-cloud="ab">A to B</button><button class="pill" data-cloud="A">A alone</button><button class="pill" data-cloud="B">B alone</button></div></div>
    <p class="note" id="cloud-note"></p>
    <div class="field"><span>Look</span><div class="row-actions" id="look-row" style="margin-top:4px"><button class="pill on" data-look="soft">Soft splats</button><button class="pill" data-look="glow">Glow</button></div></div>
    <div class="controls-grid" style="padding:12px 0 6px">
      <label class="field"><div class="row"><span>Depth</span><b id="depth-v"></b></div><input type="range" id="depth" min="0" max="140" value="55"></label>
      <label class="field"><div class="row"><span>Splat size</span><b id="size-v"></b></div><input type="range" id="size" min="30" max="250" value="100"></label>
      <label class="field">Points<select id="points"><option value="auto">Automatic</option><option value="12000">About 12,000</option><option value="24000">About 24,000</option><option value="48000">About 48,000</option></select></label>
      <label class="check" style="margin:0"><input type="checkbox" id="sway" checked> Sway slowly</label>
      <label class="check" style="margin:0"><input type="checkbox" id="sweep"> Slow sweep from A to B and back, 24 seconds</label>
    </div>
    <div class="row-actions" id="atom-actions" hidden><button class="pill" id="atoms-play">Play the atoms</button></div>
    <p class="note">Drag the stage to turn the cloud and scroll to move closer. Depth is brightness for pictures and salience for sounds: stated rules, not a learned depth estimate. A controller's mod wheel (CC1) moves the slider.</p>`;

  const patchSheet = `
    <div class="row-actions" style="margin-top:0"><div class="seg small" id="gp-src" role="group" aria-label="What to fit"><button data-s="blend" aria-pressed="true">The blend</button><button data-s="A" aria-pressed="false">A</button><button data-s="B" aria-pressed="false">B</button></div>
      <select id="gp-effort" aria-label="Effort"><option value="fast">Fast</option><option value="std" selected>Standard</option><option value="deep">Deep</option></select>
      <button class="pill primary" id="gp-grow">Grow a patch</button></div>
    <div class="statgrid" style="margin-top:14px">
      <div class="stat"><span class="k">Match</span><span class="v" id="gp-match">-</span><span class="n">spectrum correlation</span></div>
      <div class="stat"><span class="k">Search</span><span class="v" id="gp-stat">idle</span><span class="n" id="gp-cores">-</span></div>
    </div>
    <canvas class="sig-canvas" id="gp-spec" width="1400" height="380" role="img" aria-label="Target spectrum, the grown patch's spectrum and the gap between them"></canvas>
    <div class="row-actions"><button class="pill" id="gp-play">Play</button><button class="pill" id="gp-ab">Target, then patch</button><button class="pill" id="gp-wav">Save its sound (.wav)</button><button class="pill" id="gp-json">Save the patch (.json)</button></div>
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
    <div class="row-actions"><button class="pill" id="save-cloud">Cloud (.ply)</button><button class="pill" id="save-splats">Splats (.ply)</button><button class="pill" id="save-atoms" hidden>Atoms (.wav)</button></div>
    <p class="note">Cloud .ply is plain points with color, read by TouchDesigner (Point File In), Blender and CloudCompare. Splats .ply is the 3D Gaussian splat format for SuperSplat or PlayCanvas. Both hold the cloud at the slider's position. macOS Preview shows them as flat squares.</p>
    <div class="row-actions"><button class="pill" id="save-stage">A picture of the stage</button><button class="pill" id="open-session">Record a drum session</button></div>
    <p class="note" id="save-status" role="status">Files are made here and handed to your browser's downloads. The blend holds the exact result; the stage adds glow.</p>`;

  const about = `
    <p class="sheet-intro">Displacer moves mass instead of mixing it. Each blend is a stated computation, and there is no model.</p>
    <table class="maptable"><tbody>
      <tr><th>OT displacement</th><td>Pictures: each color channel's histogram moves toward B's along the intensity axis, so A is recolored and keeps its shapes. Sounds: each frame's spectrum moves along frequency, with its energy kept.</td></tr>
      <tr><th>Spatial OT</th><td>Pixels move. Both pictures become clouds of position and color, matched by sliced optimal transport. Between the ends the picture is drawn from those moving points, about 50,000 of them, so it is softer than the originals; the ends show the pictures themselves.</td></tr>
      <tr><th>MP hybrid</th><td>The loudest partials, found by matching pursuit, keep their own clean phase and ride over the transported rest of the sound.</td></tr>
      <tr><th>Crossfade</th><td>The honest control. It adds the two, so both show or sound at once.</td></tr>
      <tr><th>Space</th><td>Pictures: x and y from the frame, depth from brightness. Sounds: Gabor atoms placed by time, log frequency and salience. Matched by sliced optimal transport over position and color.</td></tr>
      <tr><th>Patch</th><td>Differential evolution fits an FM voice with three formants to a spectrum.</td></tr>
    </tbody></table>
    <details><summary>What is exact, and what is approximate</summary>
      <p><b>Exact.</b> The 1D inverse-CDF map is the exact W2 optimal-transport map between 1D distributions (McCann's displacement interpolation): a theorem, not an approximation. For pictures it moves each channel's histogram, so the mean slides linearly from A to B. For sounds it moves each frame's magnitude spectrum along frequency, with energy conserved per frame. The crossfade is the naive control: it sums the two and moves nothing.</p>
      <p><b>Approximate.</b> OT displacement and its sliced variant recolor A and keep A's geometry. Spatial OT moves the sampled pixel cloud exactly, but the picture between the ends is drawn from those points as soft splats, and the match is geometric, not a semantic correspondence.</p>
      <p>Sound phase is rebuilt by a heuristic, because a transported magnitude has no exact phase, so attacks can smear near the middle. One 1D transport per channel or frame stands in for the full 2D Sinkhorn coupling, which is not run. Nothing here invents a new texture between A and B: expect clean migration, not a hybrid that a generative model would draw.</p>
      <p><b>Fixed from the desktop version.</b> Sound blends there divided by a nearly zero window at the first and last samples, which left them about 250 times too quiet with a click. The granular effect used an unseeded random source, so a saved sound did not repeat. Both are fixed here.</p>
    </details>
    <details><summary>The 1D map, in code</summary><pre class="monitor">// distributions p (from A) and q (from B) as normalized histograms, with CDFs F_p and F_q
// the exact W2 optimal map:  T(x) = Q_q(F_p(x)),  Q_q the inverse CDF of q
// displacement interpolation at blend t:
T_t(x) = (1 - t) * x + t * Q_q(F_p(x))
// pictures: x is a pixel's channel value (the axis is intensity)
// sounds: x is a frequency bin (the axis is frequency), moving magnitude</pre></details>
    <details><summary>A MIDI controller</summary>
      <p>The mod wheel (CC1) moves the slider from A to B, as it did in the desktop app. With a patch grown, a MIDI keyboard can play it, with middle C as its root. Nothing here listens to a microphone or a drum kit.</p>
    </details>
    <p class="note">Keys: <b>Left</b> and <b>Right</b> move the slider, with <b>Shift</b> for bigger steps · <b>V</b> flat or space · <b>C</b> connect a controller · <b>F</b> full screen · <b>H</b> hide controls. To move mass between a picture and a sound, use <a href="nebula.html">Nebula</a>'s Form mode.</p>`;

  const TRUTH = {
    image: 'Optimal transport with stated rules and no model. Your pictures stay in this browser, and saved files hold the exact blend.',
    audio: 'Optimal transport with stated rules and no model. Your sounds stay in this browser, and saved files hold the exact blend.',
  };
  const BADGE = {
    'image-ot': 'OT displacement · exact 1D map per color channel · recolors A, keeps its shapes',
    'image-ot-sliced': 'OT displacement, sliced · joint color transport, approximate · recolors A, keeps its shapes',
    'image-spatial': 'Spatial OT · about 50,000 points move along the transport map · the ends show the pictures themselves',
    'image-xfade': 'Crossfade · the naive control · adds both, moves nothing',
    'audio-ot': "OT displacement · exact transport of each frame's spectrum · phase is a heuristic",
    'audio-mp': 'MP hybrid · atoms keep their own phase · the rest is transported',
    'audio-xfade': 'Crossfade · the naive control · you hear both at once',
    'space-image': 'Splat space · depth from brightness, a stated rule, not learned · sliced OT over position and color',
    'space-solo': 'Relief · depth from brightness, a stated rule, not learned · the slider raises it from flat',
    'space-audio': 'Gabor atoms · time, log frequency, salience · a sparse decomposition, not the whole sound',
    'space-audio-solo': 'Gabor atoms of one sound · the slider raises salience from flat · not the whole sound',
  };
  const CAPTION = {
    'image-ot': "OT displacement moves A's color histogram toward B's along the intensity axis (McCann interpolation). It recolors A and keeps A's shapes, so it is a color and tone morph, not a warp. At 1.00 you see A wearing B's palette.",
    'image-spatial': "Spatial OT moves pixels. Both pictures become clouds of position and color, matched by sliced optimal transport, and the slider carries A's cloud into B's. The transport of the sampled cloud is exact; between the ends the picture is drawn from those points as soft splats, softer than the originals, which show at 0.00 and 1.00. The match is geometric, not a learned correspondence.",
    'image-xfade': 'Crossfade mixes the two pictures. At 0.50 both show at once, a double exposure. It is the naive control the transport methods are built to beat.',
    'audio-ot': "OT displacement moves each frame's spectral energy from A's frequencies to B's, an exact 1D transport of magnitude. A resonance slides along the axis instead of fading. Phase is rebuilt by a heuristic, the approximate part.",
    'audio-mp': 'MP hybrid splits each sound. The loudest partials, found by matching pursuit, keep their own clean phase so attacks survive, and ride over the transported rest of the sound. The mix sets skeleton against field.',
    'audio-xfade': 'Crossfade adds the two recordings. At 0.50 you hear both at once. It is the baseline.',
  };
  const METHOD_NAME = { ot: 'OT displacement', spatial: 'Spatial OT', mp: 'MP hybrid', xfade: 'Crossfade' };

  const kit = createKit();
  // Displacer never listens to a microphone. The shared reconnect setting can come from another page, so this page
  // reconnects MIDI alone, and opening audio input does nothing here.
  kit.connectAudio = async () => {};
  kit.tryReconnect = async () => { if (!kit.autoconnect.on) return; try { const m = await navigator.permissions.query({ name: 'midi' }); if (m.state === 'granted') kit.connectMidi(); } catch (e) { /* not available everywhere */ } };
  const brand = '<svg viewBox="0 0 24 28" aria-hidden="true"><circle cx="8.5" cy="14" r="5.5"/><circle cx="15.5" cy="14" r="5.5"/><path d="M8.5 14h7"/></svg>';
  const shell = mountShell({
    id: 'displacer', name: 'Displacer', brand, kit,
    modes: [{ id: 'image', label: 'Pictures' }, { id: 'audio', label: 'Sounds' }], mode: 'image', modeLabel: 'What you blend',
    onMode: (m) => setKind(m),
    intro: { eyebrow: 'Displacer · an optimal-transport blender', title: "Don't crossfade. Move the mass.", subtitle: 'Drag from A to B, or bring two pictures or two sounds of your own. Nothing is uploaded.' },
    hud, truth: TRUTH.image,
    sheets: [
      { id: 'blend', label: 'Blend', icon: 'sliders', title: 'Choose the two, and how.', html: blendSheet },
      { id: 'space', label: 'Space', icon: 'sliders', title: 'Shape the cloud.', intro: 'These change how the cloud looks. They never change the blend you save.', html: spaceSheet },
      { id: 'patch', label: 'Patch', icon: 'wave', title: 'Grow a voice.', intro: 'Fit a playable synth voice to the blend, to A or to B.', html: patchSheet },
      { id: 'save', label: 'Save', icon: 'play', title: 'Keep what you made.', html: saveSheet },
    ],
    about, canvas: () => cv, snapshot: (done) => { wantSnap = done; }, quality: () => (S.view === 'space' && spaceN ? `${spaceN.toLocaleString()} points` : `${S.mode === 'image' ? 'picture' : 'sound'} · ${METHOD_NAME[S.method]}`),
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
  // Displacer takes files and a controller, not a drum kit: the shell's drum demo, hit strip, kit wiring and session
  // recorder come off this page, and the connect sheet keeps MIDI alone, for the mod wheel and a keyboard.
  document.body.classList.add('no-kit');
  $('demo-sheet').closest('.device-card').classList.add('kit-only');
  $('demo-audible').closest('label').classList.add('kit-only');
  [...document.querySelectorAll('#about-sheet summary')].filter((x) => /From MIDI, from audio/.test(x.textContent)).forEach((x) => x.closest('details').classList.add('kit-only'));
  $('connect-title').textContent = 'Connect a controller.';
  document.querySelector('#connect-sheet .sheet-intro').textContent = "A MIDI controller's mod wheel (CC1) moves the blend from A to B. With a patch grown, a MIDI keyboard can play it. Pictures and sounds come from files.";
  addEventListener('keydown', (e) => {     // the shell's drum keys and drum demo key do nothing here
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea, dialog[open]'))) return;
    if (e.key.length === 1 && 'jkluiop;d'.includes(e.key.toLowerCase())) e.stopImmediatePropagation();
  }, true);
  // redraw a thumbnail whenever it gets a new size, however its sheet was opened, so it is always as sharp as the screen
  const thumbRO = new ResizeObserver(() => { cancelAnimationFrame(thumbRO.f); thumbRO.f = requestAnimationFrame(drawThumbs); });
  $('patch-sheet').classList.add('wide');
  const sceneEl = $('scene');
  document.querySelector('.mode-switch').insertAdjacentHTML('afterend', `
    <div id="method-badge" class="chrome" data-kind="space-image"><span id="method-badge-text"></span></div>
    <div id="busy" class="chrome" role="status" hidden></div>`);
  sceneEl.insertAdjacentHTML('beforeend', `
    <div id="scope-card" class="chrome" hidden><canvas id="scope" width="560" height="300" role="img" aria-label="Transport scope"></canvas>
      <div class="scope-key"><span class="ka">A</span><span class="kb">B</span><span class="km">blend</span><span id="scope-mini"></span></div></div>
    <div id="flat-labels" aria-hidden="true"></div>
    <div id="drop" hidden><div data-slot="A"><b>A</b>Drop to replace A</div><div data-slot="B"><b>B</b>Drop to replace B</div></div>`);
  $('fs-button').insertAdjacentHTML('beforebegin', '<button class="top-action" id="perform-button" title="Full screen with only the stage. Esc leaves.">Perform</button>');
  document.body.insertAdjacentHTML('beforeend', '<input type="file" id="file-A" accept="image/*,audio/*,.aif,.aiff,.aifc" hidden><input type="file" id="file-B" accept="image/*,audio/*,.aif,.aiff,.aifc" hidden>');

  /* ---------- sources ---------- */
  function setImage(which, img, name, built) {
    const w = img.width, h = img.height, sc = Math.min(1, RES / Math.max(w, h)), ww = Math.max(2, Math.round(w * sc)), hh = Math.max(2, Math.round(h * sc));
    const cvw = document.createElement('canvas'); cvw.width = ww; cvw.height = hh;
    const ctx = cvw.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, ww, hh);
    const fs = Math.min(1, MAX_FULL / Math.max(w, h)), fw = Math.round(w * fs), fh = Math.round(h * fs);
    const full = document.createElement('canvas'); full.width = fw; full.height = fh; full.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, fw, fh);
    const rec = { cv: cvw, ctx, w: ww, h: hh, full, fw, fh, dataA: ctx.getImageData(0, 0, ww, hh) };
    if (which === 'A') S.imgA = rec; else S.imgB = rec;
    S.names.image[which] = name; S.built.image[which] = built;
    if (S.imgA && S.imgB) E.cacheImageDists();
    sourcesChanged('image');
  }
  function setAudio(which, obj, name, built) {
    if (which === 'A') S.srcA = obj; else S.srcB = obj;
    S.names.audio[which] = name; S.built.audio[which] = built;
    if (S.srcA && S.srcB) E.prepAudio();
    S.lastRender = null; S.audDirty = true;
    sourcesChanged('audio');
  }
  function loadBuiltIn(kind) {
    if (kind === 'image') { setImage('A', paintDusk(), 'Dusk', true); setImage('B', paintTide(), 'Tide', true); }
    else { setAudio('A', synthVoice(), 'Sung ah', true); setAudio('B', synthBells(), 'Glass bells', true); }
  }
  let distCache = { key: '', hA: null, hB: null };
  function sourcesChanged(kind) {
    S.ver[kind]++;
    distCache.key = '';
    if (kind === S.mode) { flatDirty = true; scopeDirty = true; spaceKey = ''; if (kind === 'audio') scheduleRender(30); }
    if (kind === 'image' && S.gp) { /* a patch stays until a new one is grown */ }
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
    const kind = isImageFile(f) ? 'image' : isSoundFile(f) ? 'audio' : null;
    if (!kind) { shell.toast(`${f.name} is not a picture or a sound.`); return; }
    if (!which) which = S.built[kind].A ? 'A' : 'B';
    if (S.mode !== kind) shell.setMode(kind);
    busy(`Reading ${f.name}`);
    try {
      if (kind === 'image') {
        let bmp;
        try { bmp = await createImageBitmap(f); } catch (e) { throw new Error(/tiff?|heic$/i.test(f.name) ? 'Chrome cannot read TIFF or HEIC. Save it as PNG or JPEG' : 'this browser could not read it as a picture'); }
        setImage(which, bmp, f.name, false);
      } else setAudio(which, await decodeSound(f), f.name, false);
      shell.toast(`${which}: ${f.name}`);
    } catch (err) { shell.toast(`${f.name} was not loaded: ${err.message}.`, 5200); }
    busy(null);
  }

  /* thumbnails: the picture, cropped to fill, or the waveform */
  function drawThumb(canvas, which) {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 3);   // a backing store as sharp as the screen
    if (r.width > 0 && r.height > 0) { const bw = Math.round(r.width * dpr), bh = Math.round(r.height * dpr); if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; } }
    else if (canvas.id.startsWith('sheet-') && canvas.width < 720) { canvas.width = 720; canvas.height = 446; }   // still hidden: sharp enough for any screen until it is measured
    const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    if (S.mode === 'image') {
      const rec = which === 'A' ? S.imgA : S.imgB; if (!rec) return;
      const k = Math.max(w / rec.w, h / rec.h), dw = rec.w * k, dh = rec.h * k;
      g.drawImage(rec.cv, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const obj = which === 'A' ? S.srcA : S.srcB; if (!obj) return;
      g.putImageData(specImage(spectrogram(obj.data, obj.rate, w, h), w, h), 0, 0);
    }
  }
  function drawThumbs() {
    ['A', 'B'].forEach((w) => {
      drawThumb($(`thumb-${w}`), w); drawThumb($(`sheet-thumb-${w}`), w);
      const nm = S.names[S.mode][w], built = S.built[S.mode][w];
      $(`name-${w}`).textContent = nm; $(`sheet-name-${w}`).textContent = built ? `${nm} · built in` : nm;
      $(`slot-${w}`).setAttribute('aria-label', `Source ${w}: ${nm}${built ? ', built in' : ''}. Choose a file`);
      $(`slot-${w}`).classList.toggle('built', built);
      let info = '';
      if (S.mode === 'image') { const r = w === 'A' ? S.imgA : S.imgB; if (r) info = `${r.fw} × ${r.fh} px, worked at ${r.w} × ${r.h}`; }
      else { const o = w === 'A' ? S.srcA : S.srcB; if (o) info = `${(o.data.length / o.rate).toFixed(1)} s at ${(o.rate / 1000).toFixed(1)} kHz, mono`; }
      $(`sheet-info-${w}`).textContent = info;
    });
  }

  /* ---------- state changes ---------- */
  let flatDirty = true, scopeDirty = true, spaceKey = '', spaceN = 0, spaceBusy = '', renderTimer = 0, renderSeq = 0;
  function setKind(kind) {
    S.mode = kind;
    document.body.dataset.kind = kind;
    if (kind === 'image' && (!S.imgA || !S.imgB)) loadBuiltIn('image');
    if (kind === 'audio' && (!S.srcA || !S.srcB)) loadBuiltIn('audio');
    if (kind === 'image' && S.method === 'mp') S.method = 'ot';
    if (kind === 'audio' && S.method === 'spatial') S.method = 'ot';
    stopAudio();
    $('hear').hidden = kind !== 'audio';
    $('patch-button').hidden = kind !== 'audio';
    $('save-atoms').hidden = kind !== 'audio';
    $('atom-actions').hidden = kind !== 'audio';
    $('compare-row').hidden = kind !== 'image';
    $('img-opts').hidden = kind !== 'image'; $('aud-opts').hidden = kind !== 'audio';
    $('truth').textContent = TRUTH[kind];
    flatDirty = true; scopeDirty = true; spaceKey = '';
    if (kind === 'audio') scheduleRender(30);
    syncMethod(); drawThumbs(); syncCloud(); kit.noteLane('kind', kind);
  }
  function setT(v, src) {
    S.t = clamp(v, 0, 1);
    const r = $('t'), r2 = $('t2'), val = Math.round(S.t * 1000);
    if (+r.value !== val) { r.value = val; shell.syncRange(r); }
    if (+r2.value !== val) { r2.value = val; shell.syncRange(r2); }
    $('t-val').textContent = S.t.toFixed(2); $('t2-val').textContent = S.t.toFixed(2); syncHear();
    flatDirty = true; scopeDirty = true;
    if (S.mode === 'audio') { S.audDirty = true; if (src !== 'sweep' || !playSrc) scheduleRender(src === 'sweep' ? 900 : 260); }
    if (src !== 'sweep') moved();
  }
  function setMethod(m) {
    S.method = m; flatDirty = true; scopeDirty = true;
    if (S.mode === 'audio') { S.audDirty = true; scheduleRender(30); }
    syncMethod();
  }
  function badgeKind() {
    if (S.view === 'space') return S.mode === 'image' ? (S.space.cloud === 'ab' ? 'space-image' : 'space-solo') : (S.space.cloud === 'ab' ? 'space-audio' : 'space-audio-solo');
    if (S.mode === 'image' && S.method === 'ot' && S.quality === 'sliced') return 'image-ot-sliced';
    return `${S.mode}-${S.method}`;
  }
  function syncMethod() {
    document.querySelectorAll('#method-row [data-m]').forEach((b) => { b.hidden = !!b.dataset.only && b.dataset.only !== S.mode; b.classList.toggle('on', b.dataset.m === S.method); b.setAttribute('aria-pressed', String(b.dataset.m === S.method)); });
    $('method-caption').textContent = CAPTION[`${S.mode}-${S.method}`] || '';
    $('method-line').textContent = S.view === 'space' ? (S.mode === 'image' ? 'Splat space · sliced OT' : 'Gabor atoms · sliced OT') : METHOD_NAME[S.method] + (S.compare && S.mode === 'image' ? ' · beside a crossfade' : '');
    const k = badgeKind(); $('method-badge').dataset.kind = k; $('method-badge-text').textContent = BADGE[k];
    describeSave();
  }
  function setView(v) {
    S.view = v;
    document.querySelectorAll('#view-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    document.body.dataset.view = v;
    flatDirty = true; syncMethod(); moved();
    if (G && Post) resize();
  }
  function moved() { if (!document.body.classList.contains('moved')) document.body.classList.add('moved'); }
  setTimeout(moved, 9000);
  function busy(msg) { const b = $('busy'); if (msg) { b.textContent = msg; b.hidden = false; } else b.hidden = true; }

  /* ---------- the flat view: the blend itself, computed by the engine ---------- */
  const SP_STEP = 2;   // Spatial OT samples every second pixel of the working copy: about 50,000 points
  let flatW = 0, flatH = 0, flatSpec = false, flatMean = [0.05, 0.05, 0.08], flatBusy = false;
  async function ensureSlicedMap() {
    if (S._slMap || flatBusy) return false;
    flatBusy = true; const v = S.ver.image;
    const c = E.slicedClouds(); busy(`Matching ${c.n.toLocaleString()} colors`);
    const { X, Y } = E.packClouds(c.A, c.B, c.n);
    const r = await work({ type: 'ot', X, Y, n: c.n }, [X.buffer, Y.buffer]);
    flatBusy = false; busy(null);
    if (r.error) { shell.toast(`The sliced map failed: ${r.error}`); return false; }
    if (v === S.ver.image) { E.slicedAssemble(c.A, r.X, c.n); flatDirty = true; scopeDirty = true; }
    return true;
  }
  async function ensureSpatialMap() {
    if (S._spMap || flatBusy) return false;
    flatBusy = true; const v = S.ver.image;
    const c = E.spatialClouds(SP_STEP); busy(`Matching ${c.n.toLocaleString()} points for Spatial OT`);
    const { X, Y } = E.packClouds(c.A, c.B, c.n);
    const r = await work({ type: 'ot', X, Y, n: c.n }, [X.buffer, Y.buffer]);
    flatBusy = false; busy(null);
    if (r.error) { shell.toast(`Spatial OT failed: ${r.error}`); return false; }
    if (v === S.ver.image) { E.spatialAssemble(c.A, c.B, r.X, c.n); flatDirty = true; }
    return true;
  }
  function mapsReady(method) {
    if (method === 'spatial' && !S._spMap) { ensureSpatialMap(); return false; }
    if (method === 'ot' && S.quality === 'sliced' && !S._slMap) { ensureSlicedMap(); return false; }
    return true;
  }
  const labels = $('flat-labels');
  /* The engine's maps come from the 560-pixel working copy, as in the desktop app; here they are applied to every pixel of
     the full-size pictures on the graphics card. OT displacement looks up the same per-value maps the engine builds.
     Spatial OT warps both full-size pictures toward each other along the transport field, smoothed over neighboring
     samples, and blends them, so 0.00 shows A exactly and 1.00 shows B. */
  const GPU_MAX = 4096;
  const gpu = { srcKey: '', qKey: '', slKey: '', spKey: '', spN: 0, acc: null, texA: null, texB: null, texQ: null, texSL: null, aW: 0, aH: 0, rt: null, meanA: [0.05, 0.05, 0.08], meanB: [0.05, 0.05, 0.08] };
  const cloudScale = (rec) => { const ar = rec.w / rec.h; return [Math.min(1.2, ar), Math.max(0.83, ar)]; };
  function srcTexture(old, rec) {
    const k = Math.min(1, GPU_MAX / Math.max(rec.fw, rec.fh)), w = Math.max(1, Math.round(rec.fw * k)), h = Math.max(1, Math.round(rec.fh * k));
    let src = rec.full;
    if (k < 1) { src = document.createElement('canvas'); src.width = w; src.height = h; const g = src.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(rec.full, 0, 0, w, h); }
    if (old) gl.deleteTexture(old);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    return { t, w, h };
  }
  function meanOf(rec) { const d = rec.dataA.data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 32) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return [r, g, b].map((v) => Math.pow(v / n / 255, 2.2)); }
  function ensureGpuSources() {
    const key = `${S.ver.image}`;
    if (gpu.srcKey === key) return;
    const a = srcTexture(gpu.texA, S.imgA), b = srcTexture(gpu.texB, S.imgB);
    gpu.texA = a.t; gpu.texB = b.t; gpu.aW = a.w; gpu.aH = a.h;
    gpu.meanA = meanOf(S.imgA); gpu.meanB = meanOf(S.imgB);
    gpu.srcKey = key;
  }
  // OT displacement's per-value maps, made exactly as the engine's buildLUT makes them: lut(v) = (1 - t) v + t q(v)
  function ensureQ() {
    const key = `${S.ver.image}|${S.cspace}|${S.quality}`;
    if (gpu.qKey === key) return;
    const ca = [0, 1, 2].map((k) => E.chanCDF(S._ta, k, 4, S._ta.length / 4)), cb = [0, 1, 2].map((k) => E.chanCDF(S._tb, k, 4, S._tb.length / 4));
    const r = E.mulberry32(20260625), dith = S.quality === 'dither', Q = new Float32Array(256 * 4);
    for (let k = 0; k < 3; k++) for (let v = 0; v < 256; v++) { let pp; if (dith) { const lo = v > 0 ? ca[k][v - 1] : 0; pp = lo + r() * (ca[k][v] - lo); } else pp = ca[k][v]; Q[v * 4 + k] = E.invCDF256(cb[k], pp); }
    if (!gpu.texQ) gpu.texQ = G.tex(256, 1, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }, { nearest: true, data: Q });
    else { gl.bindTexture(gl.TEXTURE_2D, gpu.texQ); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, Q); }
    gpu.qKey = key;
  }
  function ensureSL() {
    const key = `${S.ver.image}`;
    if (gpu.slKey === key || !S._slMap) return;
    const N = S._slMap.G, acc = S._slMap.acc, data = new Float32Array(N * N * N * 4);
    for (let ci = 0; ci < N * N * N; ci++) { data[ci * 4] = acc[ci * 3]; data[ci * 4 + 1] = acc[ci * 3 + 1]; data[ci * 4 + 2] = acc[ci * 3 + 2]; }
    if (gpu.texSL) gl.deleteTexture(gpu.texSL);
    gpu.texSL = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, gpu.texSL);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, N, N, N, 0, gl.RGBA, gl.FLOAT, data);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((q) => gl.texParameteri(gl.TEXTURE_3D, q, gl.NEAREST));
    gpu.slKey = key;
  }
  // Spatial OT between the ends: the matched points themselves, each carried along its transport path and drawn as a
  // soft splat at the size of the target, then normalized. The ends show the pictures themselves.
  function ensureSpatialPoints() {
    const key = `${S.ver.image}`;
    if (gpu.spKey === key || !S._spMap) return;
    const m = S._spMap, n = m.n, F = new Float32Array(n * 10);
    for (let i = 0; i < n; i++) {
      const o = i * 10;
      F[o] = m.x0[i]; F[o + 1] = m.y0[i]; F[o + 2] = m.dx[i]; F[o + 3] = m.dy[i];
      for (let k = 0; k < 3; k++) { F[o + 4 + k] = m.c0[i * 3 + k]; F[o + 7 + k] = m.c1[i * 3 + k]; }
    }
    gl.bindVertexArray(spVao); gl.bindBuffer(gl.ARRAY_BUFFER, spBuf); gl.bufferData(gl.ARRAY_BUFFER, F, gl.STATIC_DRAW); gl.bindVertexArray(baseVao);
    gpu.spN = n; gpu.spKey = key;
  }
  function ensureAcc(w, h) {
    if (gpu.acc && gpu.acc.w === w && gpu.acc.h === h) return gpu.acc;
    if (gpu.acc) G.freeTarget(gpu.acc);
    gpu.acc = G.target(w, h);
    return gpu.acc;
  }
  function drawSpatial(fbo, vp, t) {
    const w = vp[2], h = vp[3], A = ensureAcc(w, h);
    G.into(A); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(spVao);
    G.use(pSpf, { uT: t, uPt: Math.min(64, Math.max(2, 2.6 * SP_STEP * (w / S.imgA.w))), uSA: cloudScale(S.imgA) });
    gl.drawArrays(gl.POINTS, 0, gpu.spN);
    gl.bindVertexArray(baseVao); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    G.bindTex(0, A.tex); G.bindTex(1, gpu.texA); G.bindTex(2, gpu.texB);
    G.use(pSpr, { uAcc: 0, uA: 1, uB: 2, uT: t, uSA: cloudScale(S.imgA), uSB: cloudScale(S.imgB) });
    G.draw();
  }
  function ensureRT(w, h) {
    if (gpu.rt && gpu.rt.w === w && gpu.rt.h === h) return gpu.rt;
    if (gpu.rt) G.freeTarget(gpu.rt);
    gpu.rt = G.target(w, h, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    gl.bindTexture(gl.TEXTURE_2D, gpu.rt.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    return gpu.rt;
  }
  const methodId = (m) => (m === 'xfade' ? 3 : m === 'spatial' ? 2 : S.quality === 'sliced' ? 1 : 0);
  function prepare(method) { ensureGpuSources(); ensureQ(); if (method === 'spatial') ensureSpatialPoints(); if (method === 'ot' && S.quality === 'sliced') ensureSL(); }
  function drawBlend(fbo, vp, method, t) {
    if (method === 'spatial') { drawSpatial(fbo, vp, t); return; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(vp[0], vp[1], vp[2], vp[3]); gl.disable(gl.BLEND);
    G.bindTex(0, gpu.texA); G.bindTex(1, gpu.texB); G.bindTex(2, gpu.texQ);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_3D, gpu.texSL || dummy3D);
    G.use(pBlend, { uA: 0, uB: 1, uQ: 2, uSL: 5, uMethod: methodId(method), uT: t, uYcocg: S.cspace === 'ycocg' ? 1 : 0, uSA: cloudScale(S.imgA), uSB: cloudScale(S.imgB) });
    G.draw();
  }
  // draws the blend for the stage at the size the stage shows it, never larger than the source
  function renderFlatImage(pw, ph) {
    if (!S.imgA || !S.imgB || !G) return false;
    const main = S.method, left = main === 'xfade' ? 'ot' : main;
    if (!mapsReady(main) || (S.compare && !mapsReady(left))) return false;
    prepare(main); if (S.compare) prepare(left);
    gpu.lastPh = ph;
    const ar = gpu.aW / gpu.aH, hh = Math.max(16, Math.min(ph, gpu.aH)), P = Math.max(16, Math.round(hh * ar)), gap = S.compare ? Math.round(P * 0.03) : 0, ww = S.compare ? 2 * P + gap : P;
    if (!flatDirty && gpu.rt && gpu.rt.w === ww && gpu.rt.h === hh) return true;
    const rt = ensureRT(ww, hh), t = S.tView;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); gl.viewport(0, 0, ww, hh); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (S.compare) {
      drawBlend(rt.fbo, [0, 0, P, hh], left, t); drawBlend(rt.fbo, [P + gap, 0, P, hh], 'xfade', t);
      labels.innerHTML = `<span>${METHOD_NAME[left]} · mass moves</span><span>Crossfade · both at once</span>`;
    } else { drawBlend(rt.fbo, [0, 0, P, hh], main, t); labels.innerHTML = ''; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    G.bindTex(0, rt.tex); gl.generateMipmap(gl.TEXTURE_2D);
    flatMean = gpu.meanA.map((v, k) => v + (gpu.meanB[k] - v) * t);
    flatDirty = false; flatReady = 'image';
    return true;
  }
  // the blend at any size, read back for saving: rows come out top first, as ImageData wants them
  function blendPixels(method, t, w, h) {
    prepare(method);
    const T = G.target(w, h, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    drawBlend(T.fbo, [0, 0, w, h], method, t);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); G.freeTarget(T);
    return new ImageData(new Uint8ClampedArray(px.buffer), w, h);
  }
  const imageCanvas = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').putImageData(im, 0, 0); return c; };
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
    flatW = cols; flatH = rows; flatSpec = true; labels.innerHTML = '';
    uploadFlat(sp, true);
    flatMean = [0.03, 0.025, 0.07];
  }
  function scheduleRender(ms) { clearTimeout(renderTimer); renderTimer = setTimeout(renderAudioNow, ms); }
  async function renderAudioNow() {
    if (!S.audA || !S.audB) return null;
    const id = ++renderSeq, t = S.t, method = S.method;
    busy('Rendering the blend');
    const r = await work({ type: 'audio', A: S.audA.slice(), B: S.audB.slice(), rate: S.audRate, t, method, phasemode: S.phasemode, mpMix: S.mpMix, xlaw: S.xlaw, fx: S.fx });
    if (id !== renderSeq) return null;
    busy(null);
    if (r.error) { shell.toast(`The blend could not render: ${r.error}`); return null; }
    S.lastRender = { data: r.data, rate: S.audRate, t, method }; S.audDirty = false;
    if (S.mode === 'audio') showSpectrogram(S.lastRender);
    return S.lastRender;
  }
  async function currentRender() {
    const L = S.lastRender;
    if (L && !S.audDirty && L.t === S.t && L.method === S.method) return L;
    clearTimeout(renderTimer);
    return renderAudioNow();
  }

  /* ---------- the transport scope ---------- */
  const COL = { A: '#86e0d3', B: '#f3a6c8', M: '#b8b7ff' };
  function scopeData() {
    const key = `${S.mode}|${S.ver[S.mode]}`;
    if (distCache.key !== key) {
      if (S.mode === 'image') { if (!S.imgA || !S.imgB) return null; distCache = { key, hA: E.distFromImage(S.imgA), hB: E.distFromImage(S.imgB) }; }
      else { if (!S.audA || !S.audB) return null; distCache = { key, hA: E.distFromAudio(S.audA), hB: E.distFromAudio(S.audB) }; }
    }
    const { hA, hB } = distCache, t = S.t;
    let hM;
    if (S.method === 'xfade') { hM = new Float64Array(256); for (let v = 0; v < 256; v++) hM[v] = (1 - t) * hA[v] + t * hB[v]; }
    else hM = E.pushforward(hA, E.cdf256(hA), E.cdf256(hB), t);
    return { hA, hB, hM };
  }
  function axisLabel(v) {
    if (S.mode === 'image') return String(Math.round(v));
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
    if (big) { c.fillStyle = 'rgba(238,237,251,.7)'; c.font = '22px ui-sans-serif, -apple-system, sans-serif'; c.fillText(S.mode === 'image' ? 'intensity →' : 'frequency →', 8, h - 6); }
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

  /* ---------- the space view: splat clouds, lifted and matched ---------- */
  let splat = null;     // CPU copy for exports and atoms: { A, disp, c0, c1, sz, n, atoms }
  const pointsWanted = () => (S.space.points === 'auto' ? (TOUCH ? 12000 : 24000) : +S.space.points);
  const wantKey = () => `${S.mode}|${S.space.cloud}|${S.ver[S.mode]}|${pointsWanted()}|${S.spAdapt}`;
  async function buildSpace() {
    const key = wantKey();
    if (spaceBusy === key) return;
    spaceBusy = key;
    try {
      let n, A3, D3, C0, C1, SZ, atoms = null;
      if (S.mode === 'image') {
        if (!S.imgA || !S.imgB) return;
        if (S.space.cloud === 'ab') {
          const N = pointsWanted(), A = E.liftSplats(S.imgA, N), B = E.liftSplats(S.imgB, N);
          n = Math.min(A.length, B.length); A.length = n; B.length = n;
          busy(`Matching ${n.toLocaleString()} splats`);
          const { X, Y } = E.packClouds(A, B, n);
          const r = await work({ type: 'ot', X, Y, n }, [X.buffer, Y.buffer]);
          if (r.error) throw new Error(r.error);
          ({ A3, D3, C0, C1, SZ } = alloc(n));
          for (let i = 0; i < n; i++) {
            SZ[i] = ((A[i].sz || 1) + (B[i].sz || 1)) / 2;
            for (let k = 0; k < 3; k++) { A3[i * 3 + k] = A[i].p[k]; D3[i * 3 + k] = r.X[i * 6 + k] - A[i].p[k]; C0[i * 3 + k] = A[i].c[k]; C1[i * 3 + k] = clamp(r.X[i * 6 + 3 + k] / CW, 0, 255); }
          }
        } else {
          const rec = S.space.cloud === 'A' ? S.imgA : S.imgB, pts = E.liftSplats(rec, Math.round(pointsWanted() * 1.5));
          n = pts.length; ({ A3, D3, C0, C1, SZ } = alloc(n));
          for (let i = 0; i < n; i++) {
            SZ[i] = pts[i].sz || 1; A3[i * 3] = pts[i].p[0]; A3[i * 3 + 1] = pts[i].p[1]; D3[i * 3 + 2] = pts[i].p[2] * 1.6;
            for (let k = 0; k < 3; k++) { C0[i * 3 + k] = pts[i].c[k]; C1[i * 3 + k] = pts[i].c[k]; }
          }
        }
      } else {
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
      }
      if (spaceBusy !== key || key !== wantKey()) return;
      splat = { A: A3, disp: D3, c0: C0, c1: C1, sz: SZ, n, atoms, kind: S.mode, solo: S.space.cloud !== 'ab' };
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
    document.querySelectorAll('#look-row [data-look]').forEach((b) => { b.classList.toggle('on', b.dataset.look === S.space.look); b.setAttribute('aria-pressed', String(b.dataset.look === S.space.look)); });
    const solo = S.space.cloud !== 'ab';
    $('cloud-note').textContent = S.mode === 'image'
      ? (solo ? `${S.space.cloud} alone: the slider raises ${S.space.cloud}'s relief from a flat print to full depth.` : "Both pictures lift into 3D clouds and are matched by sliced optimal transport over position and color. The slider carries A's splats along their transport paths into B's cloud.")
      : (solo ? `${S.space.cloud} alone: the slider raises each atom by its salience.` : "Each sound is split into about 340 Gabor atoms, short sine bursts placed by time, log frequency and salience. The slider carries A's atoms into B's, and Play the atoms rebuilds a sound from them alone.");
    syncMethod();
  }

  /* ---------- WebGL ---------- */
  const cv = $('stage');
  const G = createGL(cv);
  let pBlend, pSpf, pSpr, dummy3D, spVao, spBuf;
  let gl, Post, pFlat, pPts, pResolve, scene, acc, tFlat, ptsVao, ptsBuf, baseVao, rw = 0, rh = 0, wantSnap = null, safe = { top: 0.12, bottom: 0.68 };
  const BACK = `
uniform vec2 uRes; uniform vec3 uMean; uniform vec2 uCenter; uniform float uKick;
vec3 backdrop(vec2 uv){
  vec3 c=mix(vec3(.010,.012,.030),vec3(.004,.005,.013),uv.y);
  float d=length((uv-uCenter)*vec2(uRes.x/uRes.y,1.));
  return c+uMean*(.09+.05*uKick)*exp(-d*d*1.8);
}
vec3 invAces(vec3 y){ y=clamp(y,0.,.94); vec3 a=2.43*y-2.51,b=.59*y-.03,c=.14*y; return (-b-sqrt(max(b*b-4.*a*c,vec3(0.))))/(2.*a); }`;
  const FLAT_FS = FS_HEAD + BACK + `
uniform sampler2D uImg; uniform vec4 uRect; uniform float uHas,uSpec,uPlay,uLod;
// the color law for sound: low is warm, high is cool, in the suite's own colors
vec3 law(float y){ vec3 a=vec3(1.,.70,.48),b=vec3(.95,.65,.78),c=vec3(.72,.72,1.),d=vec3(.53,.88,.83); return y<.33?mix(a,b,y/.33):y<.66?mix(b,c,(y-.33)/.33):mix(c,d,(y-.66)/.34); }
void main(){
  vec3 col=backdrop(vUv);
  if(uHas>.5){
    vec2 p=(vUv-uRect.xy)/(uRect.zw-uRect.xy), cp=clamp(p,0.,1.);
    if(p==cp){
      if(uSpec>.5){
        float m=textureLod(uImg,p,uLod).r, a=pow(m,1.8);
        col=col*(1.-.6*a)+pow(law(p.y),vec3(2.2))*a*.95+vec3(.9,.88,1.)*pow(m,7.)*.22;
        if(uPlay>=0.){ float dx=(p.x-uPlay)*(uRect.z-uRect.x)*uRes.x; col+=vec3(.85,.85,1.)*.45*exp(-dx*dx*.35); }
      } else {
        vec4 s=textureLod(uImg,vec2(p.x,1.-p.y),uLod);
        col=mix(col,invAces(pow(s.rgb,vec3(2.2))),s.a);
      }
    } else {
      float dd=length((p-cp)*(uRect.zw-uRect.xy)*uRes)/uRes.y;
      vec3 e=uSpec>.5?vec3(.05,.045,.12)*textureLod(uImg,cp,5.).r:pow(textureLod(uImg,vec2(cp.x,1.-cp.y),5.).rgb,vec3(2.2));
      col+=e*.3*exp(-dd*26.);
    }
  }
  o=vec4(col,1.);
}`;
  const PTS_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA; layout(location=1) in vec3 aD; layout(location=2) in vec3 aC0; layout(location=3) in vec3 aC1; layout(location=4) in vec2 aS;
uniform mat4 uVP; uniform float uT,uDepth,uBase,uPx,uTime,uGlow,uReact,uKick,uSnare,uHat,uHatOpen,uTom,uTomPos,uCrash,uRide,uDist,uFlipY;
out vec3 vC; out float vW;
void main(){
  vec3 p=aA+uT*aD;
  vec3 w=vec3(p.x,p.y*uFlipY,p.z*uDepth);
  float ph=aS.y*6.2831, band=clamp(.5-w.y*.75,0.,1.);
  w.xy+=vec2(sin(uTime*.7+ph*1.7),cos(uTime*.9+ph*2.3))*(.002+uReact*uSnare*.026);
  vec4 c=uVP*vec4(w,1.);
  gl_Position=c;
  float boost=1.+uReact*(.2*uKick+.55*uKick*step(.55,band)+.45*uTom*max(0.,1.-abs((1.-band)-uTomPos)*2.4));
  gl_PointSize=clamp(uBase*aS.x*uPx/c.w*boost*(uGlow>.5?2.3:1.),1.5,160.);
  vec3 col=pow(clamp(mix(aC0,aC1,uT)/255.,0.,1.),vec3(2.2));
  float lift=1.+uReact*(.22*uCrash+.2*uRide*(.5+.5*sin(uTime*16.+ph*.7)));
  if(band<.42) lift*=1.+uReact*uHat*(.4+.4*uHatOpen)*(.4+.8*abs(sin(ph*7.31+uTime*21.)));
  vC=col*lift;
  vW=exp(-(c.w-uDist)*6.);
}`;
  const PTS_FS = `#version 300 es
precision highp float;
in vec3 vC; in float vW; out vec4 o; uniform float uGlow,uI;
void main(){
  vec2 q=gl_PointCoord*2.-1.; float r2=dot(q,q); if(r2>1.)discard;
  if(uGlow>.5){ float g=exp(-r2*5.)+.3*exp(-r2*1.3); o=vec4(vC*g*uI,1.); }
  else { float g=exp(-r2*3.); float w=g*g*vW; o=vec4(vC*w,w); }
}`;
  // One pass draws the blend, for the stage and for saved files alike. v = 0 is the picture's top row.
  const BLEND_FS = FS_HEAD + `precision highp sampler3D;
uniform sampler2D uA,uB,uQ; uniform sampler3D uSL;
uniform int uMethod; uniform float uT,uYcocg;
vec3 toS(vec3 c){ if(uYcocg<.5) return c; float co=c.r-c.b, tmp=c.b+floor(co*.5), cg=c.g-tmp, y=tmp+floor(cg*.5); return clamp(vec3(y,cg+128.,co+128.),0.,255.); }
vec3 fromS(vec3 d){ if(uYcocg<.5) return d; float y=d.x, cg=d.y-128., co=d.z-128., tmp=y-floor(cg*.5), g=cg+tmp, b=tmp-floor(co*.5), r=b+co; return clamp(vec3(r,g,b),0.,255.); }
void main(){
  vec2 uv=vUv;
  vec3 a=floor(texture(uA,uv).rgb*255.+.5);
  if(uMethod==3){ o=vec4(mix(a,floor(texture(uB,uv).rgb*255.+.5),uT)/255.,1.); return; }
  if(uMethod==1){ ivec3 ci=ivec3(min(vec3(15.),floor(a/16.))); vec3 d=texelFetch(uSL,ivec3(ci.b,ci.g,ci.r),0).rgb; o=vec4(floor(clamp(a+uT*d,0.,255.)+.5)/255.,1.); return; }
  vec3 s=toS(a); ivec3 si=ivec3(s);
  vec3 q=vec3(texelFetch(uQ,ivec2(si.r,0),0).r,texelFetch(uQ,ivec2(si.g,0),0).g,texelFetch(uQ,ivec2(si.b,0),0).b);
  o=vec4(fromS(floor(clamp((1.-uT)*s+uT*q,0.,255.)+.5))/255.,1.);
}`;
  const SPF_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aP; layout(location=1) in vec3 aC0; layout(location=2) in vec3 aC1;
uniform float uT,uPt; uniform vec2 uSA;
out vec3 vC;
void main(){
  vec2 c=aP.xy+uT*aP.zw, uv=vec2(c.x/(2.*uSA.x)+.5,c.y*uSA.y*.5+.5);
  gl_Position=vec4(uv*2.-1.,0.,1.); gl_PointSize=uPt; vC=mix(aC0,aC1,uT)/255.;
}`;
  const SPF_FS = `#version 300 es
precision highp float;
in vec3 vC; out vec4 o;
void main(){ vec2 q=gl_PointCoord*2.-1.; float r2=dot(q,q); if(r2>1.)discard; float w=exp(-r2*3.5); o=vec4(vC*w,w); }`;
  const SPR_FS = FS_HEAD + `
uniform sampler2D uAcc,uA,uB; uniform float uT; uniform vec2 uSA,uSB;
void main(){
  vec4 a=texture(uAcc,vUv); vec3 col=a.rgb/max(a.a,1e-4); float al=smoothstep(.02,.3,a.a);
  vec2 c=vec2((vUv.x-.5)*2.*uSA.x,(vUv.y-.5)*2./uSA.y), ub=vec2(c.x/(2.*uSB.x)+.5,c.y*uSB.y*.5+.5);
  float wa=1.-smoothstep(0.,.12,uT), wb=smoothstep(.88,1.,uT);
  col=mix(col,texture(uA,vUv).rgb,wa); al=mix(al,1.,wa);
  col=mix(col,texture(uB,ub).rgb,wb); al=mix(al,1.,wb);
  o=vec4(col,al);
}`;
  const RESOLVE_FS = FS_HEAD + BACK + `
uniform sampler2D uAcc;
void main(){ vec4 a=texture(uAcc,vUv); vec3 bg=backdrop(vUv); vec3 c=a.rgb/max(a.a,1e-4); o=vec4(mix(bg,invAces(c),smoothstep(.02,.24,a.a)),1.); }`;

  function uploadFlat(src, spec) {
    if (!G) return;
    gl.bindTexture(gl.TEXTURE_2D, tFlat);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (spec) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, flatW, flatH, 0, gl.RED, gl.UNSIGNED_BYTE, src);
    else if (src instanceof ImageData) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    flatSpec = !!spec;
    flatReady = S.mode;
  }
  let flatReady = '';
  function uploadSpace(sp) {
    if (!G) return;
    const n = sp.n, F = new Float32Array(n * 14), r = E.mulberry32(4242);
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      for (let k = 0; k < 3; k++) { F[o + k] = sp.A[i * 3 + k]; F[o + 3 + k] = sp.disp[i * 3 + k]; F[o + 6 + k] = sp.c0[i * 3 + k]; F[o + 9 + k] = sp.c1[i * 3 + k]; }
      F[o + 12] = S.spAdapt ? sp.sz[i] : 1; F[o + 13] = r();
    }
    gl.bindVertexArray(ptsVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ptsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, F, gl.STATIC_DRAW);
    gl.bindVertexArray(baseVao);
    spaceN = n;
    // the gap between neighbors, so the splats just cover the picture at size 1
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { const x = sp.A[i * 3], y = sp.A[i * 3 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    sp.spacing = Math.sqrt(Math.max(1e-4, (x1 - x0) * (y1 - y0)) / n);
    let ex = 0.2, ey = 0.2;   // how far the cloud reaches, at either end of the slider, so the camera can frame it
    for (let i = 0; i < n; i++) for (const t of [0, 1]) { ex = Math.max(ex, Math.abs(sp.A[i * 3] + t * sp.disp[i * 3])); ey = Math.max(ey, Math.abs(sp.A[i * 3 + 1] + t * sp.disp[i * 3 + 1])); }
    sp.ex = ex; sp.ey = ey;
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < n; i += 7) { mr += sp.c0[i * 3] + sp.c1[i * 3]; mg += sp.c0[i * 3 + 1] + sp.c1[i * 3 + 1]; mb += sp.c0[i * 3 + 2] + sp.c1[i * 3 + 2]; }
    const cnt = Math.ceil(n / 7) * 2 * 255;
    sp.mean = [mr, mg, mb].map((v) => Math.pow(v / cnt, 2.2) * (sp.kind === 'audio' ? 0.3 : 1));
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
    [scene, acc].forEach((T) => T && G.freeTarget(T));
    scene = G.target(rw, rh); acc = G.target(rw, rh);
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
      const dt = dtMs / 1000, env = NO_HITS, react = 0;
      frameIdx++;
      if (frameIdx % 30 === 0) measureSafe();
      if (S.sweep) { S.sweepT += dt; setT(0.5 - 0.5 * Math.cos((S.sweepT / 24) * Math.PI * 2), 'sweep'); }
      if (S.tView !== S.t) { const d = S.t - S.tView; S.tView = Math.abs(d) < 1e-4 ? S.t : S.tView + d * (1 - Math.exp(-dt / 0.15)); if (S.mode === 'image') flatDirty = true; }
      if (S.view === 'space' && spaceKey !== wantKey()) buildSpace();
      if (S.view === 'flat' && S.mode === 'audio' && flatReady !== 'audio' && S.lastRender) showSpectrogram(S.lastRender);
      if (scopeDirty || $('blend-sheet').open) { scopeDirty = false; drawScopes(); }
      if (S.space.sway && !dragging && !RM.matches) S.space.phase += dt * 0.11;
      const sway = RM.matches ? 0 : Math.sin(S.space.phase) * 0.5;

      const W = rw, H = rh, asp = W / H, sh = safe.bottom - safe.top, dy = 1 - (safe.top + safe.bottom);
      const imgFlat = S.view === 'flat' && S.mode === 'image' && !!(S.imgA && S.imgB);
      if (imgFlat) { const ar = S.imgA.fw / S.imgA.fh; flatW = 1000 * (S.compare ? 2.03 * ar : ar); flatH = 1000; flatSpec = false; }
      let showFlat = S.view === 'flat' && (imgFlat || flatReady === S.mode);
      const showSpace = S.view === 'space' && spaceN > 0 && splat && splat.kind === S.mode;
      const center = [0.5, 1 - (safe.top + safe.bottom) / 2]; let rect = [0, 0, 0, 0];
      if (showFlat) {
        const side = $('scope-card').hidden ? 0.05 : Math.min(0.3, 318 / Math.max(1, innerWidth)), aw = (1 - 2 * side) * W, ah = 0.94 * sh * H, k = Math.min(aw / flatW, ah / (flatSpec ? flatW / 1.9 : flatH)), pw = flatW * k, ph = (flatSpec ? flatW / 1.9 : flatH) * k;
        const cx = 0.5, cy = center[1];
        rect = [cx - pw / W / 2, cy - ph / H / 2, cx + pw / W / 2, cy + ph / H / 2];
        if (imgFlat) showFlat = renderFlatImage(Math.round(pw), Math.round(ph)) || flatReady === 'image';
        if (labels.childElementCount) { labels.style.left = `${rect[0] * 100}%`; labels.style.width = `${(rect[2] - rect[0]) * 100}%`; labels.style.top = `${(1 - rect[3]) * 100}%`; }
      }
      labels.hidden = !(showFlat && S.compare && S.mode === 'image');
      const mean = showSpace ? splat.mean : flatMean;
      const back = { uRes: [W, H], uMean: mean, uCenter: center, uKick: env.kick * react };

      gl.disable(gl.BLEND);
      if (!showSpace) {
        const pic = S.mode === 'image' && gpu.rt;
        G.into(scene); G.bindTex(0, pic ? gpu.rt.tex : tFlat);
        let play = -1;
        if (playSrc && AC && playKind === 'blend') play = clamp((AC.currentTime - playStart) / playDur, 0, 1);
        G.use(pFlat, { ...back, uImg: 0, uRect: rect, uHas: showFlat ? 1 : 0, uSpec: flatSpec ? 1 : 0, uPlay: play, uLod: showFlat ? Math.max(0, Math.log2((pic ? gpu.rt.h : flatH) / Math.max(1, (rect[3] - rect[1]) * H))) : 0 });
        G.draw();
      } else {
        const yaw = S.space.yaw + sway, pitch = S.space.pitch, dist = S.space.dist;
        const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
        const th = Math.tan(0.425), fit = Math.min((0.8 * asp * 2.75 * th) / splat.ex, (0.86 * sh * 2.75 * th) / splat.ey);   // framed at the default distance, so zooming still zooms
        const T = [fit, 0, 0, 0, 0, fit, 0, 0, 0, 0, 1, 0, 0, dy, 0, 1];
        const fov = 0.85, VP = mul(T, mul(perspective(fov, asp, 0.05, 40), lookAt(eye, [0, 0, 0], [0, 1, 0])));
        const glow = S.space.look === 'glow' || splat.kind === 'audio';
        const audio = splat.kind === 'audio';
        const base = (audio ? 0.042 : splat.spacing * 2.4) * S.space.size;
        const uPx = (1 / Math.tan(fov / 2)) * (H / 2) * fit;
        const u = {
          uVP: VP, uT: S.tView, uDepth: S.space.depth, uBase: base, uPx, uTime: now / 1000, uGlow: glow ? 1 : 0, uReact: react,
          uKick: env.kick, uSnare: env.snare, uHat: env.hat, uHatOpen: env.hatOpen, uTom: env.tom, uTomPos: env.tomPos, uCrash: env.crash, uRide: env.ride,
          uDist: dist, uFlipY: audio ? 1 : -1, uI: audio ? 0.42 : Math.min(0.5, 2.2 / Math.sqrt(spaceN)) * 3.2,
        };
        gl.bindVertexArray(ptsVao);
        if (glow) {
          gl.bindVertexArray(baseVao); G.into(scene); G.use(pFlat, { ...back, uHas: 0, uSpec: 0, uPlay: -1 }); G.draw();
          gl.bindVertexArray(ptsVao);
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
          G.use(pPts, u); gl.drawArrays(gl.POINTS, 0, spaceN);
        } else {
          G.into(acc); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
          G.use(pPts, u); gl.drawArrays(gl.POINTS, 0, spaceN);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(baseVao);
          G.into(scene); G.bindTex(0, acc.tex); G.use(pResolve, { ...back, uAcc: 0 }); G.draw();
        }
        gl.disable(gl.BLEND);
        gl.bindVertexArray(baseVao);
      }
      const bloom = Post.bloom(scene.tex, showSpace ? 0.75 : 0.85);
      Post.finish(scene.tex, bloom, {
        uBloomK: showSpace ? (0.3 + env.kick * 0.05 * react + env.crash * 0.1 * react) : 0.08, uExposure: 1,
        uFlash: RM.matches ? 0 : Math.min(0.06, env.flash * 0.06 * react), uFlashC: [1, 0.95, 0.88], uGrain: showSpace ? 0.012 : 0.004, uT: now / 1000, uVig: showSpace ? 0.38 : 0.14, uSat: 1, rate: RM.matches ? 0.16 : 0.36,
      }, dtMs / 1000);
      if (lumaRec) lumaRec(now);
      if (wantSnap) { const done = wantSnap; wantSnap = null; cv.toBlob((blob) => done(blob), 'image/png'); }
    } catch (e) {
      if (fails++ < 3) console.error(e);
    }
  }

  /* ---------- sound: hearing the blend, the atoms and the patch ---------- */
  let AC = null, playSrc = null, playStart = 0, playDur = 1, playKind = '';
  const ensureAC = () => { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; };
  function playBuffer(data, rate, kind) {
    ensureAC(); stopAudio();
    const buf = AC.createBuffer(1, data.length, rate); buf.getChannelData(0).set(data);
    const src = AC.createBufferSource(); src.buffer = buf; src.connect(AC.destination); src.start();
    playSrc = src; playStart = AC.currentTime; playDur = data.length / rate; playKind = kind;
    src.onended = () => { if (playSrc === src) { playSrc = null; syncHear(); } };
    syncHear();
  }
  function stopAudio() { if (playSrc) { try { playSrc.stop(); } catch (e) { /* ended */ } playSrc = null; } syncHear(); }
  function syncHear() { $('hear').textContent = playSrc && playKind === 'blend' ? 'Stop' : `Hear ${S.t.toFixed(2)}`; $('hear').classList.toggle('on', !!(playSrc && playKind === 'blend')); }
  $('hear').addEventListener('click', async () => {
    if (playSrc && playKind === 'blend') { stopAudio(); return; }
    ensureAC();
    const r = await currentRender(); if (!r) return;
    playBuffer(r.data, r.rate, 'blend');
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
    const r = await work({ type: 'audio', A: S.audA.slice(), B: S.audB.slice(), rate: S.audRate, t: S.t, method: 'ot', phasemode: S.phasemode, mpMix: S.mpMix, xlaw: S.xlaw, fx: NOFX });
    return r.error ? null : { data: r.data, rate: S.audRate };
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
    S.gp.running = true; $('gp-grow').textContent = 'Growing'; $('gp-grow').disabled = true; $('gp-stat').textContent = 'starting';
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
      $('gp-match').textContent = `${Math.round(Math.max(0, E.specCorr(bd, target)) * 100)}%`; $('gp-stat').textContent = 'grown';
      shell.toast('Patch grown. Play it from your computer keys, the keyboard below or a MIDI keyboard.');
    } catch (err) { $('gp-stat').textContent = 'failed'; shell.toast(`The patch could not grow: ${err.message}`); }
    S.gp.running = false; $('gp-grow').textContent = 'Grow a patch'; $('gp-grow').disabled = false;
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
  function fxChanged() { S.audDirty = true; if (S.mode === 'audio') scheduleRender(300); ['sat', 'trans', 'gran'].forEach((m) => $(`fx-${m}`).classList.toggle('off', !S.fx[m].on)); }
  FXK.forEach(([m, k, scale, fmt]) => {
    const r = $(`fx-${m}-${k}`); r.value = Math.round(S.fx[m][k] * scale); $(`fx-${m}-${k}-v`).textContent = fmt(S.fx[m][k]);
    shell.bindRange(`fx-${m}-${k}`, (v) => { S.fx[m][k] = v / scale; $(`fx-${m}-${k}-v`).textContent = fmt(S.fx[m][k]); fxChanged(); });
  });
  ['sat', 'trans', 'gran'].forEach((m) => $(`fx-${m}-on`).addEventListener('change', (e) => { S.fx[m].on = e.target.checked; fxChanged(); }));
  $('fx-sat-type').addEventListener('change', (e) => { S.fx.sat.type = e.target.value; fxChanged(); });
  fxChanged();

  /* ---------- saving: downloads take the desktop app's save dialogs' place ---------- */
  const download = (blob, name) => { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); $('save-status').textContent = `Saved ${name}.`; };
  const tag = () => `${{ ot: 'displace', spatial: 'spatial', mp: 'mphybrid', xfade: 'crossfade' }[S.method]}_AxB_t${Math.round(S.t * 100)}`;
  const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
  function describeSave() {
    const el = $('save-what'); if (!el) return;
    el.textContent = S.mode === 'image'
      ? `The blend saves as a PNG at A's own size${S.imgA ? `, ${Math.min(S.imgA.fw, Math.round(S.imgA.fw * 4096 / Math.max(S.imgA.fw, S.imgA.fh)))} × ${Math.min(S.imgA.fh, Math.round(S.imgA.fh * 4096 / Math.max(S.imgA.fw, S.imgA.fh)))}` : ''}, up to 4,096 pixels on the long side. A sweep is a strip of seven steps. The poster adds the scope.`
      : 'The blend saves as a 16-bit WAV at the current position, effects included. A sweep is one WAV that rides from A to B. The poster shows the spectrogram and the scope.';
  }
  async function saveBlend() {
    if (S.mode === 'audio') { const r = await currentRender(); if (r) download(new Blob([E.encodeWav(r.data, r.rate)], { type: 'audio/wav' }), `${tag()}.wav`); return; }
    if (!S.imgA || !S.imgB || !G) return;
    if (!mapsReady(S.method)) { shell.toast('Matching first. Save again in a moment.'); return; }
    prepare(S.method);
    download(await toBlob(imageCanvas(blendPixels(S.method, S.t, gpu.aW, gpu.aH))), `${tag()}.png`);
  }
  async function saveSweep() {
    if (S.mode === 'audio') {
      if (!S.audA || !S.audB) return;
      busy('Rendering the sweep');
      const r = await work({ type: 'audio', sweep: true, A: S.audA.slice(), B: S.audB.slice(), rate: S.audRate, t: 0, method: S.method, phasemode: S.phasemode, mpMix: S.mpMix, xlaw: S.xlaw, fx: S.fx });
      busy(null);
      if (!r.error) download(new Blob([E.encodeWav(r.data, S.audRate)], { type: 'audio/wav' }), `${tag().replace(/_t\d+$/, '')}_sweep_A_to_B.wav`);
      return;
    }
    if (!mapsReady(S.method)) { shell.toast('Matching first. Save again in a moment.'); return; }
    prepare(S.method);
    const K = 7, th = Math.min(400, gpu.aH), tile = Math.round(th * (gpu.aW / gpu.aH)), c = document.createElement('canvas');
    c.width = K * (tile + 6) + 6; c.height = th + 40; const g = c.getContext('2d');
    g.fillStyle = '#101525'; g.fillRect(0, 0, c.width, c.height);
    g.font = '15px ui-sans-serif, -apple-system, sans-serif'; g.fillStyle = '#b6b9cf';
    for (let k = 0; k < K; k++) {
      const tt = k / (K - 1);
      g.drawImage(imageCanvas(blendPixels(S.method, tt, tile, th)), 6 + k * (tile + 6), 6, tile, th); g.fillText(`t = ${tt.toFixed(2)}`, 10 + k * (tile + 6), th + 30);
    }
    download(await toBlob(c), `${tag().replace(/_t\d+$/, '')}_strip.png`);
  }
  async function savePoster() {
    const w = 1600, h = 900, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = '#101525'; g.fillRect(0, 0, w, h);
    [[COL.A, 0.18, 0.3], [COL.B, 0.82, 0.32], [COL.M, 0.5, 0.92]].forEach(([col, x, y]) => { const gr = g.createRadialGradient(w * x, h * y, 10, w * x, h * y, w * 0.42); gr.addColorStop(0, `${col}55`); gr.addColorStop(1, `${col}00`); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    g.fillStyle = '#eeedfb'; g.font = '64px Georgia, "Times New Roman", serif'; g.fillText('Displacer', 70, 118);
    g.fillStyle = '#b6b9cf'; g.font = '24px ui-sans-serif, -apple-system, sans-serif';
    g.fillText(`${S.mode === 'image' ? 'Two pictures' : 'Two sounds'} · ${METHOD_NAME[S.method]} · t = ${S.t.toFixed(2)} · A: ${S.names[S.mode].A} · B: ${S.names[S.mode].B}`, 72, 162);
    let inset = null;
    if (S.mode === 'image') { if (G && mapsReady(S.method)) { prepare(S.method); const ih = Math.min(1120, gpu.aH), iw = Math.round(ih * (gpu.aW / gpu.aH)); inset = imageCanvas(blendPixels(S.method, S.t, iw, ih)); } }
    else { const r = await currentRender(); if (r) { const cols = 640, rows = 256, sp = spectrogram(r.data, r.rate, cols, rows); inset = document.createElement('canvas'); inset.width = cols; inset.height = rows; const ig = inset.getContext('2d');
      ig.putImageData(specImage(sp, cols, rows), 0, 0); } }
    if (inset) { const k = Math.min(920 / inset.width, 560 / inset.height); g.drawImage(inset, 70, 210, inset.width * k, inset.height * k); }
    const sc = document.createElement('canvas'); sc.width = 1400; sc.height = 440; drawScope(sc, true); g.drawImage(sc, 1030, 230, 500, 157);
    g.fillStyle = '#b6b9cf'; g.font = '15px ui-sans-serif, -apple-system, sans-serif';
    g.fillText('The transport scope: A, B and the blend, with the map drawn.', 1030, 412);
    g.fillText('The 1D inverse-CDF map is the exact W2 displacement map. No model.', 72, h - 44);
    g.fillText('Displacer · Generative AV Labs · patrickiben.github.io/generative-av-labs', 72, h - 20);
    download(await toBlob(c), `displacer_poster_${S.mode === 'image' ? 'pictures' : 'sounds'}_t${Math.round(S.t * 100)}.png`);
  }
  async function needCloud() {
    if (splat && splat.kind === S.mode && spaceKey === wantKey()) return true;
    shell.toast('Building the cloud first.');
    await buildSpace();
    return !!(splat && splat.kind === S.mode);
  }
  function cloudPos(i, t) { const sp = splat, f = sp.kind === 'audio' ? 1 : -1; return [sp.A[i * 3] + t * sp.disp[i * 3], f * (sp.A[i * 3 + 1] + t * sp.disp[i * 3 + 1]), (sp.A[i * 3 + 2] + t * sp.disp[i * 3 + 2]) * S.space.depth]; }
  function cloudCol(i, t) { const sp = splat; return [0, 1, 2].map((k) => clamp(Math.round(sp.c0[i * 3 + k] + (sp.c1[i * 3 + k] - sp.c0[i * 3 + k]) * t), 0, 255)); }
  async function saveCloud() {
    if (!(await needCloud())) return;
    const n = splat.n, t = S.t, head = `ply\nformat binary_little_endian 1.0\ncomment Displacer point cloud, t=${t.toFixed(2)}, ${splat.kind === 'image' ? 'depth from brightness' : 'Gabor atoms'}: stated mappings, not a learned model\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
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
      const p = cloudPos(i, t), col = cloudCol(i, t).map((v) => v / 255), sc = Math.log(base * (S.spAdapt ? splat.sz[i] : 1));
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
  $('open-session').addEventListener('click', () => { $('save-sheet').close(); shell.openSheet('session'); });
  $('gp-wav').addEventListener('click', () => { if (!S.gp.best) { shell.toast('Grow a patch first.'); return; } const rate = S.audRate || 44100; download(new Blob([E.encodeWav(E.applyFX(E.synthFromPatch(S.gp.best, 2, rate, 0), rate), rate)], { type: 'audio/wav' }), `genopatch_${S.gp.source}.wav`); });
  $('gp-json').addEventListener('click', () => { if (!S.gp.best) { shell.toast('Grow a patch first.'); return; } download(new Blob([JSON.stringify({ v: 1, app: 'displacer-genopatch', source: S.gp.source, loss: S.gp.bestLoss, genome: Array.from(S.gp.best), params: E.gpParams(S.gp.best) }, null, 2)], { type: 'application/json' }), `genopatch_${S.gp.source}.patch.json`); });

  /* ---------- controls ---------- */
  shell.bindRange('t', (v) => { stopSweep(); setT(v / 1000); });
  shell.bindRange('t2', (v) => { stopSweep(); setT(v / 1000); });
  $('view-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  $('method-row').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b && !b.hidden) setMethod(b.dataset.m); });
  $('compare').addEventListener('change', (e) => { S.compare = e.target.checked; flatDirty = true; if (S.compare && S.view !== 'flat') setView('flat'); syncMethod(); });
  $('scope-on').checked = S.scope;
  $('scope-on').addEventListener('change', (e) => { S.scope = e.target.checked; scopeDirty = true; });
  $('cspace').addEventListener('change', (e) => { S.cspace = e.target.value; E.cacheImageDists(); flatDirty = true; });
  $('quality').addEventListener('change', (e) => { S.quality = e.target.value; flatDirty = true; syncMethod(); });
  $('spadapt').addEventListener('change', (e) => { S.spAdapt = e.target.value === 'adaptive'; flatDirty = true; spaceKey = ''; });
  $('phasemode').addEventListener('change', (e) => { S.phasemode = e.target.value; S.audDirty = true; scheduleRender(60); });
  $('xlaw').addEventListener('change', (e) => { S.xlaw = e.target.value; S.audDirty = true; scheduleRender(60); });
  shell.bindRange('mpmix', (v) => { S.mpMix = v / 100; $('mpmix-v').textContent = `${v}%`; S.audDirty = true; scheduleRender(400); });
  $('cloud-row').addEventListener('click', (e) => { const b = e.target.closest('[data-cloud]'); if (!b) return; S.space.cloud = b.dataset.cloud; syncCloud(); if (S.view !== 'space') setView('space'); });
  $('look-row').addEventListener('click', (e) => { const b = e.target.closest('[data-look]'); if (!b) return; S.space.look = b.dataset.look; syncCloud(); });
  const bindPct = (id, get, set, fmt) => { const r = $(id); r.value = get(); $(`${id}-v`).textContent = fmt(+r.value); shell.bindRange(id, (v) => { set(v); $(`${id}-v`).textContent = fmt(v); }); };
  bindPct('depth', () => S.space.depth * 100, (v) => { S.space.depth = v / 100; }, (v) => (v / 100).toFixed(2));
  bindPct('size', () => S.space.size * 100, (v) => { S.space.size = v / 100; }, (v) => `${Math.round(v)}%`);
  $('points').addEventListener('change', (e) => { S.space.points = e.target.value; });
  $('sway').addEventListener('change', (e) => { S.space.sway = e.target.checked; });
  function stopSweep() { if (S.sweep) { S.sweep = false; $('sweep').checked = false; } }
  $('sweep').addEventListener('change', (e) => { S.sweep = e.target.checked; S.sweepT = Math.acos(clamp(1 - 2 * S.t, -1, 1)) / (2 * Math.PI) * 24; });
  $('swap').addEventListener('click', () => {
    if (S.mode === 'image') { [S.imgA, S.imgB] = [S.imgB, S.imgA]; if (S.imgA && S.imgB) E.cacheImageDists(); }
    else { [S.srcA, S.srcB] = [S.srcB, S.srcA]; if (S.srcA && S.srcB) E.prepAudio(); S.lastRender = null; S.audDirty = true; }
    const n = S.names[S.mode], b = S.built[S.mode]; [n.A, n.B] = [n.B, n.A]; [b.A, b.B] = [b.B, b.A];
    sourcesChanged(S.mode);
  });
  $('builtin-image').addEventListener('click', () => { if (S.mode !== 'image') shell.setMode('image'); loadBuiltIn('image'); });
  $('builtin-audio').addEventListener('click', () => { if (S.mode !== 'audio') shell.setMode('audio'); loadBuiltIn('audio'); });
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
    if (files.length >= 2) { await loadFile(files[0], 'A'); await loadFile(files[1], 'B'); }
    else await loadFile(files[0], e.clientX > innerWidth / 2 ? 'B' : 'A');
  });
  addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (const it of items) if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { loadFile(new File([f], f.name || 'pasted picture.png', { type: f.type }), S.mode === 'image' && !S.built.image.A ? 'B' : 'A'); return; } }
  });

  /* drag to turn the cloud, scroll to move closer */
  cv.addEventListener('pointerdown', (e) => { if (S.view !== 'space') return; dragging = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); moved(); });
  cv.addEventListener('pointermove', (e) => { if (!dragging) return; S.space.yaw += (e.clientX - dragging.x) * 0.006; S.space.pitch = clamp(S.space.pitch + (e.clientY - dragging.y) * 0.004, -1.2, 1.2); dragging = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', () => { dragging = null; });
  cv.addEventListener('pointercancel', () => { dragging = null; });
  cv.addEventListener('wheel', (e) => { if (S.view !== 'space') return; e.preventDefault(); S.space.dist = clamp(S.space.dist * Math.exp(e.deltaY * 0.0009), 1.4, 7); }, { passive: false });
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, moved, { once: true, passive: true }));

  /* performance mode: the desktop app's borderless full screen, as the browser's Fullscreen API */
  function setPerform(on) {
    S.perform = on; document.body.classList.toggle('performance', on); $('perform-button').textContent = on ? 'Leave' : 'Perform';
    if (on) {
      if (S.mode === 'image' && S.view !== 'space') setView('space');
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
  kit.on('hit', (h) => { if (S.mode === 'audio' && S.gp.keys && S.gp.best && h.src === 'midi' && h.note != null) gpNote(clamp(h.note - 60, -24, 24), Math.max(0.35, Math.min(1, h.vel * 2))); });
  kit.on('lane', (l) => { if (l.name === 'kind' && l.value !== S.mode) shell.setMode(l.value); });

  /* ---------- boot ---------- */
  if (!G || !(G.floatRT || G.gl.getExtension('EXT_color_buffer_half_float'))) {
    shell.glFail('This page needs WebGL2 with floating-point render targets, which this browser did not provide. The Blend and Save sheets still work.');
    const idle = (now) => { requestAnimationFrame(idle); kit.tick(now); shell.frame(now); };
    requestAnimationFrame(idle);
  } else {
    gl = G.gl;
    try {
      Post = createPost(G);
      pFlat = G.program(FLAT_FS); pResolve = G.program(RESOLVE_FS); pPts = G.program(PTS_FS, PTS_VS); pBlend = G.program(BLEND_FS); pSpf = G.program(SPF_FS, SPF_VS); pSpr = G.program(SPR_FS);
      dummy3D = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, dummy3D); gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((q) => gl.texParameteri(gl.TEXTURE_3D, q, gl.NEAREST));
      baseVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      tFlat = G.tex(2, 2, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
      gl.bindTexture(gl.TEXTURE_2D, tFlat); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      ptsVao = gl.createVertexArray(); ptsBuf = gl.createBuffer();
      gl.bindVertexArray(ptsVao); gl.bindBuffer(gl.ARRAY_BUFFER, ptsBuf);
      [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 3, 9], [4, 2, 12]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 56, off * 4); });
      gl.bindVertexArray(baseVao);
      spVao = gl.createVertexArray(); spBuf = gl.createBuffer();
      gl.bindVertexArray(spVao); gl.bindBuffer(gl.ARRAY_BUFFER, spBuf);
      [[0, 4, 0], [1, 3, 4], [2, 3, 7]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off * 4); });
      gl.bindVertexArray(baseVao);
      resize();
      addEventListener('resize', resize);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); shell.glFail('The graphics context was lost. Reload the page to get the picture back.'); });
      requestAnimationFrame(render);
    } catch (e) {
      console.error(e);
      shell.glFail(`The picture could not start on this graphics card: ${String(e.message).slice(0, 140)}`);
    }
  }
  document.body.dataset.view = S.view;
  setKind('image');
  { const q = new URLSearchParams(location.search); if (q.get('kind') === 'audio') shell.setMode('audio'); if (q.get('view') === 'flat') setView('flat'); }
  syncHear();

  // For the flicker check: the picture's brightness on a small grid, every frame, straight after it is drawn.
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
    S, kit, E, recordLuma, setT, setView, setMethod, loadFile, buildSpace,
    get spaceN() { return spaceN; }, get spaceReady() { return spaceKey === wantKey() && !spaceBusy; }, get flat() { return { w: flatW, h: flatH, spec: flatSpec, ready: flatReady }; },
    get flatRT() { return gpu.rt ? { w: gpu.rt.w, h: gpu.rt.h, shownH: gpu.lastPh || 0 } : null; },
    get busy() { return !$('busy').hidden; }, get safe() { return safe; }, get playing() { return playSrc ? playKind : ''; }, currentRender,
    pixel() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d');
      return new Promise((res) => { wantSnap = (blob) => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let sum = 0, min = 1e9, max = 0; const grid = []; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; sum += l; min = Math.min(min, l); max = Math.max(max, l); grid.push(l); } res({ mean: sum / (d.length / 4), min, max, grid }); }; im.src = URL.createObjectURL(blob); }; });
    },
  };
})();
