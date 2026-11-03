/* nebula.js: the last twelve seconds of playing, hanging in the air.
   Field mode winds recent sound outward from the core. Hits stir a small fluid field and push the particles.
   Form mode carries over the earlier instrument: a picture and a sound become clouds, matched by sliced
   optimal transport, and a slider moves the mass between them. Parametric synesthesia: stated mappings,
   not a learned embedding, and no model. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD, FS_VERT } = GLKit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const RM = matchMedia('(prefers-reduced-motion: reduce)');

  const S = {
    mode: 'field', shape: 0, shapeT: 0, formT: 0, morph: 0, perform: false, performT: 0,
    yaw: 0.5, pitch: 1.02, dist: 3.25, autoRot: true, reaction: 1, glow: 1, trails: 0.8,
    tier: 256, fps: 60,
  };

  /* ---- shaders ---- */
  const NOISE = `
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return textureLod(uN,(i+f+.5)/256.,0.).r;}`;

  const SIM_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oVel;
uniform sampler2D uPos,uVel,uSeed,uHist,uFluid,uN,uHomeA,uHomeB;
uniform float uDt,uT,uHistX,uRiver,uForm,uMorph,uLoud;
uniform float uKick,uSnare,uHat,uHatOpen,uTom,uTomPos,uCrash,uBlow;
const float TAU=6.2831853;
${NOISE}
vec2 curl(vec2 p){float e=.4;return vec2(vn(p+vec2(0.,e))-vn(p-vec2(0.,e)),-(vn(p+vec2(e,0.))-vn(p-vec2(e,0.))))/(2.*e);}
void main(){
  vec4 P=texture(uPos,vUv),V=texture(uVel,vUv),s=texture(uSeed,vUv);
  vec3 p=P.xyz,v=V.xyz;
  float a=s.x,b=s.y;
  bool ring=s.w>.988, dust=s.w>.84&&!ring;
  float amp=0.,k;
  vec3 home;
  if(ring){
    float th=s.z*TAU+uT*.02;
    home=vec3(cos(th)*1.5,(s.x-.5)*.03,sin(th)*1.5);
    home=mix(home,vec3(cos(th)*1.72,sin(th)*1.02,(s.x-.5)*.06),uRiver);
    k=7.;
  }else if(dust){
    float th=s.z*TAU*3.+a*5.;
    float r=.15+1.6*sqrt(a);
    vec3 g=vec3(cos(th)*r,(b-.5)*(.1+.46*a),sin(th)*r);
    vec3 riv=vec3((a-.5)*3.6,(b-.5)*1.9,(s.z-.5)*1.1);
    home=mix(g,riv,uRiver);
    k=.9;
  }else{
    // Older sound blurs as it winds outward, so bright bands dissolve instead of sweeping past at the hit rate.
    float w=.004+a*.05,tx=uHistX-a*.985;
    amp=(texture(uHist,vec2(tx,b)).r+texture(uHist,vec2(tx-w,b)).r+texture(uHist,vec2(tx+w,b)).r+texture(uHist,vec2(tx-w*2.,b)).r+texture(uHist,vec2(tx+w*2.,b)).r)*.2;
    // Galaxy: age winds outward along two arms. The inner side of an arm is low, the outer side is high.
    float th=a*2.3*TAU+(s.w<.42?0.:3.14159);
    float r=.07+1.28*pow(a,.74);
    float width=.045+.2*a;
    float off=(b-.5)*2.*width+(s.z-.5)*.05*(1.+a*3.);
    vec3 g=vec3(cos(th)*(r+off),(s.z-.5)*(.025+.12*a),sin(th)*(r+off));
    g.y+=amp*.3*(1.-a*.4)*(s.z>.5?1.:-1.);
    // River: newest on the right, low at the bottom, salience toward you.
    vec3 riv=vec3(mix(1.72,-1.72,a),(b-.5)*1.72,(s.z-.5)*(.05+.42*a)+amp*.42);
    home=mix(g,riv,uRiver);
    k=mix(11.,1.9,a);
  }
  if(uForm>.001){
    vec3 form=mix(texture(uHomeA,vUv).xyz,texture(uHomeB,vUv).xyz,uMorph);
    home=mix(home,form,uForm);
    k=mix(k,7.,uForm);
    amp=mix(amp,.42,uForm);
  }
  vec3 f=(home-p)*k;
  vec2 c=curl(p.xz*1.25+vec2(uT*.035,5.))*(.24+a*.85)*(dust?1.8:1.)*(1.-uForm*.6);
  f.xz+=c;
  f.y+=(vn(p.xz*1.6+uT*.06)-.5)*(.25+a*.45)*(1.-uForm*.6);
  vec2 fp=mix(p.xz,p.xy,uRiver);
  vec2 fv=texture(uFluid,fp*.25+.5).xy;
  if(uRiver>.5)f.xy+=fv*5.; else f.xz+=fv*5.;
  // Each drum pushes the field in its stated way.
  vec3 nrm=normalize(p+vec3(1e-4,2e-4,1e-4));
  f+=nrm*uKick*(1.-b)*(1.-b)*6.5*uBlow;
  f+=(vec3(s.w,s.z,fract(s.w*7.31))-.5)*uSnare*13.*smoothstep(.08,.5,b)*uBlow;
  f.y+=(s.z-.5)*uHat*(2.+uHatOpen*3.)*smoothstep(.58,.8,b)*uBlow;
  float tomB=exp(-pow((b-(.1+uTomPos*.42))*8.,2.));
  f.y+=tomB*uTom*5.*(s.z>.5?1.:-1.)*uBlow;
  f+=nrm*uCrash*1.5*uBlow;
  v=(v+f*uDt)*exp(-uDt*mix(3.3,1.9,a));
  p+=v*uDt;
  oPos=vec4(p,mix(P.w,amp,.3));
  oVel=vec4(v,V.w);
}`;

  const POINT_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPos,uSeed,uHist,uColA,uColB;
uniform mat4 uVP;
uniform int uSize;
uniform float uPxK,uI,uHistX,uForm,uMorph,uT,uLoud,uKick,uHat,uHatOpen,uRide,uCrash;
out vec3 vC;
vec3 hsl(float h,float s,float l){vec3 k=mod(vec3(0.,8.,4.)+h*12.,12.);float a=s*min(l,1.-l);return vec3(l)-a*max(vec3(-1.),min(min(k-3.,9.-k),vec3(1.)));}
void main(){
  ivec2 ij=ivec2(gl_VertexID%uSize,gl_VertexID/uSize);
  vec4 P=texelFetch(uPos,ij,0),s=texelFetch(uSeed,ij,0);
  float a=s.x,b=s.y,amp=P.w;
  bool ring=s.w>.988,dust=s.w>.84&&!ring;
  vec4 clip=uVP*vec4(P.xyz,1.);
  gl_Position=clip;
  float ton=texture(uHist,vec2(uHistX-a*.985,b)).g;
  // Law: hue follows log-frequency (low warm, high cool), saturation follows tonalness, value follows salience.
  float hue=.66*b;
  vec3 law=hsl(hue,.42+.5*ton,.42+.34*amp);
  float val=dust?(.085+uLoud*.12):(.06+pow(amp,1.45)*2.3);
  val*=1.-a*.42;
  if(ring){law=vec3(.82,.84,1.);val=.34+.5*uLoud;}
  if(dust)law=mix(vec3(.55,.5,.95),hsl(fract(hue+.62),.58,.6),.55);
  if(b>.62&&!dust)val*=1.+uHat*(.4+.4*uHatOpen)*(.3+.9*abs(sin(s.w*6283.+uT*34.)));
  val*=1.+.25*uRide*(.5+.5*sin(uT*16.+s.w*900.));
  val*=1.+.2*uKick*(1.-b);
  val*=1.+.1*uCrash;
  float sz=(.75+amp*1.7+(ring?.3:0.))*(.65+s.z*.55);
  if(uForm>.001){
    vec3 fc=mix(texelFetch(uColA,ij,0).rgb,texelFetch(uColB,ij,0).rgb,uMorph);
    law=mix(law,pow(fc,vec3(2.2))*1.9,uForm);
    val=mix(val,.85*(1.+.15*uKick+.08*uCrash),uForm);
    sz=mix(sz,1.05,uForm);
  }
  float fog=clamp(1.15-clip.w*.16,.2,1.);
  vC=law*val*fog*uI;
  gl_PointSize=clamp(uPxK*sz/clip.w,1.,70.);
}`;
  const POINT_FS = FS_HEAD.replace('in vec2 vUv;\n', '') + `
in vec3 vC;
void main(){vec2 q=gl_PointCoord-.5;float g=exp(-dot(q,q)*13.);o=vec4(vC*g,1.);}`;

  const TRAIL_FS = FS_HEAD + `
uniform sampler2D uPts,uPrev;uniform float uFade,uT;uniform vec2 uC;
void main(){
  vec2 c=vUv-uC;float a=.0018;float ca=cos(a),sa=sin(a);
  vec2 uv=uC+mat2(ca,-sa,sa,ca)*c*.9985;
  o=vec4(min(texture(uPrev,uv).rgb*uFade+texture(uPts,vUv).rgb,vec3(30.)),1.);
}`;

  // Painterly gas and far stars under the particles. Band energy feeds it; it is never empty, so the page breathes at rest.
  const GAS_FS = FS_HEAD + `
uniform sampler2D uN,uTrail;uniform vec2 uRes,uC;uniform float uRiverGas,uT,uTilt,uScale,uLow,uMid,uHigh,uLoud,uKick,uSnare,uHat,uHatOpen,uRide,uCrash,uForm,uYaw;
${NOISE}
const mat2 R=mat2(.8,.6,-.6,.8);
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p=R*p*2.03+1.7;a*=.5;}return s;}
float h13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
void main(){
  vec2 asp=vec2(uRes.x/uRes.y,1.);
  vec2 p=(vUv-uC)*asp/uScale;
  float cy=cos(uYaw*.25),sy=sin(uYaw*.25);
  vec2 d=mat2(cy,-sy,sy,cy)*vec2(p.x,p.y/max(.4,uTilt));
  float r=length(d);
  vec2 q=d*1.55;
  vec2 w=vec2(fbm(q+vec2(uT*.018,3.1)),fbm(q+vec2(7.3,-uT*.015)));
  float n1=fbm(q*1.05+w*2.2+vec2(0.,uT*.012));
  float n2=fbm(q*2.2-w*1.6+vec2(uT*.02,4.));
  float fall=exp(-r*r*1.3);
  float dens=smoothstep(.34,.84,n1)*fall*(1.-uRiverGas*.45);
  float dens2=smoothstep(.4,.9,n2)*fall;
  vec3 warm=vec3(.60,.18,.27),violet=vec3(.27,.20,.72),teal=vec3(.10,.46,.44);
  vec3 g=violet*dens*(.5+.85*uMid+.3*uLoud);
  g+=warm*dens2*(.26+1.05*uLow+.1*uKick);
  g+=teal*smoothstep(.42,.95,fbm(q*1.5+w*3.+9.))*fall*(.3+1.1*uHigh+.1*uHat);
  g*=(1.+uCrash*.25+uSnare*.05)*(1.-uForm*.93)*(1.-uRiverGas*.62);
  vec3 sky=vec3(.0065,.0085,.021)+vec3(.012,.012,.03)*exp(-r*r*.5);
  // far stars
  vec2 sp=vUv*asp*170.;vec2 id=floor(sp);vec2 f=fract(sp)-.5;
  float h=h13(vec3(id,1.));
  float st=0.;
  if(h>.982){float b=(h-.982)/.018;st=b*b*exp(-dot(f,f)*34.)*(.45+.35*sin(uT*(1.5+h*5.)+h*700.)+uRide*1.1*sin(uT*18.+h*333.)+uHat*(1.3+uHatOpen));}
  o=vec4(sky+g+vec3(.82,.86,1.)*max(st,0.)*.75+texture(uTrail,vUv).rgb,1.);
}`;

  /* small stable fluid. The velocity field lives on the plane of the disk. */
  const ADVECT_FS = FS_HEAD + `uniform sampler2D uV;uniform float uDt,uDiss;void main(){vec2 v=texture(uV,vUv).xy;o=vec4(texture(uV,vUv-v*uDt*.25).xy*uDiss,0.,1.);}`;
  const SPLAT_FS = FS_HEAD + `uniform sampler2D uV;uniform vec4 uA[8];uniform vec4 uB[8];uniform int uN;
void main(){vec2 v=texture(uV,vUv).xy;vec2 p=(vUv-.5)*4.;for(int i=0;i<uN;i++){vec2 d=p-uA[i].xy;float g=exp(-dot(d,d)/uA[i].w)*uA[i].z;vec2 dir=uB[i].z>.5?normalize(d+vec2(1e-3)):uB[i].xy;v+=dir*g;}o=vec4(v,0.,1.);}`;
  const DIV_FS = FS_HEAD + `uniform sampler2D uV;uniform vec2 uPx;void main(){float l=texture(uV,vUv-vec2(uPx.x,0.)).x,r=texture(uV,vUv+vec2(uPx.x,0.)).x,b=texture(uV,vUv-vec2(0.,uPx.y)).y,t=texture(uV,vUv+vec2(0.,uPx.y)).y;o=vec4(.5*(r-l+t-b),0.,0.,1.);}`;
  const JAC_FS = FS_HEAD + `uniform sampler2D uP,uD;uniform vec2 uPx;void main(){float l=texture(uP,vUv-vec2(uPx.x,0.)).x,r=texture(uP,vUv+vec2(uPx.x,0.)).x,b=texture(uP,vUv-vec2(0.,uPx.y)).x,t=texture(uP,vUv+vec2(0.,uPx.y)).x;o=vec4((l+r+b+t-texture(uD,vUv).x)*.25,0.,0.,1.);}`;
  const GRAD_FS = FS_HEAD + `uniform sampler2D uP,uV;uniform vec2 uPx;void main(){float l=texture(uP,vUv-vec2(uPx.x,0.)).x,r=texture(uP,vUv+vec2(uPx.x,0.)).x,b=texture(uP,vUv-vec2(0.,uPx.y)).x,t=texture(uP,vUv+vec2(0.,uPx.y)).x;o=vec4(texture(uV,vUv).xy-.5*vec2(r-l,t-b),0.,1.);}`;

  /* ---- sheet ---- */
  const hud = `
    <div class="gauge"><span class="k">Hits</span><span class="v" id="g-hits">0</span></div>
    <div class="gauge hero"><span class="k">Tempo</span><span class="v" id="g-hero">--</span></div>
    <div class="gauge"><span class="k">Level</span><span class="v" id="g-level">--</span></div>`;

  const spaceSheet = `
    <div id="field-opts">
      <div class="field"><span>Shape of time</span><div class="row-actions" id="shape-row">
        <button class="pill on" data-shape="0">Galaxy</button><button class="pill" data-shape="1">River</button></div></div>
      <p class="note">Galaxy: now is at the core and the last twelve seconds wind outward. River: now is on the right.</p>
    </div>
    <div id="form-opts" hidden>
      <div class="row-actions">
        <button class="pill" id="form-image">Choose a picture</button>
        <button class="pill" id="form-sound">Choose a sound</button>
        <button class="pill" id="form-capture">Use my last 12 seconds</button>
        <input type="file" id="form-image-file" accept="image/*" hidden>
        <input type="file" id="form-sound-file" accept="audio/*" hidden>
      </div>
      <p class="note" id="form-status" role="status">Picture: built in. Sound: built in.</p>
      <label class="field"><div class="row"><span>Picture to sound</span><b id="morph-v">0%</b></div><input type="range" id="morph" min="0" max="100" value="0"></label>
      <div class="row-actions">
        <button class="pill" id="form-perform">Slow sweep: off</button>
        <button class="pill" id="form-hear">Hear this cloud</button>
        <button class="pill" id="form-ply">Save cloud (.ply)</button>
      </div>
      <p class="note">The picture lifts by a stated rule: brightness sets depth. It is not a reconstructed scene. A controller's mod wheel (CC1) also moves the slider.</p>
    </div>
    <details open><summary>Look</summary><div class="controls-grid" style="padding:10px 0 0">
      <label class="field"><div class="row"><span>Reaction to hits</span><b id="react-v"></b></div><input type="range" id="react" min="0" max="200"></label>
      <label class="field"><div class="row"><span>Trails</span><b id="trail-v"></b></div><input type="range" id="trail" min="0" max="100"></label>
      <label class="field"><div class="row"><span>Glow</span><b id="glow-v"></b></div><input type="range" id="glow" min="0" max="200"></label>
      <label class="field">Particles<select id="tier"><option value="auto">Automatic</option><option value="128">16,384</option><option value="256">65,536</option><option value="512">262,144</option></select></label>
      <label class="check" style="margin:0"><input type="checkbox" id="auto-rot" checked> Turn slowly</label>
    </div></details>`;

  const about = `
    <p class="sheet-intro">Parametric synesthesia: every link below is a stated rule, not a learned embedding, and there is no model.</p>
    <table class="maptable"><tbody>
      <tr><th>Time</th><td>Now at the core, winding out over about twelve seconds. In River, now is on the right.</td></tr>
      <tr><th>Frequency</th><td>Hue: low is warm, high is cool. Low sits on the inner side of each arm, or at the bottom of the river.</td></tr>
      <tr><th>Loudness</th><td>Brightness, and lift out of the plane.</td></tr>
      <tr><th>Tonalness</th><td>Saturation. A pitched drum is more colored than a noisy one.</td></tr>
      <tr><th>Kick</th><td>A pulse outward from the core, strongest in the low part of the field.</td></tr>
      <tr><th>Snare</th><td>Scatters the mid and high particles and stirs the fluid.</td></tr>
      <tr><th>Hi-hat</th><td>Sparkle in the top third. Opening the pedal widens it.</td></tr>
      <tr><th>Toms</th><td>A swell at the height of that tom.</td></tr>
      <tr><th>Crash</th><td>Long trails and a brief bright wash. A choke cuts it short.</td></tr>
      <tr><th>Ride</th><td>A fine shimmer across the field.</td></tr>
      <tr><th>Outer ring</th><td>A fixed reference that marks the twelve-second edge.</td></tr>
    </tbody></table>
    <p class="note">Keys: <b>J K L</b> kick, snare, hat · <b>U I O</b> toms · <b>P</b> crash · <b>;</b> ride · <b>D</b> demo · <b>C</b> connect · <b>F</b> full screen · <b>H</b> hide controls. Drag to turn, scroll to zoom.</p>`;

  const kit = createKit();
  const brand = '<svg viewBox="0 0 24 28" aria-hidden="true"><circle cx="12" cy="14" r="2.2"/><path d="M12 14c5-1 7 2 6 5s-7 5-11 1-3-12 3-14 12 2 12 9"/></svg>';
  const shell = mountShell({
    id: 'nebula', name: 'Nebula', brand, kit,
    modes: [{ id: 'field', label: 'Field' }, { id: 'form', label: 'Form' }], mode: 'field', modeLabel: 'What the particles follow',
    onMode: (m) => setMode(m),
    intro: { eyebrow: 'Nebula · the last twelve seconds of your playing', title: 'Every hit stays a while.', subtitle: 'Plug in your kit, or run the demo. No helper app, no server.' },
    hud,
    truth: 'Parametric synesthesia: stated mappings, not a learned embedding, and no model. Audio and MIDI stay in this browser.',
    sheets: [{ id: 'space', label: 'Space', icon: 'sliders', title: 'Shape the space.', intro: 'These change how it looks. They never change what the page measures.', html: spaceSheet }],
    about, canvas: () => cv, snapshot: (done) => { wantSnap = done; }, quality: () => `${N.toLocaleString()} particles`,
  });

  const cv = $('stage');
  const G = createGL(cv);
  let gl, Post, pSim, pPoint, pTrail, pGas, pAdvect, pSplat, pDiv, pJac, pGrad;
  let tN, tHist, tSeed = null, tHomeA = null, tHomeB = null, tColA = null, tColB = null;
  let simA, simB, N = 0, size = 0;
  let points, trailA, trailB, scene, rw = 0, rh = 0, lastScale = 1;
  let vel, velB, pres, presB, div;
  let wantSnap = null;
  const FV = 160;
  const splats = [];

  /* ---- particles ---- */
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function buildParticles(sz) {
    const fmt = G.floatRT ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT } : { internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT };
    size = sz; N = sz * sz;
    const seed = new Float32Array(N * 4), pos = new Float32Array(N * 4), v0 = new Float32Array(N * 4), r = rng(97531);
    for (let i = 0; i < N; i++) {
      const a = Math.pow(r(), 0.72), b = r(), c = r(), d = r();
      seed.set([a, b, c, d], i * 4);
      const th = r() * 6.283, rad = 0.1 + 1.7 * r();
      pos.set([Math.cos(th) * rad, (r() - 0.5) * 0.5, Math.sin(th) * rad, 0], i * 4);
    }
    [simA, simB].forEach((x) => { if (x) { gl.deleteFramebuffer(x.fbo); gl.deleteTexture(x.pos); gl.deleteTexture(x.vel); } });
    if (tSeed) gl.deleteTexture(tSeed);
    tSeed = G.tex(sz, sz, fmt, { nearest: true, data: seed });
    const mk = () => {
      const p = G.tex(sz, sz, fmt, { nearest: true, data: pos }), v = G.tex(sz, sz, fmt, { nearest: true, data: v0 }), fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, v, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo, pos: p, vel: v, w: sz, h: sz };
    };
    simA = mk(); simB = mk();
    S.tier = sz;
    writeTargets();
    settle = true;
  }

  /* ---- render targets ---- */
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.max(320, Math.min(3840, Math.round(cv.clientWidth * dpr))), H = Math.max(240, Math.min(2160, Math.round(cv.clientHeight * dpr)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const budget = 2.0e6 * lastScale, asp = W / H;
    let h = Math.round(Math.sqrt(budget / asp)), w = Math.round(h * asp);
    if (w > W) { w = W; h = H; }
    if (w === rw && h === rh) return;
    rw = w; rh = h;
    [points, trailA, trailB, scene].forEach((T) => T && G.freeTarget(T));
    points = G.target(rw, rh); trailA = G.target(rw, rh); trailB = G.target(rw, rh); scene = G.target(rw, rh);
    Post.resize(rw, rh, 5);
  }

  /* ---- matrices ---- */
  function perspective(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
  function lookAt(e, c, u) {
    let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map((v) => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map((v) => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
  }
  function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }

  /* ---- hits become splats in the fluid ---- */
  function addSplat(x, y, fx, fy, strength, radius, radial) { splats.push({ x, y, fx, fy, strength, radius, radial: radial ? 1 : 0 }); if (splats.length > 8) splats.shift(); }
  kit.on('hit', (h) => {
    const v = h.vel * S.reaction * (RM.matches ? 0.35 : 1), th = Math.random() * 6.283;
    if (h.voice === 'kick') addSplat(0, 0, 0, 0, 1.9 * v, 0.34, true);
    else if (h.voice === 'snare') { const r = 0.4 + Math.random() * 0.5; addSplat(Math.cos(th) * r, Math.sin(th) * r, -Math.sin(th), Math.cos(th), 2.0 * v, 0.14); addSplat(-Math.cos(th) * r, -Math.sin(th) * r, Math.sin(th), -Math.cos(th), 1.4 * v, 0.1); }
    else if (h.voice === 'tom') { const r = 0.25 + kit.env.tomPos * 0.8; addSplat(Math.cos(th) * r, Math.sin(th) * r, 0, 0, 1.6 * v, 0.18, true); }
    else if (h.voice === 'crash') { for (let i = 0; i < 3; i++) { const t = th + i * 2.1; addSplat(Math.cos(t) * 0.8, Math.sin(t) * 0.8, -Math.sin(t), Math.cos(t), 1.9 * v, 0.3); } }
    else if (h.voice === 'hat') { const r = 1.1 + Math.random() * 0.5; addSplat(Math.cos(th) * r, Math.sin(th) * r, -Math.sin(th), Math.cos(th), 0.6 * v, 0.03); }
  });
  kit.on('cc', ({ cc, value }) => { if (cc === 1) { setMorph(value / 127); } });
  kit.on('column', (x) => {
    if (!G || !tHist) return;
    G.bindTex(0, tHist);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, 0, 1, kit.BANDS, gl.RG, gl.UNSIGNED_BYTE, kit.column);
  });

  /* ---- Form: clouds and transport, ported from the desktop instrument ---- */
  const CW = 0.0035;
  function hsl2rgb(h, s, l) { const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0) * 255, f(8) * 255, f(4) * 255]; }
  function atomColor(v, ton, amp) { return hsl2rgb(0.66 * ((v + 1) / 2), 0.25 + 0.75 * clamp(ton, 0, 1), 0.28 + 0.5 * amp); }
  function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function resampleCloud(pts, M) {
    if (!pts.length) return pts;
    const wgt = pts.map((q) => 0.05 + (q.p[2] + 0.5)); let tot = 0; for (const w of wgt) tot += w;
    const cum = new Float64Array(wgt.length); let c = 0; wgt.forEach((w, i) => { c += w; cum[i] = c; });
    const out = [], r = mulberry(97531);
    for (let m = 0; m < M; m++) {
      const x = r() * tot; let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
      const q = pts[lo], j = (r() - 0.5) * 0.012;
      out.push({ p: [q.p[0] + j, q.p[1] + j, q.p[2]], c: q.c.slice() });
    }
    return out;
  }
  function imageCloud(img, M) {
    const W = 512, H = Math.max(2, Math.round((W * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width)));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, step = Math.max(1, Math.round(Math.sqrt((W * H) / (M * 1.4)))), pts = [], ar = W / H;
    for (let y = step >> 1; y < H; y += step) {
      for (let x = step >> 1; x < W; x += step) {
        const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2], lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
        pts.push({ p: [((x / W) * 2 - 1) * Math.min(1, ar), ((1 - y / H) * 2 - 1) * Math.min(1, 1 / ar), lum - 0.5], c: [r, gg, b] });
      }
    }
    return resampleCloud(pts, M);
  }
  function builtInPicture() {
    const c = document.createElement('canvas'); c.width = 440; c.height = 300; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 300); bg.addColorStop(0, '#1b1440'); bg.addColorStop(0.55, '#a8456e'); bg.addColorStop(0.72, '#ffb066'); bg.addColorStop(0.73, '#2a1a2e'); bg.addColorStop(1, '#100b1c');
    g.fillStyle = bg; g.fillRect(0, 0, 440, 300);
    g.fillStyle = '#ffe0a6'; g.beginPath(); g.arc(220, 200, 42, 0, 7); g.fill();
    g.fillStyle = '#1a1226'; g.beginPath(); g.moveTo(0, 240); g.lineTo(90, 170); g.lineTo(170, 230); g.lineTo(290, 150); g.lineTo(440, 240); g.lineTo(440, 300); g.lineTo(0, 300); g.fill();
    return c;
  }
  function atomsToCloud(atoms, dur, rate, M) {
    const lf0 = Math.log(40), lf1 = Math.log(rate / 2);
    const pts = atoms.map((a) => { const v = ((Math.log(Math.max(40, a.f)) - lf0) / (lf1 - lf0)) * 2 - 1; return { p: [(a.time / dur) * 2 - 1, v, a.amp - 0.5], c: atomColor(v, a.ton == null ? 0.6 : a.ton, a.amp) }; });
    return resampleCloud(pts, M);
  }
  function historyAtoms() {
    const W = kit.HIST_W, B = kit.BANDS, atoms = [], x0 = kit.histX, dur = W / kit.HIST_RATE;
    for (let dx = 0; dx < W; dx += 2) {
      const col = (x0 + 1 + dx) % W;
      for (let b = 0; b < B; b++) { const o = (col + b * W) * 2, v = kit.hist[o] / 255; if (v > 0.16) atoms.push({ time: (dx / W) * dur, f: KitMath.bandFreq(b), amp: v, ton: kit.hist[o + 1] / 255 }); }
    }
    return { atoms, dur };
  }
  function builtInSound() {
    const r = mulberry(4242), atoms = [];
    for (let i = 0; i < 520; i++) { const t = r() * 6, h = 1 + Math.floor(r() * r() * 14); atoms.push({ time: t, f: 110 * h, amp: Math.max(0.1, 1 - h / 15) * (0.55 + 0.45 * r()), ton: 0.8 }); }
    return { atoms, dur: 6 };
  }

  // Sliced optimal transport off the main thread, so a match never stalls the visuals.
  const WORKER_SRC = `
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const u=i+j,v=i+j+len/2,tr=re[v]*cr-im[v]*ci,ti=re[v]*ci+im[v]*cr;re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const nc=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nc}}}}
function extractAtoms(data,rate,KA){const N=1024,K2=N/2,hop=256,win=new Float32Array(N);for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/N);
const frames=Math.max(1,Math.floor((data.length-N)/hop)),mag=new Float32Array(frames*K2),re=new Float32Array(N),im=new Float32Array(N),flat=new Float32Array(frames);
for(let fr=0;fr<frames;fr++){const st=fr*hop;for(let i=0;i<N;i++){re[i]=(data[st+i]||0)*win[i];im[i]=0}fft(re,im);let lsum=0,asum=0,cnt=0;for(let k=1;k<K2;k++){const m=Math.hypot(re[k],im[k]);mag[fr*K2+k]=m;if(m>1e-9){lsum+=Math.log(m);asum+=m;cnt++}}flat[fr]=cnt?Math.exp(lsum/cnt)/((asum/cnt)||1):1}
const atoms=[];for(let a=0;a<KA;a++){let bi=0,bv=0;for(let i=0;i<mag.length;i++)if(mag[i]>bv){bv=mag[i];bi=i}if(bv<=0)break;const fr=(bi/K2)|0,k=bi%K2;atoms.push({time:fr*hop/rate,f:k*rate/N,amp:bv,ton:1-Math.min(1,flat[fr])});
for(let df=-3;df<=3;df++)for(let dk=-5;dk<=5;dk++){const f2=fr+df,k2=k+dk;if(f2<0||k2<1||f2>=frames||k2>=K2)continue;mag[f2*K2+k2]*=1-Math.exp(-(df*df/4+dk*dk/8))}}
let mx=0;for(const at of atoms)mx=Math.max(mx,at.amp);for(const at of atoms)at.amp/=mx||1;return{atoms,dur:data.length/rate}}
function slicedOT(X,Y,n){const r=mulberry32(777),idxA=new Uint32Array(n),idxB=new Uint32Array(n),pa=new Float64Array(n),pb=new Float64Array(n),ITER=32;
for(let it=0;it<ITER;it++){const v=[0,0,0,0,0,0];let norm=0;for(let k=0;k<6;k++){v[k]=r()*2-1;norm+=v[k]*v[k]}norm=Math.sqrt(norm)||1;for(let k=0;k<6;k++)v[k]/=norm;
for(let i=0;i<n;i++){let a=0,b=0;for(let k=0;k<6;k++){a+=X[i*6+k]*v[k];b+=Y[i*6+k]*v[k]}pa[i]=a;pb[i]=b;idxA[i]=i;idxB[i]=i}
idxA.sort((i,j)=>pa[i]-pa[j]);idxB.sort((i,j)=>pb[i]-pb[j]);const s=.55*(1-it/ITER)+.12;for(let q=0;q<n;q++){const ia=idxA[q],ib=idxB[q],d=pb[ib]-pa[ia];for(let k=0;k<6;k++)X[ia*6+k]+=s*d*v[k]}}return X}
onmessage=(e)=>{const m=e.data;if(m.type==='atoms'){postMessage({id:m.id,result:extractAtoms(m.data,m.rate,m.k)})}
else{const t0=performance.now();const X=slicedOT(m.X,m.Y,m.n);postMessage({id:m.id,X,ms:performance.now()-t0},[X.buffer])}}`;
  let worker = null, workSeq = 0;
  const pending = {};
  function workerCall(msg, transfer) {
    if (!worker) { worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))); worker.onmessage = (e) => { const p = pending[e.data.id]; delete pending[e.data.id]; if (p) p(e.data); }; }
    const id = ++workSeq;
    return new Promise((res) => { pending[id] = res; worker.postMessage({ ...msg, id }, transfer || []); });
  }

  const F = { picture: null, pictureName: 'built in', sound: null, soundName: 'built in', A: null, X: null, n: 0, busy: false };
  const CLOUD_M = 32768;
  async function liftMatch() {
    if (F.busy) { F.again = true; return; }
    F.busy = true;
    $('form-status').textContent = 'Matching picture and sound.';
    const A = imageCloud(F.picture || builtInPicture(), CLOUD_M);
    const snd = F.sound || builtInSound();
    const B = atomsToCloud(snd.atoms, snd.dur, snd.rate || 44100, CLOUD_M);
    const n = Math.min(A.length, B.length);
    if (!n) { $('form-status').textContent = 'That sound was silent, so there is nothing to match.'; F.busy = false; return; }
    const X = new Float64Array(n * 6), Y = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) { X[i * 6 + k] = A[i].p[k]; Y[i * 6 + k] = B[i].p[k]; X[i * 6 + 3 + k] = A[i].c[k] * CW; Y[i * 6 + 3 + k] = B[i].c[k] * CW; } }
    const res = await workerCall({ type: 'ot', X, Y, n }, [Y.buffer]);
    F.A = A; F.X = res.X; F.n = n;
    F.busy = false;
    writeTargets();
    $('form-status').textContent = `Picture: ${F.pictureName}. Sound: ${F.soundName}. ${n.toLocaleString()} points matched in ${Math.round(res.ms)} ms.`;
    if (F.again) { F.again = false; liftMatch(); }
  }
  function writeTargets() {
    if (!G || !F.A || !size) return;
    const A = new Float32Array(N * 4), B = new Float32Array(N * 4), CA = new Uint8Array(N * 4), CB = new Uint8Array(N * 4), r = rng(1234), n = F.n, X = F.X;
    for (let i = 0; i < N; i++) {
      const j = i % n, a = F.A[j], jx = (r() - 0.5) * 0.016, jy = (r() - 0.5) * 0.016;
      A[i * 4] = a.p[0] * 1.55 + jx; A[i * 4 + 1] = a.p[1] * 1.55 + jy; A[i * 4 + 2] = a.p[2] * 0.5;
      B[i * 4] = X[j * 6] * 1.55 + jx; B[i * 4 + 1] = X[j * 6 + 1] * 1.55 + jy; B[i * 4 + 2] = X[j * 6 + 2] * 0.5;
      for (let k = 0; k < 3; k++) { CA[i * 4 + k] = a.c[k]; CB[i * 4 + k] = clamp(X[j * 6 + 3 + k] / CW, 0, 255); }
      CA[i * 4 + 3] = 255; CB[i * 4 + 3] = 255;
    }
    const fmt = G.floatRT ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT } : { internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT };
    const rgba8 = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    [tHomeA, tHomeB, tColA, tColB].forEach((t) => t && gl.deleteTexture(t));
    tHomeA = G.tex(size, size, fmt, { nearest: true, data: A }); tHomeB = G.tex(size, size, fmt, { nearest: true, data: B });
    tColA = G.tex(size, size, rgba8, { nearest: true, data: CA }); tColB = G.tex(size, size, rgba8, { nearest: true, data: CB });
  }
  function setMode(m) {
    S.mode = m;
    $('field-opts').hidden = m !== 'field'; $('form-opts').hidden = m !== 'form';
    if (m === 'form') {
      if (!F.A) liftMatch();
      shell.toast('Form: choose your own picture and sound under Space.');
    }
    kit.noteLane('mode', m);
  }
  function setMorph(t) { S.morph = clamp(t, 0, 1); const r = $('morph'); r.value = Math.round(S.morph * 100); shell.syncRange(r); $('morph-v').textContent = `${Math.round(S.morph * 100)}%`; }
  $('morph').addEventListener('input', (e) => { S.perform = false; syncPerform(); setMorph(+e.target.value / 100); });
  function syncPerform() { $('form-perform').textContent = `Slow sweep: ${S.perform ? 'on' : 'off'}`; $('form-perform').classList.toggle('on', S.perform); }
  $('form-perform').addEventListener('click', () => { S.perform = !S.perform; S.performT = 0; syncPerform(); });
  $('form-image').addEventListener('click', () => $('form-image-file').click());
  $('form-sound').addEventListener('click', () => $('form-sound-file').click());
  $('form-image-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const img = new Image();
    img.onload = () => { F.picture = img; F.pictureName = f.name; liftMatch(); URL.revokeObjectURL(img.src); };
    img.onerror = () => { $('form-status').textContent = 'That file could not be read as a picture.'; };
    img.src = URL.createObjectURL(f);
  });
  $('form-sound-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    $('form-status').textContent = `Reading ${f.name}.`;
    try {
      const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 44100);
      const buf = await ac.decodeAudioData(await f.arrayBuffer());
      const mono = new Float32Array(Math.min(buf.length, buf.sampleRate * 20));
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
      const r = await workerCall({ type: 'atoms', data: mono, rate: buf.sampleRate, k: 600 });
      F.sound = { atoms: r.result.atoms, dur: r.result.dur, rate: buf.sampleRate };
      F.soundName = f.name;
      liftMatch();
    } catch (err) { $('form-status').textContent = `That file could not be decoded: ${err.message}`; }
  });
  $('form-capture').addEventListener('click', () => {
    const h = historyAtoms();
    if (h.atoms.length < 24) { $('form-status').textContent = 'There is not enough recent sound yet. Play for a few seconds, or run the demo, and try again.'; return; }
    F.sound = { atoms: h.atoms, dur: h.dur, rate: 44100 };
    F.soundName = 'your last 12 seconds';
    liftMatch();
  });
  function synthAtoms(atoms, dur, rate, seed) {
    const L = Math.floor(dur * rate), out = new Float32Array(L), r = mulberry(seed || 4242);
    for (const a of atoms) {
      const sg = 0.02 * rate, GL = Math.floor(sg * 6), t0 = Math.floor(a.time * rate - GL / 2), w = (2 * Math.PI * a.f) / rate, ph = r() * 6.2832, tn = a.tone || 0;
      for (let j = 0; j < GL; j++) {
        const idx = t0 + j; if (idx < 0 || idx >= L) continue;
        const e = Math.exp(-0.5 * Math.pow((j - GL / 2) / sg, 2));
        let s = Math.sin(w * j + ph);
        if (tn > 0.02) s += tn * (0.45 * Math.sin(2 * w * j + ph) + 0.22 * Math.sin(3 * w * j + ph));
        out[idx] += a.amp * e * s * 0.28;
      }
    }
    return out;
  }
  let hearCtx = null, hearSrc = null;
  $('form-hear').addEventListener('click', () => {
    if (!F.A) return;
    if (hearSrc) { try { hearSrc.stop(); } catch (e) { /* ended */ } hearSrc = null; $('form-hear').textContent = 'Hear this cloud'; return; }
    hearCtx = hearCtx || new (window.AudioContext || window.webkitAudioContext)();
    hearCtx.resume();
    const rate = hearCtx.sampleRate, dur = 6, t = S.morph, lf0 = Math.log(40), lf1 = Math.log(rate / 2), atoms = [], stride = Math.max(1, Math.floor(F.n / 1800));
    for (let i = 0; i < F.n; i += stride) {
      const a = F.A[i], X = F.X, p = [0, 1, 2].map((k) => a.p[k] + t * (X[i * 6 + k] - a.p[k])), c = [0, 1, 2].map((k) => a.c[k] + t * (X[i * 6 + 3 + k] / CW - a.c[k]));
      const mx = Math.max(...c) / 255, mn = Math.min(...c) / 255;
      atoms.push({ time: clamp((p[0] + 1) / 2, 0, 1) * dur, f: Math.exp(lf0 + clamp((p[1] + 1) / 2, 0, 1) * (lf1 - lf0)), amp: clamp(p[2] + 0.5, 0, 1), tone: mx > 0 ? (mx - mn) / mx : 0 });
    }
    const wav = synthAtoms(atoms, dur, rate, 777);
    let pk = 0; for (let i = 0; i < wav.length; i++) pk = Math.max(pk, Math.abs(wav[i]));
    if (pk > 0) for (let i = 0; i < wav.length; i++) wav[i] *= 0.7 / pk;
    const buf = hearCtx.createBuffer(1, wav.length, rate); buf.getChannelData(0).set(wav);
    hearSrc = hearCtx.createBufferSource(); hearSrc.buffer = buf; hearSrc.loop = true; hearSrc.connect(hearCtx.destination); hearSrc.start();
    $('form-hear').textContent = 'Stop listening';
  });
  $('form-ply').addEventListener('click', () => {
    if (!F.A) return;
    const n = F.n, t = S.morph, header = `ply\nformat binary_little_endian 1.0\ncomment Nebula point cloud - parametric synesthesia, t=${t.toFixed(2)} - stated mappings, not a learned model\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const hb = new TextEncoder().encode(header), buf = new ArrayBuffer(hb.length + n * 15), dv = new DataView(buf);
    new Uint8Array(buf).set(hb);
    let o = hb.length;
    for (let i = 0; i < n; i++) {
      const a = F.A[i], X = F.X;
      for (let k = 0; k < 3; k++) { dv.setFloat32(o, a.p[k] + t * (X[i * 6 + k] - a.p[k]), true); o += 4; }
      for (let k = 0; k < 3; k++) dv.setUint8(o++, clamp(Math.round(a.c[k] + t * (X[i * 6 + 3 + k] / CW - a.c[k])), 0, 255));
    }
    const u = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })), l = document.createElement('a');
    l.href = u; l.download = `nebula-cloud-t${Math.round(t * 100)}.ply`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  });

  /* ---- sheet controls ---- */
  $('shape-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shape]'); if (!b) return;
    S.shape = +b.dataset.shape;
    document.querySelectorAll('#shape-row button').forEach((x) => x.classList.toggle('on', x === b));
    kit.noteLane('shape', S.shape);
  });
  kit.on('lane', (l) => { if (l.name === 'shape') S.shape = l.value; else if (l.name === 'mode') shell.setMode(l.value); });
  const bind = (id, get, set, fmt, lab) => { const r = $(id); r.value = get(); shell.syncRange(r); $(lab).textContent = fmt(+r.value); r.addEventListener('input', () => { shell.syncRange(r); set(+r.value); $(lab).textContent = fmt(+r.value); }); };
  bind('react', () => S.reaction * 100, (v) => { S.reaction = v / 100; }, (v) => `${Math.round(v)}%`, 'react-v');
  bind('trail', () => S.trails * 100, (v) => { S.trails = v / 100; }, (v) => `${Math.round(v)}%`, 'trail-v');
  bind('glow', () => S.glow * 100, (v) => { S.glow = v / 100; }, (v) => `${Math.round(v)}%`, 'glow-v');
  let tierAuto = true;
  $('tier').addEventListener('change', (e) => { tierAuto = e.target.value === 'auto'; if (!tierAuto) buildParticles(+e.target.value); });
  $('auto-rot').addEventListener('change', (e) => { S.autoRot = e.target.checked; });

  /* drag to turn, wheel to zoom */
  let dragging = null;
  cv.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!dragging) return; S.yaw += (e.clientX - dragging.x) * 0.005; S.pitchUser = clamp((S.pitchUser || 0) + (e.clientY - dragging.y) * 0.004, -0.7, 0.5); dragging = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', () => { dragging = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); S.dist = clamp(S.dist * Math.exp(e.deltaY * 0.0009), 1.8, 6); }, { passive: false });

  /* ---- frame ---- */
  let last = performance.now(), frameIdx = 0, slow = 0, fast = 0, fails = 0, tierLocked = false, strongGPU = false, settle = false;
  function render(now) {
    requestAnimationFrame(render);
    try {
      const dtMs = Math.min(100, now - last); last = now;
      kit.tick(now);
      shell.frame(now);
      if (!G || gl.isContextLost()) return;
      const dt = Math.min(1 / 30, dtMs / 1000), env = kit.env;
      S.shapeT += (S.shape - S.shapeT) * Math.min(1, dt / 0.9);
      S.formT += ((S.mode === 'form' && F.A ? 1 : 0) - S.formT) * Math.min(1, dt / 0.8);
      if (S.perform) { S.performT += dt; setMorph(0.5 - 0.5 * Math.cos((S.performT / 24) * Math.PI * 2)); }

      if (dtMs > 26) slow++; else if (dtMs < 11) fast++;
      if (++frameIdx % 120 === 0) {
        if (slow > 40) {
          tierLocked = true;
          if (tierAuto && S.tier > 128) buildParticles(S.tier >> 1);
          else if (lastScale > 0.4) { lastScale *= 0.75; resize(); }
        } else if (!tierLocked && tierAuto && S.tier < 512 && strongGPU && slow < 6 && frameIdx > 240) {
          buildParticles(S.tier << 1);
        } else if (fast > 100 && lastScale < 1.6) { lastScale *= 1.2; resize(); }
        slow = 0; fast = 0;
      }

      /* camera */
      if (S.autoRot && !dragging && !RM.matches) S.yaw += dt * 0.035;
      const base = 1.02 * (1 - S.shapeT) + 0.2 * S.shapeT, pitch = clamp(base * (1 - S.formT) + 0.12 * S.formT + (S.pitchUser || 0), 0.05, 1.45);
      const yaw = S.shapeT * 0 + S.yaw * (1 - Math.max(S.shapeT, S.formT)) + Math.sin(S.yaw * 0.7) * 0.12 * Math.max(S.shapeT, S.formT);
      const dist = S.dist * (1 - (RM.matches ? 0 : env.kick * 0.022));
      const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
      const asp = rw / rh;
      const fit = asp < 1 ? 1 / Math.pow(asp, 0.75) : 1;                 // keep the whole field in view on a phone
      const eyeF = eye.map((v) => v * fit);
      const VP = mul(perspective(0.9, asp, 0.05, 40), lookAt(eyeF, [0, 0, 0], [0, 1, 0]));

      /* fluid */
      gl.disable(gl.BLEND);
      G.into(velB); G.bindTex(0, vel.tex);
      G.use(pAdvect, { uV: 0, uDt: dt, uDiss: Math.exp(-dt / 0.8) }); G.draw();
      [vel, velB] = [velB, vel];
      if (splats.length) {
        const a = new Float32Array(32), b = new Float32Array(32);
        splats.forEach((s, i) => { a.set([s.x, s.y, s.strength, s.radius], i * 4); b.set([s.fx, s.fy, s.radial, 0], i * 4); });
        G.into(velB); G.bindTex(0, vel.tex);
        G.use(pSplat, { uV: 0, uA: a, uB: b, uN: splats.length }); G.draw();
        [vel, velB] = [velB, vel];
        splats.length = 0;
      }
      const px = [1 / FV, 1 / FV];
      G.into(div); G.bindTex(0, vel.tex); G.use(pDiv, { uV: 0, uPx: px }); G.draw();
      G.use(pJac, { uP: 0, uD: 1, uPx: px });
      G.bindTex(1, div.tex);
      for (let i = 0; i < 10; i++) { G.into(presB); G.bindTex(0, pres.tex); G.draw(); [pres, presB] = [presB, pres]; }
      G.into(velB); G.bindTex(0, pres.tex); G.bindTex(1, vel.tex); G.use(pGrad, { uP: 0, uV: 1, uPx: px }); G.draw();
      [vel, velB] = [velB, vel];

      /* simulate. New particles settle off-screen first, so changing the count never makes the field fly back into shape. */
      const histX = (kit.histX + 0.5) / kit.HIST_W, blow = S.reaction * (RM.matches ? 0.35 : 1);
      const substeps = settle ? 150 : 1;
      settle = false;
      for (let sub = 0; sub < substeps; sub++) {
        const quiet = substeps > 1;
        G.into(simB);
        G.bindTex(0, simA.pos); G.bindTex(1, simA.vel); G.bindTex(2, tSeed); G.bindTex(3, tHist); G.bindTex(4, vel.tex); G.bindTex(5, tN);
        G.bindTex(6, tHomeA || tSeed); G.bindTex(7, tHomeB || tSeed);
        G.use(pSim, {
          uPos: 0, uVel: 1, uSeed: 2, uHist: 3, uFluid: 4, uN: 5, uHomeA: 6, uHomeB: 7,
          uDt: quiet ? 1 / 30 : dt, uT: now / 1000, uHistX: histX, uRiver: S.shapeT, uForm: S.formT, uMorph: S.morph, uLoud: kit.loud,
          uKick: quiet ? 0 : env.kick, uSnare: quiet ? 0 : env.snare, uHat: quiet ? 0 : env.hat, uHatOpen: env.hatOpen, uTom: quiet ? 0 : env.tom, uTomPos: env.tomPos, uCrash: quiet ? 0 : env.crash, uBlow: blow,
        });
        G.draw();
        [simA, simB] = [simB, simA];
      }

      /* points */
      G.into(points); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      G.bindTex(0, simA.pos); G.bindTex(1, tSeed); G.bindTex(2, tHist); G.bindTex(3, tColA || tSeed); G.bindTex(4, tColB || tSeed);
      const dens = Math.sqrt(65536 / N);
      G.use(pPoint, {
        uPos: 0, uSeed: 1, uHist: 2, uColA: 3, uColB: 4, uVP: VP, uSize: size, uPxK: rh * 0.0058 * Math.pow(dens, 0.5), uI: (0.92 * dens * dens * 0.8 + 0.12) * (1 - 0.5 * S.shapeT * (1 - S.formT)), uHistX: histX,
        uForm: S.formT, uMorph: S.morph, uT: now / 1000, uLoud: kit.loud, uKick: env.kick, uHat: env.hat, uHatOpen: env.hatOpen, uRide: env.ride, uCrash: env.crash,
      });
      gl.drawArrays(gl.POINTS, 0, N);
      gl.disable(gl.BLEND);

      /* trails */
      const clip = [VP[12], VP[13], VP[15]];
      const c = [0.5 + (clip[0] / clip[2]) * 0.5, 0.5 + (clip[1] / clip[2]) * 0.5];
      G.into(trailB); G.bindTex(0, points.tex); G.bindTex(1, trailA.tex);
      const fade = Math.pow((0.3 + 0.62 * S.trails) * (1 - 0.5 * S.formT) + 0.08 * env.crash, dtMs / 16.67);
      G.use(pTrail, { uPts: 0, uPrev: 1, uFade: clamp(fade, 0, 0.985), uT: now / 1000, uC: c }); G.draw();
      [trailA, trailB] = [trailB, trailA];

      /* gas and composite: the gas follows slow averages of the bands, so it breathes instead of pulsing */
      const follow = (a, b) => a + (b - a) * (1 - Math.exp(-dt / (b > a ? 0.5 : 1.5)));
      S.gasL = follow(S.gasL || 0, kit.low); S.gasM = follow(S.gasM || 0, kit.mid); S.gasH = follow(S.gasH || 0, kit.high); S.gasV = follow(S.gasV || 0, kit.loud);
      G.into(scene); G.bindTex(0, tN); G.bindTex(1, trailA.tex);
      const scale = (3.25 / (dist * fit)) * (1 / 1.25);
      G.use(pGas, {
        uN: 0, uTrail: 1, uRiverGas: S.shapeT, uRes: [rw, rh], uC: c, uT: now / 1000, uTilt: Math.sin(pitch) * (1 - S.shapeT) + S.shapeT, uScale: scale, uYaw: yaw,
        uLow: S.gasL, uMid: S.gasM, uHigh: S.gasH, uLoud: S.gasV, uKick: env.kick, uSnare: env.snare, uHat: env.hat, uHatOpen: env.hatOpen, uRide: env.ride, uCrash: env.crash, uForm: S.formT,
      });
      G.draw();

      const bloom = Post.bloom(scene.tex, 0.7);
      Post.finish(scene.tex, bloom, {
        uBloomK: (0.6 + env.kick * 0.06 + env.crash * 0.12) * S.glow, uExposure: 1.02,
        uFlash: RM.matches ? 0 : Math.min(0.1, env.flash * 0.1), uFlashC: [1, 0.94, 0.86], uGrain: 0.016, uT: now / 1000, uVig: 0.42, uSat: 1.08, rate: RM.matches ? 0.16 : 0.36,
      }, dtMs / 1000);
      if (lumaRec) lumaRec(now);
      if (wantSnap) { const done = wantSnap; wantSnap = null; cv.toBlob((blob) => done(blob), 'image/png'); }

      if (frameIdx % 6 === 0) {
        $('g-hits').textContent = kit.hits;
        $('g-hero').textContent = kit.tempo.bpm ? Math.round(kit.tempo.bpm) : '--';
        $('g-level').innerHTML = kit.audio.state === 'live' ? `${Math.round(kit.audio.peakDb)}<small>dB</small>` : kit.demoOn ? 'demo' : '--';
      }
    } catch (e) {
      if (fails++ < 3) console.error(e);
    }
  }

  /* ---- boot ---- */
  if (!G || !(G.floatRT || G.gl.getExtension('EXT_color_buffer_half_float'))) {
    shell.glFail('This page needs WebGL2 with floating-point render targets, which this browser did not provide. The inputs below still report their state.');
    const idle = (now) => { requestAnimationFrame(idle); kit.tick(now); shell.frame(now); };
    requestAnimationFrame(idle);
  } else {
    gl = G.gl;
    try {
      Post = createPost(G);
      pSim = G.program(SIM_FS); pPoint = G.program(POINT_FS, POINT_VS); pTrail = G.program(TRAIL_FS); pGas = G.program(GAS_FS);
      pAdvect = G.program(ADVECT_FS); pSplat = G.program(SPLAT_FS); pDiv = G.program(DIV_FS); pJac = G.program(JAC_FS); pGrad = G.program(GRAD_FS);
      tN = G.noiseTexture(20261103);
      tHist = G.tex(kit.HIST_W, kit.BANDS, { internal: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE }, { data: kit.hist });
      G.bindTex(0, tHist); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      const rg = { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT };
      vel = G.target(FV, FV, rg); velB = G.target(FV, FV, rg); pres = G.target(FV, FV, rg); presB = G.target(FV, FV, rg); div = G.target(FV, FV, rg);
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      strongGPU = /apple m\d+ (pro|max|ultra)|apple m[3-9]|rtx|radeon rx/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
      buildParticles(navigator.maxTouchPoints > 1 ? 128 : 256);
      resize();
      addEventListener('resize', resize);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); shell.glFail('The graphics context was lost. Reload the page to get the picture back.'); });
      requestAnimationFrame(render);
    } catch (e) {
      console.error(e);
      shell.glFail(`The picture could not start on this graphics card: ${String(e.message).slice(0, 140)}`);
    }
  }

  // For the flicker check: record the picture's brightness on a small grid, on every frame, straight after it is drawn.
  let lumaRec = null;
  function recordLuma(ms) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d', { willReadFrequently: true }), frames = [], t0 = performance.now();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';        // a true area average, not a few sampled pixels
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
    S, kit, F, recordLuma,
    get N() { return N; },
    pixel() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const g = c.getContext('2d');
      return new Promise((res) => { wantSnap = (blob) => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let sum = 0, min = 1e9, max = 0; const grid = []; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; sum += l; min = Math.min(min, l); max = Math.max(max, l); grid.push(l); } res({ mean: sum / (d.length / 4), min, max, grid }); }; im.src = URL.createObjectURL(blob); }; });
    },
  };
})();
