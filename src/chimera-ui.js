/* chimera-ui.js: Chimera Synth's frame and sheets. The markup and classes match shell.js, so shell.css styles both.
   It runs before the engine, which binds to these element ids exactly as the desktop page did. */
(function (global) {
  'use strict';

  const ICON = {
    keys: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v7M12 6v7M16 6v7"/>',
    wave: '<path d="M3 12h2l2-5 3 10 3-14 3 14 2-5h3"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5Z"/><path d="M12 14.5c0-3-2.4-5-5.5-5 0 3 2.4 5 5.5 5Z"/>',
    sliders: '<path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2"/><circle cx="16" cy="16" r="2"/>',
    signal: '<path d="M3 12h3l2-6 4 13 3-9 2 4h4"/>',
    patch: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/><circle cx="15.5" cy="9.5" r="1.5"/>',
    midi: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="11" r=".8"/><circle cx="16" cy="11" r=".8"/><circle cx="10" cy="8" r=".8"/><circle cx="14" cy="8" r=".8"/><circle cx="12" cy="7.2" r=".8"/>',
  };
  const svg = (name, cls) => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICON[name]}</svg>`;
  const $ = (id) => document.getElementById(id);
  const closeBtn = (label) => `<button class="close" data-close aria-label="${label}">${svg('close')}</button>`;
  const knob = (id, label, vid, min, max, val, txt) => `<label class="field"><div class="row"><span>${label}</span><b id="${vid}">${txt}</b></div><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"></label>`;
  const tag = (kind, text) => `<span class="tag ${kind}">${text}</span>`;
  const LIVE = tag('live', 'Live'), OT = tag('ot', 'OT-style'), STAND = tag('heur', 'Stand-in');
  const BRAND = '<svg viewBox="0 0 24 28" aria-hidden="true"><circle cx="12" cy="14" r="3.2"/><path d="M12 10.8V4.5M12 17.2v6.3M8.8 14H2.5M15.2 14h6.3M9.7 11.7 5.3 7.3M14.3 16.3l4.4 4.4M14.3 11.7l4.4-4.4M9.7 16.3l-4.4 4.4"/><circle cx="12" cy="3.6" r="1.1"/><circle cx="20.4" cy="6.6" r="1.1"/><circle cx="3.6" cy="21.4" r="1.1"/></svg>';

  const DOCK = [
    { id: 'connect', label: 'Play', icon: 'keys' },
    { id: 'voices', label: 'Voices', icon: 'wave' },
    { id: 'garden', label: 'Garden', icon: 'sprout' },
    { id: 'rack', label: 'Rack', icon: 'sliders' },
    { id: 'signal', label: 'Signal', icon: 'signal' },
    { id: 'patch', label: 'Keep', icon: 'patch' },
  ];
  const PCS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  const scene = $('scene');
  document.body.dataset.app = 'chimera';
  scene.insertAdjacentHTML('beforeend', `
    <div class="vignette"></div>
    <div id="corners" class="chrome" hidden>
      ${[0, 1, 2, 3].map((k) => `<button class="corner c${k}" data-corner="${k}" aria-label="Corner ${k + 1}: change the animal"></button>`).join('')}
    </div>
    <header class="header chrome">
      <a class="brand" href="./" aria-label="Chimera Synth: back to the home page">${BRAND}<span>Chimera Synth</span></a>
      <div class="top-actions">
        <button class="top-action" id="play" aria-pressed="false">Play drone</button>
        <button class="top-action" id="demo-button"><span class="long">Try a demo</span><span class="short">Demo</span></button>
        <button class="top-action icon" id="fs-button" aria-label="Full screen">${svg('full')}</button>
      </div>
    </header>
    <nav class="mode-switch chrome" aria-label="What the stage shows">
      <button data-mode="garden" aria-pressed="true">Garden</button><button data-mode="morph" aria-pressed="false">Morph</button>
    </nav>
    <div class="intro">
      <p class="eyebrow" id="intro-eyebrow">Chimera Synth · a genome you play by ear</p>
      <h1 id="intro-title">Breed a bass by ear.</h1>
      <p id="intro-sub">Drag a bud along its vine and listen. Real synthesis in this browser, with no model and no server.</p>
      <button class="pill primary start" id="start-sound">${svg('play')}Start sound</button>
    </div>
    <div id="toast" role="status"></div>
    <div id="sr-status" role="status" aria-live="polite" class="sr-only"></div>
    <div id="drop" hidden>
      <div class="drop-box">
        <p class="eyebrow">Drop an audio file</p>
        <div class="drop-targets">
          <div class="drop-target" data-kind="genopatch"><b>Grow a seed from it</b><span>Fits the genome to the sample's spectrum</span></div>
          <div class="drop-target" data-kind="sample"><b>Use it as a voice</b><span>Measured formants, or the raw sample as the oscillator</span></div>
        </div>
      </div>
    </div>
    <div class="dock-wrap">
      <div id="hud" class="chrome">
        <div class="gauge"><span class="k">Pitch</span><span class="v" id="g-pitch">110<small>Hz</small></span></div>
        <div class="gauge hero"><span class="k">Note</span><span class="v" id="g-note">A2</span></div>
        <div class="gauge"><span class="k">Low end</span><span class="v" id="g-low">silent</span></div>
      </div>
      <div id="pc-strip" class="chrome" aria-hidden="true">${PCS.map((p, i) => `<div class="pcdot"><i id="pc-${i}"></i>${p}</div>`).join('')}</div>
      <div class="badges">
        <button class="source-badge" id="source-badge" data-source="ambient" title="Open the play settings"><span class="dot" aria-hidden="true"></span><span id="source-label">Silent · press Start sound</span></button>
        <button class="chip chrome" id="chip-sound" data-tone="idle"><span class="dot" aria-hidden="true"></span><span id="chip-sound-text">Sound · off</span></button>
        <button class="chip chrome" id="chip-midi" data-tone="idle"><span class="dot" aria-hidden="true"></span><span id="chip-midi-text">MIDI · not connected</span></button>
      </div>
      <nav class="dock chrome" aria-label="Controls">
        ${DOCK.map((d) => `<button id="${d.id}-button" aria-haspopup="dialog" aria-expanded="false">${svg(d.icon)}<span>${d.label}</span></button>`).join('')}
        <div class="dock-divider"></div>
        <button id="about-button" aria-haspopup="dialog" aria-expanded="false">${svg('about')}<span>About</span></button>
      </nav>
      <p class="truth chrome" id="truth">Real-time synthesis in this browser: FM, formant filters and a phase-checked sub. The morph is a stated formant displacement, not a model. MIDI stays on this computer.</p>
    </div>`);

  const sheet = (id, title, intro, html, wide) => `
    <dialog class="sheet${wide ? ' wide' : ''}" id="${id}-sheet" aria-labelledby="${id}-title" tabindex="-1">
      <div class="sheet-head"><h2 id="${id}-title">${title}</h2>${closeBtn(`Close ${id === 'connect' ? 'play settings' : id === 'patch' ? 'keep' : id}`)}</div>
      ${intro ? `<p class="sheet-intro">${intro}</p>` : ''}
      ${html}
    </dialog>`;
  // one set of parts for every sheet, after Autonomic Telemetry's panels: cards, setting rows with switches,
  // segmented choices, big tiles, callouts, and a live picture where there is something to see
  const card = (title, inner, o = {}) => `<section class="card"${o.id ? ` id="${o.id}"` : ''}><div class="card-head"><h3>${title}</h3>${o.right || ''}</div>${inner}</section>`;
  const dcard = (title, inner, o = {}) => `<details class="card"${o.open ? ' open' : ''}${o.id ? ` id="${o.id}"` : ''}><summary class="card-head"><h3>${title}</h3>${o.right || ''}</summary><div class="card-body">${inner}</div></details>`;
  const row = (title, desc, control) => `<div class="set-row"><div><b>${title}</b><span>${desc}</span></div>${control}</div>`;
  const sw = (id, label) => `<button class="switch" role="switch" aria-checked="false" id="${id}" aria-label="${label}"></button>`;
  const callout = (html, id) => `<p class="callout"${id ? ` id="${id}"` : ''}>${html}</p>`;
  const dev = (icon, id, title, state, why, btn) => `<div class="dev"><span class="ic-wrap">${svg(icon)}</span><div class="device-info" id="${id}-info" data-tone="idle"><strong>${title} <span class="dot"></span></strong><p class="state" id="${id}-state">${state}</p><p class="why" id="${id}-why">${why}</p></div>${btn}</div>`;
  const ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.caf';
  const VIBES = [['crunchy but wet swamp monster', '🐸', '🐋', 'Swamp monster'], ['screaming metallic high-end glitch', '🦗', '🦅', 'Metallic glitch'],
    ['deep cinematic sub whale rumble', '🐋', '🐘', 'Cinematic rumble'], ['aggressive growling predator wub', '🐺', '🦅', 'Predator wub'],
    ['jungle king roar', '🦁', '🐺', 'Jungle roar'], ['night owl hoot', '🦉', '🐋', 'Night hoot'], ['hive swarm buzz', '🐝', '🦗', 'Hive buzz'], ['dry desert rattle hiss', '🐍', '🦗', 'Desert rattle']];

  document.body.insertAdjacentHTML('beforeend', [
    sheet('connect', 'Play it.', 'A MIDI keyboard plays it, and so do the computer keys. The sound comes out of this page, so turn on your speakers or headphones.', `
      ${card('Inputs', `
        ${dev('wave', 'sound', 'Sound', 'Off', 'Browsers start sound only after a click. Start quietly: the sub can be loud on big speakers.', '<button class="pill" id="sound-toggle">Start</button>')}
        <div class="vol">${knob('vol', 'Volume', 'vol-val', 0, 100, 70, '70 %')}</div>
        ${dev('midi', 'midi', 'MIDI input', 'Not connected', 'Press Connect, then choose your MIDI keyboard.', '<button class="pill" id="midi-connect">Connect</button>')}
        <div class="controls-grid" id="midi-controls" hidden>
          <label class="field">MIDI input<select id="midi-port"></select></label>
          <div class="field"><span>Last messages</span><pre class="monitor" id="midi-monitor" aria-live="off">Nothing received yet.</pre></div>
        </div>`)}
      ${card('Computer keys', `<div id="kbstrip" role="group" aria-label="On-screen keys"></div>
        <p class="hint">Z to M is the lower octave and Q to U the upper, with the sharps on the row above. Last note <b id="kbnote">0 st</b>.</p>`)}
      ${card('Just exploring?', `<button class="pill primary wide" id="demo-sheet">Run demo</button>
        <p class="hint">The demo plays a riff through the garden by itself, and it is labeled on screen the whole time.</p>`)}
      ${card('Settings', row('Reconnect MIDI', 'When this page opens, if the browser already allows it', sw('reconnect', 'Reconnect MIDI when this page opens')))}
      ${dcard('Connecting a MIDI keyboard', `<ol>
          <li><b>Plug in.</b> A USB MIDI keyboard plugs straight into the computer. A keyboard with a 5-pin MIDI OUT needs a USB-MIDI interface. The browser lists the device's name.</li>
          <li><b>Browser.</b> Chrome or Edge. Safari has no Web MIDI, and Firefox asks for a site permission add-on. The computer keys work everywhere.</li>
          <li><b>Notes.</b> Middle C is the root, and every channel plays the same way. With per-note branches on in Garden, each note leans the genome toward its own bud.</li>
          <li><b>Sound.</b> This page makes the sound and plays it through the computer's output. It never listens to your microphone or inputs.</li>
        </ol>`, { id: 'wiring' })}`),

    sheet('voices', 'Choose the animals.', `Each voice is an FM core through a bank of formant filters, the resonances that make a duck sound like a duck, plus a breath of noise. ${LIVE}`, `
      ${card('Morph', `<canvas id="morphviz" class="viz" role="img" aria-label="The formants of animal A, animal B and the blend now, on a log-frequency axis"></canvas>
        <div class="morphbar"><span class="end a" id="endA">Mallard</span><input type="range" id="morph" min="0" max="100" value="0" aria-label="Morph from animal A to animal B"><span class="end b" id="endB">Timber</span></div>
        <div class="minis"><span class="mini">t <b id="v-morph">0.00</b></span><span class="mini">f₀ <b id="c-f0">320 Hz</b></span><span class="mini">sub <b id="c-sub">80 Hz</b></span><span class="mini">displacement <b id="c-wd">0.00</b></span><span class="mini">curvature <b id="c-curv">flat</b></span></div>
        ${callout('Halfway, you do not hear both animals at once, which would be a crossfade. You hear a new creature: the formants slide along a log-frequency axis from A to B, the way optimal transport moves spectral mass.')}`, { right: OT })}
      ${card('Animals', `<div class="animals" id="animals"></div>
        ${callout('Each animal is a small hand-set recipe: a pitch, a waveform, an FM amount, noise and three formants. A caricature by ear, not a recording or a measurement.')}`,
        { right: '<div class="seg" id="abseg" role="group" aria-label="What a tap sets"><button data-ab="A" class="on">Tap sets A</button><button data-ab="B">Tap sets B</button></div>' })}
      ${card('Shape', `<div class="knobs">
          ${knob('k-wub', 'Wub rate', 'v-wub', 0, 120, 32, '3.2 Hz')}
          ${knob('k-wubd', 'Wub depth', 'v-wubd', 0, 100, 55, '55 %')}
          ${knob('k-oct', 'Pitch', 'v-oct', -24, 12, 0, '0 st')}
          ${knob('k-glide', 'Glide', 'v-glide', 0, 300, 40, '40 ms')}
        </div>`, { right: '<button class="pill small" id="pluck">Pluck</button>' })}
      ${card('Pad and polyphony', `
        ${row('Four-corner pad', 'Blend four animals instead of two. In Morph, drag it on the stage.', sw('padtoggle', 'Four-corner pad'))}
        ${row('Chord', 'Only the lead voices stack. The sub stays single, on the root.', '<div class="seg" id="chordseg" role="group" aria-label="Chord"><button data-chord="off" class="on">Off</button><button data-chord="5th">Fifth</button><button data-chord="minor">Minor</button><button data-chord="major">Major</button></div>')}
        <div class="knobs">
          ${knob('k-voices', 'Voices', 'v-voices', 1, 5, 1, '1')}
          ${knob('k-detune', 'Detune', 'v-detune', 0, 50, 0, '0 ¢')}
          ${knob('k-spread', 'Spread', 'v-spread', 0, 100, 0, '0 %')}
        </div>`, { right: LIVE })}
      ${card('Sample voice', `
        ${row('Load a sample', 'Or drop a file anywhere on the page.', '<button class="pill" id="samp-load">Choose a file</button>')}
        ${row('It becomes', 'Measured formants, or the raw sound as the oscillator', '<div class="seg" id="sampseg" role="group" aria-label="What a sample becomes"><button data-smode="formant" class="on">Formants</button><button data-smode="osc">Oscillator</button></div>')}
        <input type="file" id="samp-file" accept="${ACCEPT}" hidden>
        <p class="hint"><span class="mini" id="samp-status">No sample loaded</span></p>
        ${callout('Measured formants are a heuristic fit to the file\'s spectrum, not the sample and not a voice clone. Patches keep the measured numbers only, never audio.', 'samp-note')}`)}`, true),

    sheet('garden', 'Breed by ear.', 'A genome of 20 genes grows the sound. The seed sits at the center and its twelve buds are mutations. Press near a bud and drag along its vine, then let go to grow a new seed there.', `
      ${card('Lineage', `<canvas class="viz" id="lineage" role="img" aria-label="Family tree of the seeds grown so far" style="height:118px"></canvas>
        <p class="hint">Click an ancestor to go back. New growth forks from there.</p>`, { right: '<span class="mini">seeds <b id="lin-n">1</b></span>' })}
      ${card('Mutation', `<div class="knobs">
          ${knob('g-amount', 'Mutation amount', 'g-amount-v', 0, 100, 60, '60%')}
          ${knob('g-temp', 'Genetic temperature', 'g-temp-v', 5, 90, 35, '35%')}
        </div>`)}
      ${card('Growing', `${row('Auto-drift', 'Wander through the buds by itself', sw('g-grow', 'Auto-drift'))}
        ${row('Per-note branches', 'Each note leans the genome toward its own bud, and letting go returns to the seed', sw('g-pernote', 'Per-note branches'))}`)}
      ${card('Seeds', `<div class="btn-row"><button class="pill" id="g-random">New random seed</button><button class="pill" id="g-undo">Undo</button><button class="pill" id="g-mark">Mark parent A</button><button class="pill" id="g-breed" disabled>Breed with A</button></div>`)}
      ${card('Grow from a sample', `${row('Choose an audio file', 'Fits the genome to its spectrum, or drop a file on the page', '<button class="pill" id="gp-load">Choose a file</button>')}
        <input type="file" id="gp-file" accept="${ACCEPT}" hidden>
        <div class="bar" aria-hidden="true"><i id="gp-bar"></i></div>
        <p class="hint" id="gp-status">Differential evolution fits the genome to the sample's spectrum.</p>
        ${callout('An analysis-by-synthesis approximation: DSP estimates seed the search, then differential evolution refines it against this synth. Not a neural clone, not a model, and never the sample itself. The genome keeps numbers only, never audio.')}`, { right: STAND })}`),

    sheet('rack', 'Shape the beast.', 'The power stack and effects act on the lead. The sub and the low-end check stay clean, so the phase lock holds.', `
      <div class="chain" id="chain" role="group" aria-label="Signal chain">
        <button class="node" data-k="brain" data-go="rk-power"><i></i><b>Brain</b><span>the voice</span></button><em aria-hidden="true">›</em>
        <button class="node" data-k="body" data-go="rk-power"><i></i><b>Body</b><span>the sub</span></button><em aria-hidden="true">›</em>
        <button class="node" data-k="nerve" data-go="rk-power"><i></i><b>Nerve</b><span>grit and glue</span></button><em aria-hidden="true">›</em>
        <button class="node" data-k="space" data-go="rk-fx"><i></i><b>Space</b><span>reverb, delay</span></button>
      </div>
      ${dcard('Power stack', `<div class="knobs">
          ${knob('k-sublvl', 'Sub level', 'v-sub', 0, 100, 70, '-10 dB')}
          ${knob('k-drive', 'Saturation', 'v-drive', 0, 100, 35, '35 %')}
          ${knob('k-ott', 'OTT glue', 'v-ott', 0, 100, 40, '40 %')}
          ${knob('k-fizz', 'Noise fizz', 'v-fizz', 0, 100, 20, '20 %')}
        </div>`, { open: true, id: 'rk-power', right: LIVE })}
      ${dcard('Envelope', `<canvas class="viz" id="envviz" role="img" aria-label="The amplitude envelope: attack, decay, sustain and release" style="height:76px"></canvas>
        <div class="knobs">
          ${knob('k-ea', 'Attack', 'v-ea', 2, 800, 40, '40 ms')}
          ${knob('k-ed', 'Decay', 'v-ed', 5, 1200, 120, '120 ms')}
          ${knob('k-es', 'Sustain', 'v-es', 0, 100, 85, '85 %')}
          ${knob('k-er', 'Release', 'v-er', 10, 2000, 180, '180 ms')}
        </div>`, { id: 'rk-env' })}
      ${dcard('Effects', `${row('Bitcrush', 'Lo-fi crunch on the lead only', sw('crush-on', 'Bitcrush'))}
        <div class="knobs">
          ${knob('crush-bits', 'Bit depth', 'v-bits', 1, 16, 12, '12 bit')}
          ${knob('crush-down', 'Downsample', 'v-down', 1, 40, 1, '1×')}
          ${knob('space-wet', 'Space', 'v-wet', 0, 100, 0, '0 %')}
          ${knob('verb-decay', 'Reverb decay', 'v-decay', 10, 70, 30, '3.0')}
          ${knob('delay-ms', 'Delay time', 'v-dms', 40, 700, 280, '280 ms')}
          ${knob('delay-fb', 'Delay feedback', 'v-dfb', 0, 85, 35, '35 %')}
        </div>
        ${callout('The reverb is a noise impulse made at run time, with no file, and the delay is a filtered feedback line. The sub stays mono and dry.')}`, { id: 'rk-fx', right: '<span class="cstate" id="fx-state"></span>' + LIVE })}
      ${dcard('Granular cloud', `${row('Grain cloud', 'Sprays grains from a 2.5-second render of the current sound', sw('gr-on', 'Grain cloud'))}
        ${row('Freeze scan', 'Hold the read position still', sw('gr-freeze', 'Freeze scan'))}
        <div class="btn-row"><button class="pill" id="gr-bake">Re-bake buffer</button><span class="mini" id="gr-buf">buffer not baked</span></div>
        <div class="knobs">
          ${knob('gr-pos', 'Position', 'v-grpos', 0, 100, 30, '30 %')}
          ${knob('gr-jit', 'Spray', 'v-grjit', 0, 100, 15, '15 %')}
          ${knob('gr-size', 'Grain size', 'v-grsize', 10, 300, 90, '90 ms')}
          ${knob('gr-dens', 'Density', 'v-grdens', 1, 60, 24, '24 /s')}
          ${knob('gr-pitch', 'Grain pitch', 'v-grpitch', -24, 24, 0, '0 st')}
          ${knob('gr-pjit', 'Pitch spray', 'v-grpjit', 0, 12, 0, '0 st')}
          ${knob('gr-pan', 'Pan spread', 'v-grpan', 0, 100, 60, '60 %')}
          ${knob('gr-rev', 'Reverse grains', 'v-grrev', 0, 100, 0, '0 %')}
        </div>`, { id: 'rk-grain', right: '<span class="cstate" id="gr-state"></span>' + LIVE })}
      ${dcard('Sequencer', `<div class="btn-row"><button class="pill primary" id="seq-on" aria-pressed="false">Play riff</button></div>
        <div class="knobs">
          ${knob('seq-bpm', 'Tempo', 'v-bpm', 60, 200, 140, '140')}
          ${knob('seq-swing', 'Swing', 'v-swing', 0, 60, 0, '0 %')}
          ${knob('seq-gate', 'Gate', 'v-gate', 10, 100, 60, '60 %')}
        </div>
        <div class="sig-title"><span>Notes</span><span>click a step; arrow keys or the wheel set its pitch</span></div>
        <div id="seqgrid" class="steps" role="group" aria-label="Sequencer notes"></div>
        <div class="sig-title"><span>Glitch lane</span><span>stutter and a grain burst</span></div>
        <div id="glitchrow" class="steps lane" role="group" aria-label="Glitch lane"></div>
        <div class="btn-row euclid">
          <label class="num">Euclidean hits <input type="number" id="eu-k" min="0" max="16" value="5"></label>
          <label class="num">rotate <input type="number" id="eu-rot" min="0" max="15" value="0"></label>
          <button class="pill" id="eu-gen">Fill notes</button><button class="pill" id="eu-glitch">Fill glitch lane</button><button class="pill" id="seq-clear">Clear</button>
        </div>
        ${callout('Steps move the lead only, and the sub stays on the root. E(k,16) spreads k hits as evenly as it can. The same pattern always renders the same way.')}`, { id: 'rk-seq', right: '<span class="cstate" id="seq-state"></span>' + LIVE })}
      ${dcard('Chaos', `<div class="btn-row"><button class="pill" id="reseed">Reseed</button><button class="pill" id="chaos-lock">Lock this accident</button><span class="mini">seed <b id="seedval">1337</b></span></div>
        <div class="knobs">
          ${knob('ch-chaos', 'Chaos', 'v-chaos', 0, 100, 0, '0 %')}
          ${knob('ch-hum', 'Humanize', 'v-hum', 0, 100, 0, '0 %')}
        </div>
        ${callout('A seeded random walk on the morph and the pad, with an occasional animal swap. The same seed wanders the same way. Humanize jitters the sequencer\'s timing and pitch.')}`, { id: 'rk-chaos', right: '<span class="cstate" id="chaos-state"></span>' + tag('heur', 'Seeded') })}`, true),

    sheet('signal', 'What you are hearing.', 'Measured from the sound this page makes, while it plays.', `
      <div class="statgrid">
        <div class="stat"><span class="k">Pitch</span><span class="v" id="sig-f0">-</span><span class="n">lead fundamental</span></div>
        <div class="stat"><span class="k">Sub</span><span class="v" id="sig-sub">-</span><span class="n">anchored to the root</span></div>
        <div class="stat"><span class="k">Displacement</span><span class="v" id="sig-wd">-</span><span class="n" id="sig-curv">from the nearest animal</span></div>
        <div class="stat"><span class="k">Low end</span><span class="v" id="sig-low">-</span><span class="n">measured below 120 Hz</span></div>
        <div class="stat"><span class="k">Frame rate</span><span class="v" id="sig-fps">-</span><span class="n" id="sig-sr">no sound yet</span></div>
      </div>
      ${card('Spectrum, log frequency', `<canvas class="viz" id="spec" role="img" aria-label="Scrolling spectrogram of the output with formant markers" style="height:210px"></canvas>
        <p class="hint">Solid lines are the formants now. Dashed lines are animals A and B.</p>`, { right: LIVE + OT })}
      ${card('Sub-bass phase check', `<div class="phase">
          <canvas id="wheel" role="img" aria-label="Phase wheel: the needle is the sub's phase, the shape is the last sweep"></canvas>
          <div class="phase-side">
            ${knob('k-phase', 'Sub phase', 'v-phase', 0, 360, 0, '0°')}
            <div class="field"><div class="row"><span>Low end, below 120 Hz</span><b><span id="lowdb">silent</span> · <span id="monoc">not measured</span></b></div><div class="meter one" aria-hidden="true"><div><i id="lowfill"></i></div></div></div>
            <button class="pill primary wide" id="autophase">Auto-align the sub</button>
          </div>
        </div>
        ${callout('Play the drone, then turn the sub phase. Near 180° the sub and the patch\'s low fundamental fall out of phase and the energy below 120 Hz drops into a deep notch. Auto-align sweeps every angle and locks the one that hits hardest. The verdict comes from the measured level, not from the knob\'s angle.', 'lowmsg')}`, { right: LIVE })}`, true),

    sheet('patch', 'Keep what you made.', 'Everything here stays on this computer until you share a file or a link yourself.', `
      <div class="tiles three">
        <button class="tile-btn" id="export">${svg('wave')}<b>WAV</b><span class="cap">Render 4 seconds</span></button>
        <button class="tile-btn" id="rec-toggle" aria-pressed="false">${svg('rec')}<b>Record</b><span class="cap">What you play, live</span></button>
        <button class="tile-btn" id="poster">${svg('image')}<b>Picture</b><span class="cap">The stage, with readouts</span></button>
      </div>
      <p class="hint" id="rec-status" role="status">Not recording.</p>
      ${card('Patch', `<div class="genome-code"><span>Genome code</span><b id="genome" class="code">-</b></div>
        <div class="btn-row"><button class="pill" id="patch-save">Save patch file</button><button class="pill" id="patch-load">Load patch file</button><button class="pill" id="patch-link">Copy share link</button><button class="pill" id="patch-mut">Mutate</button></div>
        <input type="file" id="patch-file" accept="application/json,.patch,.json" hidden>
        ${callout('Patch files and links hold settings only, never audio. A share link keeps the whole patch after the # in the address, which browsers do not send to any server.')}`)}
      ${card('Start from words', `<input class="vibe-in" id="vibe" type="text" placeholder="Describe a sound, like crunchy but wet swamp monster" aria-label="Describe a sound">
        <div class="tiles quickvibes">${VIBES.map(([v, a, b, n]) => `<button class="tile-btn small" data-v="${v}"><span class="pair" aria-hidden="true">${a}<i>×</i>${b}</span><b>${n}</b></button>`).join('')}</div>
        ${callout('A keyword matcher picks two animals, the blend point and the grit from your words. It stands in for a language model, makes no network call, and is deliberately simple.', 'vibeout')}`, { right: STAND })}`),

    sheet('about', 'What is real here.', 'Everything you hear is synthesized live in this browser with Web Audio. Nothing is sampled from a library, and there is no model and no server.', `
      <div class="legend" id="label-legend">
        <div class="lg">${LIVE}<p>Signal processing you are hearing: FM cores, formant filters, noise, envelopes, the wub, the power stack, the effects, the grains and the sequencer.</p></div>
        <div class="lg">${OT}<p>The morph moves formant frequencies along a log-frequency axis. For one-dimensional spectra that is the exact optimal-transport map on the frequency axis, and an approximation for the full spectrum, because amplitude and width are blended too.</p></div>
        <div class="lg">${STAND}<p>A plain heuristic that takes the place of a heavier step and says so: the keyword matcher for words, and the sample fits.</p></div>
      </div>
      ${dcard('Running in this page', `<ul>
          <li>Real-time synthesis: FM, a formant bank, noise transients, an envelope and the wub.</li>
          <li>A phase check that measures the level below 120 Hz as it turns the sub's phase, then locks the loudest angle.</li>
          <li>Up to five detuned voices with chord stacks, under one root-anchored sub.</li>
          <li>A 20-gene genome you breed by ear, with undo, a lineage and crossover.</li>
          <li>Audio files decoded in the browser, either fitted into the genome by differential evolution or measured into a sample voice.</li>
          <li>A 4-second WAV render, recording, patch files and share links.</li>
        </ul>`)}
      ${dcard('What a fuller build could add, not built here', `<ul>
          <li>A diffusion audio model that invents new texture between two sounds, instead of blending parameters.</li>
          <li>Sinkhorn optimal transport between two real recordings' spectrograms, instead of preset formants.</li>
          <li>A language model that reads a description and chooses the animals.</li>
        </ul>
        <p>None of these run here. The honest gap: blending formants cannot invent the breathy in-between texture a duck-wolf would really have, so this sounds like a clean synth more than an organism.</p>`)}
      ${dcard('The optimal-transport step this page approximates', `<pre class="monitor">K = exp(-C/eps)        C[i][j] = (log f_i - log f_j)^2
u = ones(n)
repeat L times:  v = b / (K^T u);  u = a / (K v)
P = diag(u) K diag(v)                       the transport plan
T[i] = sum_j P[i][j] f_j / sum_j P[i][j]    where bin i slides</pre>
        <p>For one-dimensional histograms the exact map as eps goes to zero is quantile matching, which is why log-frequency formant interpolation is a fair cheap stand-in on the frequency axis.</p>`)}
      ${dcard('Keys', `<p>Z to M and Q to U play notes, with sharps on the row above. In Garden, the left and right arrows choose a bud, up and down move along its vine, and Enter grows a seed there. ⌘Z or Ctrl+Z undoes a seed. F is full screen.</p>`)}
      ${dcard('Safety and privacy', `<p>A limiter slows any large change in brightness, and this page measures under the WCAG limit of three flashes a second, even with hard playing. That is a measured screen, not a medical guarantee. If flashing or moving light affects you, take care, and turn on your system's reduced-motion setting, which tightens the limiter. Start the sound quietly: sub-bass can be loud on big speakers.</p>
        <p>MIDI and audio files are handled in this browser and never sent anywhere. The page makes no network requests after it loads. Your volume, MIDI port and reconnect choice stay in this browser's storage.</p>`)}
      ${dcard('Ideas credited', `<p>No outside code is included. Breeding a patch from a seed, and growing one from a sample, follow the idea of Sonic Charge's Synplant. The sub phase check follows the club practice of aligning a sub with the kick or bass so the low end adds up instead of cancelling.</p>`)}
      <p class="note"><a href="field-guide.html#chimera">Read the field guide</a> · <a href="__REPO_URL__" rel="noopener">Source</a></p>`),
  ].join(''));

  /* ---------- sheets ---------- */
  const openSheet = (name) => {
    const d = $(`${name}-sheet`);
    if (!d || d.open) return;
    document.querySelectorAll('dialog.sheet[open]').forEach((o) => o.close());
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    d.focus({ preventScroll: true });
    const b = $(`${name}-button`); if (b) b.setAttribute('aria-expanded', 'true');
    global.dispatchEvent(new CustomEvent('chimera:sheet', { detail: name }));
  };
  document.querySelectorAll('dialog.sheet').forEach((d) => {
    const name = d.id.replace('-sheet', '');
    // the close event comes a moment after the sheet closes, so focus goes back to the dock only if nothing else has taken it
    d.addEventListener('close', () => { const b = $(`${name}-button`), a = document.activeElement; if (b) { b.setAttribute('aria-expanded', 'false'); if (!a || a === document.body || d.contains(a)) b.focus({ preventScroll: true }); } });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  });
  [...DOCK.map((d) => d.id), 'about'].forEach((name) => $(`${name}-button`).addEventListener('click', () => openSheet(name)));
  ['source-badge', 'chip-sound', 'chip-midi'].forEach((id) => $(id).addEventListener('click', () => openSheet('connect')));

  const toast = (msg, ms) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 3200); };
  const syncRange = (r) => r.style.setProperty('--val', ((+r.value - +r.min) / (+r.max - +r.min)) * 100);
  document.addEventListener('input', (e) => { if (e.target.type === 'range') syncRange(e.target); });
  const syncAllRanges = () => document.querySelectorAll('input[type="range"]').forEach(syncRange);
  syncAllRanges();

  global.ChimeraUI = { openSheet, toast, syncAllRanges, svg, PCS };
  global.toast = (msg) => toast(msg);
})(window);
