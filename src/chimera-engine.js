/* chimera-engine.js: the Bio-Bass Chimera Lab engine, carried over from the desktop page (2026-09-25) with its
   synthesis, morph, phase check, genome and patch code unchanged. Only the parts tied to the old layout were
   rewritten: drawing, the boot, MIDI input (now chimera.js) and file decoding (now in the browser). */
"use strict";
/* ============================== PRESETS ============================== */
// formant freqs in Hz; the morph slides these along the (log) frequency axis = OT displacement
const ANIMALS=[
  {key:"duck",  nm:"Mallard Duck", emoji:"🦆", f0:320, wave:"sawtooth", ratio:1.0, fm:0.45, noise:0.28, hue:55,  F:[[900,7,1],[2200,9,.7],[3400,10,.4]]},
  {key:"wolf",  nm:"Timber Wolf",  emoji:"🐺", f0:170, wave:"sawtooth", ratio:1.49,fm:0.7,  noise:0.16, hue:22,  F:[[500,5,1],[1100,6,.6],[2400,8,.3]]},
  {key:"whale", nm:"Humpback",     emoji:"🐋", f0:90,  wave:"sine",     ratio:2.0, fm:0.5,  noise:0.06, hue:200, F:[[300,8,1],[700,9,.7],[1400,9,.3]]},
  {key:"cicada",nm:"Cicada",       emoji:"🦗", f0:430, wave:"sawtooth", ratio:1.0, fm:0.9,  noise:0.5,  hue:150, F:[[3800,11,1],[6200,13,.6]]},
  {key:"frog",  nm:"Bullfrog",     emoji:"🐸", f0:200, wave:"sine",     ratio:1.5, fm:0.6,  noise:0.22, hue:95,  F:[[400,7,1],[900,8,.6],[1600,9,.3]]},
  {key:"ele",   nm:"Elephant",     emoji:"🐘", f0:42,  wave:"sine",     ratio:1.0, fm:0.3,  noise:0.1,  hue:14,  F:[[120,6,1],[300,7,.5]]},
  {key:"hawk",  nm:"Red-tail Hawk",emoji:"🦅", f0:600, wave:"sawtooth", ratio:1.0, fm:0.8,  noise:0.4,  hue:300, F:[[2400,9,1],[4800,11,.6]]},
  // added in the browser version (2026-11-02): hand-set recipes in the same style, caricatures by ear, not measurements
  {key:"lion",  nm:"African Lion", emoji:"🦁", f0:110, wave:"sawtooth", ratio:1.5, fm:0.65, noise:0.3,  hue:38,  F:[[380,5,1],[900,6,.6],[1800,8,.3]]},
  {key:"owl",   nm:"Great Horned Owl",emoji:"🦉", f0:300, wave:"sine",  ratio:2.0, fm:0.15, noise:0.04, hue:28,  F:[[320,9,1],[640,10,.35],[960,10,.12]]},
  {key:"cat",   nm:"House Cat",    emoji:"🐈", f0:560, wave:"sawtooth", ratio:1.0, fm:0.4,  noise:0.12, hue:330, F:[[950,8,1],[2000,9,.7],[3300,10,.35]]},
  {key:"crow",  nm:"American Crow",emoji:"🐦", f0:620, wave:"sawtooth", ratio:1.0, fm:0.85, noise:0.5,  hue:265, F:[[1250,7,1],[2300,8,.65],[3600,9,.35]]},
  {key:"bee",   nm:"Bumblebee",    emoji:"🐝", f0:180, wave:"sawtooth", ratio:1.0, fm:0.9,  noise:0.08, hue:48,  F:[[520,4,1],[1500,5,.55],[3200,6,.3]]},
  {key:"snake", nm:"Rattlesnake",  emoji:"🐍", f0:55,  wave:"square",   ratio:3.0, fm:1.0,  noise:0.85, hue:85,  F:[[5200,3,1],[8200,4,.7],[11000,5,.35]]},
  {key:"cow",   nm:"Dairy Cow",    emoji:"🐄", f0:140, wave:"sawtooth", ratio:1.0, fm:0.35, noise:0.1,  hue:20,  F:[[450,6,1],[1150,7,.5],[2400,8,.22]]},
  {key:"dolphin",nm:"Bottlenose Dolphin",emoji:"🐬", f0:880, wave:"sine", ratio:2.0, fm:0.55, noise:0.15, hue:190, F:[[4200,10,1],[7600,12,.55],[11000,12,.25]]}
];
const idx=k=>ANIMALS.findIndex(a=>a.key===k);
const chimeraHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ============================== STATE ============================== */
const ST={ A:0, B:1, t:0, playing:false,
  wubRate:3.2, wubDepth:0.55, oct:0, phase:0, subLvl:0.7, drive:0.35, ott:0.4, fizz:0.20,
  glide:0.04, env:{a:0.04,d:0.12,s:0.85,r:0.18},
  pad:false, corners:[0,6,2,1], uv:{u:0.5,v:0.5},   // NW=duck NE=hawk SW=whale SE=wolf
  noteSt:0,                                          // live keyboard/MIDI pitch offset (semitones)
  // FX rack
  crushOn:false, crushBits:12, crushDown:1, spaceWet:0, verbDecay:3, delayMs:280, delayFB:0.35,
  // granular
  grainOn:false, grPos:0.3, grJit:0.15, grSize:90, grDens:24, grPitch:0, grPitchJit:0, grPan:0.6, grRev:0, grFreeze:false, grBufDur:0,
  // sequencer
  seq:{on:false,bpm:140,steps:16,cur:-1,swing:0,gateLen:0.6,note:[],glitch:[]},
  // chaos (seeded)
  seed:1337, chaos:0, humanize:0,
  // polyphony (unison + chord) — sub stays SINGLE & anchored; only lead voices stack
  voices:1, detune:0, spread:0, chord:'off',
  // sample import (feature 2): importMode picks what the NEXT load does; sampleMode='osc' uses the buffer as the FM-core replacement
  importMode:'formant', sampleMode:'off', sampleBuf:null, sampleAnimal:null,
  f0:320, subF:55, wd:0, lowRMS:0, lowDb:-60, mono:0, monoValid:false, autoSweep:false,
  genomeMode:false };
// init sequencer lanes
ST.seq.note=Array.from({length:16},()=>({gate:false,pitch:0}));
ST.seq.glitch=Array.from({length:16},()=>false);
const NF=3;  // fixed formant-bank size so the morph can update freqs live
let AC=null;
/* ============================== PALETTE ============================== */
// The suite's palette, in place of the desktop page's five skins. Drawing code asks for colors by these names.
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const TC={'--cyan':'#9fe3e0','--violet':'#b8b7ff','--amber':'#f1cf8e','--green':'#bfe8a6','--red':'#f4a3a3','--pink':'#ffb3d1',
  '--ink':'#eeedfb','--dim':'#8d93ad','--line':'rgba(191,194,236,0.22)','--panel':'#1a2032','--panel2':'#0b0f1c','--bg':'#101525'};
const themeColor=v=>TC[v]||'#fff';
// A soft swell of light on the stage when something locks in. At most about three a second, none with reduced motion.
let lastGlitch=0, PULSE=0;
function glitchBurst(el,intensity){
  if(RM.matches) return;
  const now=performance.now(); if(now-lastGlitch<340) return; lastGlitch=now;
  PULSE=Math.min(1,0.5*(intensity||1));
}
// the last note played, for the stage and the readouts
const NOTE_EVT={semi:0,t:-1e9,src:'none'};
// text fields take letters; ranges, checkboxes and buttons leave them to the keyboard instrument
const typingInto=el=>!!el&&(el.tagName==='TEXTAREA'||el.tagName==='SELECT'||(el.tagName==='INPUT'&&!['range','checkbox','radio','button'].includes(el.type)));
// a switch shows its state on the control itself; its label lives in the row beside it
function setSwitch(id,on){ const b=document.getElementById(id); if(!b) return; b.setAttribute('aria-checked',String(!!on)); b.classList.toggle('on',!!on); }
function syncPlay(){ const b=document.getElementById('play'); if(!b) return; b.textContent=ST.playing?'Stop':'Play drone'; b.setAttribute('aria-pressed',String(ST.playing)); b.classList.toggle('on',ST.playing); }
/* ============================== INTERP (OT-style) ============================== */
const lerp=(a,b,t)=>a+(b-a)*t;
const llerp=(a,b,t)=>Math.exp(lerp(Math.log(a),Math.log(b),t)); // log = freq displacement
// which sources + weights are active: pad = 4 corners bilinear; else A/B by t
function curWeights(){
  if(ST.pad){ const u=ST.uv.u, v=ST.uv.v;
    return {srcs:ST.corners.map(i=>ANIMALS[i]), w:[(1-u)*(1-v), u*(1-v), (1-u)*v, u*v]}; }
  return {srcs:[ANIMALS[ST.A],ANIMALS[ST.B]], w:[1-ST.t, ST.t]};
}
// blend N animals by weight w. Formants are interpolated on the LOG-frequency axis
// (= optimal-transport displacement: mass slides, it does not crossfade).
function blendAnimals(srcs,w){
  const n=Math.min(...srcs.map(s=>s.F.length));               // clamp to shortest bank
  const F=[];
  for(let i=0;i<n;i++){
    let lf=0,Q=0,amp=0;
    for(let k=0;k<srcs.length;k++){ lf+=w[k]*Math.log(srcs[k].F[i][0]); Q+=w[k]*srcs[k].F[i][1]; amp+=w[k]*srcs[k].F[i][2]; }
    F.push([Math.exp(lf), Q, amp]);
  }
  let lf0=0,ratio=0,fm=0,noise=0,hue=0;
  for(let k=0;k<srcs.length;k++){ lf0+=w[k]*Math.log(srcs[k].f0); ratio+=w[k]*srcs[k].ratio; fm+=w[k]*srcs[k].fm; noise+=w[k]*srcs[k].noise; hue+=w[k]*srcs[k].hue; }
  const f0base=Math.exp(lf0), f0=f0base*Math.pow(2,(ST.oct+ST.noteSt)/12);  // noteSt = live keyboard/MIDI offset
  let mi=0; for(let k=1;k<srcs.length;k++) if(w[k]>w[mi])mi=k;  // dominant source
  const dom=srcs[mi], nd=Math.min(n,dom.F.length);
  // mass-weighted displacement of the blend away from the nearest pure animal (0 at a corner, max in the middle)
  let num=Math.abs(Math.log2(f0base/dom.f0)), den=1;
  for(let i=0;i<nd;i++){ const m=Math.max(0.05,F[i][2]); num+=m*Math.abs(Math.log2(F[i][0]/dom.F[i][0])); den+=m; }
  return { f0, wave:dom.wave, ratio, fm, noise, hue, F, wd:num/den };
}
function morphedPatch(){ if(ST.genomeMode && typeof GENOME!=='undefined' && GENOME){ const p=genomeToPatch(GENOME); ST.wd=0; return p; } const {srcs,w}=curWeights(); const p=blendAnimals(srcs,w); ST.wd=p.wd; return p; }
function wdAtUV(u,v){ const srcs=ST.corners.map(i=>ANIMALS[i]); return blendAnimals(srcs,[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v]).wd; }
function subFreq(f0){ let s=f0; while(s>80)s/=2; while(s<35)s*=2; return s; }

/* ============================== AUDIO GRAPH ============================== */
let G=null; // live graph handles

/* ---- per-VOICE Brain: FM core (or a looped audio-file oscillator) + formant bank + wub + noise.
       Returns `lp` as its lead output, which sums into the shared master sat. One instance per
       polyphonic voice; the noise buffer is exposed so master fizz can share it (keeps the
       single-voice render byte-identical to the pre-refactor monolithic graph). ---- */
