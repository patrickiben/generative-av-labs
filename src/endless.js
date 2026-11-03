/* endless.js: Endless Cockpit. A procedural road that keeps time.
   The scene is raymarched each frame, then fed through a zoom-feedback loop toward the vanishing point.
   Tempo sets the speed, each drum has a stated effect, and the horizon is the live spectrum. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD, srgb } = GLKit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const RM = matchMedia('(prefers-reduced-motion: reduce)');

  const BIOMES = [
    { name: 'Golden coast', skyTop: '#2e4f8a', skyHz: '#ffb077', sun: '#ffd49a', ground: '#55452e', rock: '#7a5a3c', fog: '#ffc898', edge: '#ffd36b', amp: 58, ridge: 0.38, trees: 0.25, sea: 1, snow: 0, strata: 0, grid: 0, fogK: 0.0034, sunAz: 0.12, sunEl: 0.1 },
    { name: 'Misty pines', skyTop: '#1f3a50', skyHz: '#a7c9c2', sun: '#ffe8c6', ground: '#1e3a2f', rock: '#39494a', fog: '#b0d3cc', edge: '#7ff0dd', amp: 64, ridge: 0.22, trees: 1, sea: 0, snow: 0, strata: 0, grid: 0, fogK: 0.0062, sunAz: -0.3, sunEl: 0.16 },
    { name: 'Neon forest', skyTop: '#120829', skyHz: '#5e2496', sun: '#ff74d4', ground: '#120b26', rock: '#28144d', fog: '#7c42bb', edge: '#ef86ff', amp: 48, ridge: 0.55, trees: 0.8, sea: 0, snow: 0, strata: 0, grid: 1, fogK: 0.0052, sunAz: 0.02, sunEl: 0.07 },
    { name: 'High alpine', skyTop: '#23548f', skyHz: '#c6def2', sun: '#fff2d8', ground: '#465660', rock: '#56626e', fog: '#d6e7f5', edge: '#9fe0ff', amp: 66, ridge: 0.7, trees: 0.1, sea: 0, snow: 1, strata: 0, grid: 0, fogK: 0.0027, sunAz: 0.42, sunEl: 0.26 },
    { name: 'Red canyon', skyTop: '#472833', skyHz: '#d27f5c', sun: '#f2bd8c', ground: '#7a3b24', rock: '#a9522c', fog: '#eaa27a', edge: '#ff8f70', amp: 54, ridge: 0.8, trees: 0, sea: 0, snow: 0, strata: 1, grid: 0, fogK: 0.0039, sunAz: -0.16, sunEl: 0.09 },
  ].map((b) => ({ ...b, c: { skyTop: srgb(b.skyTop), skyHz: srgb(b.skyHz), sun: srgb(b.sun), ground: srgb(b.ground), rock: srgb(b.rock), fog: srgb(b.fog), edge: srgb(b.edge) } }));

  /* ---- the same road in JS and GLSL, so the camera, the grade readout and the picture agree ---- */
  const S = {
    mode: 'groove', rpm: 0, speed: 0, dist: 0, vis: 40, zoom: 0, grade: 0, surge: 0, shake: 0, shakeV: 0, roll: 0,
    map: { idle: 25, max: 95, maxZoom: 0.018, gamma: 1.6 }, dream: 0.55, wild: 0.35, seed: 0,
    pedal: false, steady: null, auto: false, autoT: 0, ble: null, bleName: '', biome: 0, biomeNext: 0, biomeT: 1, crashScene: false, dusk: 0.3, ambient: 2.2,
  };
  const MAX_SPEED = 18, M_PER_MI = 1609.34, GRADE_K = 5;
  const pathX = (z) => 14 * Math.sin(z * 0.0113 + 1 + S.seed) + 6.5 * Math.sin(z * 0.0271 + 2.2 + S.seed * 1.7);
  const roadY = (z) => 7 * Math.sin(z * 0.0071 + 0.4 + S.seed) + 3.4 * Math.sin(z * 0.0193 + 1.9 + S.seed * 2.3) + 1.1 * Math.sin(z * 0.0471 + 3.1);
  const gradeAt = (z) => (roadY(z + 3) - roadY(z - 3)) / 6;
  const gradeFactor = (g) => clamp(1 - g * GRADE_K, 0.6, 1.35);
  const motion01 = (rpm) => {
    const { idle, max, gamma } = S.map;
    return Math.pow(clamp((rpm - idle) / Math.max(1, max - idle), 0, 1), 1 / gamma);
  };

  /* ---- shaders ---- */
  const SCENE_FS = FS_HEAD + `
#define RINGS 12
uniform vec2 uRes; uniform float uT,uFocal,uBeat,uSeed;
uniform vec3 uCam,uRight,uUp,uFwd;
uniform sampler2D uN,uS;
uniform vec3 uSkyTop,uSkyHz,uSunC,uGround,uRock,uFog,uEdge,uSunDir;
uniform float uAmp,uRidge,uSea,uSnow,uStrata,uGrid,uTrees,uDusk,uFogK;
uniform float uKick,uSnare,uHat,uHatOpen,uTom,uTomPos,uCrash,uRide;
uniform vec4 uRing[RINGS];
float pathX(float z){return 14.*sin(z*.0113+1.+uSeed)+6.5*sin(z*.0271+2.2+uSeed*1.7);}
float roadY(float z){return 7.*sin(z*.0071+.4+uSeed)+3.4*sin(z*.0193+1.9+uSeed*2.3)+1.1*sin(z*.0471+3.1);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return textureLod(uN,(i+f+.5)/256.,0.).r;}
const mat2 R=mat2(.8,.6,-.6,.8);
float fbm2(vec2 p){return (vn(p)+.5*vn(R*p*2.03+3.1))/1.5;}
float fbm4(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=R*p*2.03+1.7;a*=.5;}return s/.9375;}
const float SEA=-14.;
float height(vec2 p,bool hi){
  float px=pathX(p.y),ry=roadY(p.y),d=abs(p.x-px);
  float t=smoothstep(4.,46.,d);
  vec2 q=p*.0088+uSeed*3.;
  q+=.55*vec2(vn(q*.73+1.3),vn(q*.73+4.1));          // bends the noise lattice out of sight
  float n=hi?fbm4(q):fbm2(q);
  float r=1.-abs(2.*fbm2(q*.63+9.)-1.);
  float m=mix(n,r*r,uRidge);
  float mid=vn(q*4.3+5.3)-.5;
  float h=ry+t*max(0.,m-.27+mid*.16)*uAmp*(1.+d*.0016);
  float far=smoothstep(110.,430.,d);
  if(far>0.){float rr=1.-abs(2.*fbm2(q*.31+2.7)-1.);h+=far*rr*rr*uAmp*1.5;}
  if(uTrees>0.)h+=smoothstep(4.,22.,d)*uTrees*pow(vn(p*.19),3.)*5.;
  if(uSea>0.){float side=smoothstep(7.,70.,p.x-px);h=mix(h,SEA-5.,side*uSea);}
  return h;
}
float surface(vec2 p,bool hi){float h=height(p,hi);return uSea>0.?max(h,SEA):h;}
float march(vec3 ro,vec3 rd,out float last){
  float t=.8,h=0.;last=0.;
  for(int i=0;i<76;i++){
    vec3 p=ro+rd*t;h=p.y-surface(p.xz,false);
    if(h<.002*t||t>680.)break;
    last=t;t+=max(h*.62,.03+t*.011);
  }
  if(t<680.&&last>0.){float a=last,b=t;for(int i=0;i<5;i++){float m=.5*(a+b);vec3 q=ro+rd*m;if(q.y-surface(q.xz,false)>0.)a=m;else b=m;}t=.5*(a+b);}
  return t;
}
float skyTrail=0.;
vec3 sky(vec3 rd,vec2 sv){
  float y=max(rd.y,0.);
  vec3 c=mix(uSkyHz,uSkyTop,pow(y,.52));
  float s=max(dot(rd,uSunDir),0.);
  c+=uSunC*(pow(s,380.)*5.+pow(s,26.)*.42+pow(s,5.)*.2);
  // cloud deck
  if(rd.y>.004){
    vec2 cp=rd.xz/(rd.y+.13)*1.25+vec2(uT*.006,uCam.z*.0009);
    float cl=fbm4(cp);
    float cov=smoothstep(.46,.84,cl);
    vec3 cc=mix(uFog*.9,uSunC*1.02,.3+.55*pow(s,3.));
    c=mix(c,cc,cov*.62*smoothstep(.004,.13,rd.y));
  }
  // stars at dusk, hats make them flicker
  float dark=uDusk*smoothstep(.02,.26,rd.y);
  if(dark>.01){
    vec3 q=rd*190.;vec3 id=floor(q);vec3 f=fract(q)-.5;
    float h=fract(sin(dot(id,vec3(127.1,311.7,74.7)))*43758.5453);
    if(h>.968){float b=(h-.968)/.032;float tw=.55+.45*sin(uT*(2.+h*6.)+h*900.);
      c+=vec3(.95,.97,1.)*b*b*(tw+uHat*(1.6+uHatOpen*1.4)+uRide*1.1*sin(uT*18.+h*400.))*exp(-dot(f,f)*42.)*dark*2.2;}
  }
  // crash: aurora curtains
  if(uCrash>.01){
    float az=atan(rd.x,rd.z);
    float cur=pow(fbm2(vec2(az*4.+uT*.25,uT*.09)),3.)*5.;
    float band=smoothstep(.03,.2,rd.y)*smoothstep(.72,.22,rd.y);
    c+=mix(uEdge,vec3(.6,.9,1.),.45)*cur*band*min(uCrash,.7)*1.1;
  }
  // toms: a band of light in the sky at the tom's height
  c+=uEdge*exp(-pow((rd.y-(.05+uTomPos*.34))*16.,2.))*uTom*.9;
  // the horizon is the live spectrum: low in the middle, high at the edges
  float u=abs(sv.x);
  float a=texture(uS,vec2(clamp(u,0.,1.),.5)).r;
  float jag=fbm2(vec2(sv.x*9.+uSeed,uT*.03))*.012;
  float top=.006+jag+a*.17;
  float edge=smoothstep(0.,.0028,top-rd.y);
  vec3 ridge=mix(uFog*.42,uSkyTop*.6,.35)+uEdge*a*.5*smoothstep(top-.05,top,rd.y);
  c=mix(c,ridge,edge*smoothstep(-.03,.0,rd.y));
  c+=uEdge*exp(-abs(rd.y-top)*110.)*a*1.9*smoothstep(-.02,.01,rd.y);
  skyTrail=exp(-abs(rd.y-top)*90.)*a*.35*smoothstep(-.02,.01,rd.y);
  return c;
}
void main(){
  vec2 sv=vUv*2.-1.;float asp=uRes.x/uRes.y;
  vec3 rd=normalize(uFwd*uFocal+uRight*sv.x*asp+uUp*sv.y);
  vec3 ro=uCam;
  skyTrail=0.;
  vec3 skyc=sky(rd,sv);
  float trail=0.;
  vec3 col=skyc;
  float last;
  float t=rd.y<.32?march(ro,rd,last):1e4;
  if(t<680.){
    vec3 p=ro+rd*t;
    bool water=uSea>0.&&p.y<=SEA+.02;
    float e=.05+t*.0018;
    vec3 N=normalize(vec3(surface(p.xz-vec2(e,0.),true)-surface(p.xz+vec2(e,0.),true),2.*e,surface(p.xz-vec2(0.,e),true)-surface(p.xz+vec2(0.,e),true)));
    float px=pathX(p.z),d=abs(p.x-px),rel=p.y-roadY(p.z);
    float dn=fbm4(p.xz*.075);
    vec3 alb=mix(uGround*.75,uGround*1.55,dn);
    float sl=1.-N.y;
    alb=mix(alb,uRock,smoothstep(.1,.42,sl+dn*.14-.07));
    if(uSnow>0.)alb=mix(alb,vec3(.84,.88,.96),uSnow*smoothstep(14.,44.,rel+dn*22.)*smoothstep(.62,.22,sl));
    if(uStrata>0.)alb*=mix(1.,.74+.3*sin(rel*.85+dn*3.5),uStrata);
    if(uGrid>0.){vec2 g=abs(fract(p.xz*.12)-.5);float gl=smoothstep(.47,.5,max(g.x,g.y));alb+=uEdge*gl*.32*uGrid*exp(-t*.012);}
    float dif=clamp(dot(N,uSunDir),0.,1.);
    vec3 amb=mix(uFog*.7,uSkyTop,.5+.5*N.y)*.62;
    vec3 c=alb*(uSunC*dif*1.5+amb);
    float back=clamp(dot(N,normalize(vec3(-uSunDir.x,0.,-uSunDir.z))),0.,1.);
    c+=alb*uSkyHz*back*.12;
    if(water){
      vec3 W=normalize(vec3((vn(p.xz*.3+uT*.5)-.5)*.14,1.,(vn(p.xz*.27-uT*.4)-.5)*.14));
      vec3 rf=reflect(rd,W);
      float keep=skyTrail;c=mix(uFog*.22+uSkyTop*.18,sky(vec3(rf.x,abs(rf.y),rf.z),vec2(0.)),.72);skyTrail=keep;
      c+=uSunC*pow(max(dot(rf,uSunDir),0.),190.)*7.;
    }
    // the road
    float rm=1.-smoothstep(2.,2.55,d);
    if(!water){
      vec3 asphalt=mix(vec3(.022,.023,.03),uFog*.05,.4)+alb*.04;
      c=mix(c,asphalt*(uSunC*dif*1.2+amb),rm);
    }
    float em=0.;vec3 emC=vec3(0.);
    if(rm>0.){
      float dash=step(fract(p.z/max(uBeat*.5,1.)),.5)*(1.-smoothstep(.05,.1,abs(p.x-px)));
      emC+=uEdge*dash*.32*rm*smoothstep(2.,16.,t);
    }
    float side=exp(-pow((d-2.25)/.09,2.));
    float spark=pow(vn(vec2(p.z*.9,uT*1.3)),6.)*7.;
    emC+=uEdge*side*(.3+uRide*spark*.6+uHat*spark*(.75+uHatOpen*1.1));
    // rings of light that run ahead of you
    for(int i=0;i<RINGS;i++){
      vec4 r=uRing[i];
      if(r.z<=0.)continue;
      bool snare=r.w>.5;
      float zr=r.x+r.y*(snare?44.:78.);
      float w=.9+r.y*(snare?2.6:2.2);
      float g=exp(-pow((p.z-zr)/w,2.))*exp(-r.y*(snare?2.6:1.9))*r.z;
      g*=exp(-d*(snare?.03:.3))*(.12+.88*smoothstep(1.,20.,t));
      g*=smoothstep(46.,14.,zr-uCam.z);    // rings fade before the horizon, where they would stack into a flashing band
      emC+=(snare?mix(uEdge,vec3(1.),.25):uEdge*1.2)*g*(snare?.22:1.25);
    }
    float fog=1.-exp(-pow(t*uFogK,1.55));
    vec3 fogC=mix(uFog,uSunC,pow(max(dot(rd,uSunDir),0.),7.)*.55)*(1.-uDusk*.55);
    col=mix(c,fogC,fog)+emC*exp(-t*.0085);
    col=mix(col,skyc,smoothstep(590.,680.,t));
    trail=clamp(dot(emC,vec3(.4))*exp(-t*.0085),0.,1.);
  }
  // alpha marks what may leave a trail: emitters and the spectrum ridge, never the sun or the sky
  o=vec4(col,max(trail,skyTrail));
}`;

  const MOTE_VS = `#version 300 es
precision highp float;
uniform vec3 uCam,uRight,uUp,uFwd; uniform float uFocal,uAsp,uZ,uPx,uSeed,uHat,uRide,uHatOpen,uSpeedN;
out float vA;
float h(float n){return fract(sin(n)*43758.5453);}
float pathX(float z){return 14.*sin(z*.0113+1.+uSeed)+6.5*sin(z*.0271+2.2+uSeed*1.7);}
float roadY(float z){return 7.*sin(z*.0071+.4+uSeed)+3.4*sin(z*.0193+1.9+uSeed*2.3)+1.1*sin(z*.0471+3.1);}
void main(){
  float i=float(gl_VertexID);
  float a=h(i*1.13),b=h(i*2.71),c=h(i*4.33);
  float span=130.;
  float z=uZ+mod(c*span-uZ,span);
  vec3 p=vec3(pathX(z)+(a-.5)*(4.+b*34.),roadY(z)+.2+b*b*11.,z);
  vec3 d=p-uCam;float cz=dot(d,uFwd);
  if(cz<.4){gl_Position=vec4(2.,2.,0.,1.);gl_PointSize=0.;vA=0.;return;}
  gl_Position=vec4(dot(d,uRight)*uFocal/cz/uAsp,dot(d,uUp)*uFocal/cz,0.,1.);
  float tw=.5+.5*sin(i*.7+uZ*.5);
  vA=(.1+.3*uHat*(1.+.6*uHatOpen)+.18*uRide*tw+.12*uSpeedN)*smoothstep(span,span*.45,cz)*smoothstep(.4,4.,cz);
  gl_PointSize=clamp(uPx*(.5+a*1.3)/cz*(1.+uHat),1.,44.);
}`;
  const MOTE_FS = FS_HEAD.replace('in vec2 vUv;\n', '') + `
uniform vec3 uEdge; in float vA;
void main(){ vec2 q=gl_PointCoord-.5; float g=exp(-dot(q,q)*16.); o=vec4(mix(uEdge,vec3(1.),.45)*g*vA,g*vA*.8); }`;

  // The feedback loop: last frame, zoomed toward the vanishing point and warped, under the fresh scene.
  const DREAM_FS = FS_HEAD + `
uniform sampler2D uScene,uPrev; uniform vec2 uVP; uniform float uZoom,uDream,uWild,uT,uKick;
void main(){
  vec2 c=vUv-uVP; float r=length(c);
  float z=1.-uZoom*(1.+r*.55);
  float a=uWild*.0034*sin(r*7.-uT*.7);
  float ca=cos(a),sa=sin(a);
  vec2 uv=uVP+mat2(ca,-sa,sa,ca)*c*z;
  float sh=uWild*.0026*(.4+r);
  vec4 pm=texture(uPrev,uv);
  vec3 prev=vec3(texture(uPrev,uv+c*sh).r,pm.g,texture(uPrev,uv-c*sh).b);
  vec4 sc=texture(uScene,vUv);
  // Motion blur from the zoomed last frame, then long trails from emitters only.
  float k=uDream*.58*smoothstep(0.,.14,r+uDream*.1);
  vec3 m=mix(sc.rgb,prev*.985,k);
  m=max(m,prev*pm.a*(.42+uDream*.46));
  o=vec4(min(m,vec3(30.)),max(sc.a,pm.a*(.8+uDream*.16)));
}`;

  /* ---- page ---- */
  const hudHtml = `
    <div class="gauge"><span class="k">Speed</span><span class="v"><span id="g-speed">0.0</span><small>mph</small></span></div>
    <div class="gauge hero"><span class="k" id="g-hero-k">Tempo</span><span class="v" id="g-hero">--</span></div>
    <div class="gauge"><span class="k">Distance</span><span class="v"><span id="g-dist">0.00</span><small>mi</small></span></div>`;

  const routeSheet = `
    <div class="field"><div class="row"><span>Scene</span><b id="scene-name">Golden coast</b></div><div class="row-actions" id="biome-row"></div></div>
    <label class="field" style="margin-top:12px">Time of day<select id="tod"><option value="auto">Moving, a four-minute cycle</option><option value="0.18">Golden hour</option><option value="0.55">Dusk</option><option value="1">Night</option></select></label>
    <label class="check"><input type="checkbox" id="crash-scene"> Change the scene on every crash</label>
    <div class="row-actions"><button class="pill" id="new-route">New route</button><button class="pill" id="ride-sound">Ride sound: off</button></div>
    <div class="sig-title"><span>Route ahead</span><span id="grade-read">grade 0%</span></div>
    <canvas class="sig-canvas" id="elstrip" width="880" height="110" role="img" aria-label="Elevation of the procedural route ahead"></canvas>
    <p class="note">The route is procedural and seeded, not a real GPS track.</p>

    <details open><summary>Look</summary><div class="controls-grid" style="padding:10px 0 0">
      <label class="field"><div class="row"><span>Dream, how much of the last frame stays</span><b id="dream-v"></b></div><input type="range" id="dream" min="0" max="100"></label>
      <label class="field"><div class="row"><span>Wildness, warp and color split</span><b id="wild-v"></b></div><input type="range" id="wild" min="0" max="100"></label>
    </div></details>

    <details id="ride-controls"><summary>Ride: cadence sensor and pedal</summary><div class="controls-grid" style="padding:10px 0 0">
      <p class="note" style="margin:0">Ride mode takes speed from a cadence source instead of your drumming. A Bluetooth sensor connects directly from Chrome or Edge, with no other software.</p>
      <div class="row-actions"><button class="pill" id="ble-connect">Connect cadence sensor</button><button class="pill" id="auto-ride">Interval workout: off</button></div>
      <p class="note" id="ble-status" role="status" style="margin:0">No sensor connected.</p>
      <label class="field"><div class="row"><span>Steady cadence</span><b id="steady-v">off</b></div><input type="range" id="steady" min="0" max="120" value="0"></label>
    </div></details>

    <details id="mapping"><summary>Tempo and cadence to motion</summary><div class="controls-grid" style="padding:10px 0 0">
      <label class="field"><div class="row"><span>Idle cadence, no motion below</span><b id="v-idle"></b></div><input type="range" id="m-idle" min="0" max="60"></label>
      <label class="field"><div class="row"><span>Top cadence, full speed above</span><b id="v-max"></b></div><input type="range" id="m-max" min="60" max="130"></label>
      <label class="field"><div class="row"><span>Zoom per frame at top speed</span><b id="v-zoom"></b></div><input type="range" id="m-zoom" min="4" max="40"></label>
      <label class="field"><div class="row"><span>Response curve</span><b id="v-gamma"></b></div><input type="range" id="m-gamma" min="60" max="320"></label>
      <div class="sig-title" style="margin:6px 0 0"><span>Cadence to zoom</span><span>live dot</span></div>
      <canvas class="sig-canvas" id="curve" width="880" height="170" role="img" aria-label="Transfer curve from cadence to zoom, with the live value"></canvas>
    </div></details>`;

  const about = `
    <p class="sheet-intro">Everything you see here is a stated rule. There is no model and no server.</p>
    <table class="maptable"><tbody>
      <tr><th>Tempo</th><td>Sets the speed. In Groove, half your BPM stands in for pedal cadence.</td></tr>
      <tr><th>Kick</th><td>Surges you forward and sends a ring of light down the road.</td></tr>
      <tr><th>Snare</th><td>A wide flare across the land.</td></tr>
      <tr><th>Hi-hat</th><td>Sparks along the road edge and in the stars. Opening the pedal lengthens them.</td></tr>
      <tr><th>Toms</th><td>A band of light in the sky, high for the high tom and low for the low tom.</td></tr>
      <tr><th>Crash</th><td>Aurora and long trails. A choke cuts it short.</td></tr>
      <tr><th>Ride</th><td>Stars and road edge shimmer.</td></tr>
      <tr><th>Spectrum</th><td>The ridge on the horizon, low in the middle and high at the edges.</td></tr>
      <tr><th>Grade</th><td>The procedural road's slope changes your speed by up to 40%, never the zoom curve.</td></tr>
    </tbody></table>
    <p class="note">Keys: <b>J K L</b> kick, snare, hat · <b>U I O</b> toms · <b>P</b> crash · <b>;</b> ride · <b>D</b> demo · <b>C</b> connect · <b>B</b> next scene · <b>F</b> full screen · <b>H</b> hide controls · hold <b>Space</b> to pedal in Ride.</p>`;

  const kit = createKit();
  let shell = null;
  const brand = '<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 3 4 25M12 3l8 22M12 9v3M12 15v3M12 21v4"/></svg>';
  shell = mountShell({
    id: 'endless-cockpit', name: 'Endless Cockpit', brand, kit,
    modes: [{ id: 'groove', label: 'Groove' }, { id: 'ride', label: 'Ride' }], mode: 'groove', modeLabel: 'What sets the speed',
    onMode: (m) => { S.mode = m; updateModeUi(); kit.noteLane('mode', m); },
    intro: { eyebrow: 'Endless Cockpit · a road that keeps time', title: 'The road follows your hands.', subtitle: 'Plug in your kit, or run the demo. No helper app, no server.' },
    hud: hudHtml,
    truth: 'Procedural road with no model. Tempo sets the speed. Audio and MIDI stay in this browser.',
    sheets: [{ id: 'route', label: 'Route', icon: 'route', title: 'Choose the road.', intro: 'These change how it looks and how fast it moves. They never change the readings.', html: routeSheet }],
    about, canvas: () => cv, snapshot: snap, quality: () => `${rw} x ${rh} render`,
    onKey: (e, key) => { if (key === 'b') nextBiome(); },
  });

  const cv = $('stage');
  const G = createGL(cv);
  let gl, Post, pScene, pDream, pMote, tNoise, tSpec;
  let scene, dreamA, dreamB, rw = 0, rh = 0, frameIdx = 0, lastScale = 1;
  const specBytes = new Uint8Array(kit.BANDS), ridge = new Float32Array(kit.BANDS);

  const ringData = new Float32Array(12 * 4);
  const rings = [];
  kit.on('hit', (h) => {
    const v = h.vel;
    if (h.voice === 'kick') { S.surge = Math.max(S.surge, v); rings.push({ z: S.vis + 2, t: performance.now(), v, k: 0 }); }
    if (h.voice === 'snare') rings.push({ z: S.vis + 4, t: performance.now(), v: v * 0.8, k: 1 });   // no camera shake: moving the sun's edge at the hit rate reads as flashing
    if (h.voice === 'crash' && S.crashScene && !h.est) nextBiome();
    if (rings.length > 12) rings.shift();
  });
  kit.on('lane', (l) => {
    if (l.name === 'rpm') S.replayRpm = l.value;
    else if (l.name === 'biome') setBiome(l.value);
    else if (l.name === 'mode') shell.setMode(l.value);
    else if (l.name === 'seed') S.seed = l.value;
  });
  kit.on('replay', (on) => { if (!on) { S.replayRpm = null; if (S.mode === 'ride') S.pedal = false; } });

  /* ---- biomes ---- */
  function setBiome(i) {
    if (i === S.biomeNext) return;
    S.biome = S.biomeNext; S.biomeNext = i; S.biomeT = 0;
    kit.noteLane('biome', i);
    document.querySelectorAll('#biome-row button').forEach((b, k) => b.classList.toggle('on', k === i));
    document.body.style.setProperty('--accent', BIOMES[i].edge);
    $('scene-name').textContent = BIOMES[i].name;
  }
  function nextBiome() { setBiome((S.biomeNext + 1) % BIOMES.length); }
  $('biome-row').innerHTML = BIOMES.map((b, i) => `<button class="pill${i === 0 ? ' on' : ''}" data-b="${i}">${b.name}</button>`).join('');
  $('biome-row').addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b) setBiome(+b.dataset.b); });
  $('crash-scene').addEventListener('change', (e) => { S.crashScene = e.target.checked; });
  $('tod').addEventListener('change', (e) => { S.duskHold = e.target.value === 'auto' ? null : +e.target.value; });
  $('new-route').addEventListener('click', () => { S.seed = (Math.random() * 40) | 0; kit.noteLane('seed', S.seed); shell.toast('New route'); });
  document.body.style.setProperty('--accent', BIOMES[0].edge);

  /* ---- sheet controls ---- */
  const bind = (id, get, set, fmt, label) => {
    const r = $(id);
    r.value = get();
    shell.syncRange(r);
    const lab = $(label);
    if (lab) lab.textContent = fmt(+r.value);
    r.addEventListener('input', () => { shell.syncRange(r); set(+r.value); if (lab) lab.textContent = fmt(+r.value); drawCurve(); });
  };
  bind('dream', () => S.dream * 100, (v) => { S.dream = v / 100; }, (v) => `${Math.round(v)}%`, 'dream-v');
  bind('wild', () => S.wild * 100, (v) => { S.wild = v / 100; }, (v) => `${Math.round(v)}%`, 'wild-v');
  bind('m-idle', () => S.map.idle, (v) => { S.map.idle = v; }, (v) => `${v} rpm`, 'v-idle');
  bind('m-max', () => S.map.max, (v) => { S.map.max = v; }, (v) => `${v} rpm`, 'v-max');
  bind('m-zoom', () => S.map.maxZoom * 1000, (v) => { S.map.maxZoom = v / 1000; }, (v) => `${(v / 10).toFixed(1)}%`, 'v-zoom');
  bind('m-gamma', () => S.map.gamma * 100, (v) => { S.map.gamma = v / 100; }, (v) => (v / 100).toFixed(2), 'v-gamma');
  bind('steady', () => 0, (v) => { S.steady = v > 0 ? v : null; if (v > 0) S.auto = false; syncAuto(); }, (v) => (v > 0 ? `${v} rpm` : 'off'), 'steady-v');

  function syncAuto() { $('auto-ride').textContent = `Interval workout: ${S.auto ? 'on' : 'off'}`; $('auto-ride').classList.toggle('on', S.auto); }
  $('auto-ride').addEventListener('click', () => { S.auto = !S.auto; S.autoT = 0; if (S.auto) { $('steady').value = 0; shell.syncRange($('steady')); S.steady = null; $('steady-v').textContent = 'off'; } syncAuto(); });

  /* pedal button appears on the stage in Ride */
  const pedalBtn = document.createElement('button');
  pedalBtn.className = 'pill primary chrome'; pedalBtn.id = 'pedal'; pedalBtn.textContent = 'Hold to pedal'; pedalBtn.hidden = true;
  document.querySelector('.dock-wrap').insertBefore(pedalBtn, document.querySelector('.badges'));
  const pedalOn = () => { S.pedal = true; S.auto = false; syncAuto(); pedalBtn.classList.add('on'); };
  const pedalOff = () => { S.pedal = false; pedalBtn.classList.remove('on'); };
  pedalBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); pedalOn(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => pedalBtn.addEventListener(ev, pedalOff));
  addEventListener('keydown', (e) => { if (e.code === 'Space' && S.mode === 'ride' && !e.repeat && !e.target.closest('dialog[open], input, select, button')) { e.preventDefault(); pedalOn(); } });
  addEventListener('keyup', (e) => { if (e.code === 'Space') pedalOff(); });
  function updateModeUi() {
    pedalBtn.hidden = S.mode !== 'ride';
    $('g-hero-k').textContent = S.mode === 'ride' ? 'Cadence' : 'Tempo';
    if (S.mode === 'ride') $('ride-controls').open = true;
  }

  /* ---- Bluetooth cadence, ported unchanged from the first version: CSC and FTMS ---- */
  let lastCrankRev = null, lastCrankT = null;
  function onCSC(e) {
    const dv = e.target.value, flags = dv.getUint8(0);
    let off = 1;
    if (flags & 0x01) off += 6;
    if (flags & 0x02) {
      const crankRev = dv.getUint16(off, true); off += 2;
      const crankT = dv.getUint16(off, true);
      if (lastCrankRev != null) {
        let dRev = crankRev - lastCrankRev; if (dRev < 0) dRev += 65536;
        let dT = crankT - lastCrankT; if (dT < 0) dT += 65536;
        const secs = dT / 1024;
        if (secs > 0) { const rpm = (dRev / secs) * 60; if (rpm < 250) S.ble = rpm; }
        if (dRev === 0 && secs > 1.5) S.ble = 0;
      }
      lastCrankRev = crankRev; lastCrankT = crankT;
    }
  }
  function onFTMS(e) {
    const dv = e.target.value, flags = dv.getUint16(0, true);
    let off = 2;
    if (!(flags & 0x0001)) off += 2;
    if (flags & 0x0002) off += 2;
    if (flags & 0x0004) { const cad = dv.getUint16(off, true) * 0.5; if (cad >= 0 && cad < 250) S.ble = cad; }
  }
  $('ble-connect').addEventListener('click', async () => {
    const st = $('ble-status');
    if (!navigator.bluetooth) { st.textContent = 'This browser has no Web Bluetooth. Chrome and Edge do.'; return; }
    try {
      st.textContent = 'Choose a sensor in the browser prompt.';
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ['cycling_speed_and_cadence'] }, { services: ['fitness_machine'] }], optionalServices: ['cycling_speed_and_cadence', 'fitness_machine'] });
      st.textContent = `Connecting to ${dev.name || 'sensor'}.`;
      const gatt = await dev.gatt.connect();
      let svc, ch, kind;
      try { svc = await gatt.getPrimaryService('cycling_speed_and_cadence'); ch = await svc.getCharacteristic('csc_measurement'); kind = 'csc'; } catch (e) { svc = await gatt.getPrimaryService('fitness_machine'); ch = await svc.getCharacteristic('indoor_bike_data'); kind = 'ftms'; }
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', kind === 'csc' ? onCSC : onFTMS);
      S.ble = 0;
      st.textContent = `Connected: ${dev.name || 'sensor'}. Ride mode now follows it.`;
      if (S.mode !== 'ride') shell.setMode('ride');
      dev.addEventListener('gattserverdisconnected', () => { S.ble = null; st.textContent = 'The sensor disconnected.'; });
    } catch (err) { st.textContent = err.name === 'NotFoundError' ? 'No sensor chosen.' : `Could not connect: ${err.message}`; }
  });

  /* ---- ride sound: cadence-driven atoms, ported from the first version, off by default ---- */
  const ATOMS = [[98, 130.81, 196, 246.94, 293.66, 392, 493.88], [110, 146.83, 220, 277.18, 329.63, 440, 554.37], [130.81, 164.81, 196, 261.63, 392, 523.25, 659.25], [123.47, 164.81, 246.94, 329.63, 493.94, 659.25, 987.77], [82.41, 110, 164.81, 220, 277.18, 329.63, 415.3]];
  let AC = null, sndOn = false, sndGain = null, nextGrain = 0;
  function curAtoms() { const a = ATOMS[S.biome], b = ATOMS[S.biomeNext], t = S.biomeT; return a.map((v, i) => lerp(v, b[i], t)); }
  function grainTick() {
    if (!AC || !sndOn) return;
    const rate = Math.min(24, (S.rpm / 130) * 24);
    if (nextGrain < AC.currentTime) nextGrain = AC.currentTime + 0.02;
    if (rate < 0.5) { nextGrain = AC.currentTime + 0.08; return; }
    const atoms = curAtoms();
    let budget = 0;
    while (nextGrain < AC.currentTime + 0.12 && budget < 8) {
      const t = nextGrain, o = AC.createOscillator(), g = AC.createGain();
      o.type = S.wild > 0.6 ? 'triangle' : 'sine';
      o.frequency.value = atoms[(Math.random() * atoms.length) | 0] * (1 + (Math.random() - 0.5) * 0.012);
      const dur = 0.07 + Math.random() * 0.1, peak = 0.1 + S.wild * 0.06;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(sndGain); o.start(t); o.stop(t + dur + 0.01);
      nextGrain += 1 / rate; budget++;
    }
  }
  $('ride-sound').addEventListener('click', function () {
    if (!AC) { AC = new (window.AudioContext || window.webkitAudioContext)(); sndGain = AC.createGain(); sndGain.gain.value = 0; sndGain.connect(AC.destination); setInterval(grainTick, 45); }
    if (AC.state === 'suspended') AC.resume();
    sndOn = !sndOn;
    this.textContent = `Ride sound: ${sndOn ? 'on' : 'off'}`; this.classList.toggle('on', sndOn);
    sndGain.gain.linearRampToValueAtTime(sndOn ? 0.5 : 0, AC.currentTime + 0.25);
  });

  /* ---- small canvases in the Route sheet ---- */
  function drawElStrip() {
    const c = $('elstrip').getContext('2d'), w = 880, h = 110;
    c.clearRect(0, 0, w, h);
    const pts = [], span = 1400;
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= 200; i++) { const y = roadY(S.vis + (i / 200) * span); pts.push(y); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const Y = (v) => h - 14 - ((v - lo) / Math.max(1, hi - lo)) * (h - 34);
    c.beginPath(); pts.forEach((v, i) => { const x = (i / 200) * w; if (i) c.lineTo(x, Y(v)); else c.moveTo(x, Y(v)); });
    c.lineTo(w, h); c.lineTo(0, h); c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `${BIOMES[S.biomeNext].edge}66`); g.addColorStop(1, `${BIOMES[S.biomeNext].edge}05`);
    c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach((v, i) => { const x = (i / 200) * w; if (i) c.lineTo(x, Y(v)); else c.moveTo(x, Y(v)); });
    c.strokeStyle = BIOMES[S.biomeNext].edge; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(4, Y(pts[0]), 4.5, 0, 6.3); c.fill();
    $('grade-read').textContent = `grade ${(S.grade * 100 >= 0 ? '+' : '') + (S.grade * 100).toFixed(1)}%`;
  }
  function drawCurve() {
    const c = $('curve').getContext('2d'), w = 880, h = 170;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(191,194,236,.16)'; c.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((f) => { c.beginPath(); c.moveTo(0, f * h); c.lineTo(w, f * h); c.stroke(); });
    const X = (rpm) => (rpm / 130) * w, Y = (m) => h - 10 - m * (h - 20);
    c.beginPath();
    for (let r = 0; r <= 130; r += 1) { const y = Y(motion01(r)); if (r) c.lineTo(X(r), y); else c.moveTo(X(r), y); }
    c.strokeStyle = BIOMES[S.biomeNext].edge; c.lineWidth = 2.4; c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(X(clamp(S.rpm, 0, 130)), Y(motion01(S.rpm)), 6, 0, 6.3); c.fill();
    c.fillStyle = 'rgba(238,237,251,.7)'; c.font = '19px ui-sans-serif,-apple-system,sans-serif';
    c.fillText(`${Math.round(S.rpm)} rpm → ${(S.zoom * 100).toFixed(2)}% a frame`, 14, 28);
  }

  /* ---- snapshot ---- */
  let wantSnap = null;
  function snap(done) { wantSnap = done; }

  /* ---- motion: fixed step, so a replay lands in the same place at any frame rate ---- */
  function targetRpm(h) {
    if (S.replayRpm != null) return S.replayRpm;
    if (S.mode === 'groove') return kit.tempo.bpm ? kit.tempo.bpm / 2 : 0;
    if (S.ble != null) return S.ble;
    if (S.steady != null) return S.steady;
    if (S.pedal) return 88;
    if (S.auto) { S.autoT += h; const t = S.autoT % 40; return t < 12 ? 62 : t < 24 ? 92 : t < 30 ? 108 : 48; }
    return 0;
  }
  let acc = 0, rpmAcc = 0;
  const H = 1 / 120;
  function step() {
    const tau = S.ble != null ? 0.18 : S.mode === 'groove' ? 0.75 : 0.32;
    S.rpm += (targetRpm(H) - S.rpm) * (1 - Math.exp(-H / tau));
    if (S.rpm < 0.3) S.rpm = Math.max(0, S.rpm - H * 8);
    const m = motion01(S.rpm);
    S.zoom = m * S.map.maxZoom;
    S.grade = gradeAt(S.vis);
    S.speed = m * MAX_SPEED * gradeFactor(S.grade);
    S.surge *= Math.exp(-H / 0.28);
    const surgeV = (RM.matches ? 0.2 : 1) * S.surge * 6;
    S.dist += S.speed * H;                                 // distance counts driven speed only, never the idle drift
    S.vis += (S.speed + surgeV + S.ambient * (1 - m)) * H;
    S.shakeV += -S.shake * 90 * H; S.shakeV *= Math.exp(-H / 0.09); S.shake += S.shakeV * H;
  }

  /* ---- frame ---- */
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.max(320, Math.min(3840, Math.round(cv.clientWidth * dpr))), Hh = Math.max(240, Math.min(2160, Math.round(cv.clientHeight * dpr)));
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    const budget = 1.35e6 * lastScale, asp = W / Hh;
    let h = Math.round(Math.sqrt(budget / asp)), w = Math.round(h * asp);
    if (w > W) { w = W; h = Hh; }
    if (w === rw && h === rh) return;
    rw = w; rh = h;
    [scene, dreamA, dreamB].forEach((T) => T && G.freeTarget(T));
    scene = G.target(rw, rh); dreamA = G.target(rw, rh); dreamB = G.target(rw, rh);
    Post.resize(rw, rh, 5);
  }

  let last = performance.now(), slow = 0, fast = 0, fails = 0;
  function render(now) {
    requestAnimationFrame(render);
    try {
      const dtMs = Math.min(100, now - last);
      last = now;
      kit.tick(now);
      shell.frame(now);
      if (!G || gl.isContextLost()) return;

      acc += dtMs / 1000;
      let n = 0;
      while (acc >= H && n < 24) { step(); acc -= H; n++; }
      if (n === 24) acc = 0;
      rpmAcc += dtMs;
      if (rpmAcc > 100) { rpmAcc = 0; kit.noteLane('rpm', +S.rpm.toFixed(1)); }
      if (S.biomeT < 1) S.biomeT = Math.min(1, S.biomeT + dtMs / 6000);
      S.dusk = S.duskHold != null ? S.dusk + (S.duskHold - S.dusk) * Math.min(1, dtMs / 900) : RM.matches ? S.dusk : 0.5 - 0.5 * Math.cos((now / 1000 / 240 + 0.14) * Math.PI * 2);

      // Adapt the render size to the machine. The readings never depend on this.
      if (dtMs > 26) slow++; else if (dtMs < 12) fast++;
      if (++frameIdx % 90 === 0) {
        if (slow > 30 && lastScale > 0.35) { lastScale *= 0.75; resize(); } else if (fast > 80 && lastScale < 1.9) { lastScale *= 1.2; resize(); }
        slow = 0; fast = 0;
      }

      /* uniforms */
      const a = BIOMES[S.biome], b = BIOMES[S.biomeNext], t = S.biomeT * S.biomeT * (3 - 2 * S.biomeT);
      const mix3 = (k) => a.c[k].map((v, i) => lerp(v, b.c[k][i], t));
      const mixN = (k) => lerp(a[k], b[k], t);
      // Night is a real night: the sky goes dark, the sun becomes a pale moon, and the road's lights carry the scene.
      const dusk = S.dusk, night = dusk * dusk;
      const skyTop = mix3('skyTop').map((v, i) => lerp(v, [0.004, 0.006, 0.024][i], dusk * 0.94));
      const skyHz = mix3('skyHz').map((v, i) => lerp(v, [0.1, 0.045, 0.11][i], dusk * 0.92));
      const fogC = mix3('fog').map((v) => v * (1 - dusk * 0.86));
      const sunC = mix3('sun').map((v, i) => lerp(v, [0.26, 0.29, 0.44][i], night * 0.96));
      const sunEl = Math.max(0.035, mixN('sunEl') * (1 - dusk * 0.7));
      const sunAz = mixN('sunAz');

      // Camera on the road, looking ahead along it, always facing the low sun.
      const z = S.vis, cx = pathX(z), cy = roadY(z) + 1.55, look = 26;
      const tx = pathX(z + look), ty = roadY(z + look) + 1.0;
      let fx = tx - cx, fy = ty - cy, fz = look;
      const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
      const curveRoll = RM.matches ? 0 : clamp((pathX(z + 12) - 2 * pathX(z + 6) + cx) * 0.012, -0.07, 0.07);
      S.roll += (curveRoll + S.shake * 0.02 - S.roll) * Math.min(1, dtMs / 200);
      let rx = fz, ry = 0, rz = -fx;
      const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
      let ux = -ry * fz + rz * fy, uy = rx * fz - rz * fx, uz = ry * fx - rx * fy;
      if (uy < 0) { ux = -ux; uy = -uy; uz = -uz; }
      const cr = Math.cos(S.roll), sr = Math.sin(S.roll);
      const right = [rx * cr + ux * sr, ry * cr + uy * sr, rz * cr + uz * sr];
      const up = [ux * cr - rx * sr, uy * cr - ry * sr, uz * cr - rz * sr];
      const camX = cx + S.shake * 0.05, camY = cy + (RM.matches ? 0 : Math.sin(S.vis * 0.9) * 0.018 * motion01(S.rpm));
      const fwd = [fx, fy, fz];
      const sd = (() => { const x = Math.sin(sunAz), z2 = Math.cos(sunAz), y = sunEl, l = Math.hypot(x, y, z2); return [x / l, y / l, z2 / l]; })();
      const focal = 1.08;
      const env = kit.env;

      for (let i = 0; i < 12; i++) {
        const r = rings[rings.length - 1 - i], o = i * 4;
        if (r) { ringData[o] = r.z; ringData[o + 1] = (now - r.t) / 1000; ringData[o + 2] = r.v; ringData[o + 3] = r.k; } else { ringData[o + 2] = 0; }
      }
      for (let i = 0; i < kit.BANDS; i++) {
        // The ridge rises quickly and falls slowly, so the skyline swells with the music rather than flickering.
        const v = kit.spectrum[i], tau = v > ridge[i] ? 0.09 : 0.45;
        ridge[i] += (v - ridge[i]) * (1 - Math.exp(-dtMs / 1000 / tau));
        specBytes[i] = Math.round(ridge[i] * 255);
      }
      G.bindTex(1, tSpec);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, kit.BANDS, 1, gl.RED, gl.UNSIGNED_BYTE, specBytes);

      const beatLen = Math.max(6, (kit.tempo.bpm ? (60 / kit.tempo.bpm) : 0.6) * Math.max(10, S.speed));

      /* scene */
      gl.disable(gl.BLEND);
      G.into(scene);
      G.bindTex(0, tNoise); G.bindTex(1, tSpec);
      G.use(pScene, {
        uN: 0, uS: 1, uRes: [rw, rh], uT: now / 1000, uFocal: focal, uBeat: beatLen, uSeed: S.seed,
        uCam: [camX, camY, z], uRight: right, uUp: up, uFwd: fwd,
        uSkyTop: skyTop, uSkyHz: skyHz, uSunC: sunC, uGround: mix3('ground'), uRock: mix3('rock'), uFog: fogC, uEdge: mix3('edge'), uSunDir: sd,
        uAmp: mixN('amp'), uRidge: mixN('ridge'), uSea: mixN('sea'), uSnow: mixN('snow'), uStrata: mixN('strata'), uGrid: mixN('grid'), uTrees: mixN('trees'), uDusk: S.dusk, uFogK: mixN('fogK'),
        uKick: env.kick, uSnare: env.snare, uHat: env.hat, uHatOpen: env.hatOpen, uTom: env.tom, uTomPos: env.tomPos, uCrash: env.crash, uRide: env.ride,
        uRing: ringData,
      });
      G.draw();

      /* motes */
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      G.use(pMote, { uCam: [camX, camY, z], uRight: right, uUp: up, uFwd: fwd, uFocal: focal, uAsp: rw / rh, uZ: z, uPx: rh * 0.09, uSeed: S.seed, uHat: env.hat, uRide: env.ride, uHatOpen: env.hatOpen, uSpeedN: motion01(S.rpm), uEdge: mix3('edge') });
      gl.drawArrays(gl.POINTS, 0, 1500);
      gl.disable(gl.BLEND);

      /* feedback */
      const asp = rw / rh;
      const vpP = [pathX(z + 90) - camX, roadY(z + 90) + 1 - camY, 90];
      const cz = vpP[0] * fwd[0] + vpP[1] * fwd[1] + vpP[2] * fwd[2];
      const vp = [0.5 + ((vpP[0] * right[0] + vpP[1] * right[1] + vpP[2] * right[2]) * focal) / cz / asp / 2, 0.5 + ((vpP[0] * up[0] + vpP[1] * up[1] + vpP[2] * up[2]) * focal) / cz / 2];
      const fpsScale = dtMs / 16.67;
      const zoomNow = RM.matches ? S.zoom * 0.4 : 1 - Math.pow(1 - (S.zoom + S.surge * 0.003 + 0.0012), fpsScale);
      G.into(dreamB);
      G.bindTex(0, scene.tex); G.bindTex(1, dreamA.tex);
      G.use(pDream, { uScene: 0, uPrev: 1, uVP: vp, uZoom: zoomNow, uDream: RM.matches ? S.dream * 0.5 : S.dream + env.crash * 0.25 * (1 - S.dream), uWild: S.wild + env.snare * 0.5, uT: now / 1000, uKick: env.kick });
      G.draw();
      const tmp = dreamA; dreamA = dreamB; dreamB = tmp;

      /* bloom and grade */
      const bloom = Post.bloom(dreamA.tex, 1.15);
      Post.finish(dreamA.tex, bloom, {
        uBloomK: 0.55 + env.kick * 0.08 + env.crash * 0.15, uExposure: 0.98 + env.kick * 0.03 + env.snare * 0.02 + S.dusk * 0.25,
        uFlash: RM.matches ? 0 : Math.min(0.14, env.flash * 0.14), uFlashC: [1, 0.93, 0.82], uGrain: 0.022, uT: now / 1000, uVig: 0.55, uSat: 1.06, rate: RM.matches ? 0.16 : 0.36,
      }, dtMs / 1000);

      if (lumaRec) lumaRec(now);
      if (wantSnap) { const done = wantSnap; wantSnap = null; cv.toBlob((blob) => done(blob), 'image/png'); }

      /* readouts */
      if (frameIdx % 6 === 0) {
        $('g-speed').textContent = ((S.speed * 3600) / M_PER_MI).toFixed(1);
        $('g-dist').textContent = (S.dist / M_PER_MI).toFixed(2);
        const heroVal = S.mode === 'ride' ? (S.rpm > 0.5 ? Math.round(S.rpm) : '--') : (kit.tempo.bpm ? Math.round(kit.tempo.bpm) : '--');
        $('g-hero').textContent = heroVal;
        if ($('route-sheet').open) { drawElStrip(); drawCurve(); }
      }
    } catch (e) {
      if (fails++ < 3) console.error(e);
    }
  }

  /* ---- boot ---- */
  if (!G) {
    shell.glFail('This page draws with WebGL2, which this browser did not provide. The inputs below still report their state.');
    const idle = (now) => { requestAnimationFrame(idle); kit.tick(now); shell.frame(now); };
    requestAnimationFrame(idle);
  } else {
    gl = G.gl;
    try {
      Post = createPost(G);
      pScene = G.program(SCENE_FS);
      pDream = G.program(DREAM_FS);
      pMote = G.program(MOTE_FS, MOTE_VS);
      tNoise = G.noiseTexture(20261102);
      tSpec = G.tex(kit.BANDS, 1, { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
      resize();
      addEventListener('resize', resize);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); shell.glFail('The graphics context was lost. Reload the page to get the picture back.'); });
      updateModeUi();
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

  /* for the checks: read what is really on the canvas and in the engine */
  window.__app = {
    S, kit, BIOMES, pathX, roadY, gradeAt, motion01, recordLuma,
    pixel() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const g = c.getContext('2d');
      return new Promise((res) => { wantSnap = (blob) => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let sum = 0, min = 1e9, max = 0; const grid = []; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; sum += l; min = Math.min(min, l); max = Math.max(max, l); grid.push(l); } res({ mean: sum / (d.length / 4), min, max, grid }); }; im.src = URL.createObjectURL(blob); }; });
    },
  };
})();
