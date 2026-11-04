/* analog.js: Detail Forge Analog's stage, sources and states. analog-dsp.js does the processing, in a Worker; this file
   reads and decodes files at their own rate, makes the synthetic test sound, draws the before and after spectrograms,
   plays the loudness-matched A/B, draws each sheet's picture and writes the files you keep. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const UI = AnalogUI, DSP = AnalogDSP;
  const RMq = matchMedia('(prefers-reduced-motion: reduce)');
  const SANS = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`analog.${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`analog.${k}`, JSON.stringify(v)); } catch (e) { /* storage off */ } },
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round2 = (v) => Math.round(v * 100) / 100;
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const int = (v) => Math.round(v).toLocaleString('en-US');
  const signed = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
  const rateText = (sr) => `${(sr / 1000).toFixed(sr % 1000 ? 2 : 0).replace(/\.?0+$/, '')} kHz`;
  const kHz = (v) => `${(v / 1000).toFixed(1)}<small>kHz</small>`;
  const msText = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
  const announce = (t) => { if ($('sr-status').textContent !== t) $('sr-status').textContent = t; };
  const MODE = { floor: ['Floor', 'amp'], exciter: ['Exciter', 'syn'], transient: ['Transient', 'amp'], sbr: ['SBR', 'syn'], forge: ['Forge', 'syn'] };
  const MODE_IDS = Object.keys(MODE);
  const MAX_SECONDS = 600;
  const minSpan = (sr) => Math.max(4096 / sr, 0.25);

  /* ---------------- state ---------------- */
  const DEF = { amount: 55, cutoff: 0, ceiling: 200, seed: 17, wet: 65, tilt: -6, target: 20, gain: 9, drive: 40, emix: 35, tamt: 60 };
  const S = {
    mode: 'forge', prm: { ...DEF }, sel: null, drag: null, src: null, res: null, err: null, prog: null,
    side: 'A', match: store.get('match', true), loop: store.get('loop', true), vol: store.get('volume', 0.8), runs: 0, wantPlay: false,
  };

  /* ---------------- the synthetic test sound ---------------- */
  function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // plucked chords (Karplus-Strong) and breath noise, then a low-pass taper ending at 6 kHz: a dull recording made to order
  function makeSynthetic() {
    const sr = 44100, n = sr * 8, N = 1 << 19, rng = mulberry(20261103), cut = 6000;
    const L = new Float64Array(N), R = new Float64Array(N);
    const CH = [[48, 55, 64, 67, 72], [45, 52, 60, 64, 69], [41, 48, 57, 60, 65], [43, 50, 59, 62, 67]];
    for (let b = 0; b < 16; b++) {
      CH[(b >> 2) % 4].forEach((m, j) => {
        if (b % 2 && j > 2) return;
        const f0 = 440 * 2 ** ((m - 69) / 12), P = Math.max(2, Math.round(sr / f0)), buf = new Float64Array(P);
        for (let i = 0; i < P; i++) buf[i] = rng() * 2 - 1;
        const s0 = Math.floor((b * 0.5 + j * 0.011) * sr), len = Math.min(n - s0, Math.floor(1.9 * sr));
        const pan = 0.5 + 0.34 * Math.sin(j * 1.7 + b), amp = b % 4 === 0 ? 0.17 : 0.12;
        for (let i = 0, p = 0; i < len; i++, p = (p + 1) % P) {
          const v = buf[p];
          buf[p] = 0.4985 * (v + buf[(p + 1) % P]);
          L[s0 + i] += amp * v * (1 - pan); R[s0 + i] += amp * v * pan;
        }
      });
    }
    for (let i = 0; i < n; i++) { const a = 0.02 * (0.65 + 0.35 * Math.sin((2 * Math.PI * 0.37 * i) / sr)); L[i] += a * (rng() * 2 - 1); R[i] += a * (rng() * 2 - 1); }
    const re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1), out = [];
    let peak = 0;
    for (const x of [L, R]) {
      DSP.rfft(x, re, im);
      for (let k = 0; k <= N / 2; k++) {
        const f = (k * sr) / N, w = f <= cut - 200 ? 1 : f >= cut ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (f - cut + 200)) / 200);
        re[k] *= w; im[k] *= w;
      }
      DSP.irfft(re, im, x);
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
    }
    const g = 0.7 / peak;
    for (const x of [L, R]) { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = x[i] * g; out.push(y); }
    return { ch: out, sr, name: 'Synthetic test sound', origin: 'synthetic', format: 'Synthetic', rateFrom: 'synthetic', channelsInFile: 2 };
  }

  /* ---------------- reading files ---------------- */
  const str = (u, o, n) => { let s = ''; for (let i = 0; i < n && o + i < u.length; i++) s += String.fromCharCode(u[o + i]); return s; };
  function readPCM(v, o, frames, chans, keep, bits, kind, le) {   // kind: 'int', 'uint8' or 'float'; bits is the container size
    const ch = Array.from({ length: keep }, () => new Float32Array(frames)), bps = bits >> 3, stride = bps * chans;
    for (let c = 0; c < keep; c++) {
      const d = ch[c];
      let p = o + c * bps;
      if (kind === 'float' && bits === 32) for (let i = 0; i < frames; i++, p += stride) d[i] = v.getFloat32(p, le);
      else if (kind === 'float') for (let i = 0; i < frames; i++, p += stride) d[i] = v.getFloat64(p, le);
      else if (bits === 8) for (let i = 0; i < frames; i++, p += stride) d[i] = kind === 'uint8' ? (v.getUint8(p) - 128) / 128 : v.getInt8(p) / 128;
      else if (bits === 16) for (let i = 0; i < frames; i++, p += stride) d[i] = v.getInt16(p, le) / 32768;
      else if (bits === 24) {
        for (let i = 0; i < frames; i++, p += stride) {
          let s = le ? v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16) : v.getUint8(p + 2) | (v.getUint8(p + 1) << 8) | (v.getUint8(p) << 16);
          if (s & 0x800000) s -= 0x1000000;
          d[i] = s / 8388608;
        }
      } else for (let i = 0; i < frames; i++, p += stride) d[i] = v.getInt32(p, le) / 2147483648;
    }
    return ch;
  }
  function parseWav(buf) {
    const v = new DataView(buf), u = new Uint8Array(buf);
    let o = 12, fmt = null, data = null;
    while (o + 8 <= v.byteLength && !(fmt && data)) {
      const id = str(u, o, 4), size = v.getUint32(o + 4, true), body = o + 8;
      if (id === 'fmt ') {
        const tag = v.getUint16(body, true);
        fmt = { tag: tag === 0xfffe && size >= 26 ? v.getUint16(body + 24, true) : tag, ch: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true), align: v.getUint16(body + 12, true), bits: v.getUint16(body + 14, true) };
      } else if (id === 'data') data = { o: body, size: Math.min(size, v.byteLength - body) };
      o = body + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('This WAV file has no audio the page can find.');
    if (fmt.tag !== 1 && fmt.tag !== 3) throw new Error(`This WAV file is compressed (format ${fmt.tag}), which the page cannot read. Save it as PCM or float WAV.`);
    const cbits = fmt.ch ? (8 * fmt.align) / fmt.ch : 0;
    if (!fmt.ch || ![8, 16, 24, 32, 64].includes(cbits) || (fmt.tag === 3 && cbits < 32)) throw new Error(`This WAV file has ${fmt.bits}-bit samples in a layout the page cannot read.`);
    const frames = Math.floor(data.size / fmt.align), keep = Math.min(fmt.ch, 2);
    return { ch: readPCM(v, data.o, frames, fmt.ch, keep, cbits, fmt.tag === 3 ? 'float' : cbits === 8 ? 'uint8' : 'int', true), sr: fmt.sr, format: 'WAV', bits: fmt.bits, float: fmt.tag === 3, rateFrom: 'wav', channelsInFile: fmt.ch };
  }
  function ext80(v, o) {                              // the 80-bit extended float AIFF keeps its rate in
    const se = v.getUint16(o, false), exp = se & 0x7fff, hi = v.getUint32(o + 2, false), lo = v.getUint32(o + 6, false);
    if (!exp && !hi && !lo) return 0;
    return (se & 0x8000 ? -1 : 1) * (hi * 2 ** (exp - 16383 - 31) + lo * 2 ** (exp - 16383 - 63));
  }
  function parseAiff(buf) {
    const v = new DataView(buf), u = new Uint8Array(buf), aifc = str(u, 8, 4) === 'AIFC';
    let o = 12, comm = null, ssnd = null;
    while (o + 8 <= v.byteLength) {
      const id = str(u, o, 4), size = v.getUint32(o + 4, false), body = o + 8;
      if (id === 'COMM') comm = { ch: v.getInt16(body, false), frames: v.getUint32(body + 2, false), bits: v.getInt16(body + 6, false), sr: Math.round(ext80(v, body + 8)), comp: aifc ? str(u, body + 18, 4) : 'NONE' };
      else if (id === 'SSND') ssnd = { o: body + 8 + v.getUint32(body, false), end: Math.min(body + size, v.byteLength) };
      o = body + size + (size & 1);
    }
    if (!comm || !ssnd) throw new Error('This AIFF file has no audio the page can find.');
    const c = comm.comp.toLowerCase(), isFloat = c === 'fl32' || c === 'fl64';
    if (!['none', 'sowt', 'fl32', 'fl64'].includes(c)) throw new Error(`This AIFF-C file is compressed (${comm.comp.trim()}), which the page cannot read. Save it as plain AIFF or WAV.`);
    const cbits = isFloat ? (c === 'fl64' ? 64 : 32) : Math.ceil(comm.bits / 8) * 8;
    if (!comm.ch || ![8, 16, 24, 32, 64].includes(cbits)) throw new Error(`This AIFF file has ${comm.bits}-bit samples, which the page cannot read.`);
    const frames = Math.min(comm.frames, Math.floor((ssnd.end - ssnd.o) / ((cbits / 8) * comm.ch))), keep = Math.min(comm.ch, 2);
    return { ch: readPCM(v, ssnd.o, frames, comm.ch, keep, cbits, isFloat ? 'float' : 'int', c === 'sowt'), sr: comm.sr, format: aifc ? 'AIFF-C' : 'AIFF', bits: comm.bits, float: isFloat, rateFrom: 'aiff', channelsInFile: comm.ch };
  }

  // the sample rate a compressed file states in its own header, so the browser can decode it without resampling
  const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const MP3_BR = { 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const ADTS_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  function mp3Head(u, i) {
    if (u[i] !== 0xff || (u[i + 1] & 0xe0) !== 0xe0) return null;
    const ver = (u[i + 1] >> 3) & 3, layer = (u[i + 1] >> 1) & 3, bri = u[i + 2] >> 4, sri = (u[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) return null;
    const sr = MP3_SR[ver][sri];
    if (layer !== 1) return { sr, len: 0 };
    const br = MP3_BR[ver === 3 ? 3 : 2][bri] * 1000;
    return { sr, len: Math.floor(((ver === 3 ? 144 : 72) * br) / sr) + ((u[i + 2] >> 1) & 1) };
  }
  function mp4Rate(u) {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const boxes = (s, e, cb) => {
      for (let o = s; o + 8 <= e;) {
        let size = dv.getUint32(o), hdr = 8;
        if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = e - o;
        if (size < hdr || o + size > e) return;
        cb(str(u, o + 4, 4), o + hdr, o + size);
        o += size;
      }
    };
    let rate = null;
    boxes(0, u.length, (t, s, e) => t === 'moov' && boxes(s, e, (t2, s2, e2) => t2 === 'trak' && !rate && boxes(s2, e2, (t3, s3, e3) => {
      if (t3 !== 'mdia') return;
      let soun = false, ts = null;
      boxes(s3, e3, (t4, s4) => { if (t4 === 'hdlr') soun = str(u, s4 + 8, 4) === 'soun'; if (t4 === 'mdhd') ts = u[s4] === 1 ? dv.getUint32(s4 + 20) : dv.getUint32(s4 + 12); });
      if (soun && ts) rate = ts;
    })));
    return rate;
  }
  function sniffRate(u) {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), s4 = str(u, 0, 4);
    if (s4 === 'fLaC') return { rate: (u[18] << 12) | (u[19] << 4) | (u[20] >> 4) || null, format: 'FLAC' };
    if (s4 === 'OggS') {
      const p = 27 + u[26];
      if (str(u, p, 7) === '\x01vorbis') return { rate: dv.getUint32(p + 12, true) || null, format: 'Ogg Vorbis' };
      if (str(u, p, 8) === 'OpusHead') return { rate: 48000, format: 'Ogg Opus', opus: true };
      if (str(u, p + 1, 4) === 'FLAC' && str(u, p + 9, 4) === 'fLaC') { const q = p + 17 + 10; return { rate: (u[q] << 12) | (u[q + 1] << 4) | (u[q + 2] >> 4) || null, format: 'Ogg FLAC' }; }
      return { rate: null, format: 'Ogg' };
    }
    if (str(u, 4, 4) === 'ftyp') return { rate: mp4Rate(u), format: 'M4A' };
    if (s4 === 'caff' && str(u, 8, 4) === 'desc') return { rate: Math.round(dv.getFloat64(20, false)) || null, format: 'CAF' };
    if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return { rate: null, format: 'WebM' };
    let o = 0;
    if (str(u, 0, 3) === 'ID3') o = 10 + (((u[6] & 127) << 21) | ((u[7] & 127) << 14) | ((u[8] & 127) << 7) | (u[9] & 127)) + (u[5] & 0x10 ? 10 : 0);
    for (let i = o, end = Math.min(u.length - 4, o + 65536); i < end; i++) {
      const h = mp3Head(u, i);
      if (h) { const j = i + h.len, h2 = h.len && j + 4 <= u.length ? mp3Head(u, j) : null; if (!h.len || (h2 && h2.sr === h.sr)) return { rate: h.sr, format: 'MP3' }; }
      if (u[i] === 0xff && (u[i + 1] & 0xf6) === 0xf0) { const k = (u[i + 2] >> 2) & 15; if (k < 13) return { rate: ADTS_SR[k], format: 'AAC' }; }
    }
    return { rate: null, format: null };
  }
  async function decodeWithBrowser(buf, sn) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw new Error('This browser cannot decode compressed audio. A WAV file still opens.');
    const rate = sn.rate && sn.rate >= 3000 && sn.rate <= 768000 ? sn.rate : 48000;
    const ac = new OAC(1, 1, rate);
    let ab;
    try { ab = await new Promise((res, rej) => { const p = ac.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }); }
    catch (e) {
      const what = sn.format ? `this ${sn.format} file` : 'this file';
      throw new Error(sn.format === 'CAF' ? 'This browser cannot decode CAF files. Safari can, or save it as WAV.' : `This browser could not decode ${what}. It may not be audio, or it may be a format this browser cannot open. WAV always works.`);
    }
    const keep = Math.min(ab.numberOfChannels, 2), ch = [];
    for (let c = 0; c < keep; c++) ch.push(ab.getChannelData(c));
    return { ch, sr: ab.sampleRate, format: sn.format || 'Audio', rateFrom: sn.opus ? 'opus' : sn.rate ? 'header' : 'unknown', channelsInFile: ab.numberOfChannels };
  }
  async function decodeAny(buf) {
    const u = new Uint8Array(buf), t = str(u, 0, 4), f = str(u, 8, 4);
    if ((t === 'RIFF' || t === 'RIFX') && f === 'WAVE') { if (t === 'RIFX') throw new Error('This is a big-endian WAV file, which the page cannot read. Save it as an ordinary WAV.'); return parseWav(buf); }
    if (t === 'RF64') throw new Error('This is an RF64 WAV, over 4 GB in form, which the page cannot read.');
    if (t === 'FORM' && (f === 'AIFF' || f === 'AIFC')) return parseAiff(buf);
    return decodeWithBrowser(buf, sniffRate(u));
  }

  let loadSeq = 0;
  async function openFile(file) {
    if (!file) return;
    const me = ++loadSeq;
    srcInfo('wait', `Reading ${file.name}`, 'Decoding in this browser.');
    try {
      if (file.size > 1.5e9) throw new Error('This file is too large to open here.');
      const d = await decodeAny(await file.arrayBuffer());
      if (me !== loadSeq) return;
      const n = d.ch[0] ? d.ch[0].length : 0;
      if (!d.sr || d.sr < 3000 || d.sr > 768000) throw new Error(`Its sample rate, ${d.sr} Hz, is outside what a browser can play.`);
      if (n < minSpan(d.sr) * d.sr) throw new Error('It is shorter than a quarter of a second, too short to measure.');
      if (n / d.sr > MAX_SECONDS) throw new Error(`It is ${Math.round(n / d.sr / 60)} minutes long. Trim it to 10 minutes or less first.`);
      setSource({ ...d, name: file.name, origin: 'file' });
      engage();
      UI.toast(`Opened ${file.name}.`);
    } catch (err) {
      if (me !== loadSeq) return;
      srcInfo('bad', `Could not open ${file.name}`, err.message);
      UI.toast(`Could not open ${file.name}. ${err.message}`, 7000);
      announce(`Could not open ${file.name}.`);
    }
  }
  function peaks(ch, n = 800) {
    const L = ch[0].length, k = L / n, out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = 0;
      const s = Math.floor(i * k), e = Math.min(L, Math.max(s + 1, Math.floor((i + 1) * k)));
      for (let j = s; j < e; j++) { let v = 0; for (const c of ch) v += c[j]; v /= ch.length; if (v < lo) lo = v; if (v > hi) hi = v; }
      out[2 * i] = lo; out[2 * i + 1] = hi;
    }
    return out;
  }

  /* ---------------- the worker ---------------- */
  // the processing is analog-dsp.js itself, rebuilt inside a Worker from its own source, so the page never stalls
  const WSRC = `'use strict';
const DSP = (${DSP.build.toString()})();
let SRC = null, SR = 0;
const kdb = (ch, linked) => 10 * Math.log10(linked ? DSP.linkedK(ch) : DSP.kweightEnergy(ch));
const thin = (a, n) => { if (!a) return null; const m = Math.min(n, a.length), o = new Float32Array(m), k = a.length / m; for (let i = 0; i < m; i++) { let v = 0; for (let j = Math.floor(i * k), e = Math.max(j + 1, Math.floor((i + 1) * k)); j < e; j++) v = Math.max(v, a[j]); o[i] = v; } return o; };
onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') { SRC = m.ch; SR = m.sr; const s = DSP.spectrogram(SRC, SR, 1024, 900, true); postMessage({ type: 'loaded', id: m.id, spec: s }, [s.S.buffer]); return; }
    const t0 = performance.now();
    const r = DSP.run(SRC, SR, m.params, (pct, line) => postMessage({ type: 'progress', id: m.id, pct, line }));
    postMessage({ type: 'progress', id: m.id, pct: 90, line: 'drawing the spectrogram' });
    const s = DSP.spectrogram(r.out, SR, 1024, 900, true), cut = (c) => c.map((x) => x.subarray(r.n0, r.n1)), W = r.metrics;
    const out = r.out.map((c, i) => (c.buffer === SRC[i].buffer ? c.slice() : c));
    const metrics = { bw_before: W.bw_before, bw_after: W.bw_after, hb_before: W.hb_before, hb_after: W.hb_after, lsd: W.lsd, nr: W.nr, gain: W.gain,
      wb: { f: W.welch_before.f, p: W.welch_before.pxx }, wa: { f: W.welch_after.f, p: W.welch_after.pxx } };
    postMessage({ type: 'result', id: m.id, out, fc: r.fc, info: r.info, metrics, selective: r.selective, n0: r.n0, n1: r.n1, mode: r.mode,
      gainCurve: thin(r.gainCurve, 1200), spec: s, kA: kdb(cut(SRC), r.mode === 'forge'), kB: kdb(cut(out), r.mode === 'forge'), ms: performance.now() - t0 }, [...new Set(out.map((c) => c.buffer)), s.S.buffer]);
  } catch (err) { postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) }); }
};`;
  let WK = null, wURL = null, srcSeq = 0, runSeq = 0, resSeq = 0, inflight = null, pending = false, runT = 0;
  function makeWorker() {
    if (WK) WK.terminate();
    inflight = null; pending = false;
    if (!wURL) wURL = URL.createObjectURL(new Blob([WSRC], { type: 'text/javascript' }));
    WK = new Worker(wURL);
    WK.onmessage = onWorker;
    WK.onerror = (e) => { if (e.preventDefault) e.preventDefault(); inflight = null; failRun(e.message || 'the processing worker stopped'); };
  }
  function paramsNow() {
    const P = S.prm;
    return { mode: S.mode, amount: P.amount / 100, cutoff_hz: P.cutoff * 100, seed: S.mode === 'forge' ? P.seed : undefined, wet: P.wet / 100, tilt: P.tilt, target_hz: S.mode === 'forge' ? P.ceiling * 100 : P.target * 1000, gain_db: P.gain, drive: P.drive / 10, emix: P.emix / 100, tamt: P.tamt / 100, sel: S.sel ? [...S.sel] : null, measure: 'span' };
  }
  function scheduleRun(ms) {
    clearTimeout(runT);
    runT = setTimeout(startRun, ms == null ? 300 : ms);
    S.err = null;
    if (!S.prog) S.prog = { pct: 0, line: 'waiting for the settings to settle' };
    renderProc();
  }
  function startRun() {
    clearTimeout(runT); runT = 0;
    if (!S.src || !WK) return;
    if (inflight) { pending = true; return; }
    inflight = { id: ++runSeq, params: paramsNow() };
    S.prog = { pct: 2, line: 'starting' };
    renderProc();
    WK.postMessage({ type: 'run', id: inflight.id, params: inflight.params });
  }
  function failRun(msg) {
    S.err = msg; S.prog = null;
    renderProc(); requestDraw();
    UI.toast(`Could not process: ${msg}.`, 6000);
  }
  function onWorker(e) {
    const m = e.data;
    if (m.type === 'loaded') { if (S.src && m.id === S.src.id) { S.src.spec = m.spec; beforeImg = specImage(m.spec); requestDraw(); } return; }
    if (!inflight || m.id !== inflight.id) return;
    if (m.type === 'progress') { S.prog = { pct: m.pct, line: m.line }; renderProc(); return; }
    const prm = inflight.params;
    inflight = null;
    if (pending) { pending = false; startRun(); return; }      // newer settings are waiting: this result is already stale
    if (m.type === 'error') { failRun(m.message); return; }
    applyResult(m, prm);
  }
  function applyResult(m, prm) {
    const at = nodes ? absPos() : null;
    if (afterImg) { afterPrev = afterImg; fadeT0 = performance.now(); }
    afterImg = specImage(m.spec);
    S.res = { ...m, params: prm, id: ++resSeq };
    S.err = null; S.prog = null; S.runs++;
    if (nodes) restartAt(at);                                   // B changes under the same instant
    else if (S.wantPlay) { S.wantPlay = false; play(); }
    renderAll(); drawSheets(); requestDraw();
    announce(`${MODE[m.mode][0]} done. Bandwidth ${int(m.metrics.bw_before)} to ${int(m.metrics.bw_after)} hertz.`);
  }

  function setSource(d) {
    stop();
    S.src = { ...d, n: d.ch[0].length, dur: d.ch[0].length / d.sr, id: ++srcSeq, spec: null, pk: peaks(d.ch) };
    S.sel = null; S.res = null; S.err = null;
    beforeImg = afterImg = afterPrev = null; bufA = bufB = null;
    makeWorker();
    WK.postMessage({ type: 'load', id: S.src.id, ch: S.src.ch, sr: S.src.sr });
    scheduleRun(0);
    renderAll(); drawSheets(); requestDraw();
  }
  function setSel(t0, t1) {
    if (!S.src) return false;
    const dur = S.src.dur, m = minSpan(S.src.sr);
    if (t0 == null) S.sel = null;
    else {
      t0 = clamp(+t0 || 0, 0, dur); t1 = clamp(+t1 || 0, 0, dur);
      if (t1 < t0) [t0, t1] = [t1, t0];
      if (t1 - t0 < m) { UI.toast(`Choose at least ${m.toFixed(2)} s, so the range can be measured.`); renderSel(); requestDraw(); return false; }
      S.sel = t0 <= 0.005 && t1 >= dur - 0.05 ? null : [round2(t0), round2(t1)];
    }
    engage(); renderSel(); scheduleRun(0); requestDraw();
    return true;
  }
  function setMode(m, quiet) {
    if (!MODE_IDS.includes(m)) return;
    S.mode = m;
    document.querySelectorAll('.mode-switch button[data-mode], .tile-btn.eng').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    document.querySelectorAll('.knobs[data-for]').forEach((k) => { k.hidden = k.dataset.for !== m; });
    if (!quiet) { engage(); scheduleRun(40); }
    renderEngine(); drawSheets();
  }
  const engage = () => document.body.classList.add('engaged');

  /* ---------------- the stage: before and after spectrograms ---------------- */
  const cv = $('stage'), g = cv.getContext('2d');
  let dpr = 1, W = 0, H = 0, geo = null, beforeImg = null, afterImg = null, afterPrev = null, fadeT0 = 0, rafOn = false;
  const FADE = () => (RMq.matches ? 0 : 260);
  // a ramp in the suite's colors: night, violet, lavender, teal, then warm white for the loudest bins
  const LUT = (() => {
    const st = [[0, 11, 15, 28], [0.1, 20, 20, 50], [0.22, 48, 38, 112], [0.36, 92, 78, 186], [0.5, 136, 136, 236], [0.66, 156, 204, 236], [0.82, 196, 236, 226], [1, 255, 247, 230]];
    const t = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const v = i / 255; let k = 1; while (k < st.length - 1 && st[k][0] < v) k++;
      const a = st[k - 1], b = st[k], f = (v - a[0]) / (b[0] - a[0] || 1);
      for (let c = 0; c < 3; c++) t[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
    }
    return t;
  })();
  function specImage(sp) {
    if (!sp || !sp.frames) return null;
    const c = document.createElement('canvas'); c.width = sp.frames; c.height = sp.bins;
    const x = c.getContext('2d'), im = x.createImageData(sp.frames, sp.bins), d = im.data, F = sp.frames;
    for (let k = 0; k < sp.bins; k++) {
      const row = (sp.bins - 1 - k) * F;                      // low frequencies at the bottom
      for (let t = 0; t < F; t++) {
        const v = Math.round(clamp(sp.S[k * F + t], 0, 1) * 255) * 3, p = (row + t) * 4;
        d[p] = LUT[v]; d[p + 1] = LUT[v + 1]; d[p + 2] = LUT[v + 2]; d[p + 3] = 255;
      }
    }
    x.putImageData(im, 0, 0);
    return c;
  }
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    const ms = document.querySelector('.mode-switch').getBoundingClientRect(), hud = $('hud').getBoundingClientRect(), narrow = W < 860;
    const side = narrow ? 16 : 42, top = ms.bottom + (narrow ? 14 : 20), bottom = hud.top - (narrow ? 10 : 18), gap = narrow ? 10 : 14;
    const h = Math.max(48, (bottom - top - gap) / 2);
    geo = { x: side, w: Math.max(40, W - 2 * side), y0: top, y1: top + h + gap, h };
    requestDraw();
  }
  const tx = (t) => geo.x + (t / S.src.dur) * geo.w;
  const tt = (px) => clamp(((px - geo.x) / geo.w) * S.src.dur, 0, S.src.dur);
  function rrect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function tagText(x, text, px, py, color, align) {
    x.font = `500 11px ${SANS}`;
    const w = x.measureText(text).width + 16, ax = align === 'right' ? px - w : px;
    x.fillStyle = 'rgba(10, 13, 26, 0.72)'; rrect(x, ax, py, w, 22, 11); x.fill();
    x.fillStyle = color; x.fillText(text, ax + 8, py + 15);
  }
  function drawPane(x, i, now, sel) {
    const { x: px, w: pw, h: ph } = geo, py = i ? geo.y1 : geo.y0, img = i ? afterImg : beforeImg, src = S.src, r = S.res;
    const nyq = src.sr / 2, fc = r ? r.fc : null, syn = r && MODE[r.mode][1] === 'syn', active = (S.side === 'B') === !!i;
    x.save(); rrect(x, px, py, pw, ph, 14); x.clip();
    x.fillStyle = '#0b0f1c'; x.fillRect(px, py, pw, ph);
    if (img) {
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      const f = i && afterPrev ? clamp((now - fadeT0) / (FADE() || 1), 0, 1) : 1;
      if (f < 1) { x.drawImage(afterPrev, px, py, pw, ph); x.globalAlpha = f; } else if (i) afterPrev = null;
      x.drawImage(img, px, py, pw, ph);
      x.globalAlpha = 1;
    } else {
      x.fillStyle = '#8d93ad'; x.font = `13px ${SANS}`; x.textAlign = 'center';
      x.fillText(S.err ? 'Could not process this. The reason is under Engine.' : 'Processing…', px + pw / 2, py + ph / 2 + 4);
      x.textAlign = 'left';
    }
    x.font = `10px ${SANS}`;
    for (let f = 5000; f < nyq; f += 5000) {
      const y = Math.round(py + ph - (f / nyq) * ph) + 0.5;
      x.strokeStyle = 'rgba(191, 194, 236, 0.09)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, y); x.lineTo(px + pw, y); x.stroke();
      if (y > py + 40) { x.fillStyle = 'rgba(182, 185, 207, 0.75)'; x.fillText(`${f / 1000}k`, px + 8, y - 4); }
    }
    if (fc && img) {
      const y = Math.round(py + ph - (fc / nyq) * ph) + 0.5;
      if (i) { x.fillStyle = syn ? 'rgba(241, 207, 142, 0.09)' : 'rgba(184, 183, 255, 0.06)'; x.fillRect(px, py, pw, y - py); }
      x.setLineDash([6, 5]); x.strokeStyle = 'rgba(241, 207, 142, 0.9)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(px, y); x.lineTo(px + pw, y); x.stroke(); x.setLineDash([]);
    }
    if (sel) { x.fillStyle = 'rgba(6, 9, 20, 0.5)'; x.fillRect(px, py, sel[0] - px, ph); x.fillRect(sel[1], py, px + pw - sel[1], ph); }
    x.restore();
    x.strokeStyle = active ? 'rgba(184, 183, 255, 0.6)' : 'rgba(191, 194, 236, 0.17)'; x.lineWidth = 1;
    rrect(x, px + 0.5, py + 0.5, pw - 1, ph - 1, 14); x.stroke();
    const wide = pw > 620, label = i ? (r ? `B · after · ${MODE[r.mode][0]}${wide ? `, ${syn ? 'synthesized above the cutoff' : r.mode === 'transient' ? 'attacks amplified, some new highs' : 'amplified, nothing added'}` : ''}` : 'B · after') : `A · before${wide ? ' · the source' : ''}`;
    tagText(x, label, px + 10, py + 10, active ? '#eeedfb' : '#b6b9cf');
    if (fc) tagText(x, `${wide ? 'cutoff ' : ''}${int(fc)} Hz`, px + pw - 10, py + 10, '#f1cf8e', 'right');
  }
  function drawStage(now) {
    const x = g;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#101525'; x.fillRect(0, 0, W, H);
    for (const [cx, cy, rad, col] of [[0.2, 0.08, 0.55, 'rgba(120, 110, 230, 0.12)'], [0.86, 0.8, 0.5, 'rgba(110, 200, 210, 0.07)']]) {
      const gr = x.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, rad * Math.max(W, H));
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(16, 21, 37, 0)'); x.fillStyle = gr; x.fillRect(0, 0, W, H);
    }
    if (!geo || !S.src) return;
    const top = geo.y0, bot = geo.y1 + geo.h;
    const sel = S.drag ? [...S.drag].sort((a, b) => a - b) : S.sel ? [tx(S.sel[0]), tx(S.sel[1])] : null;
    drawPane(x, 0, now, sel); drawPane(x, 1, now, sel);
    if (sel) {
      x.strokeStyle = 'rgba(184, 183, 255, 0.95)'; x.lineWidth = 1.5;
      for (const s of sel) { x.beginPath(); x.moveTo(s + 0.5, top); x.lineTo(s + 0.5, bot); x.stroke(); }
      if (!S.drag && S.sel) tagText(x, `range ${S.sel[0].toFixed(2)} to ${S.sel[1].toFixed(2)} s`, clamp(sel[0] + 8, geo.x + 8, geo.x + geo.w - 180), geo.y1 + geo.h - 32, '#eeedfb');
    }
    if (nodes && bufA) {
      const px = Math.round(tx(bufA.n0 / S.src.sr + curPos())) + 0.5;
      x.strokeStyle = 'rgba(238, 237, 251, 0.85)'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(px, top); x.lineTo(px, bot); x.stroke();
    }
  }
  function frame(now) {
    rafOn = false;
    drawStage(now);
    if (nodes) { const o = openName(); if (o === 'source' || o === 'listen') drawSheets(); }
    if (nodes || S.drag || afterPrev) requestDraw();
  }
  function requestDraw() { if (!rafOn) { rafOn = true; requestAnimationFrame(frame); } }

  // drag across the spectrograms to choose a range; a click clears it
  const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => {
    if (!S.src || !geo || e.button > 0) return;
    const p = pt(e);
    if (p.x < geo.x || p.x > geo.x + geo.w || p.y < geo.y0 || p.y > geo.y1 + geo.h) return;
    cv.setPointerCapture(e.pointerId);
    S.drag = [p.x, p.x];
    requestDraw();
  });
  cv.addEventListener('pointermove', (e) => { if (S.drag) { S.drag[1] = clamp(pt(e).x, geo.x, geo.x + geo.w); requestDraw(); } });
  cv.addEventListener('pointerup', () => {
    if (!S.drag) return;
    const [a, b] = [...S.drag].sort((p, q) => p - q);
    S.drag = null;
    if (b - a < 6) { if (S.sel) setSel(null); else requestDraw(); } else setSel(tt(a), tt(b));
  });
  cv.addEventListener('pointercancel', () => { S.drag = null; requestDraw(); });

  /* ---------------- listening: A and B from the same instant ---------------- */
  let AC = null, master = null, an = null, nodes = null, startAt = 0, bufA = null, bufB = null;
  function ensureAudio() {
    if (!AC) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return false;
      AC = new C();
      master = AC.createGain(); master.gain.value = S.vol;
      an = AC.createAnalyser(); an.fftSize = 2048;
      master.connect(AC.destination); master.connect(an);
    }
    if (AC.state === 'suspended') AC.resume().catch(() => {});
    return true;
  }
  function prepareBuffers() {
    const r = S.res, s = S.src, keyA = `${s.id}:${r.n0}:${r.n1}`;
    const mk = (ch) => { const b = AC.createBuffer(ch.length, r.n1 - r.n0, s.sr); ch.forEach((c, i) => b.copyToChannel(c.subarray(r.n0, r.n1), i)); return b; };
    if (!bufA || bufA.key !== keyA) bufA = { key: keyA, b: mk(s.ch), n0: r.n0, len: r.n1 - r.n0 };
    if (!bufB || bufB.key !== r.id) bufB = { key: r.id, b: mk(r.out) };
  }
  const bGain = () => (S.match && S.res ? S.res.metrics.gain : 1);
  function curPos() {
    if (!nodes) return 0;
    const len = bufA.len / S.src.sr, el = Math.max(0, AC.currentTime - startAt);
    return S.loop ? el % len : Math.min(el, len);
  }
  const absPos = () => bufA.n0 / S.src.sr + curPos();
  function startNodes(off) {
    stopNodes();
    const sA = AC.createBufferSource(), sB = AC.createBufferSource(), gA = AC.createGain(), gB = AC.createGain();
    sA.buffer = bufA.b; sB.buffer = bufB.b; sA.loop = sB.loop = S.loop;
    gA.gain.value = S.side === 'A' ? 1 : S.side === 'D' ? -1 : 0; gB.gain.value = S.side === 'B' ? bGain() : S.side === 'D' ? 1 : 0;
    sA.connect(gA).connect(master); sB.connect(gB).connect(master);
    const t = AC.currentTime + 0.04;
    sA.start(t, off); sB.start(t, off); startAt = t - off;
    const me = { sA, sB, gA, gB };
    nodes = me;
    sA.onended = () => { if (nodes === me) { nodes = null; renderSound(); requestDraw(); } };
    renderSound(); requestDraw();
  }
  function stopNodes() {
    if (!nodes) return;
    const n = nodes; nodes = null;
    try { n.sA.stop(); n.sB.stop(); } catch (e) { /* already stopped */ }
    n.sA.disconnect(); n.sB.disconnect();
  }
  function play() {
    if (!ensureAudio()) { UI.toast('This browser has no Web Audio, so it cannot play sound.'); return; }
    engage();
    if (!S.res) { S.wantPlay = true; UI.toast('Processing first; it plays as soon as the result is ready.'); return; }
    prepareBuffers(); startNodes(0);
  }
  function restartAt(at) {
    prepareBuffers();
    const off = at - bufA.n0 / S.src.sr;
    startNodes(off >= 0 && off < bufA.len / S.src.sr ? off : 0);
  }
  function stop() { S.wantPlay = false; stopNodes(); renderSound(); requestDraw(); }
  const togglePlay = () => (nodes ? stop() : play());
  function flip(side) {
    S.side = side || (S.side === 'A' ? 'B' : 'A');
    if (nodes) {
      const t = AC.currentTime;
      nodes.gA.gain.setTargetAtTime(S.side === 'A' ? 1 : S.side === 'D' ? -1 : 0, t, 0.004);
      nodes.gB.gain.setTargetAtTime(S.side === 'B' ? bGain() : S.side === 'D' ? 1 : 0, t, 0.004);
    }
    engage(); renderSound(); renderGauges(); renderListen(); requestDraw();
    announce(S.side === 'A' ? 'A, the source' : S.side === 'D' ? 'Added detail only, at its actual level' : 'B, the result');
  }
  function liveDb() {
    if (!an || !nodes) return null;
    const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return 10 * Math.log10(s / d.length + 1e-12);
  }

  /* ---------------- readouts ---------------- */
  function renderAll() { renderSource(); renderProc(); renderSound(); renderGauges(); renderMeasured(); renderEngine(); renderListen(); renderSel(); }
  function srcInfo(tone, state, why) {
    $('src-info').dataset.tone = tone; $('src-state').textContent = state; $('src-why').textContent = why;
  }
  function renderSource() {
    const s = S.src; if (!s) return;
    const b = $('source-badge'), syn = s.origin === 'synthetic';
    b.dataset.source = syn ? 'synthetic' : 'file';
    $('source-label').textContent = syn ? 'Synthetic test sound · not a recording' : `${s.name} · ${rateText(s.sr)}`;
    b.title = syn ? 'The synthetic test sound is loaded. Open the source sheet' : `${s.name} is loaded. Open the source sheet`;
    const desc = `${rateText(s.sr)} · ${s.ch.length === 1 ? 'mono' : 'stereo'} · ${s.dur.toFixed(2)} s · ${s.format}${s.bits ? ` ${s.bits}-bit${s.float ? ' float' : ''}` : ''}`;
    srcInfo('good', syn ? 'Synthetic test sound' : s.name, desc);
    const R = rateText(s.sr);
    const why = {
      synthetic: `Made in this page at ${R}, so nothing was decoded.`,
      wav: `Read straight from the WAV file at ${R}, its own rate, sample for sample.`,
      aiff: `Read straight from the ${s.format} file at ${R}, its own rate, sample for sample.`,
      header: `Decoded by the browser at ${R}, the rate in the file's own ${s.format} header, so it was not resampled.`,
      opus: 'Opus always decodes at 48 kHz, its own rate, so it was not resampled.',
      unknown: `This file's own sample rate could not be read, so the browser decoded it at ${R}. If it was made at another rate, the browser resampled it.`,
    }[s.rateFrom] + (s.channelsInFile > 2 ? ` It has ${s.channelsInFile} channels; the first two are used.` : '');
    $('src-rate').textContent = why;
    $('src-rate').classList.toggle('warn', s.rateFrom === 'unknown' || s.channelsInFile > 2);
  }
  function renderSel() {
    const s = S.src; if (!s) return;
    const a = $('sel-t0'), b = $('sel-t1');
    a.max = b.max = s.dur.toFixed(2);
    if (document.activeElement !== a) a.value = (S.sel ? S.sel[0] : 0).toFixed(2);
    if (document.activeElement !== b) b.value = (S.sel ? S.sel[1] : s.dur).toFixed(2);
    $('sel-status').textContent = S.sel ? `Enhancing ${S.sel[0].toFixed(2)} to ${S.sel[1].toFixed(2)} s of ${s.dur.toFixed(2)} s. The rest stays untouched, and A/B plays the range.` : 'The whole sound. Drag across the spectrograms to choose a stretch, and a click clears it.';
    $('sel-full').disabled = !S.sel;
  }
  function chipLine(r) {
    if (r.mode === 'forge' && r.info.reason) return r.info.amount === 0 ? 'Forge · zero amount, source unchanged' : r.info.headroom_gain < .01 ? 'Forge · no headroom for added detail' : 'Forge · no room above guard, source unchanged';
    return { forge: `Forge · synthesized above ${(r.fc / 1000).toFixed(1)} kHz`, floor: 'Floor · amplified, nothing added', transient: 'Transient · amplified, some new highs', exciter: 'Exciter · harmonics synthesized', sbr: `SBR · synthesized above ${(r.fc / 1000).toFixed(1)} kHz` }[r.mode];
  }
  function renderProc() {
    const c = $('chip-proc'), busy = !!(inflight || runT || pending), r = S.res;
    if (S.err && !busy) { c.dataset.tone = 'bad'; $('chip-proc-text').textContent = `Could not process · ${S.err}`; }
    else if (busy) { c.dataset.tone = 'wait'; $('chip-proc-text').textContent = `Processing · ${Math.round(S.prog ? S.prog.pct : 0)} %`; }
    else if (r) { c.dataset.tone = 'good'; $('chip-proc-text').textContent = chipLine(r); }
    $('proc-bar').style.width = `${busy ? (S.prog ? S.prog.pct : 0) : r ? 100 : 0}%`;
    $('proc-line').textContent = S.err && !busy ? `Could not process: ${S.err}.` : busy ? `${Math.round(S.prog ? S.prog.pct : 0)} % · ${S.prog ? S.prog.line : 'starting'}` : r ? `Done in ${msText(r.ms)}, on ${r.selective ? 'the range' : 'the whole sound'}.` : '-';
    $('engine-state').textContent = r && !busy ? msText(r.ms) : busy ? 'working' : '';
  }
  function renderSound() {
    const c = $('chip-sound'), t = $('chip-sound-text');
    if (!(window.AudioContext || window.webkitAudioContext)) { c.dataset.tone = 'bad'; t.textContent = 'Sound · not supported'; }
    else if (nodes) { c.dataset.tone = 'good'; t.textContent = `Playing ${S.side} · ${S.side === 'A' ? 'the source' : S.side === 'D' ? 'added detail only' : 'the result'}`; }
    else if (S.wantPlay) { c.dataset.tone = 'wait'; t.textContent = 'Sound · waiting for the result'; }
    else { c.dataset.tone = 'idle'; t.textContent = AC ? `Stopped · ${S.side} chosen` : 'Sound · off'; }
    const p = $('listen-play');
    p.setAttribute('aria-pressed', String(!!nodes));
    p.querySelector('svg').innerHTML = nodes ? '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>' : '<path d="M7 5v14l11-7z"/>';
    $('listen-play-b').textContent = nodes ? 'Stop' : 'Play';
    const hp = $('hud-play');
    hp.setAttribute('aria-pressed', String(!!nodes)); hp.setAttribute('aria-label', nodes ? 'Stop' : 'Play');
    hp.querySelector('svg').innerHTML = p.querySelector('svg').innerHTML;
    $('hud-play-b').textContent = nodes ? 'Stop' : 'Play';
    $('listen-play-cap').textContent = nodes ? (S.loop ? 'Looping' : 'Playing once') : S.res && S.res.selective ? 'The range' : 'From the start';
  }
  function renderGauges() {
    const r = S.res;
    $('g-cutoff').innerHTML = r ? kHz(r.fc) : '-';
    $('g-bw').innerHTML = r ? kHz(r.metrics.bw_after) : '-';
    $('g-side').textContent = S.side === 'D' ? 'Δ' : S.side;
    $('g-side-name').textContent = S.side === 'A' ? 'source' : S.side === 'D' ? 'added detail' : 'result';
    $('detail-button').setAttribute('aria-pressed', String(S.side === 'D'));
    const ab = $('ab-toggle');
    ab.setAttribute('aria-pressed', String(S.side === 'B'));
    ab.setAttribute('aria-label', S.side === 'A' ? 'Listening: A, source. Press to hear B, the result' : S.side === 'D' ? 'Listening: added detail. Press to hear A, the source' : 'Listening: B, result. Press to hear A, the source');   // starts with the visible text, for speech input
  }
  function renderMeasured() {
    const r = S.res; if (!r) return;
    const M = r.metrics, syn = MODE[r.mode][1] === 'syn', set = (id, v, n, tone) => { $(id).textContent = v; $(`${id}-n`).textContent = n; $(id).dataset.tone = tone || ''; };
    set('m-bw', `${int(M.bw_before)} → ${int(M.bw_after)} Hz`, `${signed(M.bw_after - M.bw_before)} Hz · measured`);
    set('m-hb', `${M.hb_before.toFixed(0)} → ${M.hb_after.toFixed(0)} dB`, `${signed(M.hb_after - M.hb_before)} dB ${syn ? 'synthesized' : r.mode === 'transient' ? 'new, spread by the moving gain' : 'amplified'} · above the cutoff`);
    set('m-lsd', `${M.lsd.toFixed(2)} dB`, 'log-spectral distance below the cutoff, lower is truer', M.lsd < 3 ? 'good' : 'warn');
    set('m-nr', M.nr.verdict, `flatness ${M.nr.flatness.toFixed(3)} above the cutoff`, M.nr.ok ? 'good' : 'bad');
    set('m-gain', `${M.gain.toFixed(2)}×`, 'BS.1770 gain applied to B');
    set('m-fc', `${int(r.fc)} Hz`, r.mode === 'forge' && r.info.cutoff_source === 'user' ? 'chosen by you · source estimate ' + int(r.info.estimated_cutoff_hz) + ' Hz' : 'estimated from source spectrum');
    const fg = r.mode === 'forge';
    set('m-added', fg ? `${r.info.added_energy_percent.toFixed(2)} %` : '—', fg ? 'difference-layer energy / result energy; not recovered detail' : 'available in Forge');
    set('m-guard', fg ? `${r.info.guard_error_db.toFixed(0)} dB` : '—', 'added energy below guard / source energy below guard', fg && r.info.guard_error_db < -50 ? 'good' : '');
    set('m-headroom', fg ? `${(r.info.headroom_gain * 100).toFixed(0)} %` : '—', fg ? 'of invented layer retained; source never turned down' : 'available in Forge');
    $('m-warn').hidden = !(r.mode === 'sbr' && !M.nr.ok);
    const s = S.src;
    $('m-span').textContent = `${r.selective ? `Measured on ${(r.n0 / s.sr).toFixed(2)} to ${(r.n1 / s.sr).toFixed(2)} s, the range that was processed.` : 'Measured on the whole sound.'} ${r.mode === 'forge' ? 'Spectra combine channel energy; long files are sampled throughout. ' : ''}Cutoff and bandwidth are the highest frequency more than 12 dB above the spectrum's floor and within 60 dB of its peak.`;
  }
  const ENGINE_NOTE = {
    forge: 'Forge adds a high-frequency layer shaped by your sound’s tones, texture and attacks. The original stays underneath. Use Hear added layer to judge the invention on its own: plausible fine detail, not recovered audio.',
    floor: 'A high shelf from half the measured cutoff: the honest control. It lifts what is there and invents nothing above the cutoff.',
    exciter: 'The band above about 0.45 of the cutoff is waveshaped at four times the sample rate, so the new harmonics do not alias, then high-passed and mixed back. New content, made from what is there.',
    transient: 'A fast envelope runs ahead of a slow one, and the difference raises the gain on attacks. It synthesizes no band on purpose, but a gain that moves this fast spreads some new energy above the cutoff; the Measured sheet shows how much.',
    sbr: 'Spectral band replication: the top octave below the cutoff is folded upward, tilted, matched in level at the seam and given fresh phase. Plausible highs, synthesized, not recovered.',
  };
  const VIZ_TITLE = { forge: 'The source anchor and the invented band', floor: 'Shelf response', exciter: 'Shaper curve', transient: 'Gain over time', sbr: 'Band replication' };
  function renderEngine() {
    $('engine-viz-title').textContent = VIZ_TITLE[S.mode];
    $('engine-note').textContent = ENGINE_NOTE[S.mode];
    const r = S.res && S.res.mode === S.mode ? S.res : null, P = S.prm, fc = S.res ? S.res.fc : null, nyq = S.src ? S.src.sr / 2 : 22050;
    $('engine-viz-note').textContent = !fc ? 'Waiting for the first result.' : {
      forge: r && r.mode === 'forge' ? `${P.amount} % detail · ${r.info.cutoff_source === 'user' ? 'chosen' : 'estimated'} guard ${int(fc)} Hz · seed ${P.seed}. ${r.info.reason || `${r.info.added_energy_percent.toFixed(2)} % residual energy; low-band leakage ${r.info.guard_error_db.toFixed(0)} dB.`}` : 'Processing the detail layer…',
      floor: `+${P.gain} dB shelf from ${int(fc / 2)} Hz, half the measured cutoff of ${int(fc)} Hz.`,
      exciter: `The band above ${int(clamp(fc * 0.45, 800, S.src.sr * 0.35))} Hz, driven at ${(P.drive / 10).toFixed(1)} and mixed in at ${P.emix} %.`,
      transient: r && r.gainCurve ? `Gain from 1.00 up to at most ${(1 + 2 * P.tamt / 100).toFixed(2)}; this run peaked at ${Math.max(...r.gainCurve).toFixed(2)}.` : 'Processing…',
      sbr: `The octave from ${int(fc / 2)} to ${int(fc)} Hz, folded up to ${int(Math.min(P.target * 1000, nyq))} Hz, tilted ${P.tilt} dB per octave, ${P.wet} % wet.`,
    }[S.mode];
  }
  function renderListen() {
    $('side-a').setAttribute('aria-pressed', String(S.side === 'A'));
    $('side-b').setAttribute('aria-pressed', String(S.side === 'B'));
    $('side-d').setAttribute('aria-pressed', String(S.side === 'D'));
    $('side-b-cap').textContent = S.res ? (S.match ? `Matched, ${S.res.metrics.gain.toFixed(2)}×` : 'Not matched, as made') : 'Processing';
    const r = S.res;
    $('level-note').textContent = r ? `A ${r.kA.toFixed(1)} dB, B as made ${r.kB.toFixed(1)} dB, B as you hear it ${(r.kB + 20 * Math.log10(bGain())).toFixed(1)} dB: K-weighted mean square against full scale${r.selective ? ', over the range' : ''}. The white line is the level playing now, unweighted.` : '-';
  }

  /* ---------------- sheet pictures ---------------- */
  function vctx(id) {
    const c = $(id); if (!c) return null;
    const r = c.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return null;
    const d = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, r.width, r.height);
    return { x, w: r.width, h: r.height };
  }
  const openName = () => { const d = document.querySelector('dialog.sheet[open]'); return d ? d.id.replace('-sheet', '') : null; };
  function drawSheets(name) {
    const o = name || openName();
    if (o === 'source') drawWave();
    else if (o === 'engine') { renderEngine(); drawEngine(); }
    else if (o === 'listen') drawLevel();
    else if (o === 'measured') drawSpec();
  }
  const muted = (x, t, a, b, align) => { x.fillStyle = '#8d93ad'; x.font = `10px ${SANS}`; x.textAlign = align || 'left'; x.fillText(t, a, b); x.textAlign = 'left'; };
  function drawWave() {
    const v = vctx('wave-viz'), s = S.src; if (!v || !s) return;
    const { x, w, h } = v, n = s.pk.length / 2, mid = h / 2;
    const sx = S.sel ? (S.sel[0] / s.dur) * w : 0, ex = S.sel ? (S.sel[1] / s.dur) * w : w;
    if (S.sel) { x.fillStyle = 'rgba(184, 183, 255, 0.10)'; x.fillRect(sx, 0, ex - sx, h); }
    for (let i = 0; i < n; i++) {
      const px = (i / n) * w, inside = px >= sx && px <= ex;
      x.fillStyle = inside ? 'rgba(184, 183, 255, 0.85)' : 'rgba(141, 147, 173, 0.45)';
      const a = mid - s.pk[2 * i + 1] * mid * 0.92, b = mid - s.pk[2 * i] * mid * 0.92;
      x.fillRect(px, a, Math.max(1, w / n), Math.max(1, b - a));
    }
    if (S.sel) { x.strokeStyle = 'rgba(184, 183, 255, 0.95)'; x.lineWidth = 1.5; for (const p of [sx, ex]) { x.beginPath(); x.moveTo(p, 0); x.lineTo(p, h); x.stroke(); } }
    if (nodes && bufA) { const p = ((bufA.n0 / s.sr + curPos()) / s.dur) * w; x.strokeStyle = '#eeedfb'; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, h); x.stroke(); }
    muted(x, '0 s', 6, h - 6); muted(x, `${s.dur.toFixed(2)} s`, w - 6, h - 6, 'right');
  }
  const dB = (p) => 10 * Math.log10(p + 1e-20);
  function plotWelch(v, o) {
    const { x, w, h } = v, L = 36, Rm = 10, T = 10, B = 20, pw = w - L - Rm, ph = h - T - B;
    const fx = (f) => L + ((f - o.lo) / (o.hi - o.lo)) * pw;
    const lines = [o.before, o.after].filter(Boolean).map((W) => ({ f: W.f, d: Array.from(W.p, dB) }));
    let top = -Infinity;
    lines.forEach((l) => l.f.forEach((f, i) => { if (f >= o.lo && f <= o.hi && l.d[i] > top) top = l.d[i]; }));
    top = Math.ceil((top + 4) / 10) * 10; const bot = top - 100, fy = (d) => T + ((top - clamp(d, bot, top)) / (top - bot)) * ph;
    x.font = `10px ${SANS}`;
    (o.bands || []).forEach((b) => { const bx = fx(Math.max(b.lo, o.lo)); x.fillStyle = b.color; x.fillRect(bx, T, fx(Math.min(b.hi, o.hi)) - bx, ph); if (b.label) muted(x, b.label, bx + 5, bx + 5 + x.measureText(b.label).width > L + pw - 100 ? T + 26 : T + 12); });
    x.strokeStyle = 'rgba(191, 194, 236, 0.10)'; x.lineWidth = 1;
    for (let d = top; d >= bot; d -= 20) { const y = Math.round(fy(d)) + 0.5; x.beginPath(); x.moveTo(L, y); x.lineTo(L + pw, y); x.stroke(); muted(x, `${d}`, L - 5, y + 3, 'right'); }
    const step = o.hi - o.lo > 12000 ? 5000 : o.hi - o.lo > 5000 ? 2000 : 1000;
    for (let f = Math.ceil(o.lo / step) * step; f <= o.hi; f += step) muted(x, `${f / 1000}k`, fx(f), h - 5, 'center');
    lines.map((l, k) => [l, k]).reverse().forEach(([l, k]) => {          // after first, so before shows where they agree
      x.strokeStyle = k ? 'rgba(241, 207, 142, 0.95)' : 'rgba(184, 183, 255, 0.9)'; x.lineWidth = k ? 1.5 : 1.1; x.beginPath();
      let first = true;
      l.f.forEach((f, i) => { if (f < o.lo || f > o.hi) return; const px = fx(f), py = fy(l.d[i]); if (first) { x.moveTo(px, py); first = false; } else x.lineTo(px, py); });
      x.stroke();
    });
    if (o.fc) { x.setLineDash([5, 4]); x.strokeStyle = 'rgba(241, 207, 142, 0.85)'; x.beginPath(); x.moveTo(fx(o.fc) + 0.5, T); x.lineTo(fx(o.fc) + 0.5, T + ph); x.stroke(); x.setLineDash([]); }
    x.font = `10px ${SANS}`; x.fillStyle = '#b8b7ff'; x.fillText('before', L + pw - 92, T + 12); x.fillStyle = '#f1cf8e'; x.fillText(o.after ? 'after' : '', L + pw - 42, T + 12);
  }
  function drawSpec() {
    const v = vctx('spec-viz'), r = S.res; if (!v || !r) return;
    const syn = MODE[r.mode][1] === 'syn';
    plotWelch(v, { lo: 0, hi: S.src.sr / 2, before: r.metrics.wb, after: r.metrics.wa, fc: r.fc, bands: [{ lo: r.fc, hi: S.src.sr / 2, color: syn ? 'rgba(241, 207, 142, 0.07)' : 'rgba(184, 183, 255, 0.05)', label: syn ? 'synthesized' : 'amplified only' }] });
  }
  function drawEngine() {
    const v = vctx('engine-viz'), s = S.src; if (!v || !s) return;
    const { x, w, h } = v, P = S.prm, r = S.res, fc = r ? r.fc : null, nyq = s.sr / 2;
    if (!fc) { muted(x, 'Processing…', w / 2, h / 2, 'center'); return; }
    const axis = (L, T, pw, ph) => { x.strokeStyle = 'rgba(191, 194, 236, 0.16)'; x.lineWidth = 1; x.strokeRect(L + 0.5, T + 0.5, pw, ph); };
    if (S.mode === 'floor') {
      const [b0, b1, b2, , a1, a2] = DSP.rbjHighShelf(0.5 * fc, s.sr, P.gain), L = 36, T = 10, pw = w - 46, ph = h - 30, lo = 20, top = 20, bot = -3;
      const fx = (f) => L + (Math.log(f / lo) / Math.log(nyq / lo)) * pw, fy = (d) => T + ((top - d) / (top - bot)) * ph;
      axis(L, T, pw, ph);
      for (const d of [0, 6, 12, 18]) { x.strokeStyle = 'rgba(191, 194, 236, 0.08)'; x.beginPath(); x.moveTo(L, fy(d)); x.lineTo(L + pw, fy(d)); x.stroke(); muted(x, `${d} dB`, L - 4, fy(d) + 3, 'right'); }
      x.strokeStyle = '#b8b7ff'; x.lineWidth = 1.8; x.beginPath();
      for (let i = 0; i <= pw; i++) {
        const f = lo * (nyq / lo) ** (i / pw), om = (2 * Math.PI * f) / s.sr, c1 = Math.cos(om), s1 = Math.sin(om), c2 = Math.cos(2 * om), s2 = Math.sin(2 * om);
        const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
        const d = 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
        if (i) x.lineTo(L + i, fy(d)); else x.moveTo(L, fy(d));
      }
      x.stroke();
      x.setLineDash([5, 4]); x.strokeStyle = 'rgba(241, 207, 142, 0.9)'; x.lineWidth = 1; x.beginPath(); x.moveTo(fx(fc), T); x.lineTo(fx(fc), T + ph); x.stroke(); x.setLineDash([]);
      muted(x, 'cutoff', fx(fc) + 4, T + 12); muted(x, '100', fx(100), h - 5, 'center'); muted(x, '1k', fx(1000), h - 5, 'center'); muted(x, '10k', fx(10000), h - 5, 'center');
    } else if (S.mode === 'exciter') {
      const d = P.drive / 10, nrm = Math.tanh(d), L = 30, T = 8, side = Math.min(w - 60, h - 20), cx = L + side / 2, cy = T + side / 2, sc = side / 2 / 1.25;
      axis(L, T, side, side);
      x.strokeStyle = 'rgba(191, 194, 236, 0.14)'; x.beginPath(); x.moveTo(L, cy); x.lineTo(L + side, cy); x.moveTo(cx, T); x.lineTo(cx, T + side); x.stroke();
      x.setLineDash([4, 4]); x.strokeStyle = 'rgba(141, 147, 173, 0.6)'; x.beginPath(); x.moveTo(cx - sc, cy + sc); x.lineTo(cx + sc, cy - sc); x.stroke(); x.setLineDash([]);
      x.strokeStyle = '#f1cf8e'; x.lineWidth = 1.8; x.beginPath();
      for (let i = 0; i <= 120; i++) { const u = -1 + i / 60, o = Math.tanh(d * u), y = (o + 0.22 * o * o) / nrm; const px = cx + u * sc, py = cy - y * sc; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
      const tx0 = L + side + 16;
      x.fillStyle = '#eeedfb'; x.font = `300 22px ${SANS}`; x.fillText(d.toFixed(1), tx0, T + 30); muted(x, 'DRIVE', tx0, T + 44);
      x.fillStyle = '#eeedfb'; x.font = `300 22px ${SANS}`; x.fillText(`${P.emix} %`, tx0, T + 82); muted(x, 'MIX', tx0, T + 96);
      muted(x, 'in', L + side - 4, cy + 12, 'right'); muted(x, 'out', cx + 4, T + 12);
    } else if (S.mode === 'transient') {
      const L = 36, T = 10, pw = w - 46, ph = h - 30, gc = r && r.mode === 'transient' ? r.gainCurve : null, top = 1 + (2 * P.tamt) / 100;
      axis(L, T, pw, ph);
      const n0 = r.n0 / s.sr, n1 = r.n1 / s.sr, k0 = Math.floor((n0 / s.dur) * (s.pk.length / 2)), k1 = Math.ceil((n1 / s.dur) * (s.pk.length / 2));
      x.fillStyle = 'rgba(141, 147, 173, 0.35)';
      for (let k = k0; k < k1; k++) { const px = L + ((k - k0) / Math.max(1, k1 - k0)) * pw, a = Math.max(Math.abs(s.pk[2 * k]), Math.abs(s.pk[2 * k + 1])); x.fillRect(px, T + ph - a * ph, Math.max(1, pw / (k1 - k0)), a * ph); }
      if (gc) {
        const fy = (v2) => T + ph - ((v2 - 1) / Math.max(0.01, top - 1)) * ph;
        x.strokeStyle = '#b8b7ff'; x.lineWidth = 1.5; x.beginPath();
        gc.forEach((v2, i) => { const px = L + (i / (gc.length - 1)) * pw; if (i) x.lineTo(px, fy(v2)); else x.moveTo(px, fy(v2)); });
        x.stroke();
        muted(x, `${top.toFixed(2)}×`, L - 4, T + 9, 'right'); muted(x, '1.00×', L - 4, T + ph, 'right');
      } else muted(x, 'Processing…', L + pw / 2, T + ph / 2, 'center');
      muted(x, `${n0.toFixed(2)} s`, L, h - 5); muted(x, `${n1.toFixed(2)} s`, L + pw, h - 5, 'right');
    } else {
      const sbr = r && (r.mode === 'sbr' || r.mode === 'forge'), tgt = Math.min(S.mode === 'forge' ? P.ceiling * 100 : P.target * 1000, nyq);
      plotWelch(v, { lo: Math.max(0, fc * 0.35), hi: nyq, before: r.metrics.wb, after: sbr ? r.metrics.wa : null, fc,
        bands: [{ lo: fc / 2, hi: fc, color: 'rgba(184, 183, 255, 0.10)', label: S.mode === 'forge' ? 'source anchor' : 'source octave' }, { lo: fc, hi: tgt, color: 'rgba(241, 207, 142, 0.09)', label: 'synthesized' }] });
    }
  }
  function drawLevel() {
    const v = vctx('level-viz'), r = S.res; if (!v) return;
    const { x, w, h } = v, L = 92, Rm = 64, pw = w - L - Rm, fx = (d) => L + (clamp(d, -60, 0) + 60) / 60 * pw;
    if (!r) { muted(x, 'Processing…', w / 2, h / 2, 'center'); return; }
    const rows = [['A · source', r.kA, 'rgba(184, 183, 255, 0.85)'], ['B · as made', r.kB, 'rgba(241, 207, 142, 0.35)'], ['B · as heard', r.kB + 20 * Math.log10(bGain()), 'rgba(241, 207, 142, 0.95)']];
    rows.forEach(([lab, d, col], i) => {
      const y = 10 + i * 30;
      x.fillStyle = 'rgba(191, 194, 236, 0.08)'; rrect(x, L, y, pw, 16, 8); x.fill();
      x.fillStyle = col; rrect(x, L, y, Math.max(8, fx(d) - L), 16, 8); x.fill();
      x.fillStyle = '#b6b9cf'; x.font = `11px ${SANS}`; x.fillText(lab, 4, y + 12);
      x.fillStyle = '#eeedfb'; x.fillText(`${d.toFixed(1)} dB`, L + pw + 8, y + 12);
    });
    for (const d of [-60, -40, -20, 0]) muted(x, `${d}`, fx(d), h - 4, 'center');
    const now = liveDb();
    if (now != null) { const p = fx(now); x.strokeStyle = '#eeedfb'; x.lineWidth = 2; x.beginPath(); x.moveTo(p, 6); x.lineTo(p, 92); x.stroke(); }
  }

  /* ---------------- keeping it ---------------- */
  let LAST_DOWNLOAD = null;
  function dlBlob(blob, name) {
    const a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
    LAST_DOWNLOAD = { name, size: blob.size };
    $('keep-status').textContent = `Handed ${name} to the browser as a download, ${(blob.size / 1048576).toFixed(blob.size > 1048576 ? 1 : 2)} MB.`;
  }
  const baseName = () => (S.src.origin === 'synthetic' ? 'synthetic-test-sound' : S.src.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-'));
  function needResult() { if (!S.res) { UI.toast('Wait for the result first.'); return false; } return true; }
  function exportWav() { if (needResult()) dlBlob(new Blob([DSP.encodeWav24(S.res.out, S.src.sr)], { type: 'audio/wav' }), `${baseName()}_analog.wav`); }
  function numbers() {
    const r = S.res, s = S.src, M = r.metrics;
    return {
      app: 'Detail Forge Analog (browser)', made: new Date().toISOString(),
      source: { name: s.origin === 'synthetic' ? 'synthetic test sound' : s.name, synthetic: s.origin === 'synthetic', sample_rate: s.sr, rate_from: s.rateFrom, channels: s.ch.length, seconds: +s.dur.toFixed(4) },
      synthesis: r.mode === 'forge' ? r.info : null,
      engine: r.mode, label: MODE[r.mode][1] === 'syn' ? 'synthesized' : 'amplified', settings: r.params,
      range_seconds: r.selective ? [r.n0 / s.sr, r.n1 / s.sr] : null, measured_on: r.selective ? 'the processed range' : 'the whole sound',
      measured: { cutoff_hz: r.fc, bandwidth_before_hz: M.bw_before, bandwidth_after_hz: M.bw_after, high_band_before_db: M.hb_before, high_band_after_db: M.hb_after, lsd_db: M.lsd, flatness: M.nr.flatness, added_band: M.nr.verdict, loudness_gain_b: M.gain, k_weighted_a_db: r.kA, k_weighted_b_db: r.kB },
    };
  }
  function exportJson() { if (needResult()) dlBlob(new Blob([JSON.stringify(numbers(), null, 2)], { type: 'application/json' }), `${baseName()}_analog.json`); }
  function exportPng() {
    if (!needResult()) return;
    drawStage(performance.now() + 1e6);
    const foot = 110, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height + Math.round(foot * dpr);
    const x = c.getContext('2d'); x.drawImage(cv, 0, 0); x.scale(dpr, dpr);
    x.fillStyle = '#0b0f1c'; x.fillRect(0, H, W, foot);
    const r = S.res, M = r.metrics, cells = [['Engine', MODE[r.mode][0]], ['Cutoff', `${int(r.fc)} Hz`], ['Bandwidth', `${int(M.bw_after)} Hz`], ['High band', `${signed(M.hb_after - M.hb_before)} dB`], ['Original band', `${M.lsd.toFixed(2)} dB`], ['B gain', `${M.gain.toFixed(2)}×`]];
    const cw = (W - 80) / cells.length;
    cells.forEach(([k, v], i) => { x.fillStyle = '#8d93ad'; x.font = `12px ${SANS}`; x.fillText(k.toUpperCase(), 40 + i * cw, H + 36); x.fillStyle = '#eeedfb'; x.font = `300 22px ${SANS}`; x.fillText(v, 40 + i * cw, H + 64); });
    x.fillStyle = '#8d93ad'; x.font = `12px ${SANS}`;
    x.fillText(`${S.src.origin === 'synthetic' ? 'Synthetic test sound' : S.src.name} · measured in a browser · Detail Forge Analog, generative-av-labs`, 40, H + 94);
    c.toBlob((b) => { if (b) dlBlob(b, `${baseName()}_analog.png`); }, 'image/png');
  }

  /* ---------------- controls ---------------- */
  document.querySelectorAll('.mode-switch button[data-mode], .tile-btn.eng').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const KN = { amount: ['k-amount', 'v-amount', (v) => `${v} %`], cutoff: ['k-cutoff', 'v-cutoff', (v) => v ? `${(v / 10).toFixed(1)} kHz · chosen` : 'Auto · estimated'], ceiling: ['k-ceiling', 'v-ceiling', (v) => `${(v / 10).toFixed(1)} kHz`], wet: ['k-wet', 'v-wet', (v) => `${v} %`], tilt: ['k-tilt', 'v-tilt', (v) => `${v} dB/oct`], target: ['k-target', 'v-target', (v) => `${v} kHz`], gain: ['k-gain', 'v-gain', (v) => `${v} dB`],
    drive: ['k-drive', 'v-drive', (v) => (v / 10).toFixed(1)], emix: ['k-emix', 'v-emix', (v) => `${v} %`], tamt: ['k-tamt', 'v-tamt', (v) => `${v} %`] };
  const syncKnob = (k) => { const [id, vid, f] = KN[k]; $(id).value = S.prm[k]; $(vid).textContent = f(S.prm[k]); };
  Object.entries(KN).forEach(([k, [id]]) => $(id).addEventListener('input', () => { S.prm[k] = +$(id).value; syncKnob(k); engage(); renderEngine(); drawSheets(); scheduleRun(320); }));
  const GROUP = { forge: ['amount', 'cutoff', 'ceiling'], sbr: ['wet', 'tilt', 'target'], floor: ['gain'], exciter: ['drive', 'emix'], transient: ['tamt'] };
  $('eng-reset').addEventListener('click', () => { GROUP[S.mode].forEach((k) => { S.prm[k] = DEF[k]; syncKnob(k); }); UI.syncAllRanges(); scheduleRun(0); renderEngine(); drawSheets(); });

  const fileIn = $('file-input'), pick = () => fileIn.click();
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; openFile(f); });
  $('open-button').addEventListener('click', pick);
  $('src-open').addEventListener('click', pick);
  $('src-synth').addEventListener('click', () => { setSource(makeSynthetic()); UI.toast('The synthetic test sound is loaded.'); });
  $('sel-full').addEventListener('click', () => setSel(null));
  ['sel-t0', 'sel-t1'].forEach((id) => $(id).addEventListener('change', () => setSel($('sel-t0').value, $('sel-t1').value)));

  $('start-listen').addEventListener('click', () => { play(); cv.focus({ preventScroll: true }); });   // the button fades, so Space goes on to flip A and B
  $('listen-play').addEventListener('click', togglePlay);
  $('hud-play').addEventListener('click', togglePlay);
  $('ab-toggle').addEventListener('click', () => flip());
  $('side-a').addEventListener('click', () => flip('A'));
  $('side-b').addEventListener('click', () => flip('B'));
  $('side-d').addEventListener('click', () => flip('D'));
  $('detail-button').addEventListener('click', () => { flip(S.side === 'D' ? 'A' : 'D'); if (!nodes) play(); });
  $('compare-open').addEventListener('click', () => { UI.openSheet('engine'); $('comparison-engines').open = true; $('comparison-engines').scrollIntoView({ block: 'nearest' }); });
  const updateSeed = (value) => { S.prm.seed = Math.max(0, Math.min(4294967295, Math.trunc(+value || 0))); $('forge-seed').value = S.prm.seed; scheduleRun(0); };
  $('forge-seed').addEventListener('change', () => updateSeed($('forge-seed').value));
  $('new-seed').addEventListener('click', () => updateSeed((S.prm.seed + 1) >>> 0));
  function bindSwitch(id, key, after) {
    const b = $(id), sync = () => b.setAttribute('aria-checked', String(S[key]));
    b.addEventListener('click', () => { S[key] = !S[key]; store.set(key, S[key]); sync(); after(); });
    sync();
  }
  bindSwitch('match', 'match', () => { if (nodes && S.side === 'B') nodes.gB.gain.setTargetAtTime(bGain(), AC.currentTime, 0.01); renderListen(); drawLevel(); });
  bindSwitch('loop', 'loop', () => { if (nodes) { nodes.sA.loop = nodes.sB.loop = S.loop; } renderSound(); });
  const vol = $('vol');
  vol.value = Math.round(S.vol * 100); $('vol-val').textContent = `${vol.value} %`;
  vol.addEventListener('input', () => { S.vol = +vol.value / 100; $('vol-val').textContent = `${vol.value} %`; store.set('volume', S.vol); if (master) master.gain.setTargetAtTime(S.vol, AC.currentTime, 0.02); });
  $('export-wav').addEventListener('click', exportWav);
  $('export-png').addEventListener('click', exportPng);
  $('export-json').addEventListener('click', exportJson);
  function toggleFs() {
    const d = document;
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); }
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => UI.toast('Full screen is not available here.'));
    else UI.toast('Full screen is not available in this browser.');
  }
  $('fs-button').addEventListener('click', toggleFs);

  addEventListener('keydown', (e) => {
    const t = e.target, tn = t && t.tagName;
    if (tn === 'INPUT' || tn === 'SELECT' || tn === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      if (tn === 'BUTTON' || tn === 'A' || tn === 'SUMMARY') return;   // the focused control takes its own space
      e.preventDefault();
      if (!e.repeat) flip();
      return;
    }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'p') togglePlay();
    else if (k === 'd') flip(S.side === 'D' ? 'A' : 'D');
    else if (k >= '1' && k <= '5') setMode(MODE_IDS[+k - 1]);
    else if (k === 'o') pick();
    else if (k === 'f') toggleFs();
  });
  // a suspended context resumes on the next click or key, anywhere
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (AC && AC.state === 'suspended') AC.resume().catch(() => {}); }, true));

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
    document.querySelectorAll('dialog.sheet[open]').forEach((d) => d.close());
    openFile(e.dataTransfer.files[0]);
  });

  /* ---------------- flicker check hook ---------------- */
  // the stage's brightness on a small grid, every frame
  function recordLuma(ms) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const x = c.getContext('2d', { willReadFrequently: true }), frames = [], t0 = performance.now();
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    return new Promise((res) => {
      const step = (now) => {
        x.drawImage(cv, 0, 0, 64, 36);
        const d = x.getImageData(0, 0, 64, 36).data, grid = [];
        for (let i = 0; i < d.length; i += 4) grid.push(+(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]).toFixed(1));
        frames.push({ t: +(now - t0).toFixed(1), grid });
        if (now - t0 > ms) res(frames); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------------- boot ---------------- */
  addEventListener('analog:sheet', (e) => drawSheets(e.detail));
  addEventListener('resize', () => { layout(); drawSheets(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  cv.tabIndex = 0;
  cv.setAttribute('aria-describedby', 'stage-help');
  $('scene').insertAdjacentHTML('beforeend', '<p id="stage-help" class="sr-only">The top spectrogram is the source and the bottom one is the result, with the measured cutoff dashed. Drag across them to choose a range, and a click clears it; the range can also be typed in the Source sheet. Space flips A and B, and P plays or stops.</p>');
  Object.keys(KN).forEach(syncKnob);
  UI.syncAllRanges();
  layout();
  setMode('forge', true);
  setSource(makeSynthetic());

  window.__app = {
    S, setMode, setSel, flip, play, stop, openFile, decodeAny, sniffRate, makeSynthetic, recordLuma,
    get mode() { return S.mode; }, get side() { return S.side; }, get playing() { return !!nodes; }, get sound() { return AC ? AC.state : 'off'; },
    get busy() { return !!(inflight || runT || pending); }, get runs() { return S.runs; }, get lastDownload() { return LAST_DOWNLOAD; },
    get source() { const s = S.src; return s && { name: s.name, origin: s.origin, sr: s.sr, channels: s.ch.length, frames: s.n, seconds: s.dur, rateFrom: s.rateFrom, format: s.format, channelsInFile: s.channelsInFile }; },
    get result() { const r = S.res; if (!r) return null; const { wb, wa, ...m } = r.metrics; return { mode: r.mode, fc: r.fc, info: r.info, selective: r.selective, n0: r.n0, n1: r.n1, metrics: m, kA: r.kA, kB: r.kB, ms: r.ms }; },
    get auditionGains() { return nodes ? [nodes.gA.gain.value, nodes.gB.gain.value] : null; }, get gainB() { return bGain(); }, get geo() { return geo && { ...geo, dur: S.src.dur }; },
    outSlice(c, i0, i1) { return Array.from(S.res.out[c].subarray(i0, i1)); },
    srcSlice(c, i0, i1) { return Array.from(S.src.ch[c].subarray(i0, i1)); },
  };
})();