function buildVoice(ac, p, spec, opts){
  spec=spec||{semi:0,cents:0,pan:0}; opts=opts||{};
  const mult=Math.pow(2,((spec.semi||0)+(spec.cents||0)/100)/12);
  const f0=p.f0*mult;
  const voice=ac.createGain(); voice.gain.value=0.0;
  // ---- FM core, OR a looped decoded audio buffer as the oscillator (sample-voice mode a) ----
  let carrier, mod=null, modGain=null, sampleSrc=null;
  if(opts.sampleBuf){
    sampleSrc=ac.createBufferSource(); sampleSrc.buffer=opts.sampleBuf; sampleSrc.loop=true;
    sampleSrc.playbackRate.value=Math.pow(2,((ST.oct+ST.noteSt+(spec.semi||0)+(spec.cents||0)/100))/12);
    carrier=sampleSrc;
  } else {
    carrier=ac.createOscillator(); carrier.type=p.wave; carrier.frequency.value=f0;
    mod=ac.createOscillator(); mod.type="sine"; mod.frequency.value=f0*p.ratio;
    modGain=ac.createGain(); modGain.gain.value=f0*p.fm*4;
    mod.connect(modGain).connect(carrier.frequency);
  }
  // fixed-size formant bank (NF slots) so the morph can slide formant freqs live; unused slots muted
  const formants=[];
  for(let i=0;i<NF;i++){
    const f=p.F[i]||[1000,6,0];
    const bp=ac.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=f[0]; bp.Q.value=f[1];
    const g=ac.createGain(); g.gain.value=(p.F[i]?f[2]:0)*0.9;
    carrier.connect(bp); bp.connect(g); g.connect(voice);
    formants.push({bp,g});
  }
  const dry=ac.createGain(); dry.gain.value=0.12; carrier.connect(dry).connect(voice);
  // wub LFO -> a lowpass for movement
  const lp=ac.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=1800; lp.Q.value=4;
  voice.connect(lp);
  const lfo=ac.createOscillator(); lfo.type="sine"; lfo.frequency.value=ST.wubRate;
  const lfoG=ac.createGain(); lfoG.gain.value=1200*ST.wubDepth; lfo.connect(lfoG).connect(lp.frequency);
  // noise transient (per-voice); reuse a shared buffer if one is handed in, else make one now
  const nb=opts.noiseBuf||(function(){ const b=ac.createBuffer(1, ac.sampleRate*0.5, ac.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return b; })();
  const ns=ac.createBufferSource(); ns.buffer=nb; ns.loop=true;
  const nbp=ac.createBiquadFilter(); nbp.type="bandpass"; nbp.frequency.value=1600; nbp.Q.value=1.4;
  const nG=ac.createGain(); nG.gain.value=p.noise*0.25; ns.connect(nbp).connect(nG).connect(lp);
  const oscs=[carrier]; if(mod) oscs.push(mod); oscs.push(lfo,ns);
  return {out:lp, lp, voice, carrier, mod, modGain, sampleSrc, formants, lfo, lfoG, nG, nb, spec, oscs,
    start(time){oscs.forEach(o=>{try{o.start(time||0)}catch(e){}});},
    stop(time){oscs.forEach(o=>{try{o.stop(time)}catch(e){}});}
  };
}

/* ---- shared MASTER: sat -> OTT (+ fizz) -> leadBus -> crush insert -> space -> out, plus the
       Body sub sine + low fundamental, the <120Hz validator taps (lowMon/lowAna) and the viz/spec
       analysers — EXACTLY as the monolithic graph. Sub/leadLow are SINGLE and anchored to the ROOT
       patch, so the phase cross-validator stays physically meaningful under polyphony. ---- */
function buildMaster(ac, dest, p, opts){
  opts=opts||{};
  const out=ac.createGain(); out.gain.value=0.0; out.connect(dest);
  // ---- power stack: saturation -> OTT ----
  const sat=ac.createWaveShaper(); sat.curve=satCurve(ST.drive); sat.oversample="2x";
  const ott=ac.createDynamicsCompressor();
  ott.threshold.value=-30-ST.ott*15; ott.ratio.value=2+ST.ott*8; ott.attack.value=0.003; ott.release.value=0.12; ott.knee.value=8;
  sat.connect(ott);
  const fizzHP=ac.createBiquadFilter(); fizzHP.type="highpass"; fizzHP.frequency.value=6000;
  const nb=opts.noiseBuf||(function(){ const b=ac.createBuffer(1, ac.sampleRate*0.5, ac.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return b; })();
  const ns2=ac.createBufferSource(); ns2.buffer=nb; ns2.loop=true;
  const fizzG=ac.createGain(); fizzG.gain.value=ST.fizz*0.08; ns2.connect(fizzHP).connect(fizzG).connect(ott);
  const leadBus=ac.createGain(); leadBus.gain.value=0.9; ott.connect(leadBus);
  // ---- low fundamental of the patch (anchored to the ROOT patch f0) ----
  const sf=subFreq(p.f0); ST.subF=sf;
  const leadLow=ac.createOscillator(); leadLow.type="sine"; leadLow.frequency.value=sf;
  const leadLowG=ac.createGain(); leadLowG.gain.value=0.38; leadLow.connect(leadLowG);   // ~matched to default sub for a deep null
  // ---- sub (Body) with phase delay ----
  const sub=ac.createOscillator(); sub.type="sine"; sub.frequency.value=sf;
  const subDelay=ac.createDelay(0.05); subDelay.delayTime.value=(ST.phase/360)/sf;
  const subG=ac.createGain(); subG.gain.value=ST.subLvl*0.55; sub.connect(subDelay).connect(subG);
  const lowBus=ac.createGain(); leadLowG.connect(lowBus); subG.connect(lowBus);
  // ---- granular cloud bus: grains share the lead character chain (sat/OTT/crush/space) ----
  const grainBus=ac.createGain(); grainBus.gain.value=1.0; grainBus.connect(leadBus);
  // ---- bitcrush + sample-rate reduction (LEAD ONLY; inserted on toggle so the sub/validator path stays pristine & latency-free) ----
  const crush=ac.createScriptProcessor(2048,2,2);
  const cst={hold:[0,0],ph:[0,0]};
  crush.onaudioprocess=e=>{ const bits=Math.max(1,Math.min(16,ST.crushBits)), step=Math.pow(2,bits-1), ratio=Math.max(1,ST.crushDown), nc=e.inputBuffer.numberOfChannels;
    for(let c=0;c<nc;c++){ const inp=e.inputBuffer.getChannelData(c), o=e.outputBuffer.getChannelData(c); let hold=cst.hold[c]||0, ph=cst.ph[c]||0;
      for(let i=0;i<inp.length;i++){ ph+=1; if(ph>=ratio){ph-=ratio; hold=inp[i];} o[i]=Math.round(hold*step)/step; } cst.hold[c]=hold; cst.ph[c]=ph; } };
  // ---- space send: procedural-IR reverb + feedback delay (LEAD + grains only; wet default 0) ----
  const spaceSend=ac.createGain(); spaceSend.gain.value=ST.spaceWet; leadBus.connect(spaceSend); grainBus.connect(spaceSend);
  const verb=ac.createConvolver(); verb.buffer=makeIR(ac,2.0,ST.verbDecay); spaceSend.connect(verb); verb.connect(out);
  const dly=ac.createDelay(1.5); dly.delayTime.value=Math.max(0.03,ST.delayMs/1000);
  const dfb=ac.createGain(); dfb.gain.value=Math.min(0.85,ST.delayFB);
  const dlp=ac.createBiquadFilter(); dlp.type="lowpass"; dlp.frequency.value=3000;
  spaceSend.connect(dly); dly.connect(dlp); dlp.connect(dfb); dfb.connect(dly); dly.connect(out);
  // ---- master (dry lead + bone-dry mono low) ----
  leadBus.connect(out); lowBus.connect(out);
  // ---- low monitor for phase validation (UNTOUCHED — no crush/space here) ----
  const lowMon=ac.createBiquadFilter(); lowMon.type="lowpass"; lowMon.frequency.value=120; lowMon.Q.value=0.7;
  lowBus.connect(lowMon);
  const lowAna=ac.createAnalyser(); lowAna.fftSize=2048; lowMon.connect(lowAna);
  // ---- analysers for viz + spectrogram ----
  const ana=ac.createAnalyser(); ana.fftSize=1024; out.connect(ana);
  const spec=ac.createAnalyser(); spec.fftSize=4096; out.connect(spec);
  const oscs=[ns2,leadLow,sub];
  return {out, satIn:sat, sat, ott, fizzG, leadBus, leadLow, leadLowG, sub, subDelay, subG, lowBus, lowMon, lowAna, ana, spec,
    grainBus, crush, crushIn:leadBus, spaceSend, verb, dly, dfb, sf, oscs,
    start(time){oscs.forEach(o=>{try{o.start(time||0)}catch(e){}});},
    stop(time){oscs.forEach(o=>{try{o.stop(time)}catch(e){}});}
  };
}

/* ---- assembler: one root voice + optional detuned/transposed extra voices, summed into one master.
       At voices=1 (default / legacy single-arg call) the graph is byte-identical to the old
       monolithic buildGraph: same nodes, same params, same noise+IR RNG draw order. ---- */
function buildGraph(ac, dest, p, opts){
  opts=opts||{};
  const specs=(opts.voiceSpecs&&opts.voiceSpecs.length)?opts.voiceSpecs:[{semi:0,cents:0,pan:0}];
  const sampleBuf=opts.sampleBuf||null;
  // root voice FIRST — it draws the shared noise buffer, THEN master draws the IR (matches legacy order)
  const root=buildVoice(ac, p, specs[0], {sampleBuf});
  const master=buildMaster(ac, dest, p, {noiseBuf:root.nb});
  root.out.connect(master.satIn);                                   // root lead -> master sat (mono)
  const voices=[root];
  for(let vi=1; vi<specs.length; vi++){
    const V=buildVoice(ac, p, specs[vi], {sampleBuf});
    // extra voices: high-pass <120Hz (only the anchored ROOT feeds the low end -> the boom-null stays honest) + stereo spread
    const hp=ac.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=120; hp.Q.value=0.5;
    const pan=ac.createStereoPanner(); pan.pan.value=Math.max(-1,Math.min(1,V.spec.pan||0));
    V.out.connect(hp); hp.connect(pan); pan.connect(master.satIn);
    V.hp=hp; V.pan=pan; voices.push(V);
  }
  const allOscs=[]; voices.forEach(V=>{V.oscs.forEach(o=>allOscs.push(o));}); master.oscs.forEach(o=>allOscs.push(o));
  // legacy-compatible handle: promote root voice nodes to top level so all existing single-voice
  // code keeps working; G.voices is the full polyphonic list.
  const G0=Object.assign({}, master, {
    voices, voice:root.voice, carrier:root.carrier, mod:root.mod, modGain:root.modGain,
    formants:root.formants, lp:root.lp, lfo:root.lfo, lfoG:root.lfoG, nG:root.nG, oscs:allOscs,
    start(time){allOscs.forEach(o=>{try{o.start(time||0)}catch(e){}});},
    stop(time){allOscs.forEach(o=>{try{o.stop(time)}catch(e){}});}
  });
  return G0;
}
function makeIR(ac,dur,decay){ const len=Math.max(1,Math.floor(ac.sampleRate*dur)), b=ac.createBuffer(2,len,ac.sampleRate);
  for(let c=0;c<2;c++){ const d=b.getChannelData(c); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay); }
  return b; }
function setCrush(on){
  if(!G) return;
  try{ G.crushIn.disconnect(G.out); }catch(e){}
  try{ G.crushIn.disconnect(G.crush); }catch(e){}
  try{ G.crush.disconnect(); }catch(e){}
  if(on){ G.crushIn.connect(G.crush); G.crush.connect(G.out); }
  else  { G.crushIn.connect(G.out); }
}
function satCurve(amt){
  const k=amt*8+0.001, n=1024, c=new Float32Array(n);
  for(let i=0;i<n;i++){const x=i/(n-1)*2-1; c[i]=(1+k)*x/(1+k*Math.abs(x));}
  return c;
}

/* ============================== POLYPHONY (unison + chord) ============================== */
// Extra lead voices stack under a SINGLE, root-anchored sub + phase validator. voices=1 keeps the
// mono path byte-identical to the pre-refactor engine; only lead voices are detuned/transposed.
const CHORDS={off:[0],'5th':[0,7],minor:[0,3,7],major:[0,4,7]};
function voiceSpecs(){
  const chord=CHORDS[ST.chord]||[0];
  const uni=Math.max(1,Math.min(5,ST.voices|0));
  const specs=[];
  chord.forEach(semi=>{ for(let u=0;u<uni;u++){ const spread=uni>1?(u/(uni-1))*2-1:0;
    specs.push({semi, cents:spread*ST.detune, pan:spread*ST.spread}); } });
  if(specs.length) specs[0]={semi:0,cents:0,pan:0};   // voice 0 = clean anchor (root pitch, centred)
  return specs;
}
// smooth detune/spread when the voice COUNT is unchanged; rebuild when the count changes
function retuneVoices(){
  if(!G||!AC) return;
  const specs=voiceSpecs();
  if(specs.length!==G.voices.length){ if(ST.playing) startGraph(); return; }
  const t=AC.currentTime;
  G.voices.forEach((V,i)=>{ V.spec=specs[i]; if(V.pan) V.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,V.spec.pan||0)),t,0.05); });
  applyLive();
}

/* ============================== PLAY / STOP ============================== */
function startGraph(){
  if(!ensureAudio()) return;
  if(G){stopGraph();}
  const p=morphedPatch();
  G=buildGraph(AC, OUT, p, {voiceSpecs:voiceSpecs(), sampleBuf:(ST.sampleMode==='osc'?ST.sampleBuf:null)});
  G.start(AC.currentTime);
  // amp envelope up (ADSR onset) — every polyphonic voice, scaled for stack headroom
  const t=AC.currentTime, e=ST.env, vg=1/Math.sqrt(G.voices.length);
  G.voices.forEach(V=>{ const g=V.voice.gain; g.cancelScheduledValues(t); g.setValueAtTime(0,t);
    g.linearRampToValueAtTime(vg,t+e.a); g.linearRampToValueAtTime(0.9*e.s*vg,t+e.a+e.d); });
  G.out.gain.setValueAtTime(0,t); G.out.gain.linearRampToValueAtTime(0.5,t+Math.max(0.04,e.a));
  setCrush(ST.crushOn);                 // re-apply lead crusher routing on rebuild
  ST.playing=true;
  syncPlay();
}
function stopGraph(){
  if(!G) return;
  const t=AC.currentTime, rel=Math.max(0.05,ST.env.r);   // Release knob shapes the stop
  try{G.out.gain.cancelScheduledValues(t);G.out.gain.setValueAtTime(G.out.gain.value,t);G.out.gain.linearRampToValueAtTime(0,t+rel);}catch(e){}
  const g=G; setTimeout(()=>{try{g.stop(0)}catch(e){}},rel*1000+80); G=null;
  ST.playing=false;
  syncPlay();
}
function pluck(){
  if(!ST.playing){startGraph();return;}
  const t=AC.currentTime, e=ST.env, vg=1/Math.sqrt(G.voices.length);
  G.voices.forEach(V=>{ const g=V.voice.gain; g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.001,g.value),t);
    g.linearRampToValueAtTime(1.5*vg, t+Math.min(0.02,e.a));           // accent attack
    g.linearRampToValueAtTime(0.9*e.s*vg, t+Math.min(0.02,e.a)+e.d); });
}

/* live param updates (no rebuild) — incl. live formant displacement so the morph is audible */
function applyLive(){
  if(!G||!AC) return; const t=AC.currentTime, gl=ST.glide, p=morphedPatch();
  // ---- per-voice Brain (each detuned/transposed instance) ----
  G.voices.forEach(V=>{
    const mult=Math.pow(2,((V.spec.semi||0)+(V.spec.cents||0)/100)/12);
    if(V.sampleSrc){ V.sampleSrc.playbackRate.setTargetAtTime(Math.pow(2,((ST.oct+ST.noteSt+(V.spec.semi||0)+(V.spec.cents||0)/100))/12),t,gl); }
    else { V.carrier.type=p.wave; V.carrier.frequency.setTargetAtTime(p.f0*mult,t,gl);
      V.mod.frequency.setTargetAtTime(p.f0*mult*p.ratio,t,gl); V.modGain.gain.setTargetAtTime(p.f0*mult*p.fm*4,t,0.04); }
    V.lfo.frequency.setTargetAtTime(ST.wubRate,t,0.05);
    V.lfoG.gain.setTargetAtTime(1200*ST.wubDepth,t,0.05);
    V.nG.gain.setTargetAtTime(p.noise*0.25,t,0.05);
    // live formant displacement (the OT morph you can hear) — same targets for every voice
    for(let i=0;i<NF;i++){ const f=p.F[i], fm=V.formants[i];
      if(f){ fm.bp.frequency.setTargetAtTime(f[0],t,gl); fm.bp.Q.setTargetAtTime(f[1],t,0.05); fm.g.gain.setTargetAtTime(f[2]*0.9,t,0.05); }
      else fm.g.gain.setTargetAtTime(0,t,0.05); }
  });
  // ---- master power stack (single) ----
  G.sat.curve=satCurve(ST.drive);
  G.ott.threshold.setTargetAtTime(-30-ST.ott*15,t,0.05); G.ott.ratio.setTargetAtTime(2+ST.ott*8,t,0.05);
  G.fizzG.gain.setTargetAtTime(ST.fizz*0.08,t,0.05);
  // ---- Body sub follows the ROOT f0 (anchored) ----
  const sf=subFreq(p.f0);
  G.sub.frequency.setTargetAtTime(sf,t,gl); G.leadLow.frequency.setTargetAtTime(sf,t,gl);
  G.subDelay.delayTime.setTargetAtTime((ST.phase/360)/sf,t,0.02);
  G.subG.gain.setTargetAtTime(ST.subLvl*0.55,t,0.05);
  // ---- space (reverb/delay) live params ----
  G.spaceSend.gain.setTargetAtTime(ST.spaceWet,t,0.05);
  G.dly.delayTime.setTargetAtTime(Math.max(0.03,ST.delayMs/1000),t,0.05);
  G.dfb.gain.setTargetAtTime(Math.min(0.85,ST.delayFB),t,0.05);
}
/* ============================== UI: ANIMALS ============================== */
const animalsEl=document.getElementById('animals');
let TAP_SETS='A';
function renderAnimals(){
  animalsEl.innerHTML=ANIMALS.map((a,i)=>`<button class="anim${i===ST.A?' selA':''}${i===ST.B?' selB':''}" data-i="${i}" aria-pressed="${i===ST.A||i===ST.B}" aria-label="${chimeraHtml(a.nm)}${i===ST.A?', animal A':''}${i===ST.B?', animal B':''}"><span class="emoji" aria-hidden="true">${a.emoji}</span><canvas class="glyph" data-i="${i}" aria-hidden="true"></canvas><span class="nm">${chimeraHtml(a.nm)}</span>${a.sample?'<span class="tag">sample</span>':''}<span class="ab" aria-hidden="true">${i===ST.A?'A':''}${i===ST.B?'B':''}</span></button>`).join('');
  if(window.drawGlyphs) window.drawGlyphs();
}
animalsEl.addEventListener('click',e=>{ const b=e.target.closest('.anim'); if(!b) return; const i=+b.dataset.i;
  if(e.shiftKey||TAP_SETS==='B') ST.B=i; else ST.A=i;
  if(ST.genomeMode&&window.chimeraSetMode) chimeraSetMode('morph');
  setPadOff(); refreshMorphLabels(); renderAnimals(); if(ST.playing){startGraph();} glitchBurst(null,1);
  const nb=animalsEl.querySelector(`[data-i="${i}"]`); if(nb) nb.focus({preventScroll:true}); });
