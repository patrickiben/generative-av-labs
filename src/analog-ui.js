/* analog-ui.js: Detail Forge Analog's frame and sheets. The markup and classes match chimera-ui.js, so shell.css and
   chimera.css style both. It runs before analog.js, which binds to these element ids. */
(function (global) {
  'use strict';

  const ICON = {
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 15h1.5l1-3 2 5 1-2h1"/>',
    sliders: '<path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2"/><circle cx="16" cy="16" r="2"/>',
    phones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
    chart: '<path d="M4 4v16h16"/><path d="m7 15 3.5-4.5 3 2.5L18 7"/>',
    keep: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/><circle cx="15.5" cy="9.5" r="1.5"/>',
    table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 5v14"/>',
    wave: '<path d="M3 12h2l2-5 3 10 3-14 3 14 2-5h3"/>',
    floor: '<path d="M3 17h6c3.5 0 3.5-9 7-9h5"/>',
    exciter: '<path d="M5 20V8M9 20v-8M13 20v-5M17 20v-3M21 20v-1.5"/>',
    transient: '<path d="M3 18h4l2.5-13L12 18h9"/>',
    sbr: '<rect x="4" y="14" width="7" height="5" rx="1"/><rect x="13" y="5" width="7" height="5" rx="1"/><path d="M7.5 14c0-5 2.5-6.5 5.5-6.5"/>',
    loop: '<path d="M4 12a6 6 0 0 1 6-6h8l-3-3M20 12a6 6 0 0 1-6 6H6l3 3"/>',
  };
  const svg = (name, cls) => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICON[name]}</svg>`;
  const $ = (id) => document.getElementById(id);
  const closeBtn = (label) => `<button class="close" data-close aria-label="${label}">${svg('close')}</button>`;
  const knob = (id, label, vid, min, max, val, txt) => `<label class="field"><div class="row"><span>${label}</span><b id="${vid}">${txt}</b></div><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"></label>`;
  const tag = (kind, text) => `<span class="tag ${kind}">${text}</span>`;
  const MEAS = tag('live', 'Measured'), AMP = tag('ot', 'Amplifies'), SYN = tag('heur', 'Synthesizes'), SYNTH = tag('synthetic', 'Synthetic');
  const BRAND = '<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M2.5 20.5h6.5c4.5 0 4.5-13 9-13h3.5"/><path d="M2.5 24.5h19" opacity=".55"/><circle cx="18" cy="7.5" r="1.4"/></svg>';

  const DOCK = [
    { id: 'source', label: 'Source', icon: 'file' },
    { id: 'engine', label: 'Engine', icon: 'sliders' },
    { id: 'listen', label: 'Listen', icon: 'phones' },
    { id: 'measured', label: 'Measured', icon: 'chart' },
    { id: 'keep', label: 'Keep', icon: 'keep' },
  ];
  const MODES = [
    { id: 'floor', name: 'Floor', cap: 'High shelf', kind: 'amp' },
    { id: 'exciter', name: 'Exciter', cap: 'Harmonics', kind: 'syn' },
    { id: 'transient', name: 'Transient', cap: 'Attack restore', kind: 'amp' },
    { id: 'sbr', name: 'SBR', cap: 'Band replication', kind: 'syn' },
  ];
  const ACCEPT = 'audio/*,.wav,.wave,.aif,.aiff,.aifc,.flac,.mp3,.m4a,.mp4,.aac,.ogg,.oga,.opus,.webm,.caf';

  const scene = $('scene');
  document.body.dataset.app = 'analog';
  scene.insertAdjacentHTML('beforeend', `
    <div class="vignette"></div>
    <header class="header chrome">
      <a class="brand" href="./" aria-label="Detail Forge Analog: back to the home page">${BRAND}<span>Detail Forge Analog</span></a>
      <div class="top-actions">
        <button class="top-action" id="open-button"><span class="long">Open audio</span><span class="short">Open</span></button>
        <button class="top-action icon" id="fs-button" aria-label="Full screen">${svg('full')}</button>
      </div>
    </header>
    <nav class="mode-switch chrome" aria-label="Engine">
      ${MODES.map((m) => `<button data-mode="${m.id}" aria-pressed="${m.id === 'sbr'}">${m.name}</button>`).join('')}
    </nav>
    <div class="intro">
      <p class="eyebrow" id="intro-eyebrow">Detail Forge Analog · labeled detail</p>
      <h1 id="intro-title">Brighten a dull recording, honestly.</h1>
      <p id="intro-sub">A synthetic test sound is loaded. Press Play, then flip A and B by tapping the letter or pressing the space bar.</p>
      <button class="pill primary start" id="start-listen">${svg('play')}Start listening</button>
    </div>
    <div id="toast" role="status"></div>
    <div id="sr-status" role="status" aria-live="polite" class="sr-only"></div>
    <div id="drop" hidden>
      <div class="drop-box">
        <p class="eyebrow">Drop an audio file</p>
        <div class="drop-targets"><div class="drop-target over"><b>Open it here</b><span>WAV, AIFF, FLAC, MP3, M4A or Ogg. It stays in this browser.</span></div></div>
      </div>
    </div>
    <div class="dock-wrap">
      <div id="hud" class="chrome">
        <button class="hud-play" id="hud-play" aria-pressed="false" aria-label="Play">${svg('play')}<span id="hud-play-b">Play</span></button>
        <div class="gauge"><span class="k">Cutoff</span><span class="v" id="g-cutoff">-</span></div>
        <button class="gauge hero" id="ab-toggle" aria-pressed="false" aria-label="Listening: A, source. Press to hear B, the result"><span class="k">Listening</span> <span class="v" id="g-side">A</span> <span class="ab-sub" id="g-side-name">source</span></button>
        <div class="gauge"><span class="k">Bandwidth</span><span class="v" id="g-bw">-</span></div>
      </div>
      <div class="badges">
        <button class="source-badge" id="source-badge" data-source="synthetic" title="Open the source"><span class="dot" aria-hidden="true"></span><span id="source-label">Synthetic test sound · not a recording</span></button>
        <button class="chip chrome" id="chip-proc" data-tone="wait"><span class="dot" aria-hidden="true"></span><span id="chip-proc-text">Processing</span></button>
        <button class="chip chrome" id="chip-sound" data-tone="idle"><span class="dot" aria-hidden="true"></span><span id="chip-sound-text">Sound · off</span></button>
      </div>
      <nav class="dock chrome" aria-label="Controls">
        ${DOCK.map((d) => `<button id="${d.id}-button" aria-haspopup="dialog" aria-expanded="false">${svg(d.icon)}<span>${d.label}</span></button>`).join('')}
        <div class="dock-divider"></div>
        <button id="about-button" aria-haspopup="dialog" aria-expanded="false">${svg('about')}<span>About</span></button>
      </nav>
      <p class="truth chrome" id="truth">Nothing here recovers lost audio. Floor amplifies what is there; Exciter and SBR synthesize new detail above the measured cutoff, and Transient's moving gain spreads some new highs there too. Every number is measured on the output, in this browser.</p>
    </div>`);

  const sheet = (id, title, intro, html, wide) => `
    <dialog class="sheet${wide ? ' wide' : ''}" id="${id}-sheet" aria-labelledby="${id}-title" tabindex="-1">
      <div class="sheet-head"><h2 id="${id}-title">${title}</h2>${closeBtn(`Close ${id}`)}</div>
      ${intro ? `<p class="sheet-intro">${intro}</p>` : ''}
      ${html}
    </dialog>`;
  // the same parts as Chimera's sheets, after Autonomic Telemetry's panels: cards, setting rows with switches,
  // segmented choices, big tiles, callouts, and a live picture in every sheet
  const card = (title, inner, o = {}) => `<section class="card"${o.id ? ` id="${o.id}"` : ''}><div class="card-head"><h3${o.hid ? ` id="${o.hid}"` : ''}>${title}</h3>${o.right || ''}</div>${inner}</section>`;
  const dcard = (title, inner, o = {}) => `<details class="card"${o.open ? ' open' : ''}${o.id ? ` id="${o.id}"` : ''}><summary class="card-head"><h3>${title}</h3>${o.right || ''}</summary><div class="card-body">${inner}</div></details>`;
  const row = (title, desc, control) => `<div class="set-row"><div><b>${title}</b><span>${desc}</span></div>${control}</div>`;
  const sw = (id, label, on) => `<button class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}" id="${id}" aria-label="${label}"></button>`;
  const callout = (html, id) => `<p class="callout"${id ? ` id="${id}"` : ''}>${html}</p>`;
  const dev = (icon, id, title, state, why, btn) => `<div class="dev"><span class="ic-wrap">${svg(icon)}</span><div class="device-info" id="${id}-info" data-tone="idle"><strong>${title} <span class="dot"></span></strong><p class="state" id="${id}-state">${state}</p><p class="why" id="${id}-why">${why}</p></div>${btn}</div>`;
  const stat = (k, id, n) => `<div class="stat"><span class="k">${k}</span><span class="v" id="${id}">-</span><span class="n" id="${id}-n">${n}</span></div>`;

  document.body.insertAdjacentHTML('beforeend', [
    sheet('source', 'Your sound.', 'Open a recording, or keep the synthetic test sound. A file is read in this browser and never uploaded.', `
      ${card('Sound', `
        ${dev('file', 'src', 'Sound', 'Synthetic test sound', 'Made in this page. Open a file to work on your own.', '<button class="pill" id="src-open">Open a file</button>')}
        <input type="file" id="file-input" accept="${ACCEPT}" hidden>
        ${callout('Made in this page, so nothing was decoded.', 'src-rate')}
        <p class="hint">Or drop a file anywhere on the page.</p>`)}
      ${card('Range', `<canvas class="viz" id="wave-viz" role="img" aria-label="The waveform of the whole sound, with the range being enhanced" style="height:92px"></canvas>
        ${row('Enhance from', 'Seconds into the sound', '<div class="range-in"><input type="number" id="sel-t0" step="0.01" min="0" aria-label="Range start in seconds"><span>to</span><input type="number" id="sel-t1" step="0.01" min="0" aria-label="Range end in seconds"></div>')}
        <p class="hint" id="sel-status">The whole sound. Drag across the spectrograms to choose a stretch, and a click clears it.</p>
        ${callout('Only the range is processed, with 50 ms crossfades at the seams, and the rest stays untouched. The numbers are measured on the range itself.')}`, { right: '<button class="pill small" id="sel-full">Whole sound</button>' })}
      ${card('Test sound', `${row('Synthetic test sound', 'Plucked chords and breath noise, cut off above 11 kHz', '<button class="pill" id="src-synth">Load it</button>')}
        ${callout('Made in this page from a fixed seed, to stand in for a dull recording. It is not a recording of anything.')}`, { right: SYNTH })}
      ${dcard('What this browser can open', `<ul>
          <li><b>WAV and AIFF</b> are read straight from the file, sample for sample: 8 to 32-bit PCM and 32 or 64-bit float.</li>
          <li><b>FLAC, MP3, M4A and Ogg</b> are decoded by the browser at the rate in the file's own header, so the browser does not resample them. Opus always decodes at 48 kHz, its own rate.</li>
          <li>When a header cannot be read, the page says so and names the rate it decoded at.</li>
          <li>Up to 10 minutes and two channels. Extra channels are left out, and the page says so.</li>
        </ul>`, { id: 'formats' })}`),

    sheet('engine', 'Choose the engine.', 'Two engines amplify what is there, and two synthesize new detail above the measured cutoff. Each change runs again by itself.', `
      <div class="tiles four" role="group" aria-label="Engine">
        ${MODES.map((m) => `<button class="tile-btn eng" data-mode="${m.id}" aria-pressed="${m.id === 'sbr'}">${svg(m.id)}<b>${m.name}</b><span class="cap">${m.cap}</span>${m.kind === 'amp' ? AMP : SYN}</button>`).join('')}
      </div>
      ${card('Response', `<canvas class="viz" id="engine-viz" role="img" aria-label="A picture of what the chosen engine does" style="height:150px"></canvas>
        <p class="hint" id="engine-viz-note">-</p>`, { hid: 'engine-viz-title', right: '<span class="cstate" id="engine-state"></span>' })}
      ${card('Settings', `
        <div class="knobs" data-for="sbr">
          ${knob('k-wet', 'Wet, the synthesized amount', 'v-wet', 0, 100, 65, '65 %')}
          ${knob('k-tilt', 'High-frequency tilt', 'v-tilt', -14, -2, -6, '-6 dB/oct')}
          ${knob('k-target', 'Target ceiling', 'v-target', 10, 22, 20, '20 kHz')}
        </div>
        <div class="knobs" data-for="floor" hidden>${knob('k-gain', 'Shelf gain', 'v-gain', 0, 18, 9, '9 dB')}</div>
        <div class="knobs" data-for="exciter" hidden>
          ${knob('k-drive', 'Drive', 'v-drive', 10, 90, 40, '4.0')}
          ${knob('k-emix', 'Mix', 'v-emix', 5, 80, 35, '35 %')}
        </div>
        <div class="knobs" data-for="transient" hidden>${knob('k-tamt', 'Attack amount', 'v-tamt', 10, 100, 60, '60 %')}</div>
        <div class="bar" aria-hidden="true"><i id="proc-bar"></i></div>
        <p class="hint" id="proc-line" role="status">-</p>
        ${callout('-', 'engine-note')}`, { right: '<button class="pill small" id="eng-reset">Defaults</button>' })}`, true),

    sheet('listen', 'Hear the difference.', 'A and B play from the same instant, so a flip changes only the processing.', `
      <div class="tiles three">
        <button class="tile-btn" id="listen-play" aria-pressed="false">${svg('play')}<b id="listen-play-b">Play</b><span class="cap" id="listen-play-cap">From the start</span></button>
        <button class="tile-btn side" id="side-a" aria-pressed="true"><span class="big">A</span><b>Source</b><span class="cap">As it was</span></button>
        <button class="tile-btn side" id="side-b" aria-pressed="false"><span class="big">B</span><b>Result</b><span class="cap" id="side-b-cap">Loudness-matched</span></button>
      </div>
      ${card('Level, K-weighted', `<canvas class="viz" id="level-viz" role="img" aria-label="The K-weighted level of A, of B as made, and of B as you hear it, with the level playing now" style="height:112px"></canvas>
        <p class="hint" id="level-note">-</p>`, { right: tag('live', 'BS.1770') })}
      ${card('Settings', `${row('Match loudness', 'B is scaled by the BS.1770 gain, so brighter is never mistaken for louder', sw('match', 'Match loudness', true))}
        ${row('Loop', 'Repeat the range, or the whole sound', sw('loop', 'Loop', true))}
        <div class="vol">${knob('vol', 'Volume', 'vol-val', 0, 100, 80, '80 %')}</div>`)}
      ${callout('Space flips A and B, and holding it down does not flip again. The K-weighting uses its 48 kHz coefficients at every rate, as the desktop app does, so at other rates the match is close rather than exact.')}`),

    sheet('measured', 'What changed, measured.', `Measured on the real output with Welch spectra, in this browser. ${MEAS}`, `
      <div class="statgrid">
        ${stat('Bandwidth', 'm-bw', 'measured')}
        ${stat('High band', 'm-hb', 'above the cutoff')}
        ${stat('Original band', 'm-lsd', 'log-spectral distance, lower is truer')}
        ${stat('Added band', 'm-nr', 'spectral flatness')}
        ${stat('Loudness match', 'm-gain', 'BS.1770 gain on B')}
        ${stat('Cutoff', 'm-fc', 'measured on the source')}
      </div>
      ${callout('The synthesized band reads as hiss. Lower the wet amount or the tilt, or the source may be too narrow.', 'm-warn')}
      ${card('Spectrum before and after', `<canvas class="viz" id="spec-viz" role="img" aria-label="Welch power spectra of the source and the result, with the measured cutoff" style="height:190px"></canvas>
        <p class="hint" id="m-span">-</p>`, { right: MEAS })}
      ${dcard('Fixed from the desktop app', `<p>With a range selected, the desktop app measured the first 2<sup>18</sup> samples of the whole file, 5.46 s at 48 kHz, so a range later than that read as unchanged. This page measures the range it processed. Everything else matches the desktop app number for number.</p>`, { id: 'fix' })}`, true),

    sheet('keep', 'Keep the result.', 'Everything stays in this browser until you save a file yourself.', `
      <div class="tiles three">
        <button class="tile-btn" id="export-wav">${svg('wave')}<b>WAV</b><span class="cap">24-bit, the whole sound</span></button>
        <button class="tile-btn" id="export-png">${svg('image')}<b>Picture</b><span class="cap">The stage, with readouts</span></button>
        <button class="tile-btn" id="export-json">${svg('table')}<b>Numbers</b><span class="cap">Settings and measures</span></button>
      </div>
      <p class="hint" id="keep-status" role="status">Nothing saved yet.</p>
      ${card('Take it further', `<p class="hint lead">Save the WAV, then open it in <a href="nebula.html">Nebula</a>, whose Form mode turns a sound into a particle cloud, or in <a href="chimera.html">Chimera Synth</a>, which grows a seed from a sound or plays it as a voice.</p>`)}
      ${callout('The WAV is 24-bit at the source\'s own rate: the whole sound, with the range enhanced if you chose one, written sample for sample as the desktop app writes it.')}`),

    sheet('about', 'What is real here.', 'Detail Forge Analog\'s signal processing, ported line by line from the desktop app and checked against it number for number, running in this browser.', `
      <div class="legend" id="label-legend">
        <div class="lg">${MEAS}<p>Every number is measured on the real output: bandwidth, the level above the cutoff, how well the original band was kept, and the loudness match.</p></div>
        <div class="lg">${AMP}<p>Floor and Transient change the level of what is there. Floor is the honest control: a high shelf that invents nothing above the cutoff.</p></div>
        <div class="lg">${SYN}<p>Exciter and SBR make new content above the cutoff from what is below it. Plausible detail, synthesized, never recovered.</p></div>
        <div class="lg">${SYNTH}<p>The test sound is made in this page and labeled on screen the whole time it is loaded.</p></div>
      </div>
      ${dcard('Running in this page', `<ul>
          <li>The cutoff measured from a Welch spectrum, as the desktop app measures it.</li>
          <li>Four engines: an RBJ high shelf, a 4x oversampled harmonic exciter, a dynamic-gain transient restore, and spectral band replication.</li>
          <li>Range processing with 50 ms crossfades, before and after spectrograms, and a loudness-matched A/B.</li>
          <li>A 24-bit WAV written the way the desktop app writes it.</li>
        </ul>`)}
      ${dcard('What it cannot do', `<p>It cannot recover lost audio. A band-limited recording cannot be restored, only continued. SBR folds the top octave below the cutoff upward and gives it fresh phase: plausible highs, not the ones that were there. Its random phases come from this page's own seeded generator, so its output differs from the desktop app's in the synthesized band, within the same spread.</p>`)}
      ${dcard('Checked against the desktop app', `<p>230 of 230 checks passed: samples within 1.8 × 10<sup>-7</sup> of the desktop app's, every measure equal to four decimals, SBR inside the desktop app's own run-to-run spread, and the 24-bit WAV byte for byte. The one change is the measuring window, under Measured.</p>`)}
      ${dcard('Keys', `<p>Space flips A and B. P plays or stops. 1 to 4 choose Floor, Exciter, Transient and SBR. O opens a file. F is full screen, and Escape closes a sheet.</p>`)}
      ${dcard('Safety and privacy', `<p>Start quietly. Exciter and SBR add high frequencies that can sound harsh on headphones, and B is matched to A in loudness, not limited. The picture changes only when you act or play, and it measures under the WCAG limit of three flashes a second, even with fast engine and A/B switching. That is a measured screen, not a medical guarantee.</p>
        <p>Your file is read in this browser and never sent anywhere. The page makes no network requests after it loads. Your volume, loop and match choices stay in this browser's storage.</p>`)}
      ${dcard('Ideas credited', `<p>No outside code is included. Spectral band replication follows the idea in HE-AAC's SBR. The shelf follows Robert Bristow-Johnson's Audio EQ Cookbook, and the loudness match uses the K-weighting of ITU-R BS.1770. The exciter follows the classic studio exciter.</p>`)}
      <p class="note"><a href="field-guide.html#analog">Read the field guide</a> · <a href="__REPO_URL__" rel="noopener">Source</a></p>`),
  ].join(''));

  /* ---------- sheets ---------- */
  const openSheet = (name) => {
    const d = $(`${name}-sheet`);
    if (!d || d.open) return;
    document.querySelectorAll('dialog.sheet[open]').forEach((o) => o.close());
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    d.focus({ preventScroll: true });
    const b = $(`${name}-button`); if (b) b.setAttribute('aria-expanded', 'true');
    global.dispatchEvent(new CustomEvent('analog:sheet', { detail: name }));
  };
  document.querySelectorAll('dialog.sheet').forEach((d) => {
    const name = d.id.replace('-sheet', '');
    d.addEventListener('close', () => { const b = $(`${name}-button`), a = document.activeElement; if (b) { b.setAttribute('aria-expanded', 'false'); if (!a || a === document.body || d.contains(a)) b.focus({ preventScroll: true }); } });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  });
  [...DOCK.map((d) => d.id), 'about'].forEach((name) => $(`${name}-button`).addEventListener('click', () => openSheet(name)));
  $('source-badge').addEventListener('click', () => openSheet('source'));
  $('chip-proc').addEventListener('click', () => openSheet('measured'));
  $('chip-sound').addEventListener('click', () => openSheet('listen'));

  const toast = (msg, ms) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 3600); };
  const syncRange = (r) => r.style.setProperty('--val', ((+r.value - +r.min) / (+r.max - +r.min)) * 100);
  document.addEventListener('input', (e) => { if (e.target.type === 'range') syncRange(e.target); });
  const syncAllRanges = () => document.querySelectorAll('input[type="range"]').forEach(syncRange);
  syncAllRanges();

  global.AnalogUI = { openSheet, toast, syncAllRanges, svg, MODES };
})(window);
