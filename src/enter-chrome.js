/* enter-chrome.js: Enter's own frame, in the family look: header, world switch, HUD, dock and sheets.
   It reuses shell.css and none of the drum input. Enter takes a picture or a sound, nothing live. */
(function (global) {
  'use strict';

  const ICON = {
    sliders: '<path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2"/><circle cx="16" cy="16" r="2"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    picture: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m5.5 17 4.1-4.1 2.9 2.7 2.4-2.4 3.6 3.8"/>',
    sound: '<path d="M4 13v-2M8 17V7m4 13V4m4 13V7m4 6v-2"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const closeBtn = (label) => `<button class="close" data-close aria-label="${label}">${svg('close')}</button>`;

  function mountEnterChrome(cfg) {
    const scene = $('scene');
    document.body.dataset.app = 'enter';
    scene.insertAdjacentHTML('beforeend', `
      <div class="vignette"></div>
      <header class="header chrome">
        <a class="brand" href="./" aria-label="${esc(cfg.name)}: back to the home page">${cfg.brand}<span>${esc(cfg.name)}</span></a>
        <div class="top-actions"><button class="top-action icon" id="fs-button" aria-label="Full screen">${svg('full')}</button></div>
      </header>
      <nav class="mode-switch chrome" aria-label="${esc(cfg.modeLabel)}">${cfg.modes.map((m) => `<button data-mode="${m.id}" aria-pressed="${m.id === cfg.mode}">${esc(m.label)}</button>`).join('')}</nav>
      <div class="intro">
        <p class="eyebrow">${esc(cfg.intro.eyebrow)}</p>
        <h1>${esc(cfg.intro.title)}</h1>
        <p>${esc(cfg.intro.subtitle)}</p>
        ${cfg.intro.actions || ''}
      </div>
      <div id="toast" role="status"></div>
      <div class="dock-wrap">
        <div id="hud" class="chrome">${cfg.hud}</div>
        <div class="badges" id="badges"></div>
        <nav class="dock chrome" aria-label="Controls">
          ${(cfg.actions || []).map((a) => `<button id="${a.id}" class="dock-open">${svg(a.icon)}<span>${esc(a.label)}</span></button>`).join('')}
          ${cfg.actions ? '<div class="dock-divider"></div>' : ''}
          ${cfg.sheets.map((s) => `<button id="${s.id}-button" aria-haspopup="dialog" aria-expanded="false">${svg(s.icon)}<span>${esc(s.label)}</span></button>`).join('')}
          <div class="dock-divider"></div>
          <button id="about-button" aria-haspopup="dialog" aria-expanded="false">${svg('about')}<span>About</span></button>
        </nav>
        <p class="truth chrome" id="truth">${esc(cfg.truth)}</p>
      </div>`);
    document.body.insertAdjacentHTML('beforeend', cfg.sheets.map((s) => `
      <dialog class="sheet" id="${s.id}-sheet" aria-labelledby="${s.id}-title" tabindex="-1">
        <div class="sheet-head"><h2 id="${s.id}-title">${esc(s.title)}</h2>${closeBtn(`Close ${s.label}`)}</div>
        ${s.html}
      </dialog>`).join('') + `
      <dialog class="sheet" id="about-sheet" aria-labelledby="about-title" tabindex="-1">
        <div class="sheet-head"><h2 id="about-title">What the worlds are made of.</h2>${closeBtn('Close about')}</div>
        ${cfg.about}
      </dialog>`);

    const openSheet = (name) => {
      const d = $(`${name}-sheet`);
      if (!d || d.open) return;
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
      d.focus({ preventScroll: true });
      const b = $(`${name}-button`); if (b) b.setAttribute('aria-expanded', 'true');
    };
    document.querySelectorAll('dialog.sheet').forEach((d) => {
      const name = d.id.replace('-sheet', '');
      d.addEventListener('close', () => { const b = $(`${name}-button`); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus({ preventScroll: true }); } });
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
    });
    [...cfg.sheets.map((s) => s.id), 'about'].forEach((name) => $(`${name}-button`).addEventListener('click', () => openSheet(name)));

    let mode = cfg.mode;
    const modeButtons = [...document.querySelectorAll('.mode-switch button')];
    const setMode = (m) => { mode = m; modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); if (cfg.onMode) cfg.onMode(m); };
    modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    const toast = (msg, ms) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 3200); };
    const de = document.documentElement, canFull = !!(de.requestFullscreen || de.webkitRequestFullscreen);
    const fullscreen = () => {
      if (!canFull) return;
      if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      try { const r = (de.requestFullscreen || de.webkitRequestFullscreen).call(de); if (r && r.catch) r.catch(() => toast('Full screen is not available here.')); } catch (e) { toast('Full screen is not available here.'); }
    };
    // iPhone browsers have no full-screen API for pages, so the button is not shown there rather than doing nothing
    $('fs-button').hidden = !canFull;
    $('fs-button').addEventListener('click', fullscreen);
    let hideChrome = false;
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.target.closest && e.target.closest('input, select, textarea, dialog[open]')) return;
      const key = e.key.toLowerCase();
      if (key === 'f') fullscreen();
      else if (key === 'h') { hideChrome = !hideChrome; document.body.classList.toggle('quiet', hideChrome); }
    });
    const syncRange = (r) => r.style.setProperty('--val', ((+r.value - +r.min) / (+r.max - +r.min)) * 100);
    document.querySelectorAll('.sheet input[type="range"]').forEach(syncRange);
    const glFail = (msg) => { const d = document.createElement('div'); d.id = 'gl-error'; d.setAttribute('role', 'alert'); d.textContent = msg; scene.appendChild(d); };
    return { toast, openSheet, glFail, setMode, syncRange, get mode() { return mode; } };
  }

  global.mountEnterChrome = mountEnterChrome;
  global.EnterIcon = svg;
})(window);
