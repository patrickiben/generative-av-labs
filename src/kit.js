/* kit.js: live drum input for the browser.
   Audio capture, Web MIDI, a demo, keyboard pads and session replay all end in one hit bus
   and one spectrum, so the visuals never need to know where a hit came from.
   Nothing here touches the network. Raw audio is analyzed in memory and never stored. */
(function (global) {
  'use strict';

  const BANDS = 64, FMIN = 30, FMAX = 16000;
  const HIST_W = 512, HIST_RATE = 40;           // about 12.8 s of spectrum history
  const SESSION_RATE = 30;
  const NOISE_GATE_DB = -65;                    // below this an open input reads as no signal
  const LIVE_HOLD_MS = 6000, MIDI_HOLD_MS = 8000;
  const MIDI_OWNS_HITS_MS = 15000;              // recent MIDI notes make audio onsets texture only
  const FLASH_GAP_MS = 340;                     // at most about 3 full-field flashes a second

  const PADS = [
    { id: 'kick', label: 'Kick', voice: 'kick' },
    { id: 'snare', label: 'Snare', voice: 'snare' },
    { id: 'hat', label: 'Hi-hat', voice: 'hat' },
    { id: 'tomH', label: 'High tom', voice: 'tom', pos: 0.8 },
    { id: 'tomM', label: 'Mid tom', voice: 'tom', pos: 0.5 },
    { id: 'tomL', label: 'Low tom', voice: 'tom', pos: 0.2 },
    { id: 'crash', label: 'Crash', voice: 'crash' },
    { id: 'ride', label: 'Ride', voice: 'ride' },
  ];
  const PAD = Object.fromEntries(PADS.map((p) => [p.id, p]));
  const VOICES = ['kick', 'snare', 'hat', 'tom', 'crash', 'ride'];
  const PRESETS = {
    ekit: {
      name: 'E-kit starting map',
      notes: { kick: [36], snare: [38, 40, 37, 23], hat: [42, 22, 44, 46], tomH: [48, 50], tomM: [45, 47], tomL: [43, 41], crash: [49, 57, 52, 55], ride: [51, 53, 59] },
    },
    gm: {
      name: 'General MIDI',
      notes: { kick: [35, 36], snare: [38, 40, 37, 39], hat: [42, 44, 46], tomH: [48, 50], tomM: [45, 47], tomL: [41, 43], crash: [49, 57, 52, 55], ride: [51, 53, 59] },
    },
  };
  const SOFT_NOTES = { 23: 0.55 };              // a brush sweep note reads as a soft snare
  const TAU = { kick: 0.15, snare: 0.11, hat: 0.06, tom: 0.18, crash: 0.95, ride: 0.3, flash: 0.09 };
  const TEMPO_WEIGHT = { kick: 1, snare: 1, hat: 0.4, tom: 0.6, crash: 0.6, ride: 0.4 };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('drv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('drv.' + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
  };

  /* ------------------------------------------------- pure math, testable from the page */

  // Which drum does a hit look like, from peak levels in four bands (dB)? A stated heuristic, not a model.
  function classify(L, M1, M2, H) {
    if (H >= M2 - 1 && H - Math.max(L, M1) > 8) return 'hat';
    if (L - M2 > 10 && L - M1 > -1.5) return 'kick';
    if (Math.max(L, M1) - M2 > 9) return 'tom';
    return 'snare';
  }

  // Tempo from hit times: a weighted histogram of intervals, folded by octaves into 70 to 180 BPM.
  function estimateTempo(times, weights) {
    const n = times.length;
    if (n < 4) return { bpm: null, conf: 0 };
    const lo = 70, hi = 180, bins = new Float64Array(hi - lo + 2);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dt = times[j] - times[i];
        if (dt > 2.2) break;
        if (dt < 0.09) continue;
        let b = 60 / dt;
        while (b > hi) b /= 2;
        while (b < lo) b *= 2;
        if (b > hi) continue;
        const w = (weights ? weights[i] * weights[j] : 1) * Math.exp(-dt / 1.6);
        const x = b - lo, k = Math.floor(x), f = x - k;
        bins[k] += w * (1 - f);
        bins[k + 1] += w * f;
      }
    }
    let best = 0, sum = 0;
    const s = new Float64Array(bins.length);
    for (let i = 0; i < bins.length; i++) {
      s[i] = (bins[i - 1] || 0) * 0.25 + bins[i] * 0.5 + (bins[i + 1] || 0) * 0.25;
      sum += s[i];
      if (s[i] > s[best]) best = i;
    }
    if (!sum) return { bpm: null, conf: 0 };
    const a = s[best - 1] || 0, b = s[best], c = s[best + 1] || 0, d = a - 2 * b + c;
    const refine = d ? clamp((0.5 * (a - c)) / d, -0.5, 0.5) : 0;
    return { bpm: lo + best + refine, conf: clamp((b * 12) / sum, 0, 1) };
  }

  function analyzeSession(sess) {
    const hits = (sess && sess.hits) || [];
    const per = {};
    VOICES.forEach((v) => { per[v] = { n: 0, velMean: 0, velSD: 0 }; });
    const times = [], weights = [];
    hits.forEach((h) => {
      const p = per[h.voice] || (per[h.voice] = { n: 0, velMean: 0, velSD: 0 });
      p.n++; p.velMean += h.vel;
      times.push(h.t / 1000); weights.push(TEMPO_WEIGHT[h.voice] || 0.5);
    });
    Object.values(per).forEach((p) => { if (p.n) p.velMean /= p.n; });
    hits.forEach((h) => { const p = per[h.voice]; p.velSD += (h.vel - p.velMean) ** 2; });
    Object.values(per).forEach((p) => { p.velSD = p.n > 1 ? Math.sqrt(p.velSD / (p.n - 1)) : 0; });
    const tempo = estimateTempo(times, weights);
    let ioiDevMs = null;
    if (tempo.bpm && times.length > 8) {
      const grid = 60 / tempo.bpm / 4, dev = [];
      for (let i = 1; i < times.length; i++) {
        const ioi = times[i] - times[i - 1];
        if (ioi < 0.06 || ioi > 1) continue;
        dev.push(Math.abs(ioi - Math.round(ioi / grid) * grid) * 1000);
      }
      if (dev.length) { dev.sort((a, b) => a - b); ioiDevMs = dev[dev.length >> 1]; }
    }
    const durationS = (sess && sess.durationMs ? sess.durationMs : 0) / 1000;
    return { durationS, hits: hits.length, perVoice: per, bpm: tempo.bpm, ioiDevMs, hitsPerMin: durationS ? (hits.length / durationS) * 60 : 0 };
  }

  function bandFreq(i) { return FMIN * Math.pow(FMAX / FMIN, (i + 0.5) / BANDS); }

  // Check the complete import before it can replace live input or reach the animation loop.
  function validateSession(s) {
    const invalid = () => { throw new Error('This session is incomplete or has invalid events. Open an unedited session saved by Nebula.'); };
    const number = (v, lo, hi = Infinity) => Number.isFinite(v) && v >= lo && v <= hi;
    if (!s || !/\/session@1$/.test(s.schema || '') || !number(s.durationMs, 0) ||
        !Array.isArray(s.hits) || !Array.isArray(s.ctrl) ||
        (s.bands != null && s.bands !== BANDS) ||
        (s.frameRate != null && !number(s.frameRate, 1, 240))) invalid();
    const ordered = (events, time, valid) => {
      let last = -1;
      for (const e of events) {
        if (!e) invalid();
        const t = time(e);
        if (!number(t, 0, s.durationMs + 1) || t < last || !valid(e)) invalid();
        last = t;
      }
    };
    ordered(s.hits, h => h.t, h => Object.hasOwn(PAD, h.pad) && h.voice === PAD[h.pad].voice &&
      number(h.vel, 0, 1) && (h.note == null || (Number.isInteger(h.note) && number(h.note, 0, 127))));
    ordered(s.ctrl, c => c.t, c => c.k === 'pedal' ? number(c.v, 0, 127) :
      c.k === 'choke' && (c.v === 'crash' || c.v === 'ride'));
    if (s.lanes != null && (typeof s.lanes !== 'object' || Array.isArray(s.lanes))) invalid();
    for (const [name, lane] of Object.entries(s.lanes || {})) {
      if (!Array.isArray(lane)) invalid();
      ordered(lane, p => p[0], p => Array.isArray(p) && p.length === 2 &&
        (name === 'shape' ? p[1] === 0 || p[1] === 1 : name === 'mode' ? ['field', 'form'].includes(p[1]) : true));
    }
    if (typeof s.spectrumBase64 !== 'string') invalid();
    let bin;
    try { bin = atob(s.spectrumBase64); } catch (_) { invalid(); }
    if (bin.length % BANDS) invalid();
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  function bump(center, widthOct, gain) {
    const out = new Float32Array(BANDS);
    for (let i = 0; i < BANDS; i++) {
      const o = Math.log2(bandFreq(i) / center) / widthOct;
      out[i] = gain * Math.exp(-0.5 * o * o);
    }
    return out;
  }
  function mix2(a, b) { return a.map((v, i) => Math.max(v, b[i])); }
  // With MIDI and no audio, a hit still paints a spectrum. These are stated shapes, not a measurement.
  const SHAPES = {
    kick: mix2(bump(70, 0.9, 1), bump(3000, 1.2, 0.18)),
    snare: mix2(bump(220, 0.7, 0.7), bump(2500, 2.2, 0.85)),
    hat: bump(9000, 1.0, 1),
    crash: bump(7000, 2.2, 1),
    ride: mix2(bump(4200, 0.6, 0.6), bump(9000, 1.2, 0.6)),
    tomL: bump(95, 0.7, 1), tomM: bump(150, 0.7, 1), tomH: bump(230, 0.7, 1),
  };

  /* ------------------------------------------------- onset detection inside the audio thread */

  const WORKLET_SRC = `
${classify.toString()}
class Biquad{constructor(t,f,q,sr){const w=2*Math.PI*f/sr,c=Math.cos(w),s=Math.sin(w),a=s/(2*q);let b0,b1,b2;const a0=1+a,a1=-2*c,a2=1-a;
  if(t==='lp'){b0=(1-c)/2;b1=1-c;b2=(1-c)/2}else if(t==='hp'){b0=(1+c)/2;b1=-(1+c);b2=(1+c)/2}else{b0=a;b1=0;b2=-a}
  this.b0=b0/a0;this.b1=b1/a0;this.b2=b2/a0;this.a1=a1/a0;this.a2=a2/a0;this.z1=0;this.z2=0}
  run(x){const y=this.b0*x+this.z1;this.z1=this.b1*x-this.a1*y+this.z2;this.z2=this.b2*x-this.a2*y;return y}}
const db=(v)=>20*Math.log10(v+1e-9);
class KitOnset extends AudioWorkletProcessor{
  constructor(){super();const sr=sampleRate;
    this.f=[new Biquad('lp',110,.7,sr),new Biquad('bp',260,.9,sr),new Biquad('bp',1800,.8,sr),new Biquad('hp',6500,.7,sr)];
    const taus=[.03,.02,.01,.006];this.dec=taus.map((t)=>Math.exp(-1/(t*sr)));
    this.env=[0,0,0,0];this.hop=Math.max(64,Math.round(sr*.00533));this.n=0;this.h=[];for(let i=0;i<4;i++)this.h.push(-180);
    this.lag=[[],[],[],[]];this.odf=new Float32Array(96);this.oi=0;this.ref=0;this.pend=null;this.cym=null;this.sens=1;
    this.pk=[0,0];this.sq=0;this.mc=0;this.ch=0;this.meterEvery=Math.round(sr/30/this.hop);this.hc=0;this.last=-1;
    this.port.onmessage=(e)=>{if(e.data&&e.data.sens)this.sens=e.data.sens};}
  process(inputs){const inp=inputs[0];if(!inp||!inp.length||!inp[0]){this.tickSilent();return true}
    const L=inp[0],R=inp[1]||L;this.ch=inp.length;const f=this.f,d=this.dec,e=this.env;
    for(let i=0;i<L.length;i++){const x=(L[i]+R[i])*.5,al=Math.abs(L[i]),ar=Math.abs(R[i]);
      if(al>this.pk[0])this.pk[0]=al;if(ar>this.pk[1])this.pk[1]=ar;this.sq+=x*x;this.mc++;
      for(let b=0;b<4;b++){const y=Math.abs(f[b].run(x));e[b]=y>e[b]?y:e[b]*d[b]}
      if(++this.n>=this.hop){this.n=0;this.frame()}}
    return true}
  tickSilent(){this.mc+=128;if(this.mc>=this.hop*this.meterEvery){this.port.postMessage({type:'meter',peakL:0,peakR:0,rms:0,ch:0});this.mc=0}}
  frame(){const dbs=this.env.map(db);let maxd=0,sumd=0,top=0;
    for(let b=0;b<4;b++){const q=this.lag[b];q.push(dbs[b]);if(q.length>4)q.shift();const dd=Math.max(0,dbs[b]-q[0]);sumd+=dd;if(dd>maxd){maxd=dd;top=b}}
    const o=maxd+.25*sumd;const w=this.odf;w[this.oi++%w.length]=o;
    const sorted=Array.from(w).sort((a,b)=>a-b),med=sorted[48],mad=sorted[72]-med;
    const thr=Math.max(9/this.sens,Math.min(22/this.sens,med+3*mad+5));
    this.ref=Math.max(0,this.ref-1);
    if(this.pend){const p=this.pend;for(let b=0;b<4;b++)if(dbs[b]>p.b[b])p.b[b]=dbs[b];
      if(--p.wait<=0){const v=classify(p.b[0],p.b[1],p.b[2],p.b[3]),peak=Math.max.apply(null,p.b);
        this.port.postMessage({type:'onset',voice:v,peakDb:peak,bands:p.b.slice(),strength:p.o,time:currentTime});
        if(v==='hat')this.cym={at:p.b[3],wait:Math.round(.17*sampleRate/this.hop),m:p.b[2]};this.pend=null}}
    if(this.cym){if(--this.cym.wait<=0){if(dbs[3]>this.cym.at-14)this.port.postMessage({type:'onset',voice:'crash',peakDb:this.cym.at,bands:dbs,strength:0,wash:true,time:currentTime});this.cym=null}}
    if(o>thr&&this.ref===0&&dbs[top]>-62){this.ref=Math.round(.045*sampleRate/this.hop);this.pend={b:dbs.slice(),wait:3,o};if(this.cym)this.cym=null}
    if(++this.hc>=this.meterEvery){this.hc=0;this.port.postMessage({type:'meter',peakL:this.pk[0],peakR:this.pk[1],rms:Math.sqrt(this.sq/Math.max(1,this.mc)),ch:this.ch});this.pk[0]=0;this.pk[1]=0;this.sq=0;this.mc=0}}
}
registerProcessor('kit-onset',KitOnset);`;

  /* ------------------------------------------------- the kit */

  function createKit() {
    const listeners = {};
    const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return kit; };
    const emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

    const audio = { state: 'idle', detail: '', devices: [], deviceId: store.get('audioDevice', null), label: '', peakDb: -120, peakL: 0, peakR: 0, zero: false, clipAt: -1e12, quietMs: 0, sampleRate: 0, channels: 0, latencyMs: null, needsGesture: false, trimDb: store.get('trim', 0), sens: store.get('sens', 1) };
    const midi = { state: 'idle', detail: '', inputs: [], inputId: store.get('midiPort', 'all'), label: '', last: '', log: [], lastT: 0, lastNoteT: -1e12, count: 0, quietMs: 0, flipPedal: store.get('flipPedal', false) };
    const env = { kick: 0, snare: 0, hat: 0, tom: 0, crash: 0, ride: 0, flash: 0, hatOpen: 0, tomPos: 0.5 };

    const spectrum = new Float32Array(BANDS);
    const audioSpec = new Float32Array(BANDS);
    const rawDb = new Float32Array(BANDS);
    const hist = new Uint8Array(HIST_W * BANDS * 2);       // RG: level, tonalness
    const column = new Uint8Array(BANDS * 2);
    let histX = 0, histAcc = 0;

    let ctx = null, inputBus = null, analyser = null, worklet = null, sink = null, recDest = null;
    let stream = null, micNode = null, connectSeq = 0, lastSignal = -1e12, freqData = null, binEdges = null;
    let midiAccess = null, demo = null, replay = null, session = null;
    let lastFlash = -1e12, keysT = -1e12, lastTick = 0, ceilDb = -55, lastTempo = 0;
    const hitLog = [];                                      // recent hits, newest last
    const tempoT = [], tempoW = [];

    let map = store.get('map', null) || JSON.parse(JSON.stringify(PRESETS.ekit.notes));
    let presetId = store.get('preset', 'ekit');
    if (!PRESETS[presetId] && presetId !== 'custom') presetId = 'ekit';    // a name from an earlier version
    let noteToPad = {};
    const buildNoteMap = () => { noteToPad = {}; Object.entries(map).forEach(([pad, notes]) => notes.forEach((n) => { noteToPad[n] = pad; })); };
    buildNoteMap();
    let learning = null;

    const midiOwnsHits = () => (midi.state === 'live' || midi.state === 'no-signal') && performance.now() - midi.lastNoteT < MIDI_OWNS_HITS_MS;

    const kit = {
      on, audio, midi, env, spectrum, rawDb, hist, column,
      BANDS, HIST_W, HIST_RATE, PADS, PRESETS,
      low: 0, mid: 0, high: 0, loud: 0, tonal: 0,
      tempo: { bpm: null, conf: 0 },
      hitLog,
      hits: 0, lastHit: null, hitAge: null,
      get histX() { return histX; },
      get mode() { return demo ? 'demo' : replay ? 'replay' : (audio.state === 'live' || midi.state === 'live' || performance.now() - keysT < 8000) ? 'live' : (stream || midi.state === 'no-signal') ? 'open' : 'none'; },
      get demoOn() { return !!demo; },
      get replayOn() { return !!replay; },
      get recording() { return !!session; },
      get hitSource() {
        if (demo) return 'demo';
        if (replay) return 'replay';
        if (midiOwnsHits()) return 'midi';
        if (audio.state === 'live') return 'audio';
        if (performance.now() - keysT < 8000) return 'keys';
        return 'none';
      },
      get map() { return map; }, get presetId() { return presetId; }, get learning() { return learning; },
    };

    const notifyState = () => emit('state', kit);
    const setAudio = (state, detail) => { const ch = audio.state !== state || audio.detail !== (detail || ''); audio.state = state; audio.detail = detail || ''; if (ch) notifyState(); };
    const setMidi = (state, detail) => { const ch = midi.state !== state || midi.detail !== (detail || ''); midi.state = state; midi.detail = detail || ''; if (ch) notifyState(); };

    /* ---------------- hits ---------------- */
    function hit(padId, vel, src, extra) {
      const pad = PAD[padId] || { voice: 'snare' };
      const v = pad.voice, now = performance.now();
      env[v] = Math.max(env[v], vel);
      if (v === 'tom' && pad.pos != null) env.tomPos = pad.pos;
      if (v === 'crash' && now - lastFlash >= FLASH_GAP_MS && !(extra && extra.wash)) { env.flash = Math.max(env.flash, vel); lastFlash = now; }
      const h = { t: now, voice: v, pad: padId, vel, src, note: extra && extra.note != null ? extra.note : null, est: !!(extra && extra.est) };
      hitLog.push(h);
      if (hitLog.length > 400) hitLog.shift();
      tempoT.push(now / 1000); tempoW.push(TEMPO_WEIGHT[v] || 0.5);
      while (tempoT.length && now / 1000 - tempoT[0] > 8) { tempoT.shift(); tempoW.shift(); }
      kit.hits++; kit.lastHit = h;
      if (session) session.hits.push({ t: now - session.t0, voice: v, pad: padId, vel: +vel.toFixed(3), src, note: h.note });
      emit('hit', h);
    }
    function pedal(value, src) {
      env.hatOpen = midi.flipPedal ? clamp(value / 127, 0, 1) : 1 - clamp(value / 127, 0, 1);
      if (session) session.ctrl.push({ t: performance.now() - session.t0, k: 'pedal', v: value });
      if (src !== 'replay') emit('cc', { cc: 4, value });
    }
    function choke(voice) {
      if (voice === 'crash') { env.crash *= 0.12; env.flash = 0; } else if (voice === 'ride') { env.ride *= 0.12; }
      if (session) session.ctrl.push({ t: performance.now() - session.t0, k: 'choke', v: voice });
      emit('choke', voice);
    }

    function handleMidi(data, src) {
      const st = data[0];
      if (st >= 0xf8) return;                                // clock and active sensing are not playing
      const type = st & 0xf0, ch = (st & 0x0f) + 1, d1 = data[1], d2 = data[2];
      const now = performance.now();
      if (src === 'midi') {
        midi.lastT = now; midi.count++; midi.quietMs = 0;
        const text = type === 0x90 ? `note ${d1} vel ${d2} ch ${ch}` : type === 0x80 ? `off ${d1} ch ${ch}` : type === 0xb0 ? `CC${d1} = ${d2} ch ${ch}` : type === 0xa0 ? `aftertouch ${d1} = ${d2} ch ${ch}` : `0x${st.toString(16)} ${d1 ?? ''} ${d2 ?? ''}`;
        const unmapped = type === 0x90 && d2 > 0 && noteToPad[d1] == null;
        const line = text + (unmapped ? ' · unmapped' : '');
        if (type !== 0x80 && !(type === 0x90 && d2 === 0)) midi.last = line;   // the chip shows what you played, not the release
        midi.log.unshift(line);
        if (midi.log.length > 8) midi.log.pop();
        if (midi.state !== 'live') setMidi('live');
        emit('midi', midi);
      }
      if (type === 0x90 && d2 > 0) {
        if (src === 'midi') midi.lastNoteT = now;
        if (learning) { assignNote(learning, d1); learning = null; notifyState(); }
        const padId = noteToPad[d1];
        const soft = SOFT_NOTES[d1] || 1;
        hit(padId || 'snare', clamp((d2 / 127) * (padId ? soft : 0.5), 0, 1), src, { note: d1 });
      } else if (type === 0xa0) {
        const pad = PAD[noteToPad[d1]];
        if (d2 >= 32 && pad && (pad.voice === 'crash' || pad.voice === 'ride')) choke(pad.voice);
      } else if (type === 0xb0) {
        if (d1 === 4) pedal(d2, src);
        else emit('cc', { cc: d1, value: d2 });
      }
    }

    function assignNote(padId, note) {
      Object.keys(map).forEach((k) => { map[k] = map[k].filter((n) => n !== note); });
      (map[padId] = map[padId] || []).push(note);
      presetId = 'custom';
      store.set('map', map); store.set('preset', presetId);
      buildNoteMap();
    }
    kit.learn = (padId) => { learning = learning === padId ? null : padId; notifyState(); };
    kit.usePreset = (id) => {
      if (!PRESETS[id]) return;
      map = JSON.parse(JSON.stringify(PRESETS[id].notes)); presetId = id; learning = null;
      store.set('map', map); store.set('preset', id);
      buildNoteMap(); notifyState();
    };
    kit.setFlipPedal = (b) => { midi.flipPedal = !!b; store.set('flipPedal', midi.flipPedal); };
    kit.pad = (padId, vel) => { keysT = performance.now(); hit(padId, vel == null ? 0.85 : vel, 'keys'); notifyState(); };

    /* ---------------- audio graph ---------------- */
    function ensureCtx(rate) {
      if (ctx && rate && ctx.sampleRate !== rate && !navigator.userAgent.includes('Chrome')) { try { ctx.close(); } catch (e) { /* closing */ } ctx = null; }
      if (ctx) return ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not available');
      try { ctx = new AC({ latencyHint: 'interactive', ...(rate ? { sampleRate: rate } : {}) }); } catch (e) { ctx = new AC({ latencyHint: 'interactive' }); }
      inputBus = ctx.createGain();
      inputBus.gain.value = Math.pow(10, audio.trimDb / 20);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0; analyser.minDecibels = -120; analyser.maxDecibels = 0;
      inputBus.connect(analyser);
      sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);   // keeps the graph pulled without playing anything
      freqData = new Float32Array(analyser.frequencyBinCount);
      const hzPerBin = ctx.sampleRate / analyser.fftSize, fmax = Math.min(FMAX, ctx.sampleRate * 0.47);
      binEdges = new Float32Array(BANDS + 1);
      for (let i = 0; i <= BANDS; i++) binEdges[i] = (FMIN * Math.pow(fmax / FMIN, i / BANDS)) / hzPerBin;
      worklet = null;
      return ctx;
    }
    async function ensureWorklet() {
      if (worklet) return;
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      worklet = new AudioWorkletNode(ctx, 'kit-onset', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'explicit', channelCount: 2 });
      worklet.port.onmessage = onWorklet;
      worklet.port.postMessage({ sens: audio.sens });
      inputBus.connect(worklet); worklet.connect(sink);
    }
    function onWorklet(e) {
      const m = e.data;
      if (m.type === 'meter') {
        const pk = Math.max(m.peakL, m.peakR);
        const d = 20 * Math.log10(pk + 1e-9);
        audio.peakDb = audio.peakDb > d ? audio.peakDb - 1.2 : d;
        audio.peakL = m.peakL; audio.peakR = m.peakR; audio.channels = m.ch || audio.channels;
        audio.zero = pk === 0;
        if (d > -0.4) audio.clipAt = performance.now();
        if (d > NOISE_GATE_DB && !demo && !replay) { lastSignal = performance.now(); if (stream && audio.state !== 'live') setAudio('live'); }
      } else if (m.type === 'onset') {
        if (demo || replay) return;
        kit.onsetCount = (kit.onsetCount || 0) + 1;
        if (midiOwnsHits()) return;    // MIDI says which drum; audio stays texture
        const vel = clamp((m.peakDb + 48) / 42, 0.05, 1);
        const padId = m.voice === 'tom' ? (m.bands[1] > m.bands[0] + 3 ? 'tomH' : m.bands[0] > m.bands[1] + 1 ? 'tomL' : 'tomM') : m.voice;
        hit(padId, m.wash ? vel * 0.7 : vel, 'audio', { est: true, wash: m.wash });
      }
    }

    function micMessage(e) {
      const ff = /firefox/i.test(navigator.userAgent);
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        if (/system/i.test(e.message)) return ['denied', 'macOS is blocking this browser. Turn it on in System Settings, Privacy & Security, Microphone, then reload.'];
        return ['denied', ff ? 'Allow the microphone from the icon in the address bar, then press Connect again.' : 'Allow the microphone from the lock icon in the address bar, then press Connect again.'];
      }
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return ['no-device', 'This computer shows no audio input. Plug in or power on your interface, then press Connect.'];
      if (e.name === 'NotReadableError' || e.name === 'AbortError') return ['busy', 'The input could not be opened. Another app may hold it, or the interface may have stopped responding.'];
      return ['busy', `The input failed: ${e.name || 'error'}.`];
    }

    async function listAudioDevices() {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === 'audioinput');
      const real = inputs.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');
      audio.devices = (real.length ? real : inputs).map((d, i) => ({ id: d.deviceId, label: d.label || `Audio input ${i + 1}` }));
      notifyState();
      return audio.devices;
    }

    kit.connectAudio = async (deviceId) => {
      const seq = ++connectSeq;
      if (!global.isSecureContext) return setAudio('insecure', 'Audio capture needs HTTPS or localhost.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return setAudio('unsupported', 'This browser cannot capture audio. Use Chrome or Edge.');
      const want = deviceId !== undefined ? deviceId : audio.deviceId;
      setAudio('requesting', 'Answer the browser prompt to continue.');
      const open = (id) => navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, ...(id ? { deviceId: { exact: id } } : {}) },
        video: false,
      });
      let s;
      try {
        try { s = await open(want); } catch (e) {
          if (want && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) s = await open(null);    // the saved device is gone
          else throw e;
        }
      } catch (e) {
        if (seq !== connectSeq) return;
        const [state, msg] = micMessage(e);
        return setAudio(state, msg);
      }
      if (seq !== connectSeq) { s.getTracks().forEach((t) => t.stop()); return; }
      releaseMic();
      stream = s;
      const track = s.getAudioTracks()[0];
      const set = track.getSettings ? track.getSettings() : {};
      try {
        ensureCtx(set.sampleRate);
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 700))]);
        await ensureWorklet();
        micNode = ctx.createMediaStreamSource(s);
        if (!demo) micNode.connect(inputBus);
      } catch (e) {
        releaseMic();
        return setAudio('busy', `The audio path failed: ${e.message}.`);
      }
      audio.deviceId = set.deviceId && set.deviceId !== 'default' ? set.deviceId : (want || null);
      audio.label = cleanLabel(track.label) || 'Audio input';
      audio.sampleRate = set.sampleRate || ctx.sampleRate;
      audio.latencyMs = Math.round(((set.latency || 0) + (ctx.baseLatency || 0)) * 1000) || null;
      store.set('audioDevice', audio.deviceId);
      lastSignal = -1e12;
      track.onended = () => { if (stream === s) { releaseMic(); setAudio('lost', `${audio.label} disconnected. Plug it back in and press Connect.`); } };
      await listAudioDevices();
      audio.needsGesture = ctx.state !== 'running';
      if (audio.needsGesture) {
        const go = () => { ctx.resume().then(() => { audio.needsGesture = false; notifyState(); }); };
        addEventListener('pointerdown', go, { once: true });
        addEventListener('keydown', go, { once: true });
      }
      setAudio('no-signal');
    };
    function cleanLabel(l) { return (l || '').replace(/^Default - /, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, ''); }
    function releaseMic() {
      if (micNode) { try { micNode.disconnect(); } catch (e) { /* gone */ } micNode = null; }
      if (stream) { stream.getTracks().forEach((t) => { t.onended = null; t.stop(); }); stream = null; }
    }
    kit.disconnectAudio = () => { connectSeq++; releaseMic(); audio.peakL = 0; audio.peakR = 0; audio.peakDb = -120; setAudio('idle'); };
    kit.setTrim = (db) => { audio.trimDb = db; store.set('trim', db); if (inputBus) inputBus.gain.value = Math.pow(10, db / 20); };
    kit.setSensitivity = (x) => { audio.sens = x; store.set('sens', x); if (worklet) worklet.port.postMessage({ sens: x }); };

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => { if (stream || audio.devices.length) listAudioDevices().catch(() => {}); });
    }

    /* ---------------- MIDI ---------------- */
    function midiPorts() {
      if (!midiAccess) return;
      midi.inputs = [...midiAccess.inputs.values()].filter((p) => p.state === 'connected').map((p) => ({ id: p.id, name: p.name || 'MIDI input', manufacturer: p.manufacturer || '' }));
      midiAccess.inputs.forEach((p) => {
        const use = p.state === 'connected' && (midi.inputId === 'all' || midi.inputId === p.id);
        p.onmidimessage = use ? (ev) => handleMidi(ev.data, 'midi') : null;
      });
      const selected = midi.inputId === 'all' ? null : midi.inputs.find((p) => p.id === midi.inputId);
      if (!midi.inputs.length) {
        const wasLive = midi.state === 'live' || midi.state === 'no-signal';
        midi.label = '';
        setMidi(wasLive ? 'lost' : 'no-device', wasLive ? 'The MIDI interface went away. Plug it back in; it reconnects by itself.' : 'No MIDI input found. Plug in your USB-MIDI interface; it appears here by itself.');
      } else {
        if (midi.inputId !== 'all' && !selected) { midi.inputId = 'all'; }
        midi.label = selected ? selected.name : midi.inputs.length === 1 ? midi.inputs[0].name : `All ${midi.inputs.length} inputs`;
        if (midi.state !== 'live') setMidi('no-signal');
      }
      notifyState();
    }
    kit.connectMidi = async () => {
      if (!navigator.requestMIDIAccess) return setMidi('unsupported', /safari/i.test(navigator.userAgent) && !/chrome|chromium|edg/i.test(navigator.userAgent) ? 'Safari has no Web MIDI. Use Chrome or Edge for MIDI; audio still works here.' : 'This browser has no Web MIDI. Use Chrome or Edge for MIDI; audio still works here.');
      if (!global.isSecureContext) return setMidi('insecure', 'Web MIDI needs HTTPS or localhost.');
      setMidi('requesting', 'Answer the browser prompt to continue.');
      try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      } catch (e) {
        const ff = /firefox/i.test(navigator.userAgent);
        return setMidi('denied', ff ? 'Firefox needs a site permission add-on for MIDI. Chrome and Edge need only a prompt.' : 'MIDI permission was refused. Allow MIDI devices from the lock icon in the address bar, then press Connect again.');
      }
      midiAccess.onstatechange = midiPorts;
      midiPorts();
    };
    kit.selectMidi = (id) => { midi.inputId = id; store.set('midiPort', id); midi.state = midi.state === 'live' ? 'no-signal' : midi.state; midiPorts(); };
    kit.disconnectMidi = () => {
      if (midiAccess) { midiAccess.onstatechange = null; midiAccess.inputs.forEach((p) => { p.onmidimessage = null; }); }
      midiAccess = null; midi.inputs = []; midi.label = ''; setMidi('idle');
    };

    /* ---------------- demo drum machine ---------------- */
    let noiseBuf = null;
    function demoVoice(pad, vel, t, D) {
      const c = ctx, out = D.bus, env1 = (node, a, dur) => { const g = c.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); node.connect(g); g.connect(out); return g; };
      const noise = () => { const n = c.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.start(t, Math.random()); n.stop(t + 2); return n; };
      const v = PAD[pad].voice;
      if (v === 'kick') {
        const o = c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11); env1(o, 0.95 * vel, 0.3); o.start(t); o.stop(t + 0.32);
        const n = noise(), hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; n.connect(hp); env1(hp, 0.25 * vel, 0.02);
      } else if (v === 'snare') {
        const n = noise(), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400; n.connect(hp); env1(hp, 0.6 * vel, 0.17);
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(205, t); env1(o, 0.55 * vel, 0.11); o.start(t); o.stop(t + 0.14);
      } else if (v === 'hat') {
        const n = noise(), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7600; n.connect(hp); env1(hp, 0.42 * vel, 0.035 + 0.28 * env.hatOpen);
      } else if (v === 'tom') {
        const f = 85 + (PAD[pad].pos || 0.5) * 150, o = c.createOscillator(); o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); env1(o, 0.8 * vel, 0.3); o.start(t); o.stop(t + 0.33);
      } else if (v === 'crash') {
        const n = noise(), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3400; n.connect(hp); env1(hp, 0.5 * vel, 1.5);
      } else {
        const n = noise(), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 7000; bp.Q.value = 1.4; n.connect(bp); env1(bp, 0.34 * vel, 0.45);
        const o = c.createOscillator(); o.frequency.value = 3100; env1(o, 0.07 * vel, 0.3); o.start(t); o.stop(t + 0.32);
      }
    }
    function demoStep(D, s, t) {
      const fire = (pad, vel) => { demoVoice(pad, vel, t, D); D.timers.push(setTimeout(() => { if (demo === D) hit(pad, vel, 'demo'); }, Math.max(0, (t - ctx.currentTime) * 1000))); };
      const sec = Math.floor(D.bar / 8) % 3, fill = D.bar % 8 === 7 && s >= 8;
      if (s === 0 && D.bar % 8 === 0 && D.bar > 0) { fire('crash', 0.95); fire('kick', 1); }
      if (fill) {
        if (s % 2 === 0 || s > 13) fire(s < 11 ? 'tomH' : s < 14 ? 'tomM' : 'tomL', 0.8 + (s % 3) * 0.06);
        return;
      }
      const kicks = [[0, 6, 8], [0, 3, 8, 11], [0, 8, 10]][sec], snares = [4, 12];
      if (kicks.includes(s)) fire('kick', s === 0 ? 1 : 0.82);
      if (snares.includes(s)) fire('snare', 0.92);
      if ((s === 7 || s === 15) && sec !== 1) fire('snare', 0.22);
      if (sec === 0 && s % 2 === 0) { pedal(127, 'demo'); fire('hat', s % 4 === 0 ? 0.7 : 0.48); }
      if (sec === 1 && s % 2 === 0) fire('ride', s % 4 === 0 ? 0.74 : 0.5);
      if (sec === 2 && s % 2 === 0) { pedal(s % 4 === 2 ? 25 : 127, 'demo'); fire('hat', s % 4 === 2 ? 0.8 : 0.5); }
      if (sec === 0 && s === 4 && D.bar % 16 === 8) choke('crash');
    }
    function demoLoop() {
      const D = demo;
      if (!D) return;
      D.timers = D.timers.filter((t) => t !== null).slice(-64);
      const stepDur = () => 60 / [108, 96, 124][Math.floor(D.bar / 8) % 3] / 4;
      while (D.next < ctx.currentTime + 0.12) {
        demoStep(D, D.step, D.next);
        D.next += stepDur();
        if (++D.step >= 16) { D.step = 0; D.bar++; }
      }
    }
    kit.startDemo = async () => {
      if (demo) return;
      if (replay) kit.stopReplay();
      ensureCtx();
      await ctx.resume();
      try { await ensureWorklet(); } catch (e) { /* the spectrum still works without onsets */ }
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (micNode) { try { micNode.disconnect(); } catch (e) { /* not connected */ } }
      const bus = ctx.createGain();
      bus.connect(inputBus);
      const monitor = ctx.createGain(); monitor.gain.value = kit.demoAudible ? 0.7 : 0; bus.connect(monitor); monitor.connect(ctx.destination);
      demo = { bus, monitor, step: 0, bar: 0, next: ctx.currentTime + 0.08, timers: [] };
      demo.timer = setInterval(demoLoop, 25);
      demoLoop();
      notifyState();
    };
    kit.stopDemo = () => {
      if (!demo) return;
      clearInterval(demo.timer); demo.timers.forEach(clearTimeout);
      try { demo.bus.disconnect(); demo.monitor.disconnect(); } catch (e) { /* gone */ }
      demo = null;
      if (micNode) micNode.connect(inputBus);
      notifyState();
    };
    kit.demoAudible = false;
    kit.setDemoAudible = (b) => { kit.demoAudible = !!b; if (demo) demo.monitor.gain.value = b ? 0.7 : 0; };

    /* ---------------- recording and replay ---------------- */
    kit.startRecording = (appName) => {
      session = { t0: performance.now(), app: appName, created: new Date().toISOString(), hits: [], ctrl: [], lanes: {}, frames: [], acc: 0 };
      notifyState();
    };
    kit.noteLane = (name, value) => { if (session) (session.lanes[name] = session.lanes[name] || []).push([Math.round(performance.now() - session.t0), value]); };
    kit.stopRecording = () => {
      if (!session) return null;
      const s = session; session = null;
      const durationMs = performance.now() - s.t0;
      const bytes = new Uint8Array(s.frames.length * BANDS);
      s.frames.forEach((f, i) => bytes.set(f, i * BANDS));
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      const out = { schema: 'generative-av-labs/session@1', app: s.app, created: s.created, durationMs: Math.round(durationMs), note: 'Levels and events only. No audio is stored in this file.', bands: BANDS, frameRate: SESSION_RATE, hits: s.hits, ctrl: s.ctrl, lanes: s.lanes, spectrumBase64: btoa(bin) };
      notifyState();
      return out;
    };
    kit.startReplay = (s) => {
      const frames = validateSession(s);
      if (demo) kit.stopDemo();
      replay = { s, frames, t0: performance.now(), hi: 0, ci: 0, lanes: Object.entries(s.lanes || {}).map(([k, v]) => ({ k, v, i: 0 })) };
      if (micNode) { try { micNode.disconnect(); } catch (e) { /* not connected */ } }
      notifyState();
      emit('replay', true);
    };
    kit.stopReplay = () => {
      if (!replay) return;
      replay = null;
      if (micNode) micNode.connect(inputBus);
      audioSpec.fill(0);
      notifyState();
      emit('replay', false);
    };
    function stepReplay(now) {
      const R = replay, t = now - R.t0, s = R.s;
      while (R.hi < s.hits.length && s.hits[R.hi].t <= t) { const h = s.hits[R.hi++]; hit(h.pad, h.vel, 'replay', { note: h.note }); }
      while (R.ci < s.ctrl.length && s.ctrl[R.ci].t <= t) { const c = s.ctrl[R.ci++]; if (c.k === 'pedal') pedal(c.v, 'replay'); else choke(c.v); }
      R.lanes.forEach((l) => { while (l.i < l.v.length && l.v[l.i][0] <= t) { const p = l.v[l.i++]; emit('lane', { name: l.k, value: p[1] }); } });
      const fr = Math.floor((t / 1000) * (s.frameRate || SESSION_RATE)) * BANDS;
      if (fr + BANDS <= R.frames.length) for (let i = 0; i < BANDS; i++) audioSpec[i] = R.frames[fr + i] / 255;
      if (t >= s.durationMs) kit.stopReplay();
    }

    kit.recordingStream = () => {
      if (!ctx || !inputBus) return null;
      if (!recDest) { recDest = ctx.createMediaStreamDestination(); inputBus.connect(recDest); }
      return recDest.stream;
    };

    /* ---------------- the per-frame update ---------------- */
    function readAnalyser(dt) {
      if (!analyser || !(stream || demo)) { for (let i = 0; i < BANDS; i++) audioSpec[i] *= Math.exp(-dt / 0.2); return false; }
      analyser.getFloatFrequencyData(freqData);
      let top = -120, lsum = 0, asum = 0;
      for (let i = 0; i < BANDS; i++) {
        const a = binEdges[i], b = binEdges[i + 1];
        let v = -160;
        if (b - a < 1) {
          const k = Math.floor((a + b) / 2), f = (a + b) / 2 - k;
          v = (freqData[k] || -160) * (1 - f) + (freqData[k + 1] || -160) * f;
        } else {
          for (let k = Math.floor(a); k < Math.ceil(b); k++) if (freqData[k] > v) v = freqData[k];
        }
        if (!isFinite(v)) v = -160;
        v += 3 * Math.log2(bandFreq(i) / 1000);                // gentle tilt so cymbals read beside the kick
        rawDb[i] = v;
        if (v > top) top = v;
        const lin = Math.pow(10, v / 20);
        lsum += Math.log(lin + 1e-9); asum += lin;
      }
      // Rolling reference: the top of the range follows the loudest recent level, so a quiet or loud kit both fill it.
      ceilDb = Math.max(-55, Math.max(top, ceilDb - 1.2 * dt));
      const floor = ceilDb - 52;
      for (let i = 0; i < BANDS; i++) {
        const n = clamp((rawDb[i] - floor) / (ceilDb - floor), 0, 1);
        const shaped = n * n * (1.6 - 0.6 * n);
        audioSpec[i] = shaped > audioSpec[i] ? shaped : audioSpec[i] * Math.exp(-dt / 0.14) + shaped * (1 - Math.exp(-dt / 0.14));
      }
      kit.tonal += (clamp(1 - Math.exp(lsum / BANDS) / ((asum / BANDS) || 1), 0, 1) - kit.tonal) * Math.min(1, dt / 0.05);
      return true;
    }

    kit.tick = (now) => {
      now = now == null ? performance.now() : now;
      const dt = clamp((now - (lastTick || now)) / 1000, 0, 0.1);
      lastTick = now;

      Object.keys(TAU).forEach((k) => {
        const tau = k === 'hat' ? TAU.hat + 0.22 * env.hatOpen : TAU[k];
        env[k] *= Math.exp(-dt / tau);
      });
      if (replay) stepReplay(now);
      const analysed = replay ? false : readAnalyser(dt);
      const flowing = replay || (analysed && (demo || now - lastSignal < LIVE_HOLD_MS));
      for (let i = 0; i < BANDS; i++) {
        let v = flowing ? audioSpec[i] : 0;
        if (!flowing) {
          const p = env.tomPos, tomShape = p > 0.65 ? SHAPES.tomH : p > 0.35 ? SHAPES.tomM : SHAPES.tomL;
          v = Math.max(env.kick * SHAPES.kick[i], env.snare * SHAPES.snare[i], env.hat * SHAPES.hat[i], env.tom * tomShape[i], env.crash * SHAPES.crash[i], env.ride * SHAPES.ride[i]);
          v *= 0.92;
        }
        spectrum[i] = v;
      }
      let lo = 0, mi = 0, hi = 0;
      for (let i = 0; i < BANDS; i++) { const f = i / BANDS; if (f < 0.3) lo += spectrum[i]; else if (f < 0.7) mi += spectrum[i]; else hi += spectrum[i]; }
      kit.low = lo / (BANDS * 0.3); kit.mid = mi / (BANDS * 0.4); kit.high = hi / (BANDS * 0.3);
      const inst = (kit.low + kit.mid + kit.high) / 3;
      kit.loud += (inst - kit.loud) * Math.min(1, dt / (inst > kit.loud ? 0.03 : 0.35));

      // State clocks. These are what a visitor reads, so they keep running whether or not the page has focus.
      if (stream && !demo && audio.state !== 'requesting') {
        audio.quietMs = lastSignal > 0 ? now - lastSignal : 0;
        if (audio.state === 'live' && now - lastSignal > LIVE_HOLD_MS) setAudio('no-signal');
      }
      if (midi.state === 'live' && now - midi.lastT > MIDI_HOLD_MS) setMidi('no-signal');
      if (midi.lastT) midi.quietMs = now - midi.lastT;
      kit.hitAge = kit.lastHit ? now - kit.lastHit.t : null;

      if (now - lastTempo > 240) {
        lastTempo = now;
        const nowS = now / 1000;
        const fresh = tempoT.length && nowS - tempoT[tempoT.length - 1] < 3.5;
        kit.tempo = fresh ? estimateTempo(tempoT, tempoW) : { bpm: null, conf: 0 };
      }

      histAcc += dt;
      while (histAcc >= 1 / HIST_RATE) {
        histAcc -= 1 / HIST_RATE;
        histX = (histX + 1) % HIST_W;
        const ton = Math.round(kit.tonal * 255);
        for (let i = 0; i < BANDS; i++) {
          const v = Math.round(spectrum[i] * 255), o = (histX + i * HIST_W) * 2;
          hist[o] = v; hist[o + 1] = ton;
          column[i * 2] = v; column[i * 2 + 1] = ton;
        }
        emit('column', histX);
      }

      if (session) {
        session.acc += dt;
        while (session.acc >= 1 / SESSION_RATE) {
          session.acc -= 1 / SESSION_RATE;
          const f = new Uint8Array(BANDS);
          for (let i = 0; i < BANDS; i++) f[i] = Math.round(spectrum[i] * 255);
          session.frames.push(f);
        }
      }
      emit('frame', kit);
    };

    kit.feedMidi = (bytes) => handleMidi(bytes, 'midi');     // same path a real port uses; the tests call this too
    kit.autoconnect = {
      get on() { return store.get('reconnect', false); },
      set on(v) { store.set('reconnect', !!v); },
    };
    kit.tryReconnect = async () => {
      if (!store.get('reconnect', false)) return;
      try {
        const mic = await navigator.permissions.query({ name: 'microphone' });
        if (mic.state === 'granted') kit.connectAudio();
      } catch (e) { /* the query is not available everywhere */ }
      try {
        const m = await navigator.permissions.query({ name: 'midi' });
        if (m.state === 'granted') kit.connectMidi();
      } catch (e) { /* the query is not available everywhere */ }
    };

    // Before anyone presses anything: say what this browser cannot do.
    if (!global.isSecureContext) { audio.state = 'insecure'; audio.detail = 'Audio capture needs HTTPS or localhost.'; midi.state = 'insecure'; midi.detail = 'Web MIDI needs HTTPS or localhost.'; }
    else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { audio.state = 'unsupported'; audio.detail = 'This browser cannot capture audio. Use Chrome or Edge.'; }
      if (!navigator.requestMIDIAccess) { midi.state = 'unsupported'; midi.detail = 'This browser has no Web MIDI. Use Chrome or Edge for MIDI; audio still works here.'; }
    }
    return kit;
  }

  global.createKit = createKit;
  global.KitMath = { classify, estimateTempo, analyzeSession, bandFreq, BANDS, PADS, PRESETS };
})(window);