document.querySelectorAll('#abseg button').forEach(b=>b.onclick=()=>{ TAP_SETS=b.dataset.ab; document.querySelectorAll('#abseg button').forEach(x=>x.classList.toggle('on',x===b)); });
function refreshMorphLabels(){
  document.getElementById('endA').textContent=ANIMALS[ST.A].nm.split(' ')[0];
  document.getElementById('endB').textContent=ANIMALS[ST.B].nm.split(' ')[0];
  updateChips();
}
function setPadOff(){ if(!ST.pad)return; ST.pad=false; syncPadToggle(); }
function syncPadToggle(){ setSwitch('padtoggle',ST.pad); }
function updateChips(){
  const p=morphedPatch();
  document.getElementById('c-f0').textContent=Math.round(p.f0)+" Hz";
  document.getElementById('c-sub').textContent=Math.round(subFreq(p.f0))+" Hz";
  document.getElementById('c-wd').textContent=ST.wd.toFixed(2);
  document.getElementById('c-curv').textContent=curvWord(ST.wd);
}
function curvWord(wd){ return wd>2?"wide displacement":wd>1?"curving":wd>0.4?"gentle":"flat"; }
/* ============================== UI: SLIDERS ============================== */
function bind(id, fn){ const e=document.getElementById(id); e.addEventListener('input',()=>fn(+e.value, e)); }
bind('morph',v=>{if(ST.genomeMode&&window.chimeraSetMode) chimeraSetMode('morph'); setPadOff();ST.t=v/100;document.getElementById('v-morph').textContent=ST.t.toFixed(2);updateChips();applyLive();});
bind('k-wub',v=>{ST.wubRate=v/10;document.getElementById('v-wub').textContent=ST.wubRate.toFixed(1)+" Hz";applyLive();});
bind('k-wubd',v=>{ST.wubDepth=v/100;document.getElementById('v-wubd').textContent=v+" %";applyLive();});
bind('k-oct',v=>{ST.oct=v;document.getElementById('v-oct').textContent=(v>0?"+":"")+v+" st";updateChips();applyLive();});
bind('k-phase',v=>{ST.phase=v;document.getElementById('v-phase').textContent=v+"°";applyLive();});
bind('k-sublvl',v=>{ST.subLvl=v/100;document.getElementById('v-sub').textContent=(v===0?"–∞":((v-100)/3).toFixed(0))+" dB";applyLive();});
bind('k-drive',v=>{ST.drive=v/100;document.getElementById('v-drive').textContent=v+" %";applyLive();});
bind('k-ott',v=>{ST.ott=v/100;document.getElementById('v-ott').textContent=v+" %";applyLive();});
bind('k-fizz',v=>{ST.fizz=v/100;document.getElementById('v-fizz').textContent=v+" %";applyLive();});
bind('k-glide',v=>{ST.glide=Math.max(0.002,v/1000);document.getElementById('v-glide').textContent=v+" ms";applyLive();});
bind('k-ea',v=>{ST.env.a=v/1000;document.getElementById('v-ea').textContent=v+" ms";});
bind('k-ed',v=>{ST.env.d=v/1000;document.getElementById('v-ed').textContent=v+" ms";});
bind('k-es',v=>{ST.env.s=v/100;document.getElementById('v-es').textContent=v+" %";});
bind('k-er',v=>{ST.env.r=v/1000;document.getElementById('v-er').textContent=v+" ms";});

document.getElementById('play').onclick=()=>{ if(ST.playing)stopGraph(); else startGraph(); };
document.getElementById('pluck').onclick=pluck;
/* ============================== FOUR-CORNER PAD ============================== */
// In Morph mode the stage is the pad: each corner is an animal, and the puck blends all four on the log-frequency axis.
// A parametric manifold, not a learned latent space.
function padSet(u,v){
  ST.uv={u:Math.max(0,Math.min(1,u)), v:Math.max(0,Math.min(1,v))};
  if(!ST.pad){ ST.pad=true; syncPadToggle(); }
  updateChips(); applyLive();
}
document.getElementById('padtoggle').onclick=function(){ if(ST.genomeMode&&window.chimeraSetMode) chimeraSetMode('morph'); ST.pad=!ST.pad; syncPadToggle(); updateChips(); applyLive(); };
/* ============================== PHASE VALIDATOR ============================== */
function measureLowRMS(){
  if(!G||!G.lowAna) return 0;
  const a=G.lowAna, buf=new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
  let s=0; for(let i=0;i<buf.length;i++)s+=buf[i]*buf[i];
  return Math.sqrt(s/buf.length);
}
async function autoAlign(){
  if(!ST.playing||!G){ if(!ensureAudio()) return; startGraph(); await new Promise(r=>setTimeout(r,350)); if(!G) return; }
  ST.autoSweep=true;
  const btn=document.getElementById('autophase'); btn.textContent="Sweeping the phase…"; btn.disabled=true;
  const sweep=[]; const N=24;
  for(let i=0;i<N;i++){
    const ph=i*360/N; const sf=ST.subF;
    G.subDelay.delayTime.setValueAtTime((ph/360)/sf, AC.currentTime);
    await new Promise(r=>setTimeout(r,45));
    let m=0; for(let k=0;k<3;k++){m+=measureLowRMS();await new Promise(r=>setTimeout(r,8));}
    sweep.push({ph,rms:m/3});
  }
  let best=sweep[0]; sweep.forEach(s=>{if(s.rms>best.rms)best=s;});
  ST.phase=Math.round(best.ph); document.getElementById('k-phase').value=ST.phase;
  document.getElementById('v-phase').textContent=ST.phase+"°"; applyLive();
  ST.sweep=sweep; ST.autoSweep=false; btn.textContent="Auto-align the sub"; btn.disabled=false;
  glitchBurst(btn.closest('.card'),1.4);   // the satisfying snap when the boom locks
  const worst=sweep.reduce((a,b)=>a.rms<b.rms?a:b);
  const gain=20*Math.log10((best.rms+1e-9)/(worst.rms+1e-9));
  document.getElementById('lowmsg').innerHTML=`Locked at <b>${ST.phase}°</b>: <b>+${gain.toFixed(1)} dB</b> of low end against the worst angle, ${Math.round(worst.ph)}°, where it nearly cancels.`;
}
document.getElementById('autophase').onclick=autoAlign;
// size a canvas's backing store to its box and the screen's pixel ratio, and draw in CSS pixels
function fitCanvas(c){
  const dpr=Math.min(2,devicePixelRatio||1), w=Math.max(1,Math.round(c.clientWidth)), h=Math.max(1,Math.round(c.clientHeight));
  if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){ c.width=Math.round(w*dpr); c.height=Math.round(h*dpr); }
  const x=c.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0); return {x,w,h};
}
function drawWheel(){
  const c=document.getElementById('wheel'); if(!c||!c.clientWidth) return;
  const {x,w,h}=fitCanvas(c), cx=w/2, cy=h/2, R=Math.min(w,h)/2-18;
  x.clearRect(0,0,w,h);
  x.strokeStyle=themeColor('--line'); x.lineWidth=1; x.beginPath(); x.arc(cx,cy,R,0,7); x.stroke();
  if(ST.sweep){                         // the last sweep, as a polar plot of measured low-end level
    const mx=Math.max(...ST.sweep.map(s=>s.rms))||1e-9;
    x.beginPath();
    ST.sweep.forEach((s,i)=>{const ang=s.ph*Math.PI/180-Math.PI/2; const r=R*0.14+(s.rms/mx)*R*0.84;
      const px=cx+Math.cos(ang)*r, py=cy+Math.sin(ang)*r; i?x.lineTo(px,py):x.moveTo(px,py);});
    x.closePath(); x.fillStyle=themeColor('--cyan'); x.globalAlpha=.16; x.fill(); x.globalAlpha=1; x.strokeStyle=themeColor('--cyan'); x.stroke();
  }
  // the needle's color comes from the MEASURED reinforce or cancel value, never from the angle
  const ang=ST.phase*Math.PI/180-Math.PI/2;
  x.strokeStyle = !ST.monoValid ? themeColor('--dim') : (ST.mono>0.1?themeColor('--green'):(ST.mono<-0.1?themeColor('--red'):themeColor('--amber'))); x.lineWidth=3; x.lineCap='round';
  x.beginPath(); x.moveTo(cx,cy); x.lineTo(cx+Math.cos(ang)*R, cy+Math.sin(ang)*R); x.stroke();
  x.fillStyle=themeColor('--dim'); x.font="11px ui-sans-serif,-apple-system,sans-serif"; x.textAlign="center";
  x.fillText("0°",cx,cy-R-6); x.fillText("180°",cx,cy+R+14);
}

