/* shell.js: the chrome both pages share. Header, dock, sheets, state chips, signal view, sessions.
   Each page brings a canvas and its own sheet; everything about inputs and states lives here. */
(function (global) {
  'use strict';

  const ICON = {
    connect: '<path d="M8 8v8M16 8v8M5 11v2M19 11v2M12 4v16"/>',
    session: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    signal: '<path d="M3 12h3l2-6 4 13 3-9 2 4h4"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sliders: '<path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2"/><circle cx="16" cy="16" r="2"/>',
    route: '<path d="M6 21c0-5 4-5 6-9s2-6 1-9"/><path d="M18 21c0-4-2-5-3-8"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    wave: '<path d="M3 12h2l2-5 3 10 3-14 3 14 2-5h3"/>',
    midi: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="11" r=".8"/><circle cx="16" cy="11" r=".8"/><circle cx="10" cy="8" r=".8"/><circle cx="14" cy="8" r=".8"/><circle cx="12" cy="7.2" r=".8"/>',
    play: '<path d="M7 5v14l11-7z"/>',
  };
  const svg = (name, cls) => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICON[name]}</svg>`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const closeBtn = (label) => `<button class="close" data-close aria-label="${label}">${svg('close')}</button>`;
  const PAD_KEYS = { j: 'kick', k: 'snare', l: 'hat', u: 'tomH', i: 'tomM', o: 'tomL', p: 'crash', ';': 'ride' };

  const AUDIO_TEXT = {
    idle: ['idle', 'Not connected', 'Press Connect, then choose the input your kit is plugged into.'],
    requesting: ['wait', 'Waiting for permission', ''],
    denied: ['bad', 'Permission denied', ''],
    'no-device': ['bad', 'No audio device', ''],
    busy: ['bad', 'Input failed', ''],
    unsupported: ['bad', 'Not supported in this browser', ''],
    insecure: ['bad', 'Needs a secure page', ''],
    lost: ['bad', 'Device disconnected', ''],
  };
  const MIDI_TEXT = {
    idle: ['idle', 'Not connected', 'Press Connect, then choose your USB-MIDI interface.'],
    requesting: ['wait', 'Waiting for permission', ''],
    denied: ['bad', 'Permission denied', ''],
    'no-device': ['bad', 'No MIDI device', ''],
    unsupported: ['bad', 'Not supported in this browser', ''],
    insecure: ['bad', 'Needs a secure page', ''],
    lost: ['bad', 'Device disconnected', ''],
  };

  function audioView(a) {
    if (a.state === 'live') {
      const clip = performance.now() - a.clipAt < 1500;
      return { tone: clip ? 'warn' : 'good', chip: `Audio · signal ${Math.round(a.peakDb)} dB`, state: clip ? 'Signal is clipping' : `Signal · ${Math.round(a.peakDb)} dB peak`, why: clip ? `${a.label}. Lower the module volume or the input gain in your interface.` : `${a.label}${a.channels ? ` · ${a.channels} channels` : ''} · ${Math.round((a.sampleRate || 0) / 100) / 10} kHz` };
    }
    if (a.state === 'no-signal') {
      if (a.needsGesture) return { tone: 'wait', chip: 'Audio · click to start', state: 'Device open · click anywhere to start listening', why: `${a.label}. The browser holds audio until the first click.` };
      const q = a.quietMs ? ` for ${Math.round(a.quietMs / 1000)} s` : ' yet';
      const hint = a.zero ? 'The input reads as exact digital silence. Check the cable, the input routing in your interface, and that the module is on.' : 'Hit a pad. Check the cable, the module volume and the input gain.';
      return { tone: 'warn', chip: 'Audio · no signal', state: `Device open · no signal${q}`, why: `${a.label}. ${hint}` };
    }
    const t = AUDIO_TEXT[a.state] || AUDIO_TEXT.idle;
    return { tone: t[0], chip: `Audio · ${t[1].toLowerCase()}`, state: t[1], why: a.detail || t[2] };
  }
  function midiView(m) {
    if (m.state === 'live') return { tone: 'good', chip: `MIDI · ${m.last}`, state: `Signal · ${m.last}`, why: m.label };
    if (m.state === 'no-signal') {
      const q = m.lastT && m.quietMs ? ` for ${Math.round(m.quietMs / 1000)} s` : ' yet';
      return { tone: 'warn', chip: 'MIDI · no signal', state: `Device open · no MIDI${q}`, why: `${m.label}. Hit a pad. Check that the cable runs from the module's MIDI OUT to the interface's MIDI IN.` };
    }
    const t = MIDI_TEXT[m.state] || MIDI_TEXT.idle;
    return { tone: t[0], chip: `MIDI · ${t[1].toLowerCase()}`, state: t[1], why: m.detail || t[2] };
  }
  function sourceView(k) {
    if (k.demoOn) return ['demo', 'Demo · synthetic drums, not your kit'];
    if (k.replayOn) return ['replay', 'Replay · a recorded session, not live'];
    const hs = k.hitSource, a = k.audio.state === 'live', m = k.midi.state === 'live';
    if (m && hs === 'midi') return ['live', a ? 'Live · hits from MIDI, texture from audio' : 'Live · hits from MIDI'];
    if (m) return ['live', 'Live · MIDI with no notes'];
    if (a) return ['live', hs === 'midi' ? 'Live · audio texture, MIDI resting' : 'Live · hits estimated from audio'];
    if (hs === 'keys') return ['live', 'Keyboard pads · not your kit'];
    if (k.audio.state === 'no-signal' || k.midi.state === 'no-signal') return ['open', 'Connected · no signal'];
    return ['ambient', 'Ambient · no input connected'];
  }

  function mountShell(cfg) {
    const kit = cfg.kit;
    const scene = $('scene');
    document.body.dataset.app = cfg.id;

    const dockItems = [
      { id: 'connect', label: 'Connect', icon: 'connect' },
      ...(cfg.sheets || []).map((s) => ({ id: s.id, label: s.label, icon: s.icon })),
      { id: 'session', label: 'Session', icon: 'session' },
      { id: 'signal', label: 'Signal', icon: 'signal' },
    ];

    scene.insertAdjacentHTML('beforeend', `
      <div class="vignette"></div>
      <header class="header chrome">
        <a class="brand" href="./" aria-label="${esc(cfg.name)}: back to the home page">${cfg.brand}<span>${esc(cfg.name)}</span></a>
        <div class="top-actions">
          <button class="top-action" id="demo-button">Try a demo</button>
          <button class="top-action icon" id="fs-button" aria-label="Full screen">${svg('full')}</button>
        </div>
      </header>
      ${cfg.modes ? `<nav class="mode-switch chrome" aria-label="${esc(cfg.modeLabel)}">${cfg.modes.map((m) => `<button data-mode="${m.id}" aria-pressed="${m.id === cfg.mode}">${esc(m.label)}</button>`).join('')}</nav>` : ''}
      <div class="intro">
        <p class="eyebrow">${esc(cfg.intro.eyebrow)}</p>
        <h1>${esc(cfg.intro.title)}</h1>
        <p>${esc(cfg.intro.subtitle)}</p>
      </div>
      <div id="toast" role="status"></div>
      <div id="sr-status" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"></div>
      <div class="dock-wrap">
        <div id="hud" class="chrome">${cfg.hud || ''}</div>
        <div id="hit-strip" class="chrome" aria-hidden="true">
          ${['kick', 'snare', 'hat', 'tom', 'crash', 'ride'].map((v) => `<div class="hitdot"><i id="dot-${v}"></i>${v[0].toUpperCase()}</div>`).join('')}
        </div>
        <div class="badges">
          <button class="source-badge" id="source-badge" data-source="ambient" title="Open the input settings"><span class="dot" aria-hidden="true"></span><span id="source-label">Ambient · no input connected</span></button>
          <button class="chip chrome" id="chip-audio" data-tone="idle"><span class="dot" aria-hidden="true"></span><span id="chip-audio-text">Audio · not connected</span></button>
          <button class="chip chrome" id="chip-midi" data-tone="idle"><span class="dot" aria-hidden="true"></span><span id="chip-midi-text">MIDI · not connected</span></button>
        </div>
        <nav class="dock chrome" aria-label="Controls">
          ${dockItems.map((d) => `<button id="${d.id}-button" aria-haspopup="dialog" aria-expanded="false">${svg(d.icon)}<span>${esc(d.label)}</span></button>`).join('')}
          <div class="dock-divider"></div>
          <button id="about-button" aria-haspopup="dialog" aria-expanded="false">${svg('about')}<span>About</span></button>
        </nav>
        <p class="truth chrome" id="truth">${esc(cfg.truth)}</p>
      </div>`);

    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="sheet" id="connect-sheet" aria-labelledby="connect-title" tabindex="-1">
        <div class="sheet-head"><h2 id="connect-title">Bring your kit.</h2>${closeBtn('Close input settings')}</div>
        <p class="sheet-intro">MIDI says exactly which drum you hit. Audio gives the light its texture. Either one works alone.</p>
        <button class="pill primary wide" id="connect-both">Connect audio and MIDI</button>

        <div class="device-card" id="audio-card">
          ${svg('wave', 'ic')}
          <div class="device-info" id="audio-info" data-tone="idle">
            <strong>Audio input <span class="dot"></span></strong>
            <p class="state" id="audio-state">Not connected</p>
            <p class="why" id="audio-why"></p>
          </div>
          <button class="pill" id="audio-connect">Connect</button>
        </div>
        <div class="controls-grid" id="audio-controls" hidden>
          <label class="field">Input device<select id="audio-device"></select></label>
          <div class="field"><div class="row"><span>Level</span><b id="audio-db">-</b></div>
            <div class="meter" aria-hidden="true"><div><i id="meter-l"></i></div><div><i id="meter-r"></i></div></div></div>
          <label class="field"><div class="row"><span>Input trim</span><b id="trim-val">0 dB</b></div><input type="range" id="trim" min="-24" max="24" step="1" value="0"></label>
          <label class="field"><div class="row"><span>Hit sensitivity, audio only</span><b id="sens-val">1.0</b></div><input type="range" id="sens" min="50" max="200" step="5" value="100"></label>
        </div>

        <div class="device-card" id="midi-card">
          ${svg('midi', 'ic')}
          <div class="device-info" id="midi-info" data-tone="idle">
            <strong>MIDI input <span class="dot"></span></strong>
            <p class="state" id="midi-state">Not connected</p>
            <p class="why" id="midi-why"></p>
          </div>
          <button class="pill" id="midi-connect">Connect</button>
        </div>
        <div class="controls-grid" id="midi-controls" hidden>
          <label class="field">MIDI input<select id="midi-port"></select></label>
          <div class="field"><span>Last messages</span><pre class="monitor" id="midi-monitor" aria-live="off">Nothing received yet.</pre></div>
        </div>

        <div class="device-card">
          ${svg('play', 'ic')}
          <div class="device-info">
            <strong>No kit here</strong>
            <p class="why">The demo is a synthetic drum machine. It runs through the same analysis and is labeled on screen the whole time.</p>
          </div>
          <button class="pill" id="demo-sheet">Run demo</button>
        </div>
        <label class="check"><input type="checkbox" id="demo-audible"> Let me hear the demo</label>
        <label class="check"><input type="checkbox" id="reconnect"> Reconnect when I open this page, if the browser already allows it</label>

        <details id="wiring"><summary>Wiring: Pearl Mimic Pro into an Apollo Solo</summary>
          <ol>
            <li><b>Audio.</b> Two 1/4-inch TRS cables from the Mimic Pro's Line Out 1 and 2, which carry the main mix, to the Apollo Solo's rear Mic/Line 1 and 2. Set both inputs to Line, and leave the front Hi-Z jack empty, because a plug there takes over input 1.</li>
            <li><b>MIDI.</b> The Apollo Solo has no MIDI ports, and the Mimic Pro's USB slot is for installing samples. Run a 5-pin cable from the module's MIDI OUT into a USB-MIDI interface, and plug that into the computer. The browser lists the interface's name, not the module's.</li>
            <li><b>Browser.</b> Chrome or Edge. Safari has no Web MIDI, and Firefox asks for a site permission add-on. Choose "Universal Audio Thunderbolt" as the audio input.</li>
            <li><b>Monitoring.</b> These pages never play your input back. Keep listening through your interface as usual.</li>
          </ol>
        </details>
        <details id="map-details"><summary>Pad map and Learn</summary>
          <p>Each zone's note can be changed on the module, so this is only a starting point. Press Learn, then hit the pad.</p>
          <label class="field">Starting map<select id="map-preset"></select></label>
          <div id="pad-rows"></div>
          <label class="check"><input type="checkbox" id="flip-pedal"> Flip the hi-hat pedal (CC4: 127 means open)</label>
        </details>
      </dialog>

      ${(cfg.sheets || []).map((s) => `
      <dialog class="sheet" id="${s.id}-sheet" aria-labelledby="${s.id}-title" tabindex="-1">
        <div class="sheet-head"><h2 id="${s.id}-title">${esc(s.title)}</h2>${closeBtn(`Close ${s.label}`)}</div>
        ${s.intro ? `<p class="sheet-intro">${esc(s.intro)}</p>` : ''}
        ${s.html}
      </dialog>`).join('')}

      <dialog class="sheet" id="session-sheet" aria-labelledby="session-title" tabindex="-1">
        <div class="sheet-head"><h2 id="session-title">Keep what you played.</h2>${closeBtn('Close session')}</div>
        <p class="sheet-intro">A session file holds hits, pedal moves and levels. No audio goes in it, and nothing leaves this computer unless you share the file.</p>
        <div class="row-actions">
          <button class="pill primary" id="rec-toggle">Start recording</button>
          <button class="pill" id="replay-load">Replay a session file</button>
          <button class="pill" id="replay-stop" hidden>Stop replay</button>
          <button class="pill" id="snapshot">Save a picture</button>
          <input type="file" id="replay-file" accept="application/json,.json" hidden>
        </div>
        <label class="check"><input type="checkbox" id="rec-video"> Also save a video of the screen, with the input's sound if there is any</label>
        <p class="note" id="rec-status" role="status">Not recording.</p>
        <div id="session-analysis"></div>
      </dialog>

      <dialog class="sheet wide" id="signal-sheet" aria-labelledby="signal-title" tabindex="-1">
        <div class="sheet-head"><h2 id="signal-title">What the page hears.</h2>${closeBtn('Close signal view')}</div>
        <div class="statgrid">
          <div class="stat"><span class="k">Tempo</span><span class="v" id="sig-tempo">-</span><span class="n">estimated from hits</span></div>
          <div class="stat"><span class="k">Hits</span><span class="v" id="sig-hits">0</span><span class="n" id="sig-source">no source yet</span></div>
          <div class="stat"><span class="k">Input peak</span><span class="v" id="sig-peak">-</span><span class="n" id="sig-ch">no audio</span></div>
          <div class="stat"><span class="k">Hit to frame</span><span class="v" id="sig-lat">-</span><span class="n">page only, excludes the display</span></div>
          <div class="stat"><span class="k">Frame rate</span><span class="v" id="sig-fps">-</span><span class="n" id="sig-quality">-</span></div>
        </div>
        <div class="sig-title"><span>Spectrum over the last 12 seconds</span><span>low to high, newest on the right</span></div>
        <canvas class="sig-canvas" id="sig-spectro" width="1400" height="300" role="img" aria-label="Scrolling spectrogram of the input"></canvas>
        <div class="sig-title"><span>Hits over the last 8 seconds</span><span id="sig-legend">dot size is velocity</span></div>
        <canvas class="sig-canvas" id="sig-lanes" width="1400" height="230" role="img" aria-label="Timeline of hits by drum"></canvas>
      </dialog>

      <dialog class="sheet" id="about-sheet" aria-labelledby="about-title" tabindex="-1">
        <div class="sheet-head"><h2 id="about-title">What drives what.</h2>${closeBtn('Close about')}</div>
        ${cfg.about}
        <details><summary>From MIDI, from audio</summary>
          <p>MIDI names the drum you hit, with its velocity, plus the hi-hat pedal and cymbal chokes. With audio alone, kick, snare, hat, tom and crash are estimated from four frequency bands by a stated rule, and a ride is not told apart. With MIDI alone, each hit paints a stated spectrum shape instead of a measured one.</p>
          <p>Hit to frame is what this page measures. It leaves out the interface, the cable and the screen.</p>
        </details>
        <details><summary>Safety and privacy</summary>
          <p>A limiter slows any large change in brightness, and these pages measure under the WCAG limit of three flashes a second, even with hard playing. That is a measured screen, not a medical guarantee. If flashing or moving light affects you, take care, and turn on your system's reduced-motion setting, which tightens the limiter, calms the camera and removes the flash.</p>
          <p>Audio and MIDI are analyzed in this browser and never sent anywhere. The pages make no network requests after they load. Your device choice and pad map stay in this browser's storage.</p>
        </details>
        <details><summary>Ideas credited</summary>
          <p>No outside code is included. Ideas came from <a href="https://github.com/jberg/butterchurn" rel="noopener">Butterchurn</a> (MIT), Milkdrop's feedback warp; <a href="https://github.com/PavelDoGreat/WebGL-Fluid-Simulation" rel="noopener">WebGL Fluid Simulation</a> (MIT), one splat per impact; <a href="https://github.com/loqwai/paper-cranes" rel="noopener">paper-cranes</a> (BSD-3-Clause), reading each audio feature against its own recent range; <a href="https://github.com/audiojs/beat" rel="noopener">@audio/beat</a>, energy flux for percussive onsets; and <a href="https://github.com/dlepaux/realtime-bpm-analyzer" rel="noopener">realtime-bpm-analyzer</a> (Apache-2.0), tempo from live input.</p>
        </details>
        <p class="note"><a href="field-guide.html">Read the field guide</a> · <a href="__REPO_URL__" rel="noopener">Source</a></p>
      </dialog>`);

    /* ---------- sheets ---------- */
    const openSheet = (name) => {
      const d = $(`${name}-sheet`);
      if (!d || d.open) return;
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
      d.focus({ preventScroll: true });
      const b = $(`${name}-button`); if (b) b.setAttribute('aria-expanded', 'true');
      if (name === 'signal') drawSignal(true);
    };
    document.querySelectorAll('dialog.sheet').forEach((d) => {
      const name = d.id.replace('-sheet', '');
      d.addEventListener('close', () => { const b = $(`${name}-button`); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus({ preventScroll: true }); } });
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
    });
    [...dockItems.map((d) => d.id), 'about'].forEach((name) => $(`${name}-button`).addEventListener('click', () => openSheet(name)));
    ['source-badge', 'chip-audio', 'chip-midi'].forEach((id) => $(id).addEventListener('click', () => openSheet('connect')));

    /* ---------- modes ---------- */
    let mode = cfg.mode;
    const modeButtons = [...document.querySelectorAll('.mode-switch button')];
    const setMode = (m) => {
      mode = m;
      modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
      if (cfg.onMode) cfg.onMode(m);
    };
    modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    /* ---------- demo and input buttons ---------- */
    const toast = (msg, ms) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 3200); };
    const toggleDemo = async () => { if (kit.demoOn) kit.stopDemo(); else { try { await kit.startDemo(); } catch (e) { toast(`The demo could not start: ${e.message}`); } } };
    $('demo-button').addEventListener('click', toggleDemo);
    $('demo-sheet').addEventListener('click', async () => { await toggleDemo(); if (kit.demoOn) $('connect-sheet').close(); });
    $('demo-audible').addEventListener('change', (e) => kit.setDemoAudible(e.target.checked));
    $('audio-connect').addEventListener('click', () => { const s = kit.audio.state; if (s === 'live' || s === 'no-signal') kit.disconnectAudio(); else kit.connectAudio(); });
    $('midi-connect').addEventListener('click', () => { const s = kit.midi.state; if (s === 'live' || s === 'no-signal') kit.disconnectMidi(); else kit.connectMidi(); });
    $('connect-both').addEventListener('click', async () => { await kit.connectAudio(); await kit.connectMidi(); });
    $('audio-device').addEventListener('change', (e) => kit.connectAudio(e.target.value));
    $('midi-port').addEventListener('change', (e) => kit.selectMidi(e.target.value));
    const syncRange = (r) => r.style.setProperty('--val', ((+r.value - +r.min) / (+r.max - +r.min)) * 100);
    const bindRange = (id, fn) => { const r = $(id); syncRange(r); r.addEventListener('input', () => { syncRange(r); fn(+r.value); }); };
    $('trim').value = kit.audio.trimDb; $('sens').value = Math.round(kit.audio.sens * 100);
    $('trim-val').textContent = `${kit.audio.trimDb > 0 ? '+' : ''}${kit.audio.trimDb} dB`;
    $('sens-val').textContent = kit.audio.sens.toFixed(2);
    bindRange('trim', (v) => { kit.setTrim(v); $('trim-val').textContent = `${v > 0 ? '+' : ''}${v} dB`; });
    bindRange('sens', (v) => { kit.setSensitivity(v / 100); $('sens-val').textContent = (v / 100).toFixed(2); });
    document.querySelectorAll('.sheet input[type="range"]').forEach(syncRange);
    $('reconnect').checked = kit.autoconnect.on;
    $('reconnect').addEventListener('change', (e) => { kit.autoconnect.on = e.target.checked; });
    $('flip-pedal').checked = kit.midi.flipPedal;
    $('flip-pedal').addEventListener('change', (e) => kit.setFlipPedal(e.target.checked));

    /* ---------- pad map ---------- */
    const presetSel = $('map-preset');
    let mapKey = '';
    const renderMap = () => {
      const key = JSON.stringify([kit.map, kit.presetId, kit.learning]);
      if (key === mapKey) return;
      mapKey = key;
      presetSel.innerHTML = Object.entries(kit.PRESETS).map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join('') + (kit.presetId === 'custom' ? '<option value="custom">Your learned map</option>' : '');
      presetSel.value = kit.presetId;
      $('pad-rows').innerHTML = kit.PADS.map((p) => `<div class="padrow"><span>${esc(p.label)}</span><code>${(kit.map[p.id] || []).join(', ') || 'none'}</code><button class="pill${kit.learning === p.id ? ' on' : ''}" data-learn="${p.id}">${kit.learning === p.id ? 'Hit the pad' : 'Learn'}</button></div>`).join('');
    };
    presetSel.addEventListener('change', () => kit.usePreset(presetSel.value));
    $('pad-rows').addEventListener('click', (e) => { const b = e.target.closest('[data-learn]'); if (b) kit.learn(b.dataset.learn); });

    /* ---------- state rendering ---------- */
    const setSelect = (sel, opts, value) => {
      const key = JSON.stringify(opts);
      if (sel.dataset.key !== key) { sel.innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join(''); sel.dataset.key = key; }
      if (value != null && [...sel.options].some((o) => o.value === value)) sel.value = value;
    };
    const renderStates = () => {
      const a = audioView(kit.audio), m = midiView(kit.midi), [src, label] = sourceView(kit);
      const badge = $('source-badge');
      if (badge.dataset.source !== src) badge.dataset.source = src;
      if ($('source-label').textContent !== label) $('source-label').textContent = label;
      $('chip-audio').dataset.tone = a.tone; $('chip-midi').dataset.tone = m.tone;
      $('chip-audio-text').textContent = a.chip; $('chip-midi-text').textContent = m.chip;
      $('audio-info').dataset.tone = a.tone; $('midi-info').dataset.tone = m.tone;
      $('audio-state').textContent = a.state; $('audio-why').textContent = a.why;
      $('midi-state').textContent = m.state; $('midi-why').textContent = m.why;
      const aOpen = kit.audio.state === 'live' || kit.audio.state === 'no-signal';
      const mOpen = kit.midi.state === 'live' || kit.midi.state === 'no-signal';
      $('audio-connect').textContent = aOpen ? 'Disconnect' : kit.audio.state === 'requesting' ? 'Waiting' : kit.audio.state === 'idle' ? 'Connect' : 'Try again';
      $('midi-connect').textContent = mOpen ? 'Disconnect' : kit.midi.state === 'requesting' ? 'Waiting' : kit.midi.state === 'idle' ? 'Connect' : 'Try again';
      $('audio-connect').disabled = kit.audio.state === 'unsupported' || kit.audio.state === 'insecure' || kit.audio.state === 'requesting';
      $('midi-connect').disabled = kit.midi.state === 'unsupported' || kit.midi.state === 'insecure' || kit.midi.state === 'requesting';
      $('connect-both').hidden = aOpen && mOpen;
      $('audio-controls').hidden = !aOpen; $('midi-controls').hidden = !(mOpen || kit.midi.inputs.length);
      if (aOpen) setSelect($('audio-device'), kit.audio.devices, kit.audio.deviceId);
      if (kit.midi.inputs.length) {
        setSelect($('midi-port'), [{ id: 'all', label: `All inputs (${kit.midi.inputs.length})` }, ...kit.midi.inputs.map((p) => ({ id: p.id, label: p.manufacturer && !p.name.includes(p.manufacturer) ? `${p.name} · ${p.manufacturer}` : p.name }))], kit.midi.inputId);
      }
      const spoken = `Audio: ${kit.audio.state.replace('-', ' ')}. MIDI: ${kit.midi.state.replace('-', ' ')}. ${src === 'demo' ? 'Demo running.' : ''}`;
      if ($('sr-status').textContent !== spoken) $('sr-status').textContent = spoken;
      $('connect-button').classList.toggle('connected', aOpen || mOpen);
      const demoB = $('demo-button');
      demoB.textContent = kit.demoOn ? 'End demo' : 'Try a demo';
      $('demo-sheet').textContent = kit.demoOn ? 'End demo' : 'Run demo';
      $('replay-stop').hidden = !kit.replayOn;
      renderMap();
    };
    kit.on('state', renderStates);
    renderStates();

    /* ---------- recording ---------- */
    let recorder = null, recChunks = [];
    const download = (blob, name) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
    const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    $('rec-toggle').addEventListener('click', () => {
      if (!kit.recording) {
        kit.startRecording(cfg.id);
        if ($('rec-video').checked && cfg.canvas().captureStream && global.MediaRecorder) {
          const st = cfg.canvas().captureStream(60);
          const sound = kit.recordingStream();
          if (sound) sound.getAudioTracks().forEach((t) => st.addTrack(t));
          const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
          recChunks = [];
          recorder = new MediaRecorder(st, mime ? { mimeType: mime, videoBitsPerSecond: 14e6 } : {});
          recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
          recorder.onstop = () => download(new Blob(recChunks, { type: recorder.mimeType }), `${cfg.id}-${stamp()}.${(recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm'}`);
          recorder.start(1000);
        }
        $('rec-toggle').textContent = 'Stop and save';
        $('session-button').classList.add('rec');
        $('rec-status').textContent = 'Recording. Play, then press Stop and save.';
      } else {
        const s = kit.stopRecording();
        if (recorder) { recorder.stop(); recorder = null; }
        download(new Blob([JSON.stringify(s)], { type: 'application/json' }), `${cfg.id}-session-${stamp()}.json`);
        $('rec-toggle').textContent = 'Start recording';
        $('session-button').classList.remove('rec');
        $('rec-status').textContent = `Saved ${s.hits.length} hits over ${Math.round(s.durationMs / 1000)} s.`;
        renderAnalysis(s);
      }
    });
    $('replay-load').addEventListener('click', () => $('replay-file').click());
    $('replay-stop').addEventListener('click', () => kit.stopReplay());
    $('replay-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        kit.startReplay(s);
        renderAnalysis(s);
        $('rec-status').textContent = `Replaying a session from ${new Date(s.created).toLocaleString()}.`;
        $('session-sheet').close();
      } catch (err) { $('rec-status').textContent = `That file could not be replayed: ${err.message}`; }
    });
    $('snapshot').addEventListener('click', () => { if (cfg.snapshot) cfg.snapshot((blob) => download(blob, `${cfg.id}-${stamp()}.png`)); });
    function renderAnalysis(s) {
      const A = KitMath.analyzeSession(s), rows = Object.entries(A.perVoice).filter(([, p]) => p.n);
      $('session-analysis').innerHTML = `
        <div class="statgrid">
          <div class="stat"><span class="k">Length</span><span class="v">${Math.floor(A.durationS / 60)}:${String(Math.round(A.durationS % 60)).padStart(2, '0')}</span></div>
          <div class="stat"><span class="k">Hits</span><span class="v">${A.hits}</span><span class="n">${Math.round(A.hitsPerMin)} a minute</span></div>
          <div class="stat"><span class="k">Tempo</span><span class="v">${A.bpm ? `~${Math.round(A.bpm)}` : 'none'}</span><span class="n">whole session</span></div>
          <div class="stat"><span class="k">Timing spread</span><span class="v">${A.ioiDevMs != null ? `${A.ioiDevMs.toFixed(1)} ms` : 'none'}</span><span class="n">median gap from a 16th-note grid</span></div>
        </div>
        ${rows.length ? `<table class="maptable"><thead><tr><th>Drum</th><th>Hits</th><th>Velocity</th><th>Spread</th></tr></thead><tbody>${rows.map(([v, p]) => `<tr><th>${v}</th><td>${p.n}</td><td>${Math.round(p.velMean * 127)}</td><td>±${Math.round(p.velSD * 127)}</td></tr>`).join('')}</tbody></table>` : ''}`;
    }

    /* ---------- full screen, keys, quiet chrome ---------- */
    const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here.')); };
    $('fs-button').addEventListener('click', fullscreen);
    let hideChrome = false, lastMove = performance.now();
    const wake = () => { lastMove = performance.now(); if (!hideChrome) document.body.classList.remove('quiet'); };
    ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, wake, { passive: true }));
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.target.closest && e.target.closest('input, select, textarea, dialog[open]')) return;
      const key = e.key.toLowerCase();
      if (PAD_KEYS[key]) { kit.pad(PAD_KEYS[key]); return; }
      if (key === 'c') openSheet('connect');
      else if (key === 'd') toggleDemo();
      else if (key === 'f') fullscreen();
      else if (key === 'h') { hideChrome = !hideChrome; document.body.classList.toggle('quiet', hideChrome); }
      else if (cfg.onKey) cfg.onKey(e, key);
    });

    /* ---------- per-frame ---------- */
    let lastText = 0, frames = 0, fps = 0, fpsT = performance.now();
    const VOICE_ENV = ['kick', 'snare', 'hat', 'tom', 'crash', 'ride'];
    const dots = Object.fromEntries(VOICE_ENV.map((v) => [v, $(`dot-${v}`)]));
    const metrics = { hitToFrame: null, seenHit: null };
    function frame(now) {
      frames++;
      if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
      VOICE_ENV.forEach((v) => { const l = Math.min(1, kit.env[v]); dots[v].style.opacity = 0.16 + l * 0.84; dots[v].style.setProperty('--l', l.toFixed(2)); });
      if (kit.lastHit && kit.lastHit !== metrics.seenHit) { metrics.seenHit = kit.lastHit; metrics.hitToFrame = now - kit.lastHit.t; }

      const playing = kit.demoOn || kit.replayOn || (kit.hitAge != null && kit.hitAge < 20000) || kit.audio.state === 'live';
      document.body.classList.toggle('playing', playing);
      if (!hideChrome && (kit.demoOn || kit.audio.state === 'live' || kit.midi.state === 'live') && now - lastMove > 9000 && !document.querySelector('dialog[open]')) document.body.classList.add('quiet');

      if (now - lastText > 120) {
        lastText = now;
        renderStates();
        const pk = (p) => (Math.max(0, Math.min(1, (20 * Math.log10(p + 1e-9) + 60) / 60)) * 100).toFixed(1) + '%';
        if (!$('audio-controls').hidden && $('connect-sheet').open) {
          $('meter-l').style.width = pk(kit.audio.peakL); $('meter-r').style.width = pk(kit.audio.peakR);
          $('audio-db').textContent = kit.audio.peakDb > -119 ? `${Math.round(kit.audio.peakDb)} dB` : 'silence';
        }
        if ($('connect-sheet').open && kit.midi.log.length) $('midi-monitor').textContent = kit.midi.log.slice(0, 5).join('\n');
        if ($('signal-sheet').open) {
          $('sig-tempo').textContent = kit.tempo.bpm ? `~${Math.round(kit.tempo.bpm)} BPM` : 'none yet';
          $('sig-hits').textContent = kit.hits;
          const srcName = { midi: 'from MIDI', audio: 'estimated from audio', demo: 'from the demo', replay: 'from a replay', keys: 'from keyboard pads', none: 'no source yet' };
          $('sig-source').textContent = srcName[kit.hitSource];
          $('sig-peak').textContent = kit.audio.peakDb > -119 ? `${Math.round(kit.audio.peakDb)} dB` : 'none';
          $('sig-ch').textContent = kit.demoOn ? 'synthetic demo signal' : kit.replayOn ? 'recorded levels' : kit.audio.sampleRate ? `${kit.audio.channels || 2} ch · ${(kit.audio.sampleRate / 1000).toFixed(1)} kHz${kit.audio.latencyMs ? ` · about ${kit.audio.latencyMs} ms in` : ''}` : 'no audio';
          $('sig-lat').textContent = metrics.hitToFrame != null ? `${metrics.hitToFrame.toFixed(1)} ms` : 'none yet';
          $('sig-fps').textContent = `${Math.round(fps)} fps`;
          $('sig-quality').textContent = cfg.quality ? cfg.quality() : '';
        }
      }
      if ($('signal-sheet').open) drawSignal();
    }

    /* ---------- signal view ---------- */
    const COLORS = { kick: '#ffb37a', snare: '#f7d774', hat: '#9fe3e0', tom: '#d3a6ff', crash: '#ffd6e8', ride: '#a8c6f4' };
    let specImg = null;
    function drawSignal() {
      const cv = $('sig-spectro'), c = cv.getContext('2d'), W = kit.HIST_W, H = kit.BANDS;
      if (!specImg) specImg = c.createImageData(W, H);
      const px = specImg.data, xNow = kit.histX;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const col = (xNow + 1 + x) % W, v = kit.hist[(col + y * W) * 2] / 255, o = (x + (H - 1 - y) * W) * 4;
          const hue = 0.66 * (y / H);                 // the same law the pictures use: low is warm, high is cool
          const a = 6 * hue, i = Math.floor(a), f = a - i, s = 0.75, l = Math.pow(v, 0.8);
          const q = 1 - s * f, t = 1 - s * (1 - f), z = 1 - s;
          const rgb = [[1, t, z], [q, 1, z], [z, 1, t], [z, q, 1], [t, z, 1], [1, z, q]][i % 6];
          px[o] = 11 + rgb[0] * l * 244; px[o + 1] = 15 + rgb[1] * l * 240; px[o + 2] = 28 + rgb[2] * l * 227; px[o + 3] = 255;
        }
      }
      if (!drawSignal.off) { drawSignal.off = document.createElement('canvas'); drawSignal.off.width = W; drawSignal.off.height = H; }
      drawSignal.off.getContext('2d').putImageData(specImg, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(drawSignal.off, 0, 0, cv.width, cv.height);
      c.fillStyle = 'rgba(238,237,251,.7)'; c.font = '20px ui-sans-serif, -apple-system, sans-serif';
      [[100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz']].forEach(([f, t]) => {
        const y = cv.height * (1 - Math.log(f / 30) / Math.log(16000 / 30));
        c.fillRect(0, y, 14, 1.5); c.fillText(t, 20, y + 7);
      });

      const lv = $('sig-lanes'), g = lv.getContext('2d'), now = performance.now(), span = 8000, rows = ['kick', 'snare', 'hat', 'tom', 'crash', 'ride'], rh = lv.height / rows.length;
      g.fillStyle = '#0b0f1c'; g.fillRect(0, 0, lv.width, lv.height);
      g.font = '19px ui-sans-serif, -apple-system, sans-serif';
      rows.forEach((r, i) => {
        g.fillStyle = 'rgba(191,194,236,.14)'; g.fillRect(0, (i + 1) * rh - 1, lv.width, 1);
        g.fillStyle = 'rgba(238,237,251,.75)'; g.fillText(r, 12, i * rh + rh * 0.65);
      });
      kit.hitLog.forEach((h) => {
        const age = now - h.t; if (age > span) return;
        const i = rows.indexOf(h.voice); if (i < 0) return;
        const x = lv.width - (age / span) * (lv.width - 90), y = i * rh + rh / 2;
        g.beginPath(); g.arc(x, y, 3 + h.vel * 12, 0, 6.3);
        g.fillStyle = COLORS[h.voice]; g.globalAlpha = 0.35 + h.vel * 0.65; g.fill();
        if (h.est) { g.globalAlpha = 1; g.strokeStyle = '#0b0f1c'; g.lineWidth = 3; g.stroke(); }
        g.globalAlpha = 1;
      });
    }

    kit.on('midi', () => { if ($('connect-sheet').open) $('midi-monitor').textContent = kit.midi.log.slice(0, 5).join('\n'); });
    kit.tryReconnect();

    const glFail = (msg) => { const d = document.createElement('div'); d.id = 'gl-error'; d.setAttribute('role', 'alert'); d.textContent = msg; scene.appendChild(d); };
    return { frame, toast, openSheet, glFail, setMode, get mode() { return mode; }, bindRange, syncRange, get fps() { return fps; } };
  }

  global.mountShell = mountShell;
})(window);
