/* chimera.js: Chimera Synth's stage, inputs and states. chimera-engine.js makes the sound; this file draws the
   garden and the pad, runs Web MIDI, the demo, dropped files, recording and the readouts. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD } = GLKit;
  const $ = (id) => document.getElementById(id);
  const UI = ChimeraUI;
  const RMq = matchMedia('(prefers-reduced-motion: reduce)');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`chimera.${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`chimera.${k}`, JSON.stringify(v)); } catch (e) { /* storage off */ } },
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const announce = (t) => { if ($('sr-status').textContent !== t) $('sr-status').textContent = t; };

  /* ---------------- modes ---------------- */
  const INTRO = {
    garden: ['Chimera Synth · a genome you play by ear', 'Breed a bass by ear.', 'Drag a bud along its vine and listen. Real synthesis in this browser, with no model and no server.'],
    morph: ['Morph · four animals at the corners', 'Sit between four creatures.', 'Drag anywhere to blend their voices. The formants slide between them instead of crossfading.'],
  };
  let mode = 'garden';
  function setMode(m) {
    mode = m === 'morph' ? 'morph' : 'garden';
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    [$('intro-eyebrow').textContent, $('intro-title').textContent, $('intro-sub').textContent] = INTRO[mode];
    $('corners').hidden = mode !== 'morph';
    $('pad-hint').hidden = mode !== 'morph';
    if (mode === 'morph' && GARDEN.grow) { GARDEN.grow = false; syncGrow(); }
    GARDEN.drag = null; GARDEN.hover = -1; kbSel = -1; kbReach = 0;
    enterGenomeMode(mode === 'garden');
    if (ST.playing) applyLive();
    renderCorners();
    layout();
    store.set('mode', mode);
  }
  document.querySelectorAll('.mode-switch button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  window.chimeraSetMode = (m) => { if (mode !== m) { setMode(m); UI.toast(m === 'morph' ? 'Switched to Morph, so you hear the animals.' : 'Switched to Garden.'); } };

  /* ---------------- corners (Morph) ---------------- */
  $('scene').insertAdjacentHTML('beforeend', '<p id="pad-hint" class="chrome" hidden>Drag anywhere to blend the four animals</p>');
  function renderCorners() {
    document.querySelectorAll('#corners .corner').forEach((b) => {
      const a = ANIMALS[ST.corners[+b.dataset.corner]] || ANIMALS[0];
      b.innerHTML = `<span aria-hidden="true">${a.emoji}</span>${a.nm}`;
      b.setAttribute('aria-label', `Corner ${+b.dataset.corner + 1}, ${a.nm}: press to change the animal`);
    });
    fieldDirty = true;
  }
  $('corners').addEventListener('click', (e) => {
    const b = e.target.closest('.corner'); if (!b) return;
    const k = +b.dataset.corner;
    ST.corners[k] = (ST.corners[k] + 1) % ANIMALS.length;
    renderCorners(); updateChips(); applyLive();
  });

  /* ---------------- sound ---------------- */
  const hasWebAudio = !!(window.AudioContext || window.webkitAudioContext);
  function startSound() {
    if (!ensureAudio()) { UI.toast('This browser has no Web Audio, so it cannot make sound.'); return; }
    if (mode === 'garden') ensureLiveGenome(); else if (!ST.playing) startGraph();
  }
  $('start-sound').addEventListener('click', startSound);
  $('sound-toggle').addEventListener('click', () => {
    if (AC && AC.state === 'running' && ST.playing) { if (demo) stopDemo(); seqStop(); stopGraph(); } else startSound();
  });
  const vol = $('vol');
  vol.value = Math.round(store.get('volume', 0.7) * 100);
  setVolume(+vol.value / 100);
  $('vol-val').textContent = `${vol.value} %`;
  vol.addEventListener('input', () => { setVolume(+vol.value / 100); $('vol-val').textContent = `${vol.value} %`; store.set('volume', +vol.value / 100); });
  // a suspended context resumes on the next click or key, anywhere
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (AC && AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => {}); }, true));

  function soundView() {
    if (!hasWebAudio) return ['bad', 'Sound · not supported', 'Not supported', 'This browser has no Web Audio. Use Chrome, Edge, Safari or Firefox.'];
    if (!AC) return ['idle', 'Sound · off', 'Off', 'Browsers start sound only after a click. Start quietly: the sub can be loud on big speakers.'];
    if (AC.state === 'running') {
      const sr = `${(AC.sampleRate / 1000).toFixed(1)} kHz`;
      return ST.playing ? ['good', 'Sound · playing', 'Playing', `${sr} · volume ${Math.round(VOLUME * 100)} %`] : ['idle', 'Sound · ready', 'Ready, nothing playing', `${sr}. Press Play, a key, or drag a bud.`];
    }
    if (AC.state === 'closed') return ['bad', 'Sound · stopped', 'Stopped', 'The browser closed the audio. Reload the page to start again.'];
    return ['warn', 'Sound · paused by the browser', 'Paused by the browser', 'Click anywhere on the page, or press any key, to let it play.'];
  }

  /* ---------------- Web MIDI ---------------- */
  const midi = { state: 'idle', detail: '', inputs: [], inputId: store.get('midiPort', 'all'), label: '', lastT: 0, count: 0, log: [] };
  let access = null;
  const MIDI_HOLD_MS = 8000;
  const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios|edg|android/i.test(navigator.userAgent);
  const isFirefox = /firefox/i.test(navigator.userAgent);
  const MIDI_TEXT = {
    idle: ['idle', 'Not connected', 'Press Connect, then choose your MIDI keyboard.'],
    requesting: ['wait', 'Waiting for permission', 'Answer the browser prompt to continue.'],
    denied: ['bad', 'Permission denied', ''],
    'no-device': ['bad', 'No MIDI device', ''],
    unsupported: ['bad', 'Not in this browser', ''],
    insecure: ['bad', 'Needs a secure page', ''],
    lost: ['bad', 'Device disconnected', ''],
  };
  function setMidi(state, detail) { midi.state = state; midi.detail = detail || ''; renderStates(); }
  function midiPorts() {
    if (!access) return;
    midi.inputs = [...access.inputs.values()].filter((p) => p.state === 'connected').map((p) => ({ id: p.id, name: p.name || 'MIDI input', manufacturer: p.manufacturer || '' }));
    access.inputs.forEach((p) => {
      const use = p.state === 'connected' && (midi.inputId === 'all' || midi.inputId === p.id);
      p.onmidimessage = use ? (ev) => onMidiMessage(ev.data) : null;
    });
    const selected = midi.inputId === 'all' ? null : midi.inputs.find((p) => p.id === midi.inputId);
    if (!midi.inputs.length) {
      const wasOpen = midi.state === 'live' || midi.state === 'no-signal';
      midi.label = '';
      setMidi(wasOpen ? 'lost' : 'no-device', wasOpen ? 'The MIDI device went away. Plug it back in; it reconnects by itself.' : 'No MIDI input found. Plug in a MIDI keyboard; it appears here by itself.');
    } else {
      if (midi.inputId !== 'all' && !selected) midi.inputId = 'all';
      midi.label = selected ? selected.name : midi.inputs.length === 1 ? midi.inputs[0].name : `All ${midi.inputs.length} inputs`;
      if (midi.state !== 'live') setMidi('no-signal'); else renderStates();
    }
  }
  async function connectMidi() {
    ensureAudio();                       // the click is a gesture, so the notes that follow can sound at once
    if (!navigator.requestMIDIAccess) {
      return setMidi('unsupported', isSafari ? 'Safari has no Web MIDI. Use Chrome or Edge for MIDI. The computer keys work here.' : isFirefox ? 'Firefox needs a site permission add-on for MIDI. Chrome and Edge need only a prompt. The computer keys work here.' : 'This browser has no Web MIDI. Use Chrome or Edge. The computer keys work here.');
    }
    if (!window.isSecureContext) return setMidi('insecure', 'Web MIDI needs HTTPS or localhost.');
    setMidi('requesting', isFirefox ? 'Firefox asks to install a small site permission add-on for MIDI. Answer its prompt, or use Chrome or Edge.' : 'Answer the browser prompt to continue.');
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      return setMidi('denied', isFirefox ? 'Firefox needs a site permission add-on for MIDI. Chrome and Edge need only a prompt.' : 'MIDI permission was refused. Allow MIDI devices from the site settings icon in the address bar, then press Try again.');
    }
    access.onstatechange = midiPorts;
    midiPorts();
  }
  function disconnectMidi() {
    if (access) { access.onstatechange = null; access.inputs.forEach((p) => { p.onmidimessage = null; }); }
    access = null; midi.inputs = []; midi.label = ''; setMidi('idle');
  }
  const semiText = (s) => (s === 0 ? 'root' : `${s > 0 ? '+' : ''}${s}`);
  function onMidiMessage(data) {
    const status = data[0];
    if (status >= 0xf0) return;                          // clock, active sensing and other system messages are not playing
    const type = status & 0xf0, ch = status & 0x0f, d1 = data[1], d2 = data[2];
    midi.count++; midi.lastT = performance.now();
    if (midi.state !== 'live' && (midi.state === 'no-signal' || midi.state === 'idle' || midi.state === 'lost')) setMidi('live');
    let line = '';
    if (type === 0x90 && d2 > 0) {
      window.__midiNote(d1, d2, ch); line = `note ${d1} vel ${d2} ch ${ch + 1} → ${semiText(ST.noteSt)}`;
    } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
      window.__midiOff(d1, ch); line = `note off ${d1} ch ${ch + 1}`;
    } else line = `${type === 0xb0 ? `CC${d1} = ${d2}` : type === 0xe0 ? 'pitch bend' : type === 0xa0 || type === 0xd0 ? 'pressure' : `status ${type.toString(16)}`} · not used`;
    midi.log.unshift(line); midi.log.length = Math.min(midi.log.length, 16);
    if ($('connect-sheet').open) $('midi-monitor').textContent = midi.log.slice(0, 5).join('\n');
  }
  $('midi-connect').addEventListener('click', () => { const s = midi.state; if (s === 'live' || s === 'no-signal') disconnectMidi(); else connectMidi(); });
  $('midi-port').addEventListener('change', (e) => { midi.inputId = e.target.value; store.set('midiPort', midi.inputId); if (midi.state === 'live') midi.state = 'no-signal'; midiPorts(); });
  setSwitch('reconnect', !!store.get('reconnect', false));
  $('reconnect').addEventListener('click', () => { const on = $('reconnect').getAttribute('aria-checked') !== 'true'; setSwitch('reconnect', on); store.set('reconnect', on); });
  (async () => {                         // reconnect only if asked to and the browser already allows it, so no prompt appears unasked
    if (!store.get('reconnect', false) || !navigator.requestMIDIAccess || !navigator.permissions) return;
    try { const p = await navigator.permissions.query({ name: 'midi', sysex: false }); if (p.state === 'granted') connectMidi(); } catch (e) { /* no permission query here */ }
  })();
  /* ---------------- demo ---------------- */
  let demo = null;
  const DEMO_RIFF = [[0, 1], [0, 0], [7, 1], [0, 0], [12, 1], [0, 0], [10, 1], [7, 1], [0, 1], [0, 0], [3, 1], [0, 0], [5, 1], [7, 1], [0, 0], [10, 1]];
  function startDemo() {
    if (!ensureAudio()) { UI.toast('This browser has no Web Audio, so the demo cannot play.'); return; }
    demo = { seq: ST.seq.note.map((c) => ({ ...c })), bpm: ST.seq.bpm, grow: GARDEN.grow, playing: ST.playing, seqOn: ST.seq.on };
    if (mode !== 'garden') setMode('garden');
    ensureLiveGenome();
    ST.seq.note = DEMO_RIFF.map(([p, g]) => ({ gate: !!g, pitch: p }));
    ST.seq.bpm = 128; $('seq-bpm').value = 128; $('v-bpm').textContent = '128';
    renderSeq();
    if (!ST.seq.on) seqStart();
    GARDEN.grow = true; syncGrow();
    renderStates();
  }
  function stopDemo() {
    if (!demo) return;
    const d = demo; demo = null;
    if (!d.seqOn) seqStop();
    ST.seq.note = d.seq; ST.seq.bpm = d.bpm; $('seq-bpm').value = d.bpm; $('v-bpm').textContent = d.bpm;
    renderSeq();
    GARDEN.grow = d.grow; syncGrow();
    if (!d.playing) stopGraph();
    UI.syncAllRanges();
    renderStates();
  }
  const toggleDemo = () => (demo ? stopDemo() : startDemo());
  $('demo-button').addEventListener('click', toggleDemo);
  $('demo-sheet').addEventListener('click', () => { toggleDemo(); if (demo) $('connect-sheet').close(); });

  /* ---------------- files: pick or drop ---------------- */
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return; e.preventDefault();
    const t = e.target.closest && e.target.closest('.drop-target');
    document.querySelectorAll('.drop-target').forEach((d) => d.classList.toggle('over', d === t));
  });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return; e.preventDefault();
    dragDepth = 0; $('drop').hidden = true;
    const f = e.dataTransfer.files[0]; if (!f) return;
    const t = e.target.closest && e.target.closest('.drop-target');
    handleFile(f, t ? t.dataset.kind : mode === 'garden' ? 'genopatch' : 'sample');
  });
  function handleFile(f, kind) {
    if (kind === 'genopatch') { UI.openSheet('garden'); return growFromFile(f); }
    UI.openSheet('voices'); return importSampleFile(f);
  }

  /* ---------------- record what you play ---------------- */
  let rec = null, recDest = null, recT0 = 0;
  $('rec-toggle').addEventListener('click', () => {
    const btn = $('rec-toggle');
    if (!rec) {
      if (!window.MediaRecorder) { $('rec-status').textContent = 'This browser cannot record audio. The WAV render still works.'; return; }
      if (!ensureAudio()) return;
      recDest = AC.createMediaStreamDestination(); OUT.connect(recDest);
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : {}), chunks = [], dest = recDest;
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        const type = r.mimeType || mime || 'audio/webm';
        dlBlob(new Blob(chunks, { type }), `chimera-take-${stamp()}.${type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'}`);
        try { OUT.disconnect(dest); } catch (e) { /* already gone */ }
      };
      r.start(1000); rec = r; recT0 = performance.now();
      btn.querySelector('b').textContent = 'Stop'; btn.querySelector('.cap').textContent = 'and save the take'; btn.setAttribute('aria-pressed', 'true'); $('patch-button').classList.add('rec');
      $('rec-status').textContent = "Recording this page's own sound. Play, then press Stop and save.";
    } else {
      const secs = Math.max(1, Math.round((performance.now() - recT0) / 1000));
      rec.stop(); rec = null; recDest = null;
      btn.querySelector('b').textContent = 'Record'; btn.querySelector('.cap').textContent = 'What you play, live'; btn.setAttribute('aria-pressed', 'false'); $('patch-button').classList.remove('rec');
      $('rec-status').textContent = `Saved ${secs} s of sound to your downloads.`;
    }
  });

  /* ---------------- full screen and keys ---------------- */
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => UI.toast('Full screen is not available here.')); };
  $('fs-button').addEventListener('click', fullscreen);
  let kbSel = -1, kbReach = 0;
  const stageKeys = () => !document.querySelector('dialog[open]') && (!document.activeElement || document.activeElement === document.body || document.activeElement.id === 'stage');
  // the stage takes focus from Tab or a click, so Enter there grows a seed instead of pressing a button
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typingInto(document.activeElement) || document.querySelector('dialog[open]')) return;
    if (e.key === 'f' || e.key === 'F') { fullscreen(); return; }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mode === 'garden') {
      if (arrow && arrow[0]) {
        e.preventDefault();
        kbSel = kbSel < 0 ? 0 : (kbSel + arrow[0] + 12) % 12;
        GARDEN.hover = kbSel;
        if (GARDEN.drag) gardenApply({ branch: kbSel, r: kbReach }, 'move');
        announce(`Bud ${kbSel + 1} of 12${GARDEN.drag ? `, reach ${Math.round(kbReach * 100)} percent` : ''}`);
      } else if (arrow) {
        e.preventDefault();
        if (kbSel < 0) kbSel = 0;
        kbReach = clamp(kbReach - arrow[1] * 0.1, 0, 1);
        gardenApply({ branch: kbSel, r: kbReach }, GARDEN.drag ? 'move' : 'down');
        announce(`Bud ${kbSel + 1}, reach ${Math.round(kbReach * 100)} percent. Enter grows a seed here.`);
      } else if (e.key === 'Enter' && GARDEN.drag && stageKeys()) {
        e.preventDefault(); gardenApply({ branch: kbSel, r: kbReach }, 'up'); kbReach = 0;
      } else if (e.key === 'Escape' && GARDEN.drag) {
        GARDEN.drag = null; kbReach = 0; setGenome(GARDEN.seed, { glide: 0.05 });
      }
    } else if (arrow) {
      e.preventDefault();
      if (!ST.playing) startSound();
      padSet(ST.uv.u + arrow[0] * 0.05, ST.uv.v + arrow[1] * 0.05);
      announce(`Pad at ${Math.round(ST.uv.u * 100)} by ${Math.round(ST.uv.v * 100)}`);
    }
  });

  /* ---------------- the stage: geometry and pointer ---------------- */
  const cv = $('stage');
  let cssW = 1, cssH = 1;
  const PADR = { x: 0, y: 0, w: 1, h: 1 };
  function layout() {
    cssW = cv.clientWidth || innerWidth; cssH = cv.clientHeight || innerHeight;
    const head = document.querySelector(mode === 'morph' || cssW < 860 ? '.mode-switch' : '.header').getBoundingClientRect().bottom;
    const foot = document.querySelector('.dock-wrap').getBoundingClientRect().top + (document.querySelector('#hud').offsetHeight || 0) * 0.55;
    const top = Math.max(60, head + 12), bottom = Math.max(top + 160, foot - 8), avail = bottom - top;
    GARDEN_GEOM.cx = cssW / 2; GARDEN_GEOM.cy = top + avail / 2;
    GARDEN_GEOM.R = Math.max(64, Math.min(cssW * 0.4, avail * 0.44));
    const mx = Math.max(16, cssW * 0.06);
    Object.assign(PADR, { x: mx, y: top + 6, w: cssW - 2 * mx, h: Math.max(140, avail - 10) });
    const cs = $('corners').style;
    cs.setProperty('--px', `${PADR.x}px`); cs.setProperty('--py', `${PADR.y}px`); cs.setProperty('--pw', `${PADR.w}px`); cs.setProperty('--ph', `${PADR.h}px`);
    fieldDirty = true;
  }
  let dragging = false;
  const inGarden = (x, y) => Math.hypot(x - GARDEN_GEOM.cx, y - GARDEN_GEOM.cy) < GARDEN_GEOM.R * 1.3;
  const padFrom = (x, y) => padSet((x - PADR.x) / PADR.w, (y - PADR.y) / PADR.h);
  const scene = $('scene'), isStage = (t) => t === cv || t === ov;
  scene.addEventListener('pointerdown', (e) => {
    if (!isStage(e.target)) return;
    e.target.focus({ preventScroll: true });
    if (e.button !== 0) return;
    if (mode === 'garden') {
      if (!inGarden(e.clientX, e.clientY)) return;
      e.target.setPointerCapture(e.pointerId); dragging = true; kbReach = 0;
      gardenPointer(e.clientX, e.clientY, 'down');
    } else {
      e.target.setPointerCapture(e.pointerId); dragging = true;
      if (!ST.playing) startSound();
      padFrom(e.clientX, e.clientY);
    }
  });
  scene.addEventListener('pointermove', (e) => {
    if (!isStage(e.target)) return;
    if (mode === 'garden') {
      if (dragging) gardenPointer(e.clientX, e.clientY, 'move');
      else { const inside = inGarden(e.clientX, e.clientY); GARDEN.hover = inside ? _branchAt(e.clientX, e.clientY).branch : -1; e.target.style.cursor = inside ? 'grab' : ''; }
    } else { e.target.style.cursor = 'crosshair'; if (dragging) padFrom(e.clientX, e.clientY); }
  });
  const endDrag = (e, cancel) => {
    if (!dragging) return; dragging = false;
    if (mode === 'garden' && GARDEN.drag) { if (cancel) { GARDEN.drag = null; setGenome(GARDEN.seed, { glide: 0.05 }); } else gardenPointer(e.clientX, e.clientY, 'up'); }
  };
  scene.addEventListener('pointerup', (e) => endDrag(e, false));
  scene.addEventListener('pointercancel', (e) => endDrag(e, true));
  scene.addEventListener('pointerleave', () => { if (!dragging) GARDEN.hover = kbSel; });

  /* ---------------- the stage: drawing ---------------- */
  const ov = document.createElement('canvas'), ox = ov.getContext('2d');
  let G2 = null, gl = null, Post = null, pBg = null, pComp = null, tN = null, tOv = null, tField = null, bgT = null, sceneT = null, rw = 0, rh = 0, k = 1, glOK = false, fieldDirty = true;
  let freq = null, lowSm = 0, lastT = performance.now();
  const BG_FS = `${FS_HEAD}
uniform sampler2D uN, uField; uniform vec2 uRes, uC; uniform vec4 uPad;
uniform float uT, uLow, uHue, uSat, uMorph, uR, uPulse;
vec3 hsl(float h, float s, float l){ vec3 q=clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); return l+s*(q-.5)*(1.-abs(2.*l-1.)); }
float n2(vec2 p){ p*=5.4; vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);            // value noise with smooth steps, so no texel shows
  float a=texture(uN,(i+.5)/256.).r, b=texture(uN,(i+vec2(1.5,.5))/256.).r, c=texture(uN,(i+vec2(.5,1.5))/256.).r, d=texture(uN,(i+1.5)/256.).r;
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*n2(p); p=p*2.02+vec2(.17,.31); a*=.45; } return s/.83; }
void main(){
  vec2 px=vUv*uRes, q=(px-uC)/uRes.y;
  float r=length(q), t=uT*.01;
  vec2 p=vUv*vec2(uRes.x/uRes.y,1.)*1.05;
  vec2 w=vec2(fbm(p+vec2(t,-t*.7)), fbm(p+vec2(-t*.6,t)+5.2));
  float h=fbm(p*1.1+w*.9+vec2(t*.4,0.)), m=fbm(p*.6-w*.5+9.1);
  vec3 indigo=vec3(.16,.13,.42), teal=vec3(.05,.26,.30), rose=vec3(.34,.10,.26);
  vec3 gas=mix(mix(indigo,teal,smoothstep(.38,.66,m)),rose,smoothstep(.62,.8,w.x)*.55);
  vec3 c=vec3(.010,.012,.026)+gas*smoothstep(.28,.92,h)*.34+gas*pow(smoothstep(.55,.95,h),2.)*.22;
  float rr=uR/uRes.y;
  vec3 tint=hsl(fract(uHue),.6*uSat,.5);
  c+=tint*(.05+.26*uLow+.2*uPulse)*exp(-r*r/(rr*rr*1.1));
  if(uMorph>0.){ vec2 f=clamp((px-uPad.xy)/uPad.zw,0.,1.);
    float e=smoothstep(0.,.12,f.x)*smoothstep(1.,.88,f.x)*smoothstep(0.,.12,f.y)*smoothstep(1.,.88,f.y);
    c+=vec3(.34,.31,.86)*texture(uField,vec2(f.x,1.-f.y)).r*.085*e*uMorph; }
  o=vec4(c,1.);
}`;
  const COMP_FS = `${FS_HEAD}
uniform sampler2D uBg, uOv; uniform float uGain; uniform vec2 uRes;
void main(){
  vec3 b=texture(uBg,vUv).rgb; vec4 v=texture(uOv,vec2(vUv.x,1.-vUv.y));
  vec2 g=floor(vUv*uRes/3.); float s=fract(sin(dot(g,vec2(12.9898,78.233)))*43758.5453);
  b+=vec3(.85,.88,1.)*step(.9989,s)*(.3+.7*fract(s*91.))*.42;                  // fine dust, at full resolution
  vec3 lin=v.a>0.?pow(v.rgb/v.a,vec3(2.2))*v.a:vec3(0.);
  o=vec4(b*(1.-v.a*.85)+lin*uGain,1.);
}`;

  function resize() {
    layout();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(320, Math.min(3840, Math.round(cssW * dpr))), H = Math.max(240, Math.min(2160, Math.round(cssH * dpr)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const budget = navigator.maxTouchPoints > 1 ? 1.1e6 : 2.2e6, asp = W / H;
    let h = Math.round(Math.sqrt(budget / asp)), w = Math.round(h * asp);
    if (w > W) { w = W; h = H; }
    k = w / cssW;
    if (w === rw && h === rh) return;
    rw = w; rh = h; ov.width = rw; ov.height = rh;
    if (glOK) {
      [bgT, sceneT].forEach((T) => T && G2.freeTarget(T));
      bgT = G2.target(rw >> 1, rh >> 1); sceneT = G2.target(rw, rh);     // the gas is soft, so half resolution is plenty
      Post.resize(rw, rh, 5);
    }
  }

  function bake() {                      // the four-corner displacement field, 24 by 24, lightly blurred
    const N = 24, raw = new Float32Array(N * N), d = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) raw[x + y * N] = Math.min(1, wdAtUV(x / (N - 1), y / (N - 1)) / 2.2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < N && yy < N) { s += raw[xx + yy * N]; n++; } } d[x + y * N] = Math.round((s / n) * 255); }
    gl.bindTexture(gl.TEXTURE_2D, tField);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, d);
    fieldDirty = false;
  }

  function spectrum() {
    if (!(G && G.ana && ST.playing)) return null;
    if (!freq || freq.length !== G.ana.frequencyBinCount) freq = new Uint8Array(G.ana.frequencyBinCount);
    G.ana.getByteFrequencyData(freq);
    return freq;
  }
  // the spectrum around the creature: mirrored left to right and smoothed over neighbors, low bins at the top
  function specAt(f, u) {
    const m = u <= 0.5 ? u * 2 : (1 - u) * 2, n = f.length * 0.5, c = m * n;
    let s = 0, wsum = 0;
    for (let j = -4; j <= 4; j++) { const b = Math.round(c + j * Math.max(1, n / 160)), w = 1 - Math.abs(j) / 5; s += (f[Math.max(0, Math.min(f.length - 1, b))] || 0) * w; wsum += w; }
    return s / wsum / 255;
  }
  // the living seed: the desktop page's data sculpture, at the center of the garden or under the puck
  function membrane(X, Y, base, hue, p, now, alpha) {
    const f = spectrum(), N = 160, curv = Math.min(1.6, ST.wd / 2);
    const bad = ST.monoValid && ST.mono < 0 ? Math.min(1, -ST.mono) : 0;
    const breathe = RMq.matches ? 0 : Math.sin(now * 0.0011) * 0.03;
    ox.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      const amp = f ? specAt(f, i / N) : 0;
      let r = base * (1 + breathe) + amp * base * 1.7;
      r *= 1 + curv * 0.6 * Math.cos((a + Math.PI / 2) * 2);                                  // lobes scaled by the displacement
      r += Math.sin(i * 12.9 + now * (RMq.matches ? 0.001 : 0.004)) * p.noise * base * 0.3;   // grain from the noise gene
      if (bad > 0) r += Math.sin(i * 7.3 + now * 0.011) * Math.sin(i * 3.1 - now * 0.007) * bad * base * 0.55;   // measured cancellation
      const x = X + Math.cos(a) * r, y = Y + Math.sin(a) * r;
      if (i) ox.lineTo(x, y); else ox.moveTo(x, y);
    }
    ox.closePath();
    const g = ox.createRadialGradient(X, Y, base * 0.1, X, Y, base * 3.4);
    g.addColorStop(0, `hsla(${hue},80%,62%,${0.8 * alpha})`);
    g.addColorStop(0.45, `hsla(${(hue + 30) % 360},72%,44%,${0.42 * alpha})`);
    g.addColorStop(1, `hsla(${(hue + 70) % 360},66%,28%,${0.04 * alpha})`);
    ox.fillStyle = g; ox.fill();
    ox.lineWidth = 2 * k;
    ox.strokeStyle = bad > 0.15 ? `rgba(244,140,140,${(0.45 + bad * 0.5) * alpha})` : `hsla(${hue},90%,74%,${0.85 * alpha})`;
    ox.stroke();
    const core = base * 0.16 + (f ? (f[2] / 255) * base * 0.32 : 0);
    ox.beginPath(); ox.arc(X, Y, core, 0, 7); ox.fillStyle = `hsla(${hue},90%,82%,${0.95 * alpha})`; ox.fill();
  }
  function glowDot(x, y, r, color, a) {
    const g = ox.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', a)); g.addColorStop(1, color.replace('A', 0));
    ox.fillStyle = g; ox.beginPath(); ox.arc(x, y, r, 0, 7); ox.fill();
  }
  function drawGardenStage(now, p) {
    const X = GARDEN_GEOM.cx * k, Y = GARDEN_GEOM.cy * k, R = GARDEN_GEOM.R * k, sc = R / 176;
    const recent = now - NOTE_EVT.t < 650, pcBud = ((NOTE_EVT.semi % 12) + 12) % 12;
    GARDEN.branches.forEach((br, b) => {
      const tx = X + Math.cos(br.ang) * R, ty = Y + Math.sin(br.ang) * R;
      const on = GARDEN.drag && GARDEN.drag.branch === b, hov = GARDEN.hover === b, lit = GARDEN.perNote && recent && pcBud === b;
      const mx = X + Math.cos(br.ang) * R * 0.5 + Math.cos(br.ang + 1.4) * R * 0.12, my = Y + Math.sin(br.ang) * R * 0.5 + Math.sin(br.ang + 1.4) * R * 0.12;
      ox.beginPath(); ox.moveTo(X, Y); ox.quadraticCurveTo(mx, my, tx, ty);
      ox.strokeStyle = on ? 'rgba(159,227,224,.95)' : hov ? 'rgba(184,183,255,.85)' : lit ? 'rgba(241,207,142,.7)' : 'rgba(170,185,235,.26)';
      ox.lineWidth = (on ? 2.6 : hov ? 1.8 : 1.3) * k; ox.stroke();
      const d = geneDecode(br.g), hue = genomeHue(br.g) | 0, rad = (8 + d.fmDepth * 7) * sc;
      glowDot(tx, ty, rad * (on || lit ? 3.6 : 2.4), `hsla(${hue},85%,62%,A)`, on || lit ? 0.45 : hov ? 0.32 : 0.2);
      ox.beginPath(); ox.arc(tx, ty, rad, 0, 7); ox.fillStyle = `hsl(${hue} 72% ${on ? 70 : hov ? 64 : 56}%)`; ox.fill();
      for (let s = 0; s < 3; s++) {              // three genes as satellites
        const gg = [GIDX.wave, GIDX.noise, GIDX.formTilt][s], aa = br.ang + (s - 1) * 0.5, dd = rad + 8 * sc;
        ox.beginPath(); ox.arc(tx + Math.cos(aa) * dd, ty + Math.sin(aa) * dd, 2.3 * sc, 0, 7);
        ox.fillStyle = `hsla(${(hue + 80 * s) % 360},80%,68%,${0.35 + br.g[gg] * 0.6})`; ox.fill();
      }
    });
    ox.beginPath(); ox.arc(X, Y, R, 0, 7); ox.setLineDash([2 * k, 7 * k]); ox.strokeStyle = 'rgba(191,194,236,.16)'; ox.lineWidth = 1 * k; ox.stroke(); ox.setLineDash([]);
    if (GARDEN.drag) {
      const br = GARDEN.branches[GARDEN.drag.branch], r = Math.min(1.15, GARDEN.drag.r);
      glowDot(X + Math.cos(br.ang) * R * r, Y + Math.sin(br.ang) * R * r, 16 * sc, 'rgba(159,227,224,A)', 0.9);
    }
    membrane(X, Y, R * 0.2, genomeHue(GENOME || GARDEN.seed) | 0, p, now, 1);
  }
  function drawMorphStage(now, p) {
    const X0 = PADR.x * k, Y0 = PADR.y * k, W = PADR.w * k, H = PADR.h * k, pts = [[X0, Y0], [X0 + W, Y0], [X0, Y0 + H], [X0 + W, Y0 + H]];
    const u = ST.uv.u, v = ST.uv.v, w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    const X = ST.pad ? X0 + u * W : X0 + W / 2, Y = ST.pad ? Y0 + v * H : Y0 + H / 2;
    pts.forEach(([cx, cy], i) => {
      const a = ANIMALS[ST.corners[i]] || ANIMALS[0];
      glowDot(cx, cy, Math.min(W, H) * 0.28, `hsla(${a.hue},70%,55%,A)`, ST.pad ? 0.08 + w[i] * 0.3 : 0.12);
      if (ST.pad) { ox.beginPath(); ox.moveTo(X, Y); ox.lineTo(cx, cy); ox.strokeStyle = `hsla(${a.hue},80%,70%,${0.1 + w[i] * 0.75})`; ox.lineWidth = (0.6 + w[i] * 3) * k; ox.stroke(); }
    });
    membrane(X, Y, Math.min(W, H) * 0.075, ((p.hue % 360) + 360) % 360, p, now, ST.pad ? 1 : 0.55);
  }

  let lumaRec = null, wantPoster = false, lastFrame = performance.now();
  function render(now) {
    requestAnimationFrame(render);
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    measureTick();
    tick(now);
    const p = morphedPatch();
    const hue = mode === 'garden' ? genomeHue(GENOME || GARDEN.seed) : ((p.hue % 360) + 360) % 360;
    const low = ST.playing && ST.lowDb > -60 ? clamp((ST.lowDb + 60) / 50, 0, 1) : 0;
    lowSm += (low - lowSm) * Math.min(1, dt * (low > lowSm ? 6 : 2));
    PULSE *= Math.exp(-dt * 2.5);
    ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, rw, rh);
    if (!glOK) { ox.fillStyle = '#0c1122'; ox.fillRect(0, 0, rw, rh); }
    if (mode === 'garden') drawGardenStage(now, p); else drawMorphStage(now, p);
    if (glOK) {
      if (fieldDirty) bake();
      G2.into(bgT); G2.bindTex(0, tN); G2.bindTex(1, tField);
      G2.use(pBg, { uN: 0, uField: 1, uRes: [rw, rh], uC: [GARDEN_GEOM.cx * k, rh - GARDEN_GEOM.cy * k], uPad: [PADR.x * k, rh - (PADR.y + PADR.h) * k, PADR.w * k, PADR.h * k],
        uT: RMq.matches ? 0 : now / 1000, uLow: lowSm, uHue: hue / 360, uSat: ST.playing ? 1 : 0.7, uMorph: mode === 'morph' ? 1 : 0, uR: (mode === 'garden' ? GARDEN_GEOM.R : Math.min(PADR.w, PADR.h) * 0.3) * k, uPulse: PULSE });
      G2.draw();
      gl.bindTexture(gl.TEXTURE_2D, tOv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ov);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      G2.into(sceneT); G2.bindTex(0, bgT.tex); G2.bindTex(1, tOv);
      G2.use(pComp, { uBg: 0, uOv: 1, uGain: 1.45, uRes: [rw, rh] });
      G2.draw();
      const bloom = Post.bloom(sceneT.tex, 0.7);
      Post.finish(sceneT.tex, bloom, { uBloomK: 0.75, uExposure: 1.1, uVig: 0.4, uSat: 1.06, uGrain: 0.014, uT: now / 1000, rate: RMq.matches ? 0.14 : 0.3 }, dt);
    }
    if (lumaRec) lumaRec(now);
    if (wantPoster) { wantPoster = false; makePoster(); }
    lastFrame = now;
  }

  /* ---------------- readouts, a few times a second ---------------- */
  const pcEls = Array.from({ length: 12 }, (_, i) => $(`pc-${i}`));
  let lastText = 0, frames = 0, fps = 0, fpsT = performance.now(), quietT = performance.now(), quiet = false;
  const noteName = (f) => { const m = Math.round(69 + 12 * Math.log2(f / 440)); return `${UI.PCS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`; };
  ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, () => { quietT = performance.now(); if (quiet) { quiet = false; document.body.classList.remove('quiet'); } }, { passive: true }));
  function tick(now) {
    frames++;
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    if (midi.state === 'live' && now - midi.lastT > MIDI_HOLD_MS) setMidi('no-signal');
    if (demo && !ST.seq.on) stopDemo();
    if ($('rack-sheet').open && ST.seq.on) highlightStep();
    if ($('signal-sheet').open) { drawSpec(); drawWheel(); }
    if ($('voices-sheet').open) drawMorphViz();
    if ($('rack-sheet').open) { drawChain(); drawEnvViz(); }
    if ($('garden-sheet').open) $('lin-n').textContent = LINEAGE.nodes.length;
    if ($('connect-sheet').open) { const lit = now - NOTE_EVT.t < 450 ? NOTE_EVT.semi : null; kbKeys().forEach((k) => k.classList.toggle('lit', +k.dataset.n === lit)); }
    // the pitch-class strip: the sounding note lights its class
    const pAge = now - NOTE_EVT.t, pc = ((Math.round(69 + 12 * Math.log2(morphedPatch().f0 / 440)) % 12) + 12) % 12;
    for (let i = 0; i < 12; i++) {
      const l = i === pc && ST.playing ? Math.max(0.28, 1 - pAge / 900) : 0;
      const el = pcEls[i]; el.style.opacity = (0.16 + l * 0.84).toFixed(2); el.style.setProperty('--l', l.toFixed(2));
    }
    if (!quiet && ST.playing && now - quietT > 9000 && !document.querySelector('dialog[open]') && !dragging) { quiet = true; document.body.classList.add('quiet'); }
    if (now - lastText > 140) { lastText = now; renderStates(); }
  }
  function renderStates() {
    const p = morphedPatch();
    // HUD
    $('g-pitch').innerHTML = `${Math.round(p.f0)}<small>Hz</small>`;
    $('g-note').textContent = noteName(p.f0);
    const lowLive = ST.playing && ST.lowDb > -59;
    $('g-low').innerHTML = lowLive ? `${Math.round(ST.lowDb)}<small>dB ${ST.monoValid ? (ST.mono > 0.1 ? '✓' : ST.mono < -0.1 ? '✕' : '~') : ''}</small>` : 'silent';
    // sound
    const [tone, chip, state, why] = soundView();
    $('chip-sound').dataset.tone = tone; $('chip-sound-text').textContent = chip;
    $('sound-info').dataset.tone = tone; $('sound-state').textContent = state; $('sound-why').textContent = why;
    $('sound-toggle').textContent = AC && AC.state === 'running' && ST.playing ? 'Stop' : AC && AC.state !== 'running' ? 'Resume' : 'Start';
    $('sound-toggle').disabled = !hasWebAudio;
    $('start-sound').hidden = !!(AC && AC.state === 'running' && ST.playing);
    // MIDI
    let mv;
    if (midi.state === 'live') mv = ['good', `MIDI · ${midi.log[0] ? midi.log[0].split(' · ')[0] : 'live'}`, `Signal · ${midi.count} message${midi.count === 1 ? '' : 's'}`, midi.label];
    else if (midi.state === 'no-signal') { const q = midi.lastT ? ` for ${Math.round((performance.now() - midi.lastT) / 1000)} s` : ' yet'; mv = ['warn', 'MIDI · no notes', `Device open · no notes${q}`, `${midi.label}. Play a key. Check the USB cable, or the MIDI cable into your interface.`]; }
    else { const t = MIDI_TEXT[midi.state] || MIDI_TEXT.idle; mv = [t[0], `MIDI · ${t[1].toLowerCase()}`, t[1], midi.detail || t[2]]; }
    $('chip-midi').dataset.tone = mv[0]; $('chip-midi-text').textContent = mv[1];
    $('midi-info').dataset.tone = mv[0]; $('midi-state').textContent = mv[2]; $('midi-why').textContent = mv[3];
    const open = midi.state === 'live' || midi.state === 'no-signal';
    $('midi-connect').textContent = open ? 'Disconnect' : midi.state === 'requesting' ? 'Waiting' : midi.state === 'idle' ? 'Connect' : 'Try again';
    $('midi-connect').disabled = midi.state === 'unsupported' || midi.state === 'insecure' || midi.state === 'requesting';
    $('midi-controls').hidden = !(open || midi.inputs.length);
    if (midi.inputs.length) {
      const opts = [{ id: 'all', label: `All inputs (${midi.inputs.length})` }, ...midi.inputs.map((q) => ({ id: q.id, label: q.manufacturer && !q.name.includes(q.manufacturer) ? `${q.name} · ${q.manufacturer}` : q.name }))];
      const sel = $('midi-port'), key = JSON.stringify(opts);
      if (sel.dataset.key !== key) { sel.innerHTML = opts.map((o) => `<option value="${o.id.replace(/"/g, '&quot;')}">${o.label.replace(/</g, '&lt;')}</option>`).join(''); sel.dataset.key = key; }
      sel.value = midi.inputId;
    }
    $('connect-button').classList.toggle('connected', open);
    // what is driving the sound
    const recent = performance.now() - NOTE_EVT.t < 4000;
    let src, label;
    if (demo) [src, label] = ['demo', 'Demo · the page is playing itself, not your input'];
    else if (!AC) [src, label] = ['ambient', 'Silent · press Start sound'];
    else if (AC.state !== 'running') [src, label] = ['open', 'Paused · click anywhere to let the browser play'];
    else if (recent && NOTE_EVT.src === 'midi-keys') [src, label] = ['live', 'Live · MIDI keys'];
    else if (recent && NOTE_EVT.src === 'keys') [src, label] = ['live', 'Live · computer keys'];
    else if (ST.seq.on) [src, label] = ['live', 'Live · sequencer riff'];
    else if (GARDEN.grow && ST.genomeMode) [src, label] = ['live', 'Live · auto-drift through the garden'];
    else if (ST.playing) [src, label] = ['live', mode === 'morph' ? (ST.pad ? 'Live · drone on the four-corner pad' : 'Live · drone, A into B') : 'Live · drone from the seed'];
    else [src, label] = ['open', 'Ready · press Play, a key, or drag a bud'];
    if ($('source-badge').dataset.source !== src) $('source-badge').dataset.source = src;
    if ($('source-label').textContent !== label) $('source-label').textContent = label;
    $('pad-hint').hidden = mode !== 'morph' || ST.pad;
    // what is on inside each Rack card, readable while the card is folded
    const fx = [ST.crushOn && 'Bitcrush on', ST.spaceWet > 0.005 && `space ${Math.round(ST.spaceWet * 100)} %`].filter(Boolean).join(' · ');
    if ($('fx-state').textContent !== fx) $('fx-state').textContent = fx;
    const gr = ST.grainOn ? `Cloud on${ST.grFreeze ? ', frozen' : ''}` : '', sq = ST.seq.on ? `Riff at ${ST.seq.bpm}` : '', ch = ST.chaos > 0.005 ? `Chaos ${Math.round(ST.chaos * 100)} %` : '';
    if ($('gr-state').textContent !== gr) $('gr-state').textContent = gr;
    if ($('seq-state').textContent !== sq) $('seq-state').textContent = sq;
    if ($('chaos-state').textContent !== ch) $('chaos-state').textContent = ch;
    $('demo-button').querySelector('.long').textContent = demo ? 'End demo' : 'Try a demo';
    $('demo-button').querySelector('.short').textContent = demo ? 'End' : 'Demo';
    $('demo-sheet').textContent = demo ? 'End demo' : 'Run demo';
    document.body.classList.toggle('playing', !!(demo || (AC && AC.state === 'running' && (ST.playing || recent))));
    announce(`Sound: ${chip.replace('Sound · ', '')}. MIDI: ${mv[2]}.${demo ? ' Demo running.' : ''}`);
    // sheets that are open
    if ($('signal-sheet').open) {
      $('sig-f0').textContent = `${Math.round(p.f0)} Hz`;
      $('sig-sub').textContent = `${Math.round(subFreq(p.f0))} Hz`;
      $('sig-wd').textContent = ST.genomeMode ? 'genome' : ST.wd.toFixed(2);
      $('sig-curv').textContent = ST.genomeMode ? 'the seed is not an animal blend' : curvWord(ST.wd);
      $('sig-low').textContent = lowLive ? `${ST.lowDb.toFixed(1)} dB` : 'silent';
      $('sig-fps').textContent = `${Math.round(fps)} fps`;
      $('sig-sr').textContent = AC ? `${(AC.sampleRate / 1000).toFixed(1)} kHz · ${AC.state}` : 'no sound yet';
      renderLowEnd();
    }
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
  }

  /* ---------------- live pictures inside the sheets ---------------- */
  const FX0 = Math.log(70), FX1 = Math.log(14000), fx = (f, w) => ((Math.log(f) - FX0) / (FX1 - FX0)) * w;
  const bankAt = (F, f) => { let s = 0; for (const [fc, q, a] of F) { const d = (f - fc) / (fc / Math.max(1, q) / 2); s += a / (1 + d * d); } return s; };
  const kbKeys = () => kbKeys.c || (kbKeys.c = [...document.querySelectorAll('#kbstrip .key')]);
  function trace(x, F, w, h, top, peak) {         // a formant bank's response, Lorentzian peaks on a log-frequency axis
    x.beginPath();
    for (let i = 0; i <= w; i += 2) { const y = h - 4 - Math.min(1, bankAt(F, Math.exp(FX0 + (i / w) * (FX1 - FX0))) / peak) * (h - top - 6); if (i) x.lineTo(i, y); else x.moveTo(i, y); }
  }
  function shade(x, F, w, h, top, peak, hue, a) {
    trace(x, F, w, h, top, peak); x.lineTo(w, h); x.lineTo(0, h); x.closePath();
    const g = x.createLinearGradient(0, top, 0, h); g.addColorStop(0, `hsla(${hue},80%,62%,${a})`); g.addColorStop(1, `hsla(${hue},80%,62%,0)`);
    x.fillStyle = g; x.fill();
  }
  window.drawGlyphs = function () {                 // each animal tile draws its own formant shape, in its own color
    document.querySelectorAll('#animals canvas.glyph').forEach((c) => {
      const a = ANIMALS[+c.dataset.i]; if (!a || !c.clientWidth) return;
      const { x, w, h } = fitCanvas(c), peak = Math.max(...a.F.map((f) => f[2])) * 1.08;
      x.clearRect(0, 0, w, h);
      shade(x, a.F, w, h, 2, peak, a.hue, 0.5);
      trace(x, a.F, w, h, 2, peak); x.strokeStyle = `hsl(${a.hue} 82% 72%)`; x.lineWidth = 1.4; x.stroke();
    });
  };
  function drawMorphViz() {                        // A, B and the blend now: the formants slide rather than crossfade
    const c = $('morphviz'); if (!c || !c.clientWidth) return;
    const { x, w, h } = fitCanvas(c), p = morphedPatch(), A = ANIMALS[ST.A], B = ANIMALS[ST.B], two = !ST.genomeMode && !ST.pad;
    const peak = Math.max(1, ...p.F.map((f) => f[2]), ...(two ? [...A.F, ...B.F].map((f) => f[2]) : [])) * 1.1;
    x.clearRect(0, 0, w, h);
    const AX = [[100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz']];
    AX.forEach(([f]) => { x.fillStyle = 'rgba(191,194,236,.09)'; x.fillRect(fx(f, w), 0, 1, h); });
    if (two) [[A, 1], [B, 2]].forEach(([a]) => { trace(x, a.F, w, h, 18, peak); x.setLineDash([4, 4]); x.strokeStyle = `hsla(${a.hue},80%,68%,.8)`; x.lineWidth = 1.2; x.stroke(); x.setLineDash([]); });
    const hue = ST.genomeMode ? genomeHue(GENOME || GARDEN.seed) : ((p.hue % 360) + 360) % 360;
    shade(x, p.F, w, h, 18, peak, hue, 0.55);
    trace(x, p.F, w, h, 18, peak); x.strokeStyle = '#eeedfb'; x.lineWidth = 2; x.stroke();
    p.F.forEach(([fc]) => { const xx = fx(fc, w), y = h - 4 - Math.min(1, bankAt(p.F, fc) / peak) * (h - 24); x.beginPath(); x.arc(xx, y, 3.2, 0, 7); x.fillStyle = '#eeedfb'; x.fill(); });
    x.font = '10px ui-sans-serif,-apple-system,sans-serif'; x.textAlign = 'left'; x.fillStyle = 'rgba(238,237,251,.5)';
    AX.forEach(([f, t]) => x.fillText(t, fx(f, w) + 4, 26));
    x.font = '11px ui-sans-serif,-apple-system,sans-serif';
    if (two) { x.fillStyle = `hsl(${A.hue} 80% 72%)`; x.fillText(`A · ${A.nm}`, 8, 13); x.textAlign = 'right'; x.fillStyle = `hsl(${B.hue} 80% 72%)`; x.fillText(`B · ${B.nm}`, w - 8, 13); }
    else { x.fillStyle = 'rgba(238,237,251,.7)'; x.fillText(ST.genomeMode ? (w < 460 ? 'Garden seed. Pick an animal to morph.' : 'The garden seed is playing. Pick an animal to switch to Morph.') : 'Four corners on the pad, now', 8, 13); }
  }
  function drawEnvViz() {                          // the amplitude envelope as a shape
    const c = $('envviz'); if (!c || !c.clientWidth) return;
    const { x, w, h } = fitCanvas(c), e = ST.env, hold = Math.max(0.25, (e.a + e.d + e.r) * 0.35), total = e.a + e.d + hold + e.r;
    const sx = (t) => 10 + (t / total) * (w - 20), sy = (v) => h - 16 - v * (h - 26);
    const pts = [[0, 0], [e.a, 1], [e.a + e.d, e.s], [e.a + e.d + hold, e.s], [total, 0]];
    x.clearRect(0, 0, w, h);
    x.beginPath(); pts.forEach(([t, v], i) => (i ? x.lineTo(sx(t), sy(v)) : x.moveTo(sx(t), sy(v)))); x.lineTo(sx(total), sy(0)); x.closePath();
    const g = x.createLinearGradient(0, 8, 0, h); g.addColorStop(0, 'rgba(184,183,255,.35)'); g.addColorStop(1, 'rgba(184,183,255,0)'); x.fillStyle = g; x.fill();
    x.beginPath(); pts.forEach(([t, v], i) => (i ? x.lineTo(sx(t), sy(v)) : x.moveTo(sx(t), sy(v)))); x.strokeStyle = '#b8b7ff'; x.lineWidth = 1.8; x.stroke();
    x.fillStyle = 'rgba(238,237,251,.55)'; x.font = '10px ui-sans-serif,-apple-system,sans-serif'; x.textAlign = 'center';
    [['A', 0, e.a], ['D', e.a, e.a + e.d], ['S', e.a + e.d, e.a + e.d + hold], ['R', e.a + e.d + hold, total]].forEach(([l, a, b]) => x.fillText(l, sx((a + b) / 2), h - 3));
  }
  let outBuf = null;
  function drawChain() {                           // live levels along the chain: measured where measured, scaled by settings after
    let lvl = 0;
    if (G && G.ana && ST.playing) {
      if (!outBuf || outBuf.length !== G.ana.fftSize) outBuf = new Float32Array(G.ana.fftSize);
      G.ana.getFloatTimeDomainData(outBuf); let s = 0; for (let i = 0; i < outBuf.length; i++) s += outBuf[i] * outBuf[i];
      lvl = clamp((20 * Math.log10(Math.sqrt(s / outBuf.length) + 1e-9) + 50) / 44, 0, 1);
    }
    const body = ST.playing && ST.lowDb > -60 ? clamp((ST.lowDb + 60) / 50, 0, 1) : 0;
    const g = { brain: lvl, body, nerve: lvl * (0.3 + 0.7 * Math.max(ST.drive, ST.ott, ST.fizz)), space: lvl * Math.min(1, ST.spaceWet * 1.6) };
    document.querySelectorAll('#chain .node').forEach((n) => n.style.setProperty('--g', g[n.dataset.k].toFixed(2)));
  }
  $('chain').addEventListener('click', (e) => {
    const n = e.target.closest('.node'), d = n && $(n.dataset.go); if (!d) return;
    d.open = true; d.scrollIntoView({ behavior: RMq.matches ? 'auto' : 'smooth', block: 'nearest' });
  });

  /* ---------------- poster ---------------- */
  $('poster').addEventListener('click', () => { if (glOK) wantPoster = true; else makePoster(); });
  function makePoster() {
    const W = 1600, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), src = glOK ? cv : ov;
    x.fillStyle = '#101525'; x.fillRect(0, 0, W, H);
    const s = Math.max(W / src.width, H / src.height), dw = src.width * s, dh = src.height * s;
    x.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const band = x.createLinearGradient(0, H * 0.6, 0, H);
    band.addColorStop(0, 'rgba(8,10,22,0)'); band.addColorStop(1, 'rgba(8,10,22,0.92)');
    x.fillStyle = band; x.fillRect(0, H * 0.55, W, H * 0.45);
    const p = morphedPatch();
    x.fillStyle = '#eeedfb'; x.font = '400 60px Georgia, "Times New Roman", serif'; x.textBaseline = 'alphabetic';
    x.fillText('Chimera Synth', 72, H - 170);
    x.fillStyle = '#b6b9cf'; x.font = '22px Inter, ui-sans-serif, -apple-system, sans-serif';
    x.fillText(ST.genomeMode ? `A seed from the garden · generation ${LINEAGE.nodes[LINEAGE.cur] ? LINEAGE.nodes[LINEAGE.cur].depth : 0}` : ST.pad ? 'Four animals on the pad' : `${ANIMALS[ST.A].nm} into ${ANIMALS[ST.B].nm} · t ${ST.t.toFixed(2)}`, 74, H - 128);
    const rows = [['Pitch', `${Math.round(p.f0)} Hz`], ['Sub', `${Math.round(subFreq(p.f0))} Hz`], ['Low end', ST.lowDb > -59 && ST.playing ? `${ST.lowDb.toFixed(1)} dB ${lowWord()}` : 'silent'], ['Grit', `${Math.round(ST.drive * 100)} %`], ['Seed', String(ST.seed)]];
    rows.forEach(([kk, v], i) => {
      const xx = 74 + i * 290;
      x.fillStyle = '#8d93ad'; x.font = '15px Inter, ui-sans-serif, -apple-system, sans-serif'; x.fillText(kk.toUpperCase(), xx, H - 76);
      x.fillStyle = '#eeedfb'; x.font = '300 26px Inter, ui-sans-serif, -apple-system, sans-serif'; x.fillText(v, xx, H - 44);
    });
    x.fillStyle = '#8d93ad'; x.font = '14px Inter, ui-sans-serif, -apple-system, sans-serif';
    x.fillText('Real-time synthesis in a browser · no model · generative-av-labs', 74, H - 14);
    c.toBlob((b) => { if (b) dlBlob(b, `chimera-${stamp()}.png`); }, 'image/png');
  }

  /* ---------------- flicker check hook ---------------- */
  // record the picture's brightness on a small grid, every frame, straight after it is drawn
  function recordLuma(ms) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d', { willReadFrequently: true }), frames2 = [], t0 = performance.now();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    return new Promise((res) => {
      lumaRec = (now) => {
        g.drawImage(glOK ? cv : ov, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data, grid = [];
        for (let i = 0; i < d.length; i += 4) grid.push(+(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]).toFixed(1));
        frames2.push({ t: +(now - t0).toFixed(1), grid });
        if (now - t0 > ms) { lumaRec = null; res(frames2); }
      };
    });
  }

  /* ---------------- boot ---------------- */
  UI.toast.t = 0;
  addEventListener('chimera:sheet', (e) => {          // drawn the moment a sheet opens, so no canvas is ever shown at the wrong size
    const d = e.detail;
    if (d === 'garden') drawLineage();
    if (d === 'voices') { window.drawGlyphs(); drawMorphViz(); }
    if (d === 'rack') { drawEnvViz(); drawChain(); }
    if (d === 'signal') { drawWheel(); drawSpec(); }
    renderStates();
  });
  addEventListener('resize', resize);
  addEventListener('hashchange', () => { if (location.hash.startsWith('#p=')) { loadFromHash(); UI.toast('Patch loaded from the link.'); } });   // a pasted link in an open tab
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  G2 = createGL(cv);
  if (G2 && (G2.floatRT || G2.gl.getExtension('EXT_color_buffer_half_float'))) {
    try {
      gl = G2.gl; Post = createPost(G2);
      pBg = G2.program(BG_FS); pComp = G2.program(COMP_FS);
      tN = G2.noiseTexture(20261102);
      tOv = G2.tex(4, 4, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
      tField = G2.tex(24, 24, { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
      glOK = true;
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glOK = false; UI.toast('The graphics context was lost. Reload the page to get the picture back.', 8000); });
    } catch (e) { console.error(e); glOK = false; }
  }
  if (!glOK) {                           // a plain picture without glow, so the instrument still works
    ov.id = 'stage-2d'; ov.setAttribute('role', 'img'); ov.setAttribute('aria-label', cv.getAttribute('aria-label') || 'Stage');
    cv.replaceWith(ov); ov.id = 'stage';
  }
  const stageEl = $('stage');
  stageEl.tabIndex = 0;
  stageEl.setAttribute('aria-roledescription', 'instrument');
  stageEl.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Escape');
  stageEl.setAttribute('aria-describedby', 'stage-help');
  $('scene').insertAdjacentHTML('beforeend', '<p id="stage-help" class="sr-only">In Garden, left and right arrows choose a bud, up and down lean toward it, Enter grows a seed there and Escape cancels. In Morph, the arrows move the puck. Letter keys play notes.</p>');
  setMode(store.get('mode', 'garden') === 'morph' ? 'morph' : 'garden');
  renderCorners();
  resize();
  requestAnimationFrame(render);

  window.__app = {
    ST, GARDEN, ANIMALS, LINEAGE, midi, setMode, decodeFile, handleFile, recordLuma,
    get mode() { return mode; }, get demoOn() { return !!demo; }, get glOK() { return glOK; },
    get lastDownload() { return LAST_DOWNLOAD; }, get sound() { return AC ? AC.state : 'off'; },
    kit: { feedMidi: onMidiMessage },
  };
})();