/* ============================== LOW-END MEASUREMENT ============================== */
// The low bus is leadLow + phase-delayed sub, both pure sines at sf. Their summed RMS is
// exactly sqrt((aL^2 + aS^2 + 2*aL*aS*cos phi)/2): max at phi=0, min at phi=180. We normalise
// the MEASURED <120Hz RMS against that analytic min/max -> a real reinforcing/cancelling value.
function monoFromRms(rms,aL,aS){
  const rmsMax=(aL+aS)/Math.SQRT2, rmsMin=Math.abs(aL-aS)/Math.SQRT2;
  if(!(aS>0.02 && (rmsMax-rmsMin)>1e-4)) return null;
  return Math.max(-1,Math.min(1, 2*(rms-rmsMin)/(rmsMax-rmsMin)-1));
}
function measureTick(){
  if(G&&ST.playing){
    const rms=measureLowRMS(); ST.lowRMS=rms;
    ST.lowDb=20*Math.log10(rms+1e-9);
    const monoM=monoFromRms(rms,G.leadLowG.gain.value,G.subG.gain.value);
    ST.mono = monoM==null?0:monoM; ST.monoValid = monoM!=null;
  }else{ ST.lowRMS=0; ST.lowDb=-120; ST.mono=0; ST.monoValid=false; }
}
function lowWord(){ return !ST.monoValid?(ST.playing?"raise the sub to test":"not measured"):(ST.mono>0.1?"reinforcing ✓":(ST.mono<-0.1?"cancelling ✕":"partial")); }
function renderLowEnd(){               // the Signal sheet's meter, while it is open
  const fill=document.getElementById('lowfill'), lowdb=document.getElementById('lowdb'), monoc=document.getElementById('monoc');
  const live=G&&ST.playing&&ST.lowDb>-59;
  fill.style.width=(live?Math.max(2,Math.min(100,(ST.lowDb+60)/60*100)):0)+"%";
  const col=!ST.monoValid?"var(--warn)":(ST.mono>0.1?"var(--good)":(ST.mono<-0.1?"var(--bad)":"var(--warn)"));
  fill.style.background=col;
  lowdb.textContent=live?ST.lowDb.toFixed(1)+" dB":"silent";
  monoc.textContent=lowWord();
}
/* ============================== GEMMA STAND-IN ============================== */
const VIBEMAP=[
  {kw:["swamp","wet","frog","slimy"], A:"frog", B:"whale", t:0.45, drive:45, fizz:15, sub:80},
  {kw:["metallic","glitch","high","screech","scream","bright"], A:"cicada", B:"hawk", t:0.55, drive:70, fizz:60, sub:50},
  {kw:["cinematic","deep","rumble","sub","whale","massive"], A:"whale", B:"ele", t:0.4, drive:25, fizz:8, sub:95},
  {kw:["predator","growl","aggressive","wolf","angry","beast"], A:"wolf", B:"hawk", t:0.5, drive:65, fizz:35, sub:70},
  {kw:["duck","quack","classic","yoi","nasal"], A:"duck", B:"wolf", t:0.5, drive:40, fizz:25, sub:70},
  {kw:["roar","lion","big cat","jungle","king"], A:"lion", B:"wolf", t:0.45, drive:55, fizz:20, sub:85},
  {kw:["buzz","insect","bee","swarm","hive"], A:"bee", B:"cicada", t:0.5, drive:50, fizz:30, sub:60},
  {kw:["hiss","rattle","snake","dry","sizzle"], A:"snake", B:"cicada", t:0.4, drive:60, fizz:55, sub:45},
  {kw:["hoot","owl","night","hollow","soft"], A:"owl", B:"whale", t:0.45, drive:15, fizz:5, sub:80},
  {kw:["ocean","dolphin","whistle","sonar","underwater"], A:"dolphin", B:"whale", t:0.5, drive:20, fizz:15, sub:85},
  {kw:["moo","cow","farm","lazy","barn"], A:"cow", B:"frog", t:0.45, drive:30, fizz:10, sub:75},
  {kw:["meow","cat","whine","purr","kitten"], A:"cat", B:"duck", t:0.5, drive:35, fizz:20, sub:60},
  {kw:["caw","crow","raven","croak","bird"], A:"crow", B:"hawk", t:0.5, drive:60, fizz:40, sub:55}
];
function curate(text){
  text=text.toLowerCase();
  let best=null, bestN=0;
  VIBEMAP.forEach(m=>{const n=m.kw.filter(k=>text.includes(k)).length; if(n>bestN){bestN=n;best=m;}});
  if(!best) best=VIBEMAP[0];
  setPadOff();
  ST.A=idx(best.A); ST.B=idx(best.B); ST.t=best.t;
  ST.drive=best.drive/100; ST.fizz=best.fizz/100; ST.subLvl=best.sub/100;
  // push to UI
  document.getElementById('morph').value=best.t*100; document.getElementById('v-morph').textContent=best.t.toFixed(2);
  document.getElementById('k-drive').value=best.drive; document.getElementById('v-drive').textContent=best.drive+" %";
  document.getElementById('k-fizz').value=best.fizz; document.getElementById('v-fizz').textContent=best.fizz+" %";
  document.getElementById('k-sublvl').value=best.sub; document.getElementById('v-sub').textContent=((best.sub-100)/3).toFixed(0)+" dB";
  refreshMorphLabels(); renderAnimals();
  if(ST.playing)startGraph(); else applyLive();
  document.getElementById('vibeout').innerHTML=(bestN?`Matched ${bestN} keyword${bestN===1?'':'s'}: <b>${chimeraHtml(ANIMALS[ST.A].nm)}</b> into <b>${chimeraHtml(ANIMALS[ST.B].nm)}</b> at t = ${best.t}, grit ${best.drive} %.`:`No keyword matched, so it chose the swamp preset: <b>${chimeraHtml(ANIMALS[ST.A].nm)}</b> into <b>${chimeraHtml(ANIMALS[ST.B].nm)}</b>.`)+` A keyword matcher, not a language model.`;
}
document.getElementById('vibe').addEventListener('keydown',e=>{if(e.key==='Enter')curate(e.target.value);});
document.querySelectorAll('.quickvibes button').forEach(b=>b.onclick=()=>{document.getElementById('vibe').value=b.dataset.v;curate(b.dataset.v);});
/* ============================== WAV EXPORT ============================== */
async function exportWav(){
  const btn=document.getElementById('export'), cap=btn.querySelector('.cap')||btn; cap.textContent="Rendering…"; btn.disabled=true;
  try{
  const dur=4, sr=44100;
  const oc=new OfflineAudioContext(2, sr*dur, sr);
  const p=morphedPatch();
  const g=buildGraph(oc, oc.destination, p, {voiceSpecs:voiceSpecs(), sampleBuf:(ST.sampleMode==='osc'?ST.sampleBuf:null)});
  const e=ST.env, vg=1/Math.sqrt(g.voices.length);
  // A/D/S shape each lead voice; the Release fades the MASTER so the sub releases too
  g.voices.forEach(V=>{ const gg=V.voice.gain; gg.setValueAtTime(0,0);
    gg.linearRampToValueAtTime(vg, e.a); gg.linearRampToValueAtTime(0.9*e.s*vg, e.a+e.d); });
  g.out.gain.setValueAtTime(0,0); g.out.gain.linearRampToValueAtTime(0.5,0.06);
  g.out.gain.setValueAtTime(0.5, Math.max(0.1, dur-e.r));
  g.out.gain.linearRampToValueAtTime(0.0, dur-0.005);
  g.start(0); g.stop(dur);
  const rendered=await oc.startRendering();
  const wav=encodeWav(rendered);
  dlBlob(new Blob([wav],{type:'audio/wav'}), ST.genomeMode?`chimera_garden-seed${LINEAGE.cur}.wav`:`chimera_${ANIMALS[ST.A].key}-x-${ANIMALS[ST.B].key}_t${Math.round(ST.t*100)}.wav`);
  toast('Rendered 4 seconds to a WAV file.');
  }catch(err){ toast('The render failed: '+err.message); }
  finally{ cap.textContent="Render 4 seconds"; btn.disabled=false; }
}
function encodeWav(buf){
  const nch=buf.numberOfChannels, len=buf.length, sr=buf.sampleRate;
  const ab=new ArrayBuffer(44+len*nch*2), dv=new DataView(ab);
  const wr=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
  wr(0,"RIFF"); dv.setUint32(4,36+len*nch*2,true); wr(8,"WAVE"); wr(12,"fmt ");
  dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,nch,true);
  dv.setUint32(24,sr,true); dv.setUint32(28,sr*nch*2,true); dv.setUint16(32,nch*2,true); dv.setUint16(34,16,true);
  wr(36,"data"); dv.setUint32(40,len*nch*2,true);
  let off=44;
  for(let i=0;i<len;i++) for(let c=0;c<nch;c++){
    let s=Math.max(-1,Math.min(1,buf.getChannelData(c)[i])); dv.setInt16(off,s*0x7fff,true); off+=2;
  }
  return ab;
}
document.getElementById('export').onclick=exportWav;
/* ============================== GRANULAR CLOUD ============================== */
async function bakeGrain(){
  if(!AC) return;
  const dur=2.5, sr=AC.sampleRate, oc=new OfflineAudioContext(1,Math.floor(sr*dur),sr);
  const p=morphedPatch(), g=buildGraph(oc,oc.destination,p,{voiceSpecs:voiceSpecs(), sampleBuf:(ST.sampleMode==='osc'?ST.sampleBuf:null)});
  const vg=1/Math.sqrt(g.voices.length); g.voices.forEach(V=>V.voice.gain.setValueAtTime(0.9*vg,0)); g.out.gain.setValueAtTime(0.5,0); g.start(0); g.stop(dur);
  const b=await oc.startRendering();
  ST.grainBuf=b; ST.grBufDur=b.duration;
  const rb=AC.createBuffer(1,b.length,sr), s=b.getChannelData(0), d=rb.getChannelData(0);
  for(let i=0;i<b.length;i++) d[i]=s[b.length-1-i];
  ST.grainBufRev=rb;
  const lbl=document.getElementById('gr-buf'); if(lbl) lbl.textContent='buffer · '+b.duration.toFixed(1)+' s of the current sound';
}
function spawnGrain(t){
  const fwd=ST.grainBuf; if(!fwd||!G) return;
  const useRev = ST.grainBufRev && Math.random()<ST.grRev;
  const buf = useRev?ST.grainBufRev:fwd;
  const src=AC.createBufferSource(); src.buffer=buf;
  const semis=ST.grPitch+(Math.random()*2-1)*ST.grPitchJit; src.playbackRate.value=Math.pow(2,semis/12);
  const dur=Math.max(0.005,ST.grSize/1000);
  let pos=ST.grPos+(Math.random()*2-1)*ST.grJit; pos=Math.max(0,Math.min(1,pos));
  const off=Math.max(0,Math.min(buf.duration-dur-0.001, pos*buf.duration));
  const g=AC.createGain(); g.gain.setValueAtTime(0,t);
  g.gain.linearRampToValueAtTime(0.5,t+dur*0.5); g.gain.linearRampToValueAtTime(0,t+dur); // triangular window
  const pan=AC.createStereoPanner(); pan.pan.value=(Math.random()*2-1)*ST.grPan;
  src.connect(g).connect(pan).connect(G.grainBus);
  try{ src.start(t,off,dur); }catch(e){}
}
let grainTimer=null, nextGrainT=0;
function grainTick(){
  if(!ST.grainOn||!G||!AC||!ST.grainBuf) return;
  const ahead=AC.currentTime+0.12;
  while(nextGrainT<ahead){ spawnGrain(Math.max(nextGrainT,AC.currentTime)); nextGrainT+=1/Math.max(1,ST.grDens); }
  if(!ST.grFreeze){ ST.grPos=(ST.grPos+0.0006*ST.grDens/24)%1; const s=document.getElementById('gr-pos'); if(s)s.value=ST.grPos*100; }
}
async function setGrain(on){
  ST.grainOn=on;
  if(on){ if(!ensureAudio()){ ST.grainOn=false; return; } if(!ST.playing) startGraph(); if(!ST.grainBuf) await bakeGrain(); nextGrainT=AC.currentTime+0.05; if(!grainTimer) grainTimer=setInterval(grainTick,25); }
  else { if(grainTimer){clearInterval(grainTimer);grainTimer=null;} }
  const b=document.getElementById('gr-on'); if(b) setSwitch('gr-on',on);
}

/* ============================== IDM SEQUENCER + EUCLIDEAN ============================== */
function euclid(k,n){ const r=[]; let bucket=0; k=Math.max(0,Math.min(n,k)); for(let i=0;i<n;i++){ bucket+=k; if(bucket>=n){bucket-=n; r.push(true);} else r.push(false);} return r; }
function rotate(arr,by){ const n=arr.length; by=((by%n)+n)%n; return arr.slice(n-by).concat(arr.slice(0,n-by)); }
let seqTimer=null, seqNextT=0, seqStep=0;
function triggerStep(t,semis,stepDur){
  const base=morphedPatch();
  const hjit = ST.humanize? (Math.random()*2-1)*0.4 : 0;
  const e=ST.env, vg=1/Math.sqrt(G.voices.length);
  G.voices.forEach(V=>{
    const semiTot=semis+hjit+(V.spec.semi||0)+(V.spec.cents||0)/100;
    if(V.sampleSrc) V.sampleSrc.playbackRate.setValueAtTime(Math.pow(2,((ST.oct+ST.noteSt+semiTot))/12),t);
    else { const f=base.f0*Math.pow(2,semiTot/12); V.carrier.frequency.setValueAtTime(f,t); V.mod.frequency.setValueAtTime(f*base.ratio,t); }
    const g=V.voice.gain, hold=t+stepDur*ST.seq.gateLen;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001,t);
    g.linearRampToValueAtTime(vg,t+Math.min(0.012,e.a));
    g.linearRampToValueAtTime(0.9*e.s*vg,t+Math.min(0.012,e.a)+e.d);
    g.setValueAtTime(0.9*e.s*vg,Math.max(hold,t+0.03));
    g.linearRampToValueAtTime(0.0001,Math.max(hold,t+0.03)+0.03);
  });
}
function glitchStep(t,stepDur){
  const sub=Math.min(0.06,stepDur/4), vg=1/Math.sqrt(G.voices.length);
  G.voices.forEach(V=>{ const g=V.voice.gain;
    for(let k=0;k<3;k++){ g.setValueAtTime(0.9*vg,t+k*sub); g.linearRampToValueAtTime(0.0001,t+k*sub+sub*0.8); } });
  if(ST.grainBuf) for(let k=0;k<4;k++) spawnGrain(t+k*0.018);
}
function seqTick(){
  if(!ST.seq.on||!G||!AC) return;
  const stepDur=(60/ST.seq.bpm)/4;
  while(seqNextT<AC.currentTime+0.12){
    const i=seqStep%ST.seq.steps;
    const swing=(i%2===1)?ST.seq.swing*stepDur*0.5:0;
    const ht = ST.humanize? (Math.random()*2-1)*0.004 : 0;
    const t=seqNextT+swing+ht;
    const cell=ST.seq.note[i];
    if(cell&&cell.gate) triggerStep(t,cell.pitch,stepDur);
    if(ST.seq.glitch[i]) glitchStep(t,stepDur);
    ST.seq.cur=i; seqStep++; seqNextT+=stepDur;
  }
}
function seqStart(){ if(!ensureAudio()) return; if(!ST.playing) startGraph(); ST.seq.on=true; seqNextT=AC.currentTime+0.06; seqStep=0; seqTimer=setInterval(seqTick,25);
  const b=document.getElementById('seq-on'); if(b){b.classList.add('on');b.setAttribute('aria-pressed','true');b.textContent='Stop riff';} }
function seqStop(){ ST.seq.on=false; if(seqTimer){clearInterval(seqTimer);seqTimer=null;} ST.seq.cur=-1;
  if(G&&AC){ const e=ST.env, vg=1/Math.sqrt(G.voices.length); G.voices.forEach(V=>{ V.voice.gain.cancelScheduledValues(AC.currentTime); V.voice.gain.setTargetAtTime(0.9*e.s*vg,AC.currentTime,0.05); }); }
  const b=document.getElementById('seq-on'); if(b){b.classList.remove('on');b.setAttribute('aria-pressed','false');b.textContent='Play riff';} }

/* ============================== CHAOS / HUMANIZE (seeded) ============================== */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let rng=mulberry32(ST.seed);
function reseed(s){ ST.seed=(s|0)||1; rng=mulberry32(ST.seed); const r=document.getElementById('seedval'); if(r)r.textContent=ST.seed; }
const reflect=x=> x<0?-x : x>1?2-x : x;
let du=0,dv=0;
function chaosTick(){
  if(ST.chaos<=0||!ST.playing) return;
  const rate=ST.chaos*0.05;
  if(ST.pad){ du=(du+(rng()-0.5)*rate)*0.85; dv=(dv+(rng()-0.5)*rate)*0.85; ST.uv.u=reflect(ST.uv.u+du); ST.uv.v=reflect(ST.uv.v+dv); }
  else { ST.t=reflect(ST.t+(rng()-0.5)*rate); const m=document.getElementById('morph'); if(m)m.value=ST.t*100; document.getElementById('v-morph').textContent=ST.t.toFixed(2); }
  updateChips(); applyLive();
  if(rng()<ST.chaos*0.025){ ST.B=Math.floor(rng()*ANIMALS.length); refreshMorphLabels(); renderAnimals(); if(ST.playing)startGraph(); }
}
/* ============================== SPECTROGRAM (the formant displacement, made visible) ============================== */
// Frequency runs up the y axis on a log scale, and the formant markers sit on that same axis, so a formant's line
// lies on its band in the picture. (The desktop page drew the markers across the x axis, which did not line up.)
const specOff=document.createElement('canvas'); specOff.width=360; specOff.height=180; const sox=specOff.getContext('2d');
let specData=null; const FMIN=40,FMAX=16000, LMIN=Math.log(FMIN),LMAX=Math.log(FMAX);
const yForF=(f,h)=>(1-(Math.log(Math.max(FMIN,Math.min(FMAX,f)))-LMIN)/(LMAX-LMIN))*h;
function specColor(v){ if(v<=0.02) return 'rgb(11,15,28)'; const hue=250-v*215; return `hsl(${hue},70%,${12+v*54}%)`; }
function drawSpec(){
  const cv=document.getElementById('spec'); if(!cv||!cv.clientWidth) return;
  const {x:scx,w:W,h:H}=fitCanvas(cv);
  if(!(G&&ST.playing)){ scx.fillStyle='#0b0f1c'; scx.fillRect(0,0,W,H);
    scx.fillStyle=themeColor('--dim'); scx.font='13px ui-sans-serif,-apple-system,sans-serif'; scx.textAlign='center'; scx.fillText('Play to watch the formants move',W/2,H/2); return; }
  if(!specData||specData.length!==G.spec.frequencyBinCount) specData=new Uint8Array(G.spec.frequencyBinCount);
  G.spec.getByteFrequencyData(specData);
  const w=specOff.width,h=specOff.height, nyq=AC.sampleRate/2;
  sox.globalCompositeOperation='copy'; sox.drawImage(specOff,-1,0); sox.globalCompositeOperation='source-over';
  for(let y=0;y<h;y++){ const f=Math.exp(LMIN+(1-y/h)*(LMAX-LMIN)); const bin=Math.round(f/nyq*specData.length); const v=(specData[bin]||0)/255; sox.fillStyle=specColor(v); sox.fillRect(w-1,y,1,1); }
  scx.imageSmoothingEnabled=true; scx.drawImage(specOff,0,0,W,H);
  const cur=morphedPatch(), x0=W-110;
  if(!ST.pad&&!ST.genomeMode){ const A=ANIMALS[ST.A],B=ANIMALS[ST.B], n=Math.min(A.F.length,B.F.length);
    scx.lineWidth=1.2; scx.setLineDash([4,4]);
    for(let i=0;i<n;i++){ scx.strokeStyle=`hsla(${A.hue},80%,66%,.75)`; hline(scx,yForF(A.F[i][0],H),x0,W); scx.strokeStyle=`hsla(${B.hue},80%,66%,.75)`; hline(scx,yForF(B.F[i][0],H),x0,W); }
    scx.setLineDash([]); }
  scx.lineWidth=2.4; scx.strokeStyle=themeColor('--ink');
  cur.F.forEach(f=>{ hline(scx,yForF(f[0],H),x0,W); });
  scx.fillStyle='rgba(238,237,251,.75)'; scx.font='11px ui-sans-serif,-apple-system,sans-serif'; scx.textAlign='left';
  [[100,'100 Hz'],[1000,'1 kHz'],[10000,'10 kHz']].forEach(([f,t])=>{ const y=yForF(f,H); scx.fillRect(0,y,10,1); scx.fillText(t,14,y+4); });
}
function hline(c,y,x0,x1){ c.beginPath(); c.moveTo(x0,y); c.lineTo(x1,y); c.stroke(); }
/* ============================== SAMPLE IMPORT (audio-file voice) ============================== */
// Fully offline (decodeAudioData). Two honest modes:
//  (a) raw-sample-as-oscillator -> loop the buffer as the FM-core replacement, still through the formant/wub/power stack
//  (b) formant-extract hybrid   -> estimate f0 + top-3 spectral peaks into an 8th ANIMALS entry (heuristic fit, NOT the sample)
function _fft(re,im){ const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j){ const tr=re[i];re[i]=re[j];re[j]=tr; const ti=im[i];im[i]=im[j];im[j]=ti; } }
  for(let len=2;len<=n;len<<=1){ const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0;
      for(let k=0;k<len/2;k++){ const ur=re[i+k],ui=im[i+k];
        const vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci, vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
        re[i+k]=ur+vr; im[i+k]=ui+vi; re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi;
        const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } } }
function _estF0(ch,sr){                                   // autocorrelation on the loudest window (50..1000 Hz)
  const W=Math.min(4096, 1<<Math.max(8,Math.floor(Math.log2(Math.max(256,ch.length)))));
  let bestOff=0,bestE=-1;
  for(let o=0;o+W<=ch.length;o+=W){ let e=0; for(let i=0;i<W;i++) e+=ch[o+i]*ch[o+i]; if(e>bestE){bestE=e;bestOff=o;} }
  const x=ch.subarray(bestOff,bestOff+Math.min(W,ch.length-bestOff));
  const minLag=Math.max(2,Math.floor(sr/1000)), maxLag=Math.min(x.length-1,Math.floor(sr/50));
  let best=-1,bestLag=0;
  for(let lag=minLag;lag<=maxLag;lag++){ let a=0; for(let i=0;i+lag<x.length;i++) a+=x[i]*x[i+lag]; if(a>best){best=a;bestLag=lag;} }
  return bestLag>0? sr/bestLag : 200;
}
function _estPeaks(ch,sr){                                // averaged Hann-windowed FFT magnitude -> top-3 peaks in 200..8000 Hz
  const N=4096, re=new Float64Array(N), im=new Float64Array(N), mag=new Float64Array(N/2);
  let frames=0;
  for(let o=0;o+N<=ch.length && frames<24;o+=Math.floor(N*0.75)){
    for(let i=0;i<N;i++){ const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=ch[o+i]*w; im[i]=0; }
    _fft(re,im); for(let i=0;i<N/2;i++) mag[i]+=Math.hypot(re[i],im[i]); frames++;
  }
  if(frames===0){ for(let i=0;i<N;i++){ const w=(i<ch.length)?(0.5-0.5*Math.cos(2*Math.PI*i/(N-1))):0; re[i]=(i<ch.length?ch[i]:0)*w; im[i]=0; }
    _fft(re,im); for(let i=0;i<N/2;i++) mag[i]=Math.hypot(re[i],im[i]); }
  const binHz=sr/N, lo=Math.max(1,Math.floor(200/binHz)), hi=Math.min(N/2-2,Math.floor(8000/binHz));
  const peaks=[];
  for(let i=lo+1;i<hi;i++){ if(mag[i]>mag[i-1]&&mag[i]>=mag[i+1]) peaks.push({f:i*binHz,m:mag[i]}); }
  peaks.sort((a,b)=>b.m-a.m);
  const top=peaks.slice(0,3); top.sort((a,b)=>a.f-b.f);
  const mx=Math.max(1e-9,...top.map(p=>p.m));
  return top.map((p,i)=>[Math.round(p.f), 6+i*2, +Math.max(0.25,p.m/mx).toFixed(2)]);
}
function makeSampleAnimal(buf){
  const ch=buf.getChannelData(0), sr=buf.sampleRate;
  const f0=Math.max(40,Math.min(800, Math.round(_estF0(ch,sr))));
  let F=_estPeaks(ch,sr);
  if(!F||!F.length) F=[[Math.round(Math.min(8000,f0*3)),7,1],[Math.round(Math.min(12000,f0*5)),8,.6],[Math.round(Math.min(15000,f0*7)),9,.3]];
  while(F.length<2) F.push([Math.min(15000,(F.length?F[F.length-1][0]*2:1000)),8,.4]);
  return {key:'sample', nm:'Your Sample', emoji:'🎤', f0, wave:'sawtooth', ratio:1.0, fm:0.4, noise:0.2, hue:280, F, sample:true};
}
function ensureSampleAnimal(entry){                        // keep exactly ONE 'sample' animal; extracted params only
  const ex=ANIMALS.findIndex(a=>a.key==='sample');
  if(ex>=0) ANIMALS[ex]=entry; else ANIMALS.push(entry);
  ST.sampleAnimal=entry; renderAnimals();
}
// Decode in the browser (the desktop app used macOS afconvert). Each failure says what to do next.
const DECODE_HINT={aif:'AIFF',aiff:'AIFF',aifc:'AIFF',caf:'CAF'};
async function decodeFile(f){
  if(!f) throw new Error('No file was chosen.');
  if(f.size>300*1048576) throw new Error(`“${f.name}” is ${Math.round(f.size/1048576)} MB, too large to decode in a browser tab. Trim it under 300 MB first.`);
  if(!ensureAudio()) throw new Error('This browser has no Web Audio, so it cannot decode audio.');
  const ab=await f.arrayBuffer();
  let buf;
  try{ buf=await new Promise((res,rej)=>{ const p=AC.decodeAudioData(ab.slice(0),res,rej); if(p&&p.then) p.then(res,rej); }); }
  catch(e){ const ext=(f.name.split('.').pop()||'').toLowerCase();
    throw new Error(DECODE_HINT[ext]?`This browser could not open “${f.name}”. ${DECODE_HINT[ext]} files often fail outside Safari. Convert it to WAV or MP3, then load it again.`:`This browser could not decode “${f.name}”. WAV, MP3, M4A, FLAC and Ogg usually work. The file may be damaged, or not audio.`); }
  if(buf.length<2048) throw new Error(`“${f.name}” is too short to analyze. Use at least a twentieth of a second of sound.`);
  return buf;
}
async function importSampleFile(f){
  const st=document.getElementById('samp-status');
  st.textContent='Decoding '+f.name+'…';
  let buf; try{ buf=await decodeFile(f); }catch(err){ st.textContent=err.message; toast(err.message); return false; }
  ST.sampleBuf=buf;
  if(ST.importMode==='osc'){
    ST.sampleMode='osc';
    st.textContent='Raw sample oscillator · '+buf.duration.toFixed(1)+' s';
    if(ST.playing) startGraph();
  } else {
    const entry=makeSampleAnimal(buf); ensureSampleAnimal(entry);
    ST.A=idx('sample'); setPadOff(); refreshMorphLabels(); renderAnimals();
    st.textContent='Measured voice · f₀ about '+entry.f0+' Hz';
    if(ST.playing) startGraph(); else updateChips();
  }
  return true;
}
/* ============================== MIDI / KEYBOARD ============================== */
const KEYMAP={'z':-12,'s':-11,'x':-10,'d':-9,'c':-8,'v':-6,'g':-5,'b':-4,'h':-3,'n':-2,'j':-1,'m':0,'q':0,'2':1,'w':2,'3':3,'e':4,'r':5,'5':6,'t':7,'6':8,'y':9,'7':10,'u':11,'i':12};
function setNote(semi,accent){
  ST.noteSt=semi; NOTE_EVT.semi=semi; NOTE_EVT.t=performance.now(); updateChips();
  if(ST.genomeMode&&GARDEN.perNote&&GARDEN.branches&&GARDEN.branches.length){
    const b=GARDEN.branches[((semi%12)+12)%12];
    const cur=new Float32Array(GN);
    for(let i=0;i<GN;i++) cur[i]=clamp01(GARDEN.seed[i]+(b.g[i]-GARDEN.seed[i])*GARDEN.amount*0.7);
    setGenome(cur,{glide:0.03});
  }
  if(ST.playing){ applyLive(); const t=AC.currentTime, e=ST.env, vg=1/Math.sqrt(G.voices.length);
    G.voices.forEach(V=>{ const g=V.voice.gain; g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.001,g.value),t);
      g.linearRampToValueAtTime((accent||1.0)*vg,t+Math.min(0.02,e.a)); g.linearRampToValueAtTime(0.9*e.s*vg,t+Math.min(0.02,e.a)+e.d); });
  } else startGraph();
  const kb=document.getElementById('kbnote'); if(kb){kb.textContent=(semi>0?'+':'')+semi+' st'; kb.style.color=`hsl(${((semi*30)%360+360)%360},90%,70%)`;}
}
window.addEventListener('keydown',e=>{
  if(typingInto(document.activeElement)) return;
  if(e.repeat||e.metaKey||e.ctrlKey||e.altKey) return; const k=e.key.toLowerCase();
  if(k in KEYMAP){ e.preventDefault(); NOTE_EVT.src='keys'; setNote(KEYMAP[k]); }
});
window.addEventListener('keyup',e=>{
  const k=e.key.toLowerCase();
  if(k in KEYMAP && ST.genomeMode && GARDEN.perNote){
    setGenome(GARDEN.seed,{glide:0.05});      // release: settle back to the seed
  }
});
/* MIDI notes play as keys, with middle C as the root, on every channel. */
window.__midiNote=function(note,vel){
  const v=Math.min(1,vel/127);
  NOTE_EVT.src='midi-keys';
  setNote(note-60,0.6+v*0.6);
};
// a key released on a MIDI keyboard settles the genome back to the seed, as letting go of a computer key does
window.__midiOff=function(note){
  if(ST.genomeMode&&GARDEN.perNote&&ST.noteSt===note-60) setGenome(GARDEN.seed,{glide:0.05});
};

/* ============================== LAB RACK BINDINGS ============================== */
const $=id=>document.getElementById(id);
// polyphony (unison + chord)
bind('k-voices',v=>{ST.voices=v|0;$('v-voices').textContent=v;if(ST.playing)startGraph();});
bind('k-detune',v=>{ST.detune=v;$('v-detune').textContent=v+' \u00A2';retuneVoices();});
bind('k-spread',v=>{ST.spread=v/100;$('v-spread').textContent=v+' %';retuneVoices();});
document.querySelectorAll('#chordseg button').forEach(b=>b.onclick=()=>{ ST.chord=b.dataset.chord; document.querySelectorAll('#chordseg button').forEach(x=>x.classList.toggle('on',x===b)); if(ST.playing)startGraph(); });
// sample import (audio-file voice)
$('samp-load').onclick=()=>$('samp-file').click();
$('samp-file').addEventListener('change',e=>{ const f=e.target.files[0]; if(f) importSampleFile(f); e.target.value=''; });
document.querySelectorAll('#sampseg button').forEach(b=>b.onclick=()=>{ ST.importMode=b.dataset.smode; document.querySelectorAll('#sampseg button').forEach(x=>x.classList.toggle('on',x===b)); if(b.dataset.smode==='formant'&&ST.sampleMode==='osc'){ST.sampleMode='off';if(ST.playing)startGraph();} });
// granular
$('gr-on').onclick=()=>setGrain(!ST.grainOn);
$('gr-freeze').onclick=function(){ST.grFreeze=!ST.grFreeze;setSwitch('gr-freeze',ST.grFreeze);};
$('gr-bake').onclick=()=>bakeGrain();
bind('gr-pos',v=>{ST.grPos=v/100;$('v-grpos').textContent=v+' %';});
bind('gr-jit',v=>{ST.grJit=v/100;$('v-grjit').textContent=v+' %';});
bind('gr-size',v=>{ST.grSize=v;$('v-grsize').textContent=v+' ms';});
bind('gr-dens',v=>{ST.grDens=v;$('v-grdens').textContent=v+' /s';});
bind('gr-pitch',v=>{ST.grPitch=v;$('v-grpitch').textContent=(v>0?'+':'')+v+' st';});
bind('gr-pjit',v=>{ST.grPitchJit=v;$('v-grpjit').textContent=v+' st';});
bind('gr-pan',v=>{ST.grPan=v/100;$('v-grpan').textContent=v+' %';});
bind('gr-rev',v=>{ST.grRev=v/100;$('v-grrev').textContent=v+' %';});
// sequencer
$('seq-on').onclick=()=> ST.seq.on?seqStop():seqStart();
bind('seq-bpm',v=>{ST.seq.bpm=v;$('v-bpm').textContent=v;});
bind('seq-swing',v=>{ST.seq.swing=v/100;$('v-swing').textContent=v+' %';});
bind('seq-gate',v=>{ST.seq.gateLen=v/100;$('v-gate').textContent=v+' %';});
$('eu-gen').onclick=()=>{ const pat=rotate(euclid(+$('eu-k').value,16),+$('eu-rot').value); ST.seq.note.forEach((c,i)=>c.gate=pat[i]); renderSeq(); };
$('eu-glitch').onclick=()=>{ const pat=rotate(euclid(+$('eu-k').value,16),+$('eu-rot').value); ST.seq.glitch=pat.slice(); renderSeq(); };
$('seq-clear').onclick=()=>{ ST.seq.note.forEach(c=>{c.gate=false;c.pitch=0;}); ST.seq.glitch=Array(16).fill(false); renderSeq(); };
function renderSeq(){
  const g=$('seqgrid'); if(!g)return;
  g.innerHTML=ST.seq.note.map((c,i)=>`<button class="step${c.gate?' on':''}${i===ST.seq.cur?' cur':''}" data-i="${i}" aria-pressed="${c.gate}" aria-label="Step ${i+1}${c.gate?`, ${c.pitch>0?'+':''}${c.pitch} semitones`:', off'}">${c.gate?(c.pitch>0?'+'+c.pitch:c.pitch):''}</button>`).join('');
  const gr=$('glitchrow'); if(!gr)return;
  gr.innerHTML=ST.seq.glitch.map((on,i)=>`<button class="step glitch${on?' on':''}${i===ST.seq.cur?' cur':''}" data-i="${i}" aria-pressed="${on}" aria-label="Glitch step ${i+1}"></button>`).join('');
  _hiStep=ST.seq.cur;
}
function focusStep(id,i){ const b=$(id).querySelector(`[data-i="${i}"]`); if(b) b.focus({preventScroll:true}); }
function nudgeStep(i,d){ const c=ST.seq.note[i]; c.pitch=Math.max(-24,Math.min(24,c.pitch+d)); c.gate=true; renderSeq(); focusStep('seqgrid',i); }
$('seqgrid').addEventListener('click',e=>{ const b=e.target.closest('.step'); if(!b) return; const c=ST.seq.note[+b.dataset.i]; c.gate=!c.gate; renderSeq(); focusStep('seqgrid',b.dataset.i); });
$('seqgrid').addEventListener('wheel',e=>{ const b=e.target.closest('.step'); if(!b) return; e.preventDefault(); nudgeStep(+b.dataset.i, e.deltaY<0?1:-1); },{passive:false});
$('seqgrid').addEventListener('keydown',e=>{ const b=e.target.closest('.step'); if(!b) return; if(e.key==='ArrowUp'||e.key==='ArrowDown'){ e.preventDefault(); nudgeStep(+b.dataset.i, e.key==='ArrowUp'?1:-1); } });
$('glitchrow').addEventListener('click',e=>{ const b=e.target.closest('.step'); if(!b) return; const i=+b.dataset.i; ST.seq.glitch[i]=!ST.seq.glitch[i]; renderSeq(); focusStep('glitchrow',i); });
let _hiStep=-2;
function highlightStep(){ if(ST.seq.cur===_hiStep) return; _hiStep=ST.seq.cur;
  ['seqgrid','glitchrow'].forEach(id=>{ const g=$(id); if(!g) return; [...g.children].forEach((d,i)=>d.classList.toggle('cur',i===ST.seq.cur)); }); }
// FX rack
$('crush-on').onclick=function(){ ST.crushOn=!ST.crushOn; setCrush(ST.crushOn); setSwitch('crush-on',ST.crushOn); };
bind('crush-bits',v=>{ST.crushBits=v;$('v-bits').textContent=v+' bit';});
bind('crush-down',v=>{ST.crushDown=v;$('v-down').textContent=v+'×';});
bind('space-wet',v=>{ST.spaceWet=v/100;$('v-wet').textContent=v+' %'; if(G&&AC)G.spaceSend.gain.setTargetAtTime(ST.spaceWet,AC.currentTime,0.05);});
bind('verb-decay',v=>{ST.verbDecay=v/10;$('v-decay').textContent=(v/10).toFixed(1); if(G&&AC)G.verb.buffer=makeIR(AC,2.0,ST.verbDecay);});
bind('delay-ms',v=>{ST.delayMs=v;$('v-dms').textContent=v+' ms'; if(G&&AC)G.dly.delayTime.setTargetAtTime(v/1000,AC.currentTime,0.05);});
bind('delay-fb',v=>{ST.delayFB=v/100;$('v-dfb').textContent=v+' %'; if(G&&AC)G.dfb.gain.setTargetAtTime(Math.min(0.85,ST.delayFB),AC.currentTime,0.05);});
// chaos
bind('ch-chaos',v=>{ST.chaos=v/100;$('v-chaos').textContent=v+' %';});
bind('ch-hum',v=>{ST.humanize=v/100;$('v-hum').textContent=v+' %';});
$('reseed').onclick=()=>{ reseed(Math.floor(Math.random()*99999)+1); glitchBurst($('reseed').closest('.card'),1); };
$('chaos-lock').onclick=function(){ ST.chaos=0; $('ch-chaos').value=0; $('v-chaos').textContent='0 %'; this.classList.add('on'); setTimeout(()=>this.classList.remove('on'),400); };
// keyboard strip: two octaves around the root, for a mouse or a finger
function renderKb(){ const s=$('kbstrip'); if(!s)return;
  s.innerHTML=Array.from({length:25},(_,k)=>{ const n=k-12, pc=((n%12)+12)%12, black=[1,3,6,8,10].includes(pc);
    return `<button class="key${black?' black':''}${n===0?' root':''}" data-n="${n}" tabindex="-1" aria-label="${n>0?'+':''}${n} semitones"></button>`; }).join(''); }
$('kbstrip').addEventListener('pointerdown',e=>{ const b=e.target.closest('.key'); if(!b) return; e.preventDefault(); NOTE_EVT.src='keys'; setNote(+b.dataset.n); });

/* ============================== DOWNLOADS ============================== */
let LAST_DOWNLOAD=null;
function dlBlob(blob,name){ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  LAST_DOWNLOAD={name,size:blob.size,type:blob.type,t:Date.now()}; setTimeout(()=>URL.revokeObjectURL(u),4000); }
function dl(name,text,type){ dlBlob(new Blob([text],{type:type||'application/octet-stream'}),name); }
/* ============================== PATCH SAVE / LOAD / SHARE ============================== */
const clampv=(v,a,b,d)=> (typeof v==='number'&&isFinite(v))?Math.max(a,Math.min(b,v)):d;
let PATCH_LOADED_MODE = null;
function serializePatch(){ const s=ST; return {v:3,app:'biobass',
  mode:s.genomeMode?'garden':'morph',
  garden:s.genomeMode?{genome:Array.from(GENOME||GARDEN.seed),amount:GARDEN.amount,temp:GARDEN.temp,perNote:!!GARDEN.perNote}:null,
  sampleRequired:s.sampleMode==='osc',
  A:s.A,B:s.B,Akey:ANIMALS[s.A].key,Bkey:ANIMALS[s.B].key,cornerKeys:s.corners.map(i=>ANIMALS[i].key),t:s.t,oct:s.oct,phase:s.phase,subLvl:s.subLvl,drive:s.drive,ott:s.ott,fizz:s.fizz,wubRate:s.wubRate,wubDepth:s.wubDepth,glide:s.glide,
  env:{a:s.env.a,d:s.env.d,s:s.env.s,r:s.env.r},corners:s.corners.slice(),uv:{u:s.uv.u,v:s.uv.v},pad:s.pad,
  crushOn:s.crushOn,crushBits:s.crushBits,crushDown:s.crushDown,spaceWet:s.spaceWet,verbDecay:s.verbDecay,delayMs:s.delayMs,delayFB:s.delayFB,
  grPos:s.grPos,grJit:s.grJit,grSize:s.grSize,grDens:s.grDens,grPitch:s.grPitch,grPitchJit:s.grPitchJit,grPan:s.grPan,grRev:s.grRev,
  seq:{bpm:s.seq.bpm,swing:s.seq.swing,gateLen:s.seq.gateLen,note:s.seq.note.map(c=>({gate:c.gate,pitch:c.pitch})),glitch:s.seq.glitch.slice()},
  voices:s.voices,detune:s.detune,spread:s.spread,chord:s.chord,
  sampleAnimal: s.sampleAnimal ? {nm:s.sampleAnimal.nm,f0:s.sampleAnimal.f0,wave:s.sampleAnimal.wave,ratio:s.sampleAnimal.ratio,fm:s.sampleAnimal.fm,noise:s.sampleAnimal.noise,hue:s.sampleAnimal.hue,F:s.sampleAnimal.F.map(x=>x.slice()),sample:true} : null,
  seed:s.seed,chaos:s.chaos,humanize:s.humanize}; }
function syncUI(){
  const padWas=ST.pad, uvWas={...ST.uv};
  const d=(id,v)=>{const e=$(id); if(e){e.value=v; e.dispatchEvent(new Event('input'));}};
  d('morph',ST.t*100); d('k-wub',ST.wubRate*10); d('k-wubd',ST.wubDepth*100); d('k-oct',ST.oct); d('k-glide',ST.glide*1000);
  d('k-phase',ST.phase); d('k-sublvl',ST.subLvl*100); d('k-drive',ST.drive*100); d('k-ott',ST.ott*100); d('k-fizz',ST.fizz*100);
  d('k-ea',ST.env.a*1000); d('k-ed',ST.env.d*1000); d('k-es',ST.env.s*100); d('k-er',ST.env.r*1000);
  d('crush-bits',ST.crushBits); d('crush-down',ST.crushDown); d('space-wet',ST.spaceWet*100); d('verb-decay',ST.verbDecay*10); d('delay-ms',ST.delayMs); d('delay-fb',ST.delayFB*100);
  d('gr-pos',ST.grPos*100); d('gr-jit',ST.grJit*100); d('gr-size',ST.grSize); d('gr-dens',ST.grDens); d('gr-pitch',ST.grPitch); d('gr-pjit',ST.grPitchJit); d('gr-pan',ST.grPan*100); d('gr-rev',ST.grRev*100);
  d('seq-bpm',ST.seq.bpm); d('seq-swing',ST.seq.swing*100); d('seq-gate',ST.seq.gateLen*100);
  d('ch-chaos',ST.chaos*100); d('ch-hum',ST.humanize*100);
  d('k-voices',ST.voices); d('k-detune',ST.detune); d('k-spread',ST.spread*100);
  document.querySelectorAll('#chordseg button').forEach(x=>x.classList.toggle('on',x.dataset.chord===ST.chord));
  ST.pad=padWas; ST.uv=uvWas;                              // morph dispatch calls setPadOff — restore
  syncPadToggle();
  setSwitch('crush-on',ST.crushOn);
  updateGenome();
}
function applyPatch(p){
  if(!p||p.app!=='biobass') return false;
  const garden=p.mode==='garden'?p.garden:null;
  if(p.mode==='garden'&&(!garden||!Array.isArray(garden.genome)||garden.genome.length!==GN||garden.genome.some(v=>typeof v!=='number'||!isFinite(v)||v<0||v>1))) return false;
  const s=ST;
  // A saved oscillator reference cannot silently reuse an unrelated sample already open in this tab.
  s.sampleMode='off'; s.sampleBuf=null; s.genomeMode=false;
  $('samp-status').textContent=p.sampleRequired?'This patch used a raw sample oscillator. Load its audio file again; patch files and links contain settings only.':'Patch uses synthesis. No raw sample oscillator is loaded.';
  // reconstruct an imported 'sample' animal from EXTRACTED params only (never audio) before clamping A/B
  if(p.sampleAnimal && Array.isArray(p.sampleAnimal.F)){ const sa=p.sampleAnimal;
    ensureSampleAnimal({key:'sample',nm:String(sa.nm||'Your Sample').slice(0,24),emoji:'🎤',
      f0:clampv(sa.f0,40,800,200), wave:(sa.wave==='sine'?'sine':'sawtooth'),
      ratio:clampv(sa.ratio,0.25,4,1), fm:clampv(sa.fm,0,1.5,0.4), noise:clampv(sa.noise,0,1,0.2), hue:clampv(sa.hue,0,360,280),
      F:sa.F.slice(0,NF).map(f=>[clampv(f&&f[0],40,16000,1000),clampv(f&&f[1],1,20,7),clampv(f&&f[2],0,1,0.5)]), sample:true}); }
  // by name when the patch has names; a desktop patch used index 7 for its sample voice
  const pick=(key,i,d)=>{ if(typeof key==='string'&&idx(key)>=0) return idx(key); if(i===7&&p.sampleAnimal&&!key) return idx('sample'); return clampv(i,0,ANIMALS.length-1,d)|0; };
  s.A=pick(p.Akey,p.A,0); s.B=pick(p.Bkey,p.B,1);
  s.t=clampv(p.t,0,1,0); s.oct=clampv(p.oct,-24,12,0)|0; s.phase=clampv(p.phase,0,360,0);
  s.subLvl=clampv(p.subLvl,0,1,0.7); s.drive=clampv(p.drive,0,1,0.35); s.ott=clampv(p.ott,0,1,0.4); s.fizz=clampv(p.fizz,0,1,0.2);
  s.wubRate=clampv(p.wubRate,0,12,3.2); s.wubDepth=clampv(p.wubDepth,0,1,0.55); s.glide=clampv(p.glide,0.002,0.3,0.04);
  if(p.env){s.env.a=clampv(p.env.a,0.002,0.8,0.04);s.env.d=clampv(p.env.d,0.005,1.2,0.12);s.env.s=clampv(p.env.s,0,1,0.85);s.env.r=clampv(p.env.r,0.01,2,0.18);}
  if(Array.isArray(p.corners)&&p.corners.length===4) s.corners=p.corners.map((i,k)=>pick(Array.isArray(p.cornerKeys)?p.cornerKeys[k]:null,i,0));
  if(p.uv){s.uv={u:clampv(p.uv.u,0,1,0.5),v:clampv(p.uv.v,0,1,0.5)};} s.pad=!!p.pad;
  s.crushOn=!!p.crushOn; s.crushBits=clampv(p.crushBits,1,16,12)|0; s.crushDown=clampv(p.crushDown,1,40,1)|0;
  s.spaceWet=clampv(p.spaceWet,0,1,0); s.verbDecay=clampv(p.verbDecay,1,7,3); s.delayMs=clampv(p.delayMs,40,700,280)|0; s.delayFB=clampv(p.delayFB,0,0.85,0.35);
  s.grPos=clampv(p.grPos,0,1,0.3); s.grJit=clampv(p.grJit,0,1,0.15); s.grSize=clampv(p.grSize,10,300,90)|0; s.grDens=clampv(p.grDens,1,60,24)|0;
  s.grPitch=clampv(p.grPitch,-24,24,0)|0; s.grPitchJit=clampv(p.grPitchJit,0,12,0)|0; s.grPan=clampv(p.grPan,0,1,0.6); s.grRev=clampv(p.grRev,0,1,0);
  if(p.seq){ s.seq.bpm=clampv(p.seq.bpm,60,200,140)|0; s.seq.swing=clampv(p.seq.swing,0,0.6,0); s.seq.gateLen=clampv(p.seq.gateLen,0.1,1,0.6);
    if(Array.isArray(p.seq.note)) s.seq.note=Array.from({length:16},(_,i)=>({gate:!!(p.seq.note[i]&&p.seq.note[i].gate),pitch:clampv(p.seq.note[i]&&p.seq.note[i].pitch,-24,24,0)|0}));
    if(Array.isArray(p.seq.glitch)) s.seq.glitch=Array.from({length:16},(_,i)=>!!p.seq.glitch[i]); }
  s.seed=clampv(p.seed,1,1e9,1337)|0; s.chaos=clampv(p.chaos,0,1,0); s.humanize=clampv(p.humanize,0,1,0);
  s.voices=clampv(p.voices,1,5,1)|0; s.detune=clampv(p.detune,0,50,0); s.spread=clampv(p.spread,0,1,0);
  s.chord=(['off','5th','minor','major'].indexOf(p.chord)>=0?p.chord:'off');
  syncUI(); reseed(s.seed); refreshMorphLabels(); renderAnimals(); renderSeq(); updateChips();
  PATCH_LOADED_MODE=garden?'garden':'morph';
  if(garden){
    GARDEN.grow=false; GARDEN.amount=clampv(garden.amount,0,1,.6); GARDEN.temp=clampv(garden.temp,0,1,.35); GARDEN.perNote=!!garden.perNote;
    plantSeed(garden.genome,true); syncGrow(); setSwitch('g-pernote',GARDEN.perNote);
    $('g-amount').value=Math.round(GARDEN.amount*100); $('g-amount-v').textContent=$('g-amount').value+'%';
    $('g-temp').value=Math.round(GARDEN.temp*100); $('g-temp-v').textContent=$('g-temp').value+'%';
  }
  if(window.chimeraSetMode) chimeraSetMode(PATCH_LOADED_MODE);
  enterGenomeMode(!!garden);
  if(ST.playing){ startGraph(); } else applyLive();   // startGraph re-applies crush + rebuilds with new patch
  s.monoValid=false;                                    // validator must re-measure, never trust a loaded value
  return true;
}
function updateGenome(){ const s=ST;
  const bytes=[s.A,s.B,Math.round(s.t*35),Math.round(s.drive*35),Math.round(s.ott*35),Math.round(s.fizz*35),Math.round(s.subLvl*35),Math.round(s.phase/10.3),s.crushBits,Math.round(s.spaceWet*35),Math.max(0,s.seq.bpm-60)>>2,Math.round(s.chaos*35)];
  const g=bytes.map(b=>Math.max(0,Math.min(35,b|0)).toString(36)).join('').toUpperCase();
  const e=$('genome'); if(e)e.textContent=g; }
function mutate(){ const j=(v,amt,a,b)=>Math.max(a,Math.min(b,v+(rng()*2-1)*amt));
  ST.drive=j(ST.drive,0.25,0,1); ST.fizz=j(ST.fizz,0.25,0,1); ST.ott=j(ST.ott,0.2,0,1); ST.subLvl=j(ST.subLvl,0.2,0,1);
  ST.wubRate=j(ST.wubRate,2.5,0,12); ST.wubDepth=j(ST.wubDepth,0.3,0,1); ST.phase=j(ST.phase,70,0,360); ST.glide=j(ST.glide,0.05,0.002,0.3);
  ST.spaceWet=j(ST.spaceWet,0.3,0,1); ST.t=j(ST.t,0.3,0,1);
  if(rng()<0.5){ ST.B=Math.floor(rng()*ANIMALS.length); }
  setPadOff(); syncUI(); refreshMorphLabels(); renderAnimals(); updateChips();
  if(ST.playing) startGraph(); else applyLive();
  glitchBurst($('genome').closest('.card'),1);
}
$('patch-save').onclick=()=>dl('chimera_'+ANIMALS[ST.A].key+'-x-'+ANIMALS[ST.B].key+'.patch.json', JSON.stringify(serializePatch(),null,2),'application/json');
$('patch-load').onclick=()=>$('patch-file').click();
$('patch-file').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{ try{ if(!applyPatch(JSON.parse(r.result))) toast('That file is not a Chimera patch.'); else toast(patchLoadMessage()); }catch(err){ toast('Could not read that patch: '+err.message); } }; r.readAsText(f); e.target.value=''; });
function patchLoadMessage(){ return ST.sampleMode==='off'&&$('samp-status').textContent.startsWith('This patch used')?'Patch settings loaded. Reload the raw sample audio to restore its oscillator.':'Patch loaded.'; }
function patchToBase64(p){ const bytes=new TextEncoder().encode(JSON.stringify(p)); let bin=''; for(const b of bytes)bin+=String.fromCharCode(b); return btoa(bin); }
function patchFromBase64(value){ const bin=atob(value), bytes=Uint8Array.from(bin,c=>c.charCodeAt(0)); let text; try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(e){text=bin;} return JSON.parse(text); }
$('patch-link').onclick=()=>{ try{ history.replaceState(null,'','#p='+encodeURIComponent(patchToBase64(serializePatch())));
  const ok=()=>toast('Share link copied. The seed and settings are in it; raw sample audio is not included. Nothing was uploaded.'), no=()=>toast('The share link is in the address bar now. Copy it from there.');
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(ok,no); else no(); }catch(e){ toast('Could not make a link: '+e.message); } };
$('patch-mut').onclick=mutate;
function loadFromHash(){ if(location.hash.startsWith('#p=')){ try{ const p=patchFromBase64(decodeURIComponent(location.hash.slice(3))); return applyPatch(p); }catch(e){} } }
/* ============================== BOOT ============================== */
// Browsers start audio only after a gesture, so the context is made on the first click that needs sound.
// OUT is the master volume, between every graph and the speakers, and the tap the recorder listens to.
let OUT=null, VOLUME=0.7;
function ensureAudio(){
  if(!AC){ const Ctor=window.AudioContext||window.webkitAudioContext; if(!Ctor) return false;
    AC=new Ctor({latencyHint:'interactive'});
    OUT=AC.createGain(); OUT.gain.value=VOLUME; OUT.connect(AC.destination); }
  if(AC.state==='suspended'||AC.state==='interrupted') AC.resume().catch(()=>{});
  return AC.state!=='closed';
}
function setVolume(v){ VOLUME=v; if(OUT&&AC) OUT.gain.setTargetAtTime(v,AC.currentTime,0.03); }
setInterval(chaosTick,100);
/* ==== genome module ==== */
/* ============================== GENOME / SEED GARDEN ==============================
   Synplant-style genetic layer, evolved in place on the BioBass engine. A genome is a
   ~20-gene vector in [0,1] that decodes to a synth patch + macro params driving the SAME
   buildVoice/buildMaster graph. You play by BREEDING: a central seed, radial mutations,
   drag to evolve toward one by ear. Genopatch grows a seed from a dropped sample by
   Differential Evolution against its spectrum — a transparent local analysis-by-synthesis
   APPROXIMATION of the sample's spectral character, seeded by DSP heuristics. No learned
   or neural model. The genome stores extracted params only, never audio.               */

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

// ~20 genes. Frequency/time genes are log-warped so a fixed nudge is perceptually even.
// Patch genes (pitch..noise) are explored by the garden; macro genes (wubRate..space)
// are also editable by the knob rack (which becomes this seed's DNA editor).
const GENES = [
  {name:'pitch',     min:40,    max:600,  warp:'log', group:'osc'},
  {name:'wave',      min:0,     max:1,    warp:'lin', group:'osc'},
  {name:'modRatio',  min:0.25,  max:4,    warp:'log', group:'fm'},
  {name:'fmDepth',   min:0,     max:1,    warp:'lin', group:'fm'},
  {name:'noise',     min:0,     max:0.8,  warp:'lin', group:'noise'},
  {name:'formShift', min:0.5,   max:2.0,  warp:'log', group:'formant'},
  {name:'formSpread',min:0.6,   max:1.6,  warp:'lin', group:'formant'},
  {name:'formTilt',  min:-1,    max:1,    warp:'lin', group:'formant'},
  {name:'formQ',     min:0.5,   max:2.0,  warp:'lin', group:'formant'},
  {name:'wubRate',   min:0.1,   max:12,   warp:'log', group:'move'},
  {name:'wubDepth',  min:0,     max:1,    warp:'lin', group:'move'},
  {name:'attack',    min:0.002, max:0.5,  warp:'log', group:'env'},
  {name:'decay',     min:0.02,  max:1.0,  warp:'log', group:'env'},
  {name:'sustain',   min:0,     max:1,    warp:'lin', group:'env'},
  {name:'release',   min:0.02,  max:1.5,  warp:'log', group:'env'},
  {name:'subLevel',  min:0,     max:1,    warp:'lin', group:'body'},
  {name:'drive',     min:0,     max:1,    warp:'lin', group:'fx'},
  {name:'ott',       min:0,     max:1,    warp:'lin', group:'fx'},
  {name:'fizz',      min:0,     max:0.5,  warp:'lin', group:'fx'},
  {name:'space',     min:0,     max:0.7,  warp:'lin', group:'fx'},
];
const GN = GENES.length;
const GIDX = Object.fromEntries(GENES.map((g,i)=>[g.name,i]));

// pure, round-trip-verified encode/decode (the linchpin — every operator acts on [0,1]^N)
function geneDecode(g){
  const p = {};
  for(let i=0;i<GN;i++){ const G=GENES[i], u=clamp01(g[i]);
    p[G.name] = G.warp==='log' ? G.min*Math.pow(G.max/G.min,u) : G.min+(G.max-G.min)*u; }
  return p;
}
function geneEncode(params){
  const g = new Float32Array(GN);
  for(let i=0;i<GN;i++){ const G=GENES[i], v=params[G.name];
    g[i] = clamp01(G.warp==='log' ? Math.log(v/G.min)/Math.log(G.max/G.min)
                                  : (v-G.min)/(G.max-G.min)); }
  return g;
}

const WAVES = ['sine','triangle','sawtooth','square'];
const FORMANT_BASE = [[600,7,1.0],[1400,8,0.6],[2600,9,0.3]];  // neutral vocal bank

// genome -> BioBass patch (same shape blendAnimals returns)
function genomeToPatch(g){
  const d = geneDecode(g);
  const wave = WAVES[Math.min(3, Math.floor(d.wave*3.999))];
  const F = FORMANT_BASE.map((f,i)=>{
    const freq = f[0]*d.formShift*Math.pow(d.formSpread, i);       // shift whole bank + widen spacing
    const q    = f[1]*d.formQ;
    const amp  = Math.max(0.04, Math.min(1.2, f[2]*Math.pow(10, d.formTilt*(i-1)*0.4))); // tilt across bank
    return [freq, q, amp];
  });
  const f0 = d.pitch*Math.pow(2, (ST.oct+ST.noteSt)/12);
  return { f0, wave, ratio:d.modRatio, fm:d.fmDepth, noise:d.noise, hue:200, F, wd:0, _d:d };
}

// push a genome's macro genes into ST so applyLive/buildMaster reflect them
function applyGenomeToST(g){
  const d = geneDecode(g);
  ST.wubRate = d.wubRate; ST.wubDepth = d.wubDepth;
  ST.env = {a:d.attack, d:d.decay, s:d.sustain, r:d.release};
  ST.subLvl = d.subLevel; ST.drive = d.drive; ST.ott = d.ott; ST.fizz = d.fizz;
  ST.spaceWet = d.space;
}

// the single live entry point: set the genome and hear it
let GENOME = null, SEED = null, _lastGlide = 0.05;
function setGenome(g, opts){
  opts = opts || {};
  GENOME = Float32Array.from(g, clamp01);
  if(ST.genomeMode){
    applyGenomeToST(GENOME);
    if(opts.glide!=null){ _lastGlide = ST.glide; ST.glide = opts.glide; }
    if(G && AC) applyLive();
    if(opts.glide!=null) ST.glide = _lastGlide;
    updateChips && updateChips();
    updateGenome && updateGenome();
  }
  drawGarden();
}

/* ---- the garden: a seed + 12 radial mutation branches you evolve toward by ear ---- */
const GARDEN = { seed:null, branches:[], amount:0.6, temp:0.35, drag:null,
                 grow:false, growPhase:0, hover:-1, undo:[] };
const NBRANCH = 12;

function mul32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

function regenBranches(){
  const r = mul32((ST.seed|0) ^ 0x9E37 ^ Math.floor(GARDEN.temp*1000));
  GARDEN.branches = [];
  for(let b=0;b<NBRANCH;b++){
    const mut = new Float32Array(GN);
    for(let i=0;i<GN;i++){
      // gaussian-ish nudge (sum of uniforms), scaled by temperature; per-branch stable
      const n = (r()+r()+r()-1.5)/1.5;
      mut[i] = clamp01(GARDEN.seed[i] + n*GARDEN.temp);
    }
    GARDEN.branches.push({g:mut, ang:(b/NBRANCH)*Math.PI*2 - Math.PI/2});
  }
}
const LINEAGE={nodes:[],cur:-1};
function lineageAdd(genome){
  const node={id:LINEAGE.nodes.length,g:Float32Array.from(genome),
              parent:LINEAGE.cur,depth:LINEAGE.cur<0?0:LINEAGE.nodes[LINEAGE.cur].depth+1,kids:0};
  if(LINEAGE.cur>=0)LINEAGE.nodes[LINEAGE.cur].kids++;
  LINEAGE.nodes.push(node); LINEAGE.cur=node.id;
  drawLineage();
}
function lineageJump(id){
  if(id<0||id>=LINEAGE.nodes.length)return;
  LINEAGE.cur=id;
  GARDEN.seed=Float32Array.from(LINEAGE.nodes[id].g); SEED=GARDEN.seed;
  regenBranches(); setGenome(GARDEN.seed,{glide:0.05}); drawLineage();
  toast('Back to seed '+id+'. New growth forks from here.');
}
function drawLineage(){
  const cv=document.getElementById('lineage'); if(!cv||!cv.clientWidth)return;
  const {x:c,w:W,h:H}=fitCanvas(cv);
  c.clearRect(0,0,W,H);
  const n=LINEAGE.nodes.length; if(!n)return;
  const maxD=Math.max(...LINEAGE.nodes.map(o=>o.depth));
  const lanes=[], count=[];              // per-depth slot counters; each generation's seeds sit centered in its column
  LINEAGE.nodes.forEach(o=>{ count[o.depth]=(count[o.depth]||0)+1; });
  LINEAGE._px=[];
  LINEAGE.nodes.forEach(o=>{
    lanes[o.depth]=(lanes[o.depth]||0);
    const x=maxD?22+o.depth/maxD*(W-44):W/2, n=Math.min(6,count[o.depth]), step=Math.min(22,(H-28)/Math.max(1,n-1));
    const y=H/2+((lanes[o.depth]%6)-(n-1)/2)*step;
    lanes[o.depth]++;
    o._x=x;o._y=y; LINEAGE._px.push({id:o.id,x,y});
  });
  c.strokeStyle='rgba(191,194,236,.32)'; c.lineWidth=1;
  LINEAGE.nodes.forEach(o=>{ if(o.parent>=0){ const p=LINEAGE.nodes[o.parent];
    c.beginPath(); c.moveTo(p._x,p._y); c.lineTo(o._x,o._y); c.stroke(); }});
  LINEAGE.nodes.forEach(o=>{
    const hue=genomeHue(o.g);
    c.beginPath(); c.arc(o._x,o._y,o.id===LINEAGE.cur?6:3.6,0,6.283);
    c.fillStyle=`hsl(${hue|0} 70% ${o.id===LINEAGE.cur?72:56}%)`; c.fill();
    if(o.id===LINEAGE.cur){ c.strokeStyle=themeColor('--ink'); c.lineWidth=1.6; c.stroke(); }
  });
}
// a genome's fingerprint hue, shared by the buds, the seed, the lineage and the stage
// a genome's fingerprint color, shared by the buds, the seed, the lineage and the stage. It reads the formant, pitch and FM
// genes and stays inside the suite's teal to rose range, so neighbors differ visibly. A label, not a measurement.
function genomeHue(g){ const u=(0.15+1.3*g[GIDX.formShift]+0.7*g[GIDX.pitch]+0.5*g[GIDX.fmDepth])%1; return 186+u*174; }
function plantSeed(g, pushUndo){
  if(pushUndo && GARDEN.seed) GARDEN.undo.push(Float32Array.from(GARDEN.seed));
  if(GARDEN.undo.length>40) GARDEN.undo.shift();
  GARDEN.seed = Float32Array.from(g, clamp01);
  SEED = GARDEN.seed;
  regenBranches();
  setGenome(GARDEN.seed, {glide:0.05});
  lineageAdd(GARDEN.seed);
}
function undoSeed(){
  if(!GARDEN.undo.length) { toast('Nothing to undo.'); return; }
  GARDEN.seed = GARDEN.undo.pop(); SEED = GARDEN.seed;
  regenBranches(); setGenome(GARDEN.seed, {glide:0.05});
  toast('Back to the previous seed.');
}

/* ---- the garden lives on the stage: chimera.js draws it and keeps this geometry, in CSS pixels ---- */
const GARDEN_GEOM={cx:0,cy:0,R:1};
function gardenGeom(){ return GARDEN_GEOM; }
function drawGarden(){ GARDEN.dirty=true; }      // the stage redraws every frame
function _branchAt(mx,my){
  const {cx,cy,R} = gardenGeom();
  const dx=mx-cx, dy=my-cy, dist=Math.hypot(dx,dy);
  if(dist < Math.max(14,R*0.1)) return {branch:-1, r:0};      // on the seed core
  const ang = Math.atan2(dy,dx);
  let best=0, bd=1e9;
  for(let b=0;b<GARDEN.branches.length;b++){
    let da = Math.abs(((GARDEN.branches[b].ang - ang + Math.PI*3)%(Math.PI*2)) - Math.PI);
    if(da<bd){bd=da; best=b;}
  }
  return {branch:best, r:Math.min(1.15, dist/R)};
}
function gardenPointer(mx,my,kind){
  if(!GARDEN.seed) return;
  const hit = _branchAt(mx,my);
  if(kind==='move' && !GARDEN.drag){ GARDEN.hover = hit.branch; return; }
  gardenApply(hit, kind);
}
// one step of breeding: lean from the seed toward a bud by reach, and on release grow a seed there
function gardenApply(hit, kind){
  if(hit.branch<0){                                  // released on the core: cancel back to the seed
    if(kind==='up' && GARDEN.drag){ GARDEN.drag=null; setGenome(GARDEN.seed,{glide:0.05}); }
    return; }
  const br = GARDEN.branches[hit.branch];
  const reach = Math.min(1, hit.r) * GARDEN.amount;
  const cur = new Float32Array(GN);
  for(let i=0;i<GN;i++) cur[i] = clamp01(GARDEN.seed[i] + (br.g[i]-GARDEN.seed[i])*reach);
  if(kind==='down'){ GARDEN.drag = {branch:hit.branch, r:hit.r}; ensureLiveGenome(); setGenome(cur,{glide:0.03}); }
  else if(kind==='move'){ GARDEN.drag = {branch:hit.branch, r:hit.r}; setGenome(cur,{glide:0.03}); }
  else if(kind==='up'){
    plantSeed(cur, true); GARDEN.drag=null; GARDEN.hover=-1;      // commit where you let go as the new seed
    toast('Grew a new seed here. Keep breeding, or press ⌘Z or Ctrl+Z to step back.');
  }
}
function growTick(){
  if(GARDEN.grow && GARDEN.seed && GARDEN.branches.length){
    GARDEN.growPhase += 0.008;
    const b = Math.floor(GARDEN.growPhase) % GARDEN.branches.length;
    const f = 0.5 - 0.5*Math.cos((GARDEN.growPhase%1)*Math.PI*2);
    const br = GARDEN.branches[b];
    const cur = new Float32Array(GN);
    for(let i=0;i<GN;i++) cur[i] = clamp01(GARDEN.seed[i] + (br.g[i]-GARDEN.seed[i])*f*GARDEN.amount);
    setGenome(cur,{glide:0.05});
  }
  requestAnimationFrame(growTick);
}

function ensureLiveGenome(){
  if(!ST.genomeMode) enterGenomeMode(true);
  if(!ST.playing) startGraph();
}

function enterGenomeMode(on){
  ST.genomeMode = !!on;
  const badge = document.getElementById('genome-badge');
  const tog = document.getElementById('genome-toggle');
  if(badge) badge.style.display = on ? '' : 'none';
  if(tog){ tog.classList.toggle('on', on); tog.textContent = on ? '🌱 genome mode: ON' : '🌱 genome mode: off'; }
  if(on){
    if(!GARDEN.seed) plantSeed(defaultSeedGenome(), false);
    else setGenome(GARDEN.seed, {glide:0.05});
  } else {
    if(G && AC) applyLive();   // revert to animal morph
  }
  updateChips && updateChips();
}

function defaultSeedGenome(){
  // a musical starting point: mid bass, saw-ish, gentle formants, slow wub
  return geneEncode({ pitch:110, wave:0.66, modRatio:1.0, fmDepth:0.35, noise:0.15,
    formShift:1.0, formSpread:1.0, formTilt:0.0, formQ:1.0, wubRate:3.2, wubDepth:0.5,
    attack:0.02, decay:0.2, sustain:0.8, release:0.25, subLevel:0.7, drive:0.35,
    ott:0.4, fizz:0.2, space:0.0 });
}

/* ---- GENOPATCH: grow a seed from a dropped sample via Differential Evolution ---- */
function _sampleSpectrum(ch, sr){
  // averaged log-magnitude over 200..8000 Hz, L2-normalized (the fitness target)
  const N=2048, re=new Float64Array(N), im=new Float64Array(N), mag=new Float64Array(N/2);
  let frames=0;
  for(let o=0;o+N<=ch.length && frames<20;o+=Math.floor(N*0.75)){
    for(let i=0;i<N;i++){ const wnd=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=ch[o+i]*wnd; im[i]=0; }
    _fft(re,im); for(let i=0;i<N/2;i++) mag[i]+=Math.hypot(re[i],im[i]); frames++;
  }
  const binHz=sr/N, lo=Math.max(1,Math.floor(200/binHz)), hi=Math.min(N/2-1,Math.floor(8000/binHz));
  const v=[]; for(let i=lo;i<hi;i++) v.push(Math.log(1+mag[i]));
  const norm=Math.hypot(...v)||1; return {v:v.map(x=>x/norm), lo, hi, binHz, N};
}
async function _renderGenomeSpectrum(g, ref){
  const sr = AC ? AC.sampleRate : 44100, dur=0.30;
  const oc = new OfflineAudioContext(1, Math.floor(sr*dur), sr);
  const p = genomeToPatch(g);
  const gr = buildGraph(oc, oc.destination, p, {voiceSpecs:[{semi:0,cents:0,pan:0}]});
  gr.voices.forEach(V=>V.voice.gain.setValueAtTime(0.9,0)); gr.out.gain.setValueAtTime(0.5,0);
  gr.start(0); gr.stop(dur);
  const b = await oc.startRendering();
  const ch = b.getChannelData(0);
  // sample the SAME 200..8000 band with a matched-size FFT
  const N=ref.N, re=new Float64Array(N), im=new Float64Array(N), mag=new Float64Array(N/2);
  let frames=0;
  for(let o=0;o+N<=ch.length && frames<8;o+=Math.floor(N*0.75)){
    for(let i=0;i<N;i++){ const wnd=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=ch[o+i]*wnd; im[i]=0; }
    _fft(re,im); for(let i=0;i<N/2;i++) mag[i]+=Math.hypot(re[i],im[i]); frames++;
  }
  const v=[]; for(let i=ref.lo;i<ref.hi;i++) v.push(Math.log(1+mag[i]));
  const norm=Math.hypot(...v)||1; return v.map(x=>x/norm);
}
function _specDist(a,b){ let s=0; const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++){ const d=a[i]-b[i]; s+=d*d; } return Math.sqrt(s); }

function analyzeSampleToGenome(buf){
  const ch=buf.getChannelData(0), sr=buf.sampleRate;
  const f0=Math.max(40,Math.min(600, _estF0(ch,sr)));
  const peaks=_estPeaks(ch,sr)||[];
  // formant shift = how the estimated 1st peak sits vs the base bank's first formant
  const shift = peaks.length ? Math.max(0.5,Math.min(2.0, peaks[0][0]/FORMANT_BASE[0][0])) : 1.0;
  // spectral flatness (tonal vs noisy) -> noise + fm depth
  const N=2048, re=new Float64Array(N), im=new Float64Array(N); let gm=0,am=0,cnt=0;
  for(let i=0;i<N && i<ch.length;i++){ const wnd=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=ch[i]*wnd; im[i]=0; }
  _fft(re,im);
  for(let i=2;i<N/2;i++){ const m=Math.hypot(re[i],im[i])+1e-9; gm+=Math.log(m); am+=m; cnt++; }
  const flat=Math.exp(gm/cnt)/(am/cnt+1e-9);           // 0 tonal .. 1 noisy
  // envelope: RMS onset (attack) + tail (decay)
  const win=Math.floor(sr*0.01); let peakRms=0, peakAt=0;
  const rms=[]; for(let o=0;o+win<=ch.length;o+=win){ let e=0; for(let i=0;i<win;i++)e+=ch[o+i]*ch[o+i]; e=Math.sqrt(e/win); rms.push(e); if(e>peakRms){peakRms=e;peakAt=rms.length-1;} }
  const attack=Math.max(0.002,Math.min(0.5, peakAt*0.01));
  let decIdx=rms.length-1; for(let i=peakAt;i<rms.length;i++){ if(rms[i]<peakRms*0.37){decIdx=i;break;} }
  const decay=Math.max(0.02,Math.min(1.0,(decIdx-peakAt)*0.01));
  return geneEncode({ pitch:f0, wave: flat>0.4?0.9:0.55, modRatio:1.0,
    fmDepth: Math.min(1, 0.3+flat), noise: Math.min(0.8, flat*0.9),
    formShift:shift, formSpread:1.0, formTilt:0.0, formQ:1.0,
    wubRate:2.5, wubDepth:0.35, attack, decay, sustain:0.7, release:Math.max(decay,0.2),
    subLevel:0.6, drive:0.35, ott:0.4, fizz:0.2, space:0.0 });
}

let _deRunning=false;
async function genopatchGrow(buf){
  if(_deRunning) return; _deRunning=true;
  const st=document.getElementById('gp-status'); const bar=document.getElementById('gp-bar');
  const setS=(m)=>{ if(st)st.textContent=m; }; if(bar) bar.style.width='0%';
  try{
    enterGenomeMode(true);
    setS('Analyzing the sample…');
    const ref=_sampleSpectrum(buf.getChannelData(0), buf.sampleRate);
    const seed=analyzeSampleToGenome(buf);
    // DE population seeded around the analyzed guess (so ~20-dim converges in feasible compute)
    const POP=24, GENS=10, F=0.6, CR=0.85;
    const r=mul32(0xC0FFEE ^ (ST.seed|0));
    const pop=[]; const fit=[];
    for(let k=0;k<POP;k++){ const c=new Float32Array(GN);
      for(let i=0;i<GN;i++) c[i]=clamp01(seed[i] + (k===0?0:(r()*2-1)*0.25));
      pop.push(c); }
    for(let k=0;k<POP;k++){ fit[k]=_specDist(await _renderGenomeSpectrum(pop[k],ref), ref.v);
      if(k%4===0){ setS(`Seeding the population, ${k+1} of ${POP}…`); await new Promise(z=>setTimeout(z,0)); } }
    let best=0; for(let k=1;k<POP;k++) if(fit[k]<fit[best]) best=k;
    for(let gen=0; gen<GENS; gen++){
      for(let k=0;k<POP;k++){
        let a,b,c; do{a=(r()*POP)|0;}while(a===k); do{b=(r()*POP)|0;}while(b===k||b===a); do{c=(r()*POP)|0;}while(c===k||c===a||c===b);
        const trial=new Float32Array(GN); const jr=(r()*GN)|0;
        for(let i=0;i<GN;i++){ trial[i] = (r()<CR||i===jr) ? clamp01(pop[a][i]+F*(pop[b][i]-pop[c][i])) : pop[k][i]; }
        const tf=_specDist(await _renderGenomeSpectrum(trial,ref), ref.v);
        if(tf<fit[k]){ pop[k]=trial; fit[k]=tf; if(tf<fit[best]) best=k; }
      }
      if(bar) bar.style.width = Math.round((gen+1)/GENS*100)+'%';
      setS(`Growing, generation ${gen+1} of ${GENS} · best fit ${fit[best].toFixed(3)}`);
      // audition the current best while it grows
      plantSeed(pop[best], false);
      await new Promise(z=>setTimeout(z,0));
    }
    plantSeed(pop[best], true);
    setS(`Grown: an approximation of the sample's spectral character, fit ${fit[best].toFixed(3)}, where lower is closer. Not the sample and not a clone.`);
    if(bar) bar.style.width='100%';
  }catch(err){ setS('Growing failed: '+err.message); }
  finally{ _deRunning=false; }
}

/* ---- self-test hook (headless): decode(encode(x)) round-trips ---- */
function _genomeSelfTest(){
  const r=mul32(123); let maxErr=0;
  for(let t=0;t<200;t++){ const g=new Float32Array(GN); for(let i=0;i<GN;i++)g[i]=r();
    const g2=geneEncode(geneDecode(g));
    for(let i=0;i<GN;i++) maxErr=Math.max(maxErr, Math.abs(g[i]-g2[i])); }
  return maxErr;
}
/* ---- wiring ---- */
function syncGrow(){ setSwitch('g-grow',!!GARDEN.grow); }
async function growFromFile(f){
  const st=$('gp-status'); st.textContent='Decoding '+f.name+'…';
  let buf; try{ buf=await decodeFile(f); }catch(err){ st.textContent=err.message; toast(err.message); return false; }
  enterGenomeMode(true); await genopatchGrow(buf); return true;
}
function initGarden(){
  GARDEN.seed = defaultSeedGenome(); SEED=GARDEN.seed; regenBranches();
  $('g-amount').oninput=e=>{ GARDEN.amount=+e.target.value/100; $('g-amount-v').textContent=e.target.value+'%'; };
  $('g-temp').oninput=e=>{ GARDEN.temp=+e.target.value/100; $('g-temp-v').textContent=e.target.value+'%'; regenBranches(); };
  $('g-grow').onclick=()=>{ GARDEN.grow=!GARDEN.grow; syncGrow(); if(GARDEN.grow) ensureLiveGenome(); };
  $('g-undo').onclick=undoSeed;
  const mk=$('g-mark'), br=$('g-breed');
  mk.onclick=()=>{ GARDEN.parentA=Float32Array.from(GARDEN.seed); mk.classList.add('on'); br.disabled=false;
    toast('Parent A marked. Evolve somewhere else, then breed.'); };
  br.onclick=()=>{ if(!GARDEN.parentA)return;
    const r=mul32((ST.seed|0)^0xBEEF^LINEAGE.nodes.length);
    const child=new Float32Array(GN);
    for(let i=0;i<GN;i++){ child[i]=clamp01((r()<0.5?GARDEN.seed[i]:GARDEN.parentA[i])+(r()*2-1)*0.05); }
    plantSeed(child,true); ensureLiveGenome();
    toast('Bred: a uniform crossover of A and this seed, with a light mutation.'); };
  const pn=$('g-pernote');
  pn.onclick=()=>{ GARDEN.perNote=!GARDEN.perNote;
    setSwitch('g-pernote',GARDEN.perNote);
    if(GARDEN.perNote) toast('Each note now leans the genome toward its own bud, and letting go returns to the seed.'); };
  const lc=$('lineage');
  lc.onclick=e=>{ const r=lc.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    let best=-1,bd=1e9;
    (LINEAGE._px||[]).forEach(p=>{ const d=(p.x-mx)**2+(p.y-my)**2; if(d<bd){bd=d;best=p.id;} });
    if(best>=0&&bd<400) lineageJump(best); };
  $('g-random').onclick=()=>{ const r=mul32((ST.seed|0)+Date.now()%99999); const c=new Float32Array(GN); for(let i=0;i<GN;i++)c[i]=r(); plantSeed(c,true); ensureLiveGenome(); };
  const gpf=$('gp-file'); $('gp-load').onclick=()=>gpf.click();
  gpf.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) growFromFile(f); };
  document.addEventListener('keydown', e=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&ST.genomeMode&&!typingInto(document.activeElement)){ e.preventDefault(); undoSeed(); } });
  lineageAdd(GARDEN.seed);
  requestAnimationFrame(growTick);
}

renderAnimals(); refreshMorphLabels(); updateChips(); reseed(ST.seed); renderSeq(); renderKb(); updateGenome(); initGarden(); loadFromHash();
