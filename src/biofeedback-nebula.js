/* biofeedback-nebula.js: Biofeedback Nebula.
   Combines Nebula's 65k-262k 3D particle/fluid/gas/Form engine with Biofeedback Path Cockpit's
   heart-rate, HRV (RMSSD/SDNN), Autonomic Telemetry multivariate-1 inferred arousal index,
   paced-breathing resonance training, and optional Muse S / Athena EEG brainwave game control.
   Every physiological state reading is inferred or a declared game proxy, never a medical measurement. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD } = GLKit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const CLARITY_TARGET = 0.6, SET_SECONDS = 60, LOAD_MAX = 0.045;

  const S = {
    mode: 'watch', shape: 0, shapeT: 0, vortexT: 0, shellT: 0, formT: 0, morph: 0, perform: false, performT: 0,
    driver: 'drums', formDriver: 'manual',
    picPreset: 'sunset', sndPreset: 'chord', palette: 0, demoStyle: 'pocket',
    yaw: 0.5, pitch: 1.02, dist: 3.25, autoRot: true, reaction: 1, glow: 1, trails: 0.8,
    tier: 256, fps: 60,
    load: 0, bioLoad: 0, clarity: 0, dawn: 0, holdT: 0, complete: false, pulse: 0,
    eegDrive: 0, fnirsDrive: 0, stillDrive: 0, eegScore: null, eegRatio: null, eegValid: false, eegSimulated: false, eegBusy: false,
    orbitA: 0,
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
uniform sampler2D uPos,uVel,uSeed,uHist,uFluid,uN,uHomeA,uHomeB,uHrHist;
uniform float uDt,uT,uHistX,uRiver,uVortex,uShell,uForm,uMorph,uLoud;
uniform float uKick,uSnare,uHat,uHatOpen,uTom,uTomPos,uCrash,uBlow;
uniform float uTrain,uClarity,uBreath,uBioLoad,uEegDrive,uFnirs,uStillness,uPulse,uUseBioHist;
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
    vec3 vtx=vec3(cos(th)*1.52,sin(th*3.)*.24,sin(th)*1.52);
    vec3 shl=vec3(cos(th)*1.38,sin(th*4.)*.32,sin(th)*1.38);
    home=mix(mix(mix(home,vec3(cos(th)*1.72,sin(th)*1.02,(s.x-.5)*.06),uRiver),vtx,uVortex),shl,uShell);
    k=7.;
  }else if(dust){
    float th=s.z*TAU*3.+a*5.;
    float r=.15+1.6*sqrt(a);
    vec3 g=vec3(cos(th)*r,(b-.5)*(.1+.46*a),sin(th)*r);
    vec3 riv=vec3((a-.5)*3.6,(b-.5)*1.9,(s.z-.5)*1.1);
    vec3 vtx=vec3(cos(th)*r,(b-.5)*.85,sin(th)*r);
    float dph=acos(clamp(1.-2.*b,-.99,.99));
    vec3 shl=vec3(sin(dph)*cos(th),cos(dph),sin(dph)*sin(th))*(.35+1.35*sqrt(a));
    home=mix(mix(mix(g,riv,uRiver),vtx,uVortex),shl,uShell);
    k=.9;
  }else{
    float w=.004+a*.05,tx=uHistX-a*.985;
    float drumAmp=(texture(uHist,vec2(tx,b)).r+texture(uHist,vec2(tx-w,b)).r+texture(uHist,vec2(tx+w,b)).r+texture(uHist,vec2(tx-w*2.,b)).r+texture(uHist,vec2(tx+w*2.,b)).r)*.2;
    float hrAmp=texture(uHrHist,vec2(a,.5)).r*(.35+.65*exp(-pow((b-.45)*3.2,2.)));
    float fnirsWave=uFnirs*.26*(.5+.5*sin(a*TAU*1.5-uT*1.1));
    amp=mix(drumAmp,max(drumAmp,hrAmp),uUseBioHist)+uEegDrive*.38*(.5+.5*sin(a*TAU*2.-uT*2.4))+fnirsWave;
    float th=a*2.3*TAU+(s.w<.42?0.:3.14159)+uEegDrive*uT*.45;
    float r=.07+1.28*pow(a,.74)*(1.+uBioLoad*.12+uFnirs*.08*sin(uT*.9-a*4.));
    float width=(.045+.2*a)*(1.-uEegDrive*.35);
    float off=(b-.5)*2.*width+(s.z-.5)*.05*(1.+a*3.);
    vec3 g=vec3(cos(th)*(r+off),(s.z-.5)*(.025+.12*a),sin(th)*(r+off));
    g.y+=amp*.3*(1.-a*.4)*(s.z>.5?1.:-1.);
    vec3 riv=vec3(mix(1.72,-1.72,a),(b-.5)*1.72,(s.z-.5)*(.05+.42*a)+amp*.42);
    float phi=a*1.75*TAU+uT*(.05+uEegDrive*.18), psi=(b-.5)*TAU+a*TAU*3.5;
    float rTube=.18+.22*a+amp*.24, rMaj=1.08+rTube*cos(psi);
    vec3 vtx=vec3(cos(phi)*rMaj,rTube*sin(psi)+(s.z-.5)*.06,sin(phi)*rMaj);
    float shPhi=acos(clamp(1.-2.*b,-.98,.98)), shTh=a*3.*TAU+s.z*TAU*.35+uT*(.06+uEegDrive*.12);
    float cym=sin(4.*shPhi)*cos(3.*shTh)+.55*cos(6.*shPhi)*sin(4.*shTh);
    float shR=(.48+.72*pow(a,.65))*(1.+.16*cym)+amp*.32;
    vec3 shl=vec3(sin(shPhi)*cos(shTh),cos(shPhi)+.14*cym,sin(shPhi)*sin(shTh))*shR;
    home=mix(mix(mix(g,riv,uRiver),vtx,uVortex),shl,uShell);
    k=mix(11.,1.9,a)*(1.+uEegDrive*.55+uStillness*.25);
  }
  if(uTrain>.001){
    // In Train mode, breathing clarity gathers turbulent particles into a coherent harmonic ring that breathes with the pacer.
    float breathR=mix(.62,1.26,uBreath);
    float th=s.z*TAU+a*TAU*2.+uT*.14;
    float tube=mix(.48,.055,uClarity)*(.4+a*.8);
    float psi=(b-.5)*TAU+s.w*TAU;
    vec3 ringHome=vec3(cos(th)*(breathR+tube*cos(psi)),tube*sin(psi)+(s.z-.5)*mix(.35,.03,uClarity),sin(th)*(breathR+tube*cos(psi)));
    home=mix(home,ringHome,uTrain*(.35+.65*uClarity));
    k=mix(k,2.5+7.5*uClarity,uTrain);
    amp=mix(amp,.22+.55*uClarity,uTrain);
  }
  if(uForm>.001){
    vec3 form=mix(texture(uHomeA,vUv).xyz,texture(uHomeB,vUv).xyz,uMorph);
    home=mix(home,form,uForm);
    k=mix(k,7.,uForm);
    amp=mix(amp,.42,uForm);
  }
  vec3 f=(home-p)*k;
  float turb=(1.-uForm*.6)*(1.-uTrain*uClarity*.78)*(1.-uEegDrive*.55)*(1.-uStillness*.35)*(1.+uBioLoad*.45);
  vec2 c=curl(p.xz*1.25+vec2(uT*.035,5.))*(.24+a*.85)*(dust?1.8:1.)*turb;
  f.xz+=c;
  f.y+=(vn(p.xz*1.6+uT*.06)-.5)*(.25+a*.45)*turb;
  vec2 fp=mix(p.xz,p.xy,uRiver);
  vec2 fv=texture(uFluid,fp*.25+.5).xy;
  if(uRiver>.5)f.xy+=fv*5.; else f.xz+=fv*5.;
  vec3 nrm=normalize(p+vec3(1e-4,2e-4,1e-4));
  f+=nrm*(uKick*(1.-b)*(1.-b)*6.5+uPulse*3.2*(1.-a*.6))*uBlow;
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
uniform float uPxK,uI,uHistX,uForm,uMorph,uT,uLoud,uKick,uHat,uHatOpen,uRide,uCrash,uPalette;
uniform float uBioLoad,uClarity,uDawn,uEegDrive,uFnirs,uPulse,uTrain;
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
  float hue=fract(.66*b - uBioLoad*.14 + uEegDrive*.08 - uFnirs*.06);
  vec3 law=hsl(hue,.42+.5*max(ton,max(uEegDrive,uFnirs)*.7),.42+.34*amp);
  if(uPalette>.5&&uPalette<1.5)law=hsl(fract(.02+.14*b-uBioLoad*.06),.78+.2*ton,.38+.42*amp);
  else if(uPalette>=1.5&&uPalette<2.5)law=hsl(fract(.36+.22*b+uEegDrive*.06),.72+.25*ton,.38+.4*amp);
  else if(uPalette>=2.5&&uPalette<3.5)law=hsl(fract(.82+.32*b),.85,.44+.36*amp);
  else if(uPalette>=3.5)law=vec3(.46+.44*amp)*mix(vec3(.88,.91,1.),vec3(1.,.96,.9),b);
  if(uFnirs>.01) law=mix(law,vec3(.96,.38,.58),uFnirs*.28*(1.-a*.5));
  if(uTrain>.001){
    vec3 calmCol=mix(vec3(.38,.78,.86),vec3(1.,.82,.52),uDawn);
    law=mix(law,calmCol,uTrain*(.35+.5*uClarity));
  }
  float val=dust?(.085+max(uLoud,uBioLoad*.5)*.12):(.06+pow(amp,1.45)*2.3);
  val*=1.-a*.42;
  if(ring){law=mix(vec3(.82,.84,1.),vec3(1.,.78,.62),uBioLoad);val=.34+.5*max(uLoud,uBioLoad*.6);}
  if(dust)law=mix(vec3(.55,.5,.95),hsl(fract(hue+.62),.58,.6),.55);
  if(b>.62&&!dust)val*=1.+uHat*(.4+.4*uHatOpen)*(.3+.9*abs(sin(s.w*6283.+uT*34.)));
  val*=1.+.25*uRide*(.5+.5*sin(uT*16.+s.w*900.));
  val*=1.+.2*(uKick+uPulse*.85)*(1.-b);
  val*=1.+.1*uCrash + .28*uDawn;
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
void main(){vec2 q=gl_PointCoord-.5;float d2=dot(q,q);float g=exp(-d2*14.)+.18*exp(-d2*3.8);o=vec4(vC*g,1.);}`;

  const TRAIL_FS = FS_HEAD + `
uniform sampler2D uPts,uPrev;uniform float uFade,uT;uniform vec2 uC;
void main(){
  vec2 c=vUv-uC;float a=.0018;float ca=cos(a),sa=sin(a);
  vec2 uv=uC+mat2(ca,-sa,sa,ca)*c*.9985;
  o=vec4(min(texture(uPrev,uv).rgb*uFade+texture(uPts,vUv).rgb,vec3(30.)),1.);
}`;

  const GAS_FS = FS_HEAD + `
uniform sampler2D uN,uTrail;uniform vec2 uRes,uC;uniform float uRiverGas,uT,uTilt,uScale,uLow,uMid,uHigh,uLoud,uKick,uSnare,uHat,uHatOpen,uRide,uCrash,uForm,uYaw,uPalette;
uniform float uBioLoad,uClarity,uDawn,uEegDrive,uFnirs,uPulse,uHaze;
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
  vec2 q=d*(1.55-uBioLoad*.32);
  vec2 w=vec2(fbm(q+vec2(uT*.018,3.1)),fbm(q+vec2(7.3,-uT*.015)));
  float n1=fbm(q*1.05+w*2.2+vec2(0.,uT*.012));
  float n2=fbm(q*2.2-w*1.6+vec2(uT*.02,4.));
  float fall=exp(-r*r*(1.3-uBioLoad*.42));
  float dens=smoothstep(.34,.84,n1)*fall*(1.-uRiverGas*.45);
  float dens2=smoothstep(.4,.9,n2)*fall;
  vec3 warm=mix(vec3(.60,.18,.27),vec3(.88,.34,.22),max(uBioLoad,uFnirs*.7));
  vec3 violet=mix(vec3(.27,.20,.72),vec3(.52,.22,.68),uBioLoad);
  vec3 teal=mix(vec3(.10,.46,.44),vec3(.18,.68,.64),max(uClarity,uEegDrive));
  if(uPalette>.5&&uPalette<1.5){warm=vec3(.82,.32,.10);violet=vec3(.62,.18,.12);teal=vec3(.88,.62,.18);}
  else if(uPalette>=1.5&&uPalette<2.5){warm=vec3(.08,.52,.38);violet=vec3(.08,.28,.58);teal=vec3(.18,.78,.58);}
  else if(uPalette>=2.5&&uPalette<3.5){warm=vec3(.82,.12,.56);violet=vec3(.36,.12,.78);teal=vec3(.08,.68,.82);}
  else if(uPalette>=3.5){warm=vec3(.38,.40,.46);violet=vec3(.28,.32,.40);teal=vec3(.34,.38,.44);}
  vec3 nirGlow=vec3(.92,.28,.54)*uFnirs*exp(-r*r*1.35)*(.45+.55*n2);
  vec3 dawnCol=vec3(.95,.62,.34)*uDawn*exp(-r*r*1.1);
  vec3 g=violet*dens*(.5+.85*uMid+.3*uLoud+.45*uBioLoad);
  g+=warm*dens2*(.26+1.05*uLow+.1*uKick+.65*uBioLoad+.22*uPulse+.35*uFnirs);
  g+=teal*smoothstep(.42,.95,fbm(q*1.5+w*3.+9.))*fall*(.3+1.1*uHigh+.1*uHat+.55*uEegDrive+.45*uClarity);
  g+=nirGlow + dawnCol*(.55+.45*n1);
  g*=(1.+uCrash*.25+uSnare*.05)*(1.-uForm*.93)*(1.-uRiverGas*.62);
  vec3 sky=vec3(.0065,.0085,.021)+vec3(.012,.012,.03)*exp(-r*r*.5)+vec3(.06,.07,.12)*uHaze*exp(-r*r*.8);
  vec2 sp=vUv*asp*170.;vec2 id=floor(sp);vec2 f=fract(sp)-.5;
  float h=h13(vec3(id,1.));
  float st=0.;
  if(h>.982){float b=(h-.982)/.018;st=b*b*exp(-dot(f,f)*34.)*(.45+.35*sin(uT*(1.5+h*5.)+h*700.)+uRide*1.1*sin(uT*18.+h*333.)+uHat*(1.3+uHatOpen));}
  o=vec4(sky+g+vec3(.82,.86,1.)*max(st,0.)*.75*(1.-uHaze*.6)+texture(uTrail,vUv).rgb,1.);
}`;

  const ORBIT_VS = `#version 300 es
precision highp float;
uniform vec2 uC; uniform float uR,uAsp,uT,uA,uPx,uSquash;
out float vA;
float h(float n){return fract(sin(n)*43758.5453);}
void main(){
  float i=float(gl_VertexID);
  float a=h(i*1.13)*6.28318+uT*.012*(.5+h(i*3.1));
  float band=h(i*5.7);
  float rr=uR*(1.+(band-.5)*(.05+.06*h(i*7.1)));
  vec2 p=vec2(cos(a),sin(a)*uSquash)*rr;
  float c=cos(.42),s=sin(.42);
  p=vec2(p.x*c-p.y*s,p.x*s+p.y*c);
  gl_Position=vec4(uC.x+p.x/uAsp,uC.y+p.y,0.,1.);
  float tw=.55+.45*sin(uT*(.6+h(i*9.)*1.4)+i);
  float clump=pow(.5+.5*sin(a*5.+h(i)*.8+1.),2.);
  vA=uA*tw*(.25+.75*clump);
  gl_PointSize=uPx*(.7+h(i*2.3)*1.2);
}`;
  const ORBIT_FS = FS_HEAD.replace('in vec2 vUv;\n', '') + `
in float vA;
void main(){ vec2 q=gl_PointCoord-.5; float g=smoothstep(.5,.12,length(q)); o=vec4(vec3(.93,.92,1.)*g*vA,1.); }`;

  const ADVECT_FS = FS_HEAD + `uniform sampler2D uV;uniform float uDt,uDiss;void main(){vec2 v=texture(uV,vUv).xy;o=vec4(texture(uV,vUv-v*uDt*.25).xy*uDiss,0.,1.);}`;
  const SPLAT_FS = FS_HEAD + `uniform sampler2D uV;uniform vec4 uA[8];uniform vec4 uB[8];uniform int uN;
void main(){vec2 v=texture(uV,vUv).xy;vec2 p=(vUv-.5)*4.;for(int i=0;i<uN;i++){vec2 d=p-uA[i].xy;float g=exp(-dot(d,d)/uA[i].w)*uA[i].z;vec2 dir=uB[i].z>.5?normalize(d+vec2(1e-3)):uB[i].xy;v+=dir*g;}o=vec4(v,0.,1.);}`;
  const DIV_FS = FS_HEAD + `uniform sampler2D uV;uniform vec2 uPx;void main(){float l=texture(uV,vUv-vec2(uPx.x,0.)).x,r=texture(uV,vUv+vec2(uPx.x,0.)).x,b=texture(uV,vUv-vec2(0.,uPx.y)).y,t=texture(uV,vUv+vec2(0.,uPx.y)).y;o=vec4(.5*(r-l+t-b),0.,0.,1.);}`;
  const JAC_FS = FS_HEAD + `uniform sampler2D uP,uD;uniform vec2 uPx;void main(){float l=texture(uP,vUv-vec2(uPx.x,0.)).x,r=texture(uP,vUv+vec2(uPx.x,0.)).x,b=texture(uP,vUv-vec2(0.,uPx.y)).x,t=texture(uP,vUv+vec2(0.,uPx.y)).x;o=vec4((l+r+b+t-texture(uD,vUv).x)*.25,0.,0.,1.);}`;
  const GRAD_FS = FS_HEAD + `uniform sampler2D uP,uV;uniform vec2 uPx;void main(){float l=texture(uP,vUv-vec2(uPx.x,0.)).x,r=texture(uP,vUv+vec2(uPx.x,0.)).x,b=texture(uP,vUv-vec2(0.,uPx.y)).x,t=texture(uP,vUv+vec2(0.,uPx.y)).x;o=vec4(texture(uV,vUv).xy-.5*vec2(r-l,t-b),0.,1.);}`;

  /* ---- UI & Sheets ---- */
  const hud = `
    <div class="hud-set" data-for="watch">
      <div class="gauge"><span class="k">Heart rate <span class="ep ep-measured" id="ep-hr">Sensor</span></span><span class="v"><span id="w-hr">--</span><small>bpm</small></span></div>
      <div class="gauge hero"><span class="k">Index <span class="ep ep-inferred">Inferred</span></span><span class="v" id="w-idx">--</span></div>
      <div class="gauge"><span class="k">RMSSD</span><span class="v"><span id="w-rmssd">--</span><small>ms</small></span></div>
      <div class="gauge"><span class="k">Trend</span><span class="v word" id="w-trend">--</span></div>
    </div>
    <div class="hud-set" data-for="field" hidden>
      <div class="gauge"><span class="k" id="f-k1">Hits</span><span class="v" id="g-hits">0</span></div>
      <div class="gauge hero"><span class="k"><span id="f-hero-label">Tempo</span> <span class="ep ep-measured" id="f-hero-ep">Kit</span></span><span class="v" id="g-hero">--</span></div>
      <div class="gauge"><span class="k" id="f-k3">Level</span><span class="v" id="g-level">--</span></div>
      <div class="gauge"><span class="k"><span id="f-load-label">Field load</span> <span class="ep ep-inferred" id="f-load-ep">Inferred</span></span><span class="v"><span id="g-load">--</span><small id="g-load-u">%</small></span></div>
    </div>
    <div class="hud-set" data-for="train" hidden>
      <div class="train-panel">
        <div class="tp-row"><span class="k">Clarity <span class="ep ep-proxy">Proxy</span></span><b id="t-clarity">--</b><span class="tp-hold" id="t-hold">0:00 of 1:00</span></div>
        <div class="tp-bar"><i id="t-bar"></i><u></u></div>
        <div class="tp-row tp-controls">
          <label class="tp-pace"><span>Pace</span><input type="range" id="pace" min="4.5" max="7" step="0.5" value="6" aria-label="Breaths a minute"><b id="pace-v">6.0</b><span>a minute</span></label>
          <button class="pill" id="pace-toggle">Pause</button>
          <button class="pill" id="set-again" hidden>Another set</button>
        </div>
      </div>
    </div>
    <div class="hud-set" data-for="form" hidden>
      <div class="gauge"><span class="k">Picture</span><span class="v word" id="fm-pic">sunset</span></div>
      <div class="gauge hero"><span class="k">Morph <span class="ep ep-proc" id="fm-ep">Manual</span></span><span class="v" id="fm-pct">0%</span></div>
      <div class="gauge"><span class="k">Sound</span><span class="v word" id="fm-snd">chord</span></div>
    </div>`;

  const stageBar = `
    <div id="stage-field-bar" class="row-actions" style="margin:0;align-items:center">
      <button class="pill on" data-shape="0">Galaxy</button>
      <button class="pill" data-shape="1">River</button>
      <button class="pill" data-shape="2">Vortex</button>
      <button class="pill" data-shape="3">Shell</button>
      <span class="stage-sep" id="stage-driver-sep" hidden></span>
      <span class="stage-sub" id="stage-driver-label" hidden>Driver</span>
      <button class="pill on" data-driver="drums" id="drv-drums" hidden>Drums</button>
      <button class="pill" data-driver="brainwaves" id="drv-eeg" hidden>Brainwaves</button>
      <button class="pill" data-driver="heart" id="drv-heart" hidden>Heart</button>
      <span class="stage-sep" id="stage-athena-sep" hidden></span>
      <span id="stage-athena-row" hidden style="display:inline-flex;align-items:center;gap:4px">
        <button class="pill on" data-athena="eeg" title="EEG alpha/beta balance">EEG</button>
        <button class="pill" data-athena="fnirs" title="fNIRS slow forehead optical density (&lt;0.18 Hz)">fNIRS</button>
        <button class="pill" data-athena="prv" title="Forehead optical pulse-rate variability (RMSSD)">PRV</button>
        <button class="pill" data-athena="stillness" title="3-axis IMU accelerometer head stillness">Stillness</button>
        <button class="pill" data-athena="fusion" title="4-sensor Muse S Athena fusion">Fusion</button>
      </span>
    </div>
    <div id="stage-form-bar" class="row-actions" style="margin:0;align-items:center" hidden>
      <label class="stage-slider"><span>Picture → Sound</span><input type="range" id="stage-morph" min="0" max="100" value="0" aria-label="Picture to sound morph"><b id="stage-morph-v">0%</b></label>
      <button class="pill" id="stage-perform">Sweep: off</button>
      <button class="pill" id="stage-form-bio" title="Let Muse S / Athena sensors or breathing clarity drive the Picture to Sound morph">Bio morph: off</button>
      <button class="pill" id="stage-hear">Hear cloud</button>
    </div>`;

  const connectHtml = `
    <div class="device-card">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="ic"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/><path d="M6.5 12.5h3l1.5-2.5 2 4 1.2-1.5h3.3"/></svg>
      <div class="device-info" id="hr-info" data-tone="idle">
        <strong>Heart-rate sensor <span class="dot"></span></strong>
        <p class="state" id="hr-state">Not connected</p>
        <p class="why" id="hr-why">Press Connect, then choose your Bluetooth heart-rate strap or armband.</p>
      </div>
      <button class="pill" id="hr-connect">Connect</button>
    </div>
    <div class="controls-grid">
      <button class="pill quiet-pill" id="hume-connect">Hume Band instead, experimental</button>
    </div>

    <section class="eeg-connect" aria-labelledby="eeg-title">
      <div class="device-info" id="eeg-info" data-tone="idle"><strong id="eeg-title">Muse S / Athena brainwaves &amp; optical <span class="dot"></span></strong>
        <p class="state" id="eeg-state">Not connected</p><p class="why" id="eeg-why"></p></div>
      <p class="note">Calibrated headband automation. Choose EEG balance (8–12 Hz α / 13–30 Hz β), fNIRS slow optical density (&lt;0.18 Hz), forehead optical PRV, 3-axis IMU stillness, or 4-sensor fusion to drive Field spiral coherence and Form cloud morphing.</p>
      <div class="field" style="margin-top:8px"><span>Headband automation source</span>
        <div class="row-actions" id="athena-sensor-row" role="group" aria-label="Headband automation source" style="margin-top:4px">
          <button class="pill on" data-athena="eeg" aria-pressed="true">EEG balance</button>
          <button class="pill" data-athena="fnirs" aria-pressed="false">fNIRS optical</button>
          <button class="pill" data-athena="prv" aria-pressed="false">Optical PRV</button>
          <button class="pill" data-athena="stillness" aria-pressed="false">Head stillness</button>
          <button class="pill" data-athena="fusion" aria-pressed="false">4-sensor fusion</button>
        </div>
      </div>
      <div class="statgrid" id="athena-grid" style="margin-top:10px">
        <div class="stat"><span class="k">EEG β/α</span><span class="v" id="ath-eeg">-</span><span class="n" id="ath-eeg-n">256 Hz · 4 s PSD</span></div>
        <div class="stat"><span class="k">fNIRS ΔOD</span><span class="v" id="ath-fnirs">-</span><span class="n" id="ath-fnirs-n">64 Hz · &lt;0.18 Hz</span></div>
        <div class="stat"><span class="k">Optical PRV</span><span class="v" id="ath-prv">-</span><span class="n" id="ath-prv-n">forehead RMSSD</span></div>
        <div class="stat"><span class="k">IMU stillness</span><span class="v" id="ath-still">-</span><span class="n" id="ath-still-n">52 Hz · 3-axis g</span></div>
      </div>
      <p class="note" id="eeg-setup">A Muse S cannot connect to this page: the Mac relay that reads the headband does not serve it. The synthetic preview runs in Demo.</p>
      <div class="row-actions"><button class="pill" id="eeg-start">Find Muse S</button><button class="pill" id="eeg-scan">Scan again</button><button class="pill" id="eeg-disconnect">Disconnect</button></div>
      <label class="field">Headset<select id="eeg-device"><option value="">No Muse found yet</option></select></label>
      <div class="row-actions"><button class="pill primary" id="eeg-pair">Pair selected headset</button><button class="pill" id="eeg-calibrate">New personal reference</button></div>
      <p class="note" id="eeg-reference">Keep your eyes open and sit still for 20 eligible samples (~20 seconds).</p>
      <progress id="eeg-progress" max="1" value="0" aria-label="EEG personal reference progress"></progress>
      <p class="note" id="eeg-quality" role="status">No usable EEG data yet.</p><p class="note" id="eeg-transport"></p>
    </section>

    <div class="device-card" id="audio-card">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="ic"><path d="M3 12h2l2-5 3 10 3-14 3 14 2-5h3"/></svg>
      <div class="device-info" id="audio-info" data-tone="idle">
        <strong>Audio input (Drums / Mic) <span class="dot"></span></strong>
        <p class="state" id="audio-state">Not connected</p>
        <p class="why" id="audio-why">Optional audio input for live drum/instrument spectrum in Field mode.</p>
      </div>
      <button class="pill" id="audio-connect">Connect</button>
    </div>
    <div class="device-card" id="midi-card">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="ic"><circle cx="12" cy="12" r="9"/><circle cx="8" cy="11" r=".8"/><circle cx="16" cy="11" r=".8"/><circle cx="10" cy="8" r=".8"/><circle cx="14" cy="8" r=".8"/></svg>
      <div class="device-info" id="midi-info" data-tone="idle">
        <strong>MIDI input <span class="dot"></span></strong>
        <p class="state" id="midi-state">Not connected</p>
        <p class="why" id="midi-why">Optional USB-MIDI drum kit or controller (CC1 morphs Form).</p>
      </div>
      <button class="pill" id="midi-connect">Connect</button>
    </div>

    <div class="device-card">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="ic"><path d="M7 5v14l11-7z"/></svg>
      <div class="device-info">
        <strong>No sensor or kit here</strong>
        <p class="why">The demo runs synthetic heart-rate/HRV packets through the real parsers and inference engine, synthetic Muse S Athena (EEG, fNIRS, PRV, Stillness, Fusion) preview when Brainwaves is active, and synthetic drums in Field mode. Everything is labeled on screen.</p>
      </div>
      <button class="pill" id="demo-sheet">Run demo</button>
    </div>
    <label class="check"><input type="checkbox" id="demo-audible"> Let me hear the drum demo in Field mode</label>`;

  const spaceSheet = `
    <div id="field-opts">
      <div class="field"><span>Shape of time</span><div class="row-actions" id="shape-row">
        <button class="pill on" data-shape="0">Galaxy</button><button class="pill" data-shape="1">River</button><button class="pill" data-shape="2">Vortex</button><button class="pill" data-shape="3">Shell</button></div></div>
      <div class="field" style="margin-top:8px"><span>Field driver</span><div class="row-actions" id="driver-row">
        <button class="pill on" data-driver="drums">Drums &amp; Audio</button><button class="pill" data-driver="brainwaves">Brainwaves &amp; fNIRS</button><button class="pill" data-driver="heart">Heart &amp; Breath</button></div></div>
      <div class="field" style="margin-top:8px" id="space-athena-field"><span>Headband sensor mode</span><div class="row-actions">
        <button class="pill on" data-athena="eeg">EEG balance</button><button class="pill" data-athena="fnirs">fNIRS optical</button><button class="pill" data-athena="prv">Optical PRV</button><button class="pill" data-athena="stillness">Head stillness</button><button class="pill" data-athena="fusion">4-sensor fusion</button></div></div>
      <label class="field" style="margin-top:8px">Demo drum groove<select id="demo-style"><option value="pocket">Pocket (3-section)</option><option value="breakbeat">Breakbeat (136 BPM)</option><option value="techno">Techno 4×4 (128 BPM)</option><option value="polymeter">IDM 7/8 (118 BPM)</option></select></label>
      <p class="note">Galaxy winds the last twelve seconds outward from the core. River places now on the right. Vortex wraps time and frequency around a toroidal helix. Shell forms a spherical harmonic Chladni shell.</p>
    </div>
    <div id="form-opts" hidden>
      <div class="controls-grid" style="padding:0 0 6px">
        <label class="field">Built-in picture<select id="form-pic-preset"><option value="sunset">Sunset ridge</option><option value="galaxy">Spiral galaxy</option><option value="lattice">Crystal lattice</option><option value="aurora">Aurora curtains</option><option value="mandala">Sacred mandala</option></select></label>
        <label class="field">Built-in sound<select id="form-snd-preset"><option value="chord">Harmonic chord</option><option value="bells">Bell cascade</option><option value="pulse">Rhythmic pulse</option><option value="arpeggio">Pentatonic arpeggio</option><option value="drone">Subharmonic drone</option></select></label>
      </div>
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
        <button class="pill" id="form-bio">Bio morph: off</button>
        <button class="pill" id="form-hear">Hear this cloud</button>
        <button class="pill" id="form-update" hidden>Update audition</button>
        <button class="pill" id="form-wav">Save audio (.wav)</button>
        <button class="pill" id="form-ply">Save cloud (.ply)</button>
      </div>
      <p class="note">Bio morph lets heart-rate arousal, or the synthetic Muse S / Athena preview (EEG, fNIRS, PRV, stillness, or fusion), move the cloud between picture and sound.</p>
    </div>
    <details id="load-controls" open><summary>Biofeedback thresholds</summary><div class="controls-grid" style="padding:10px 0 0">
      <label class="field"><div class="row"><span>Full field-load at this far above baseline HR</span><b id="full-over-v">+60 bpm</b></div><input type="range" id="full-over" min="20" max="100" step="5" value="60"></label>
      <label class="field"><div class="row"><span>Full clarity at this heart-rate swing</span><b id="full-swing-v">10 bpm</b></div><input type="range" id="full-swing" min="6" max="16" value="10"></label>
      <div class="row-actions"><button class="pill" id="ref-reset">Start a new personal reference</button></div>
    </div></details>
    <details open><summary>Look</summary><div class="controls-grid" style="padding:10px 0 0">
      <label class="field"><div class="row"><span>Reaction to hits &amp; pulse</span><b id="react-v"></b></div><input type="range" id="react" min="0" max="200"></label>
      <label class="field"><div class="row"><span>Trails</span><b id="trail-v"></b></div><input type="range" id="trail" min="0" max="100"></label>
      <label class="field"><div class="row"><span>Glow</span><b id="glow-v"></b></div><input type="range" id="glow" min="0" max="200"></label>
      <label class="field">Color palette<select id="palette"><option value="0">Spectrum (default)</option><option value="1">Solar corona</option><option value="2">Bioluminescent</option><option value="3">Cyberpunk neon</option><option value="4">Monochrome silver</option></select></label>
      <label class="field">Particles<select id="tier"><option value="auto">Automatic</option><option value="128">16,384</option><option value="256">65,536</option><option value="512">262,144</option></select></label>
      <label class="check" style="margin:0"><input type="checkbox" id="auto-rot" checked> Turn slowly</label>
    </div></details>`;

  const bioSignalSheet = `
    <div class="statgrid">
      <div class="stat"><span class="k">Heart rate</span><span class="v" id="bsig-hr">-</span><span class="n" id="bsig-hr-n">no source yet</span></div>
      <div class="stat"><span class="k">RMSSD</span><span class="v" id="bsig-rmssd">-</span><span class="n" id="bsig-rmssd-n">from beat intervals</span></div>
      <div class="stat"><span class="k">SDNN</span><span class="v" id="bsig-sdnn">-</span><span class="n">from beat intervals</span></div>
      <div class="stat"><span class="k">Index</span><span class="v" id="bsig-idx">-</span><span class="n" id="bsig-idx-n">inferred, not measured</span></div>
      <div class="stat"><span class="k">Reference</span><span class="v" id="bsig-ref">-</span><span class="n" id="bsig-ref-n">120 s of quiet data</span></div>
      <div class="stat"><span class="k">Swing at pace</span><span class="v" id="bsig-swing">-</span><span class="n">peak to trough</span></div>
      <div class="stat"><span class="k">Headband control</span><span class="v" id="bsig-eeg">-</span><span class="n" id="bsig-eeg-n">EEG · fNIRS · PRV · IMU</span></div>
      <div class="stat"><span class="k">Particles</span><span class="v" id="bsig-pts">-</span><span class="n" id="bsig-fps">-</span></div>
    </div>
    <div class="sig-title"><span>Heart rate over the last two minutes</span><span id="bsig-hr-range">bpm</span></div>
    <canvas class="sig-canvas" id="sig-trace" width="1400" height="200" role="img" aria-label="Heart rate over the last two minutes"></canvas>
    <div class="sig-title"><span>Beat intervals over the last 32 seconds</span><span>milliseconds</span></div>
    <canvas class="sig-canvas" id="sig-rr" width="1400" height="160" role="img" aria-label="Beat intervals over the last 32 seconds"></canvas>
    <div class="sig-title"><span>Inferred index over the last ten minutes</span><span>tiers at 25, 46 and 68</span></div>
    <canvas class="sig-canvas" id="sig-index" width="1400" height="170" role="img" aria-label="Inferred index over the last ten minutes"></canvas>`;

  const about = `
    <p class="sheet-intro">Every link from your body or instrument to the nebula is a stated rule. Heart rate and drum hits are measured when a sensor reports them; arousal, fNIRS optical density, and EEG clarity are inferred or proxy game controls, never medical measurements.</p>
    <table class="maptable"><tbody>
      <tr><th>Watch (Inferred arousal)</th><td>Autonomic Telemetry's <code>multivariate-1</code> engine scores your shift from a 120-second personal reference. A higher index warms and widens the nebula gas, shifts the core toward crimson-amber, and stirs the curl field. <span class="ep ep-inferred">Inferred</span></td></tr>
      <tr><th>Field · Drums</th><td>The last twelve seconds of drum hits and audio spectrum wind outward along the Galaxy, River, or Vortex arms, while heart rate above baseline adds warm field tension. <span class="ep ep-measured">Measured</span> + <span class="ep ep-inferred">Inferred</span></td></tr>
      <tr><th>Field · Brainwaves &amp; Athena</th><td>Synthetic preview only: a real Muse S cannot connect to this page. Choose EEG α/β balance, fNIRS slow optical density (&lt;0.18 Hz), forehead optical PRV, 3-axis IMU stillness, or 4-sensor fusion. Calibrated 0–100 control calms particle scatter into a coherent spiral while fNIRS optical shifts add deep-infrared aurora warmth. <span class="ep ep-proxy">Proxy</span></td></tr>
      <tr><th>Field · Heart</th><td>Each heartbeat sends a radial wave through the 2D fluid and pulses the core, while your 2-minute heart-rate history winds along the nebula arms. <span class="ep ep-measured">Measured</span></td></tr>
      <tr><th>Train (Swing at pace)</th><td>Follow the breathing ring (4.5–7 breaths/min). Heart-rate swing at the pacer's frequency increases Clarity (0–1), gathering turbulent dust into a coherent harmonic torus. Hold 60 seconds for a supernova dawn bloom. <span class="ep ep-proxy">Proxy</span></td></tr>
      <tr><th>Form (Picture ↔ Sound)</th><td>Matches a 2D image and a sound by 6D sliced optimal transport. Slide manually, sweep slowly, or let breathing clarity or the synthetic Muse S preview morph the cloud live. <span class="ep ep-proc">Optimal transport</span></td></tr>
    </tbody></table>
    <p class="note"><b>Not a medical device.</b> Diagnoses nothing, treats nothing, and all data stays in this browser.</p>`;

  const kit = createKit();
  const bio = createBio();
  const eeg = createEEGDrive();
  const brand = '<svg viewBox="0 0 24 28" aria-hidden="true"><circle cx="12" cy="14" r="2.2"/><path d="M12 14c5-1 7 2 6 5s-7 5-11 1-3-12 3-14 12 2 12 9"/><path d="M4 22h4l1.5-3 2 5 1.5-3h7" stroke-width="1.4"/></svg>';

  const ATHENA_SHORT = { eeg: 'EEG', fnirs: 'fNIRS', prv: 'PRV', stillness: 'Stillness', fusion: 'Fusion' };
  const chips = [
    {
      id: 'hr',
      label: 'Heart rate · not connected',
      read: () => {
        const h = bio.hr;
        if (h.state === 'live') return ['good', `Heart rate · ${h.deviceBpm} bpm`];
        if (h.state === 'no-signal') return ['warn', 'Heart rate · no signal'];
        if (bio.demoOn) return ['idle', 'Heart rate · synthetic demo'];
        return ['idle', `Heart rate · ${h.state === 'unsupported' ? 'not supported' : 'not connected'}`];
      },
    },
    {
      id: 'eeg',
      label: 'EEG · not connected',
      read: () => {
        const q = eeg.state;
        const sm = q.sensorMode || 'eeg';
        const tag = ATHENA_SHORT[sm] || 'EEG';
        const active = (S.mode === 'field' && S.driver === 'brainwaves') || (S.mode === 'form' && S.formDriver === 'bio');
        if (bio.demoOn && active) return ['good', `${tag} · synthetic preview`];
        if (S.eegValid && S.eegScore != null) return ['good', `${tag} · ${S.eegScore}/100`];
        return [q.phase === 'error' ? 'bad' : 'idle', `${tag} · ${q.phase}`];
      },
    },
    {
      id: 'kit',
      label: 'Kit · not connected',
      read: () => {
        if (kit.audio.state === 'live' || kit.midi.state === 'live') return ['good', 'Kit · live signal'];
        if (kit.demoOn) return ['idle', 'Kit · synthetic demo'];
        return ['idle', 'Kit · not connected'];
      },
    },
  ];

  function sourceView() {
    const eegActive = (S.mode === 'field' && S.driver === 'brainwaves') || (S.mode === 'form' && S.formDriver === 'bio');
    const sm = eeg.state.sensorMode || 'eeg';
    const tag = ATHENA_SHORT[sm] || 'EEG';
    if (bio.demoOn || kit.demoOn) {
      if (eegActive) return ['demo', `Demo · synthetic ${tag} & body preview, not your signals`];
      return ['demo', 'Demo · synthetic body signals & drums, not live hardware'];
    }
    if (bio.replayOn || kit.replayOn) return ['replay', 'Replay · recorded session, not live'];
    if (eegActive && S.eegValid) return ['live', `Live · Muse S Athena · ${eeg.state.activeLabel || tag} proxy`];
    if (bio.hr.state === 'live' && (kit.audio.state === 'live' || kit.midi.state === 'live')) return ['live', 'Live · heart-rate sensor + drum kit'];
    if (bio.hr.state === 'live') return ['live', `Live · heart rate from ${bio.hr.label}`];
    if (kit.audio.state === 'live' || kit.midi.state === 'live') return ['live', 'Live · drum kit signal'];
    return ['ambient', 'Ambient · no sensor or kit connected'];
  }

  function toggleDemo() {
    if (bio.demoOn || kit.demoOn) {
      bio.stopDemo();
      if (kit.demoOn) kit.stopDemo();
    } else {
      bio.startDemo();
      kit.startDemo();
    }
  }

  const shell = mountShell({
    id: 'biofeedback-nebula', name: 'Biofeedback Nebula', brand, kit,
    modes: [
      { id: 'watch', label: 'Watch' },
      { id: 'field', label: 'Field' },
      { id: 'train', label: 'Train' },
      { id: 'form', label: 'Form' },
    ],
    mode: 'watch', modeLabel: 'How your signals shape the nebula',
    onMode: (m) => setMode(m),
    onKey: (_e, key) => { if ((S.mode === 'field' || S.mode === 'watch') && (key === '1' || key === '2' || key === '3' || key === '4')) selectShape(+key - 1); },
    intro: {
      eyebrow: 'Biofeedback Nebula · body signals, brainwaves & sound in 3D',
      title: 'The nebula breathes with your signals.',
      subtitle: 'Connect a heart-rate sensor or drum kit, or run the labeled demo. The Muse S modes are a synthetic preview here.',
    },
    stageBar, hud, chips,
    source: sourceView,
    demo: { isOn: () => bio.demoOn || kit.demoOn, toggle: toggleDemo },
    playing: () => bio.demoOn || kit.demoOn || bio.hr.connected || kit.audio.state === 'live' || kit.midi.state === 'live' || S.mode === 'train' || S.mode === 'form',
    connect: {
      title: 'Bring your signals and kit.',
      intro: 'Heart rate shapes the nebula gas and clarity ring. A synthetic preview of the Muse S / Athena modes drives spiral coherence. Audio and MIDI wind the last twelve seconds of playing outward.',
      html: connectHtml,
    },
    truth: 'Inferred arousal and clarity are personal heuristics and game proxies, never medical measurements. All signals stay in this browser.',
    sheets: [
      { id: 'space', label: 'Space', icon: 'sliders', title: 'Shape the nebula.', intro: 'Choose the 3D topology, field driver, optimal-transport clouds, and biofeedback thresholds.', html: spaceSheet },
      { id: 'biosignal', label: 'Body', icon: 'route', title: 'What your body sensors report.', intro: 'Live heart rate, beat intervals, and Autonomic Telemetry multivariate-1 reference state.', html: bioSignalSheet },
    ],
    about, canvas: () => cv, snapshot: (done) => { wantSnap = done; }, quality: () => `${N.toLocaleString()} particles`,
    onStates: updateConnectDom,
  });

  // Inject Watch reading card & Train breathing cue onto #scene
  $('scene').insertAdjacentHTML('beforeend', `
    <div class="reading" id="reading" hidden>
      <p class="eyebrow">Inferred arousal · personal</p>
      <div class="read-num" id="read-num">--</div>
      <p class="read-tier" id="read-tier"></p>
      <div class="read-scale" id="read-scale"><i id="read-dot"></i><u id="read-fill"></u></div>
      <p class="read-sub" id="read-sub"></p>
      <p class="read-sub" id="read-cov"></p>
      <button class="read-more" id="read-more">Experimental · reference and signals ↗</button>
    </div>
    <div class="breath" id="breath" hidden>
      <span class="breath-cue" id="breath-cue">Breathe in</span>
      <span class="breath-note" id="breath-note"></span>
    </div>`);
  $('read-more').addEventListener('click', () => shell.openSheet('biosignal'));
  $('biosignal-button').addEventListener('click', () => { renderBioSignal(); drawBioSignal(); });

  /* ---- Wire Connect sheet ---- */
  $('hr-connect').addEventListener('click', () => (bio.hr.connected ? bio.disconnectHeart() : bio.connectHeart('standard')));
  $('hume-connect').addEventListener('click', () => bio.connectHeart('hume'));
  $('audio-connect').addEventListener('click', () => { const s = kit.audio.state; if (s === 'live' || s === 'no-signal') kit.disconnectAudio(); else kit.connectAudio(); });
  $('midi-connect').addEventListener('click', () => { const s = kit.midi.state; if (s === 'live' || s === 'no-signal') kit.disconnectMidi(); else kit.connectMidi(); });
  $('demo-sheet').addEventListener('click', () => { toggleDemo(); if (bio.demoOn) $('connect-sheet').close(); });
  $('demo-audible').addEventListener('change', (e) => kit.setDemoAudible(e.target.checked));

  async function eegAction(action) {
    if (S.eegBusy) return;
    S.eegBusy = true; updateConnectDom();
    try { await action(); } catch (err) { $('eeg-why').textContent = err.message || 'The EEG connection could not complete.'; }
    finally { S.eegBusy = false; updateConnectDom(); }
  }
  $('eeg-start').addEventListener('click', () => eegAction(() => eeg.start()));
  $('eeg-scan').addEventListener('click', () => eegAction(() => eeg.scan()));
  $('eeg-device').addEventListener('change', updateConnectDom);
  $('eeg-pair').addEventListener('click', () => eegAction(() => eeg.pair($('eeg-device').value)));
  $('eeg-disconnect').addEventListener('click', () => eegAction(() => eeg.disconnect()));
  $('eeg-calibrate').addEventListener('click', () => eegAction(() => eeg.calibrate()));
  $('ref-reset').addEventListener('click', () => { bio.resetReference(); shell.toast('Personal reference restarted.'); });
  document.querySelectorAll('[data-athena]').forEach((b) => b.addEventListener('click', () => {
    eeg.setSensorMode(b.dataset.athena);
    updateConnectDom();
    renderHud();
  }));

  function updateConnectDom() {
    if (!$('hr-state')) return;
    const h = bio.hr;
    $('hr-state').textContent = h.state === 'live' ? `Signal · ${h.deviceBpm} bpm` : h.state === 'no-signal' ? 'Connected · waiting for beats' : 'Not connected';
    $('hr-connect').textContent = h.connected ? 'Disconnect' : 'Connect';
    $('audio-state').textContent = kit.audio.state === 'live' ? `Signal · ${Math.round(kit.audio.peakDb)} dB` : kit.audio.state;
    $('audio-connect').textContent = (kit.audio.state === 'live' || kit.audio.state === 'no-signal') ? 'Disconnect' : 'Connect';
    $('midi-state').textContent = kit.midi.state === 'live' ? `Signal · ${kit.midi.last}` : kit.midi.state;
    $('midi-connect').textContent = (kit.midi.state === 'live' || kit.midi.state === 'no-signal') ? 'Disconnect' : 'Connect';
    $('demo-sheet').textContent = (bio.demoOn || kit.demoOn) ? 'End demo' : 'Run demo';

    const q = eeg.state;
    const sm = q.sensorMode || 'eeg';
    document.querySelectorAll('[data-athena]').forEach((b) => {
      const on = b.dataset.athena === sm;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const sens = q.sensors || {};
    if ($('ath-eeg')) {
      const se = sens.eeg || {};
      $('ath-eeg').textContent = se.valid && se.score != null ? `${se.score}/100` : se.ratio != null ? `${se.ratio.toFixed(2)} β/α` : '-';
      $('ath-eeg-n').textContent = se.ratio != null ? `β/α ${se.ratio.toFixed(2)} · 256 Hz` : '256 Hz · 4 s PSD';
    }
    if ($('ath-fnirs')) {
      const sf = sens.fnirs || {};
      $('ath-fnirs').textContent = sf.valid && sf.score != null ? `${sf.score}/100` : sf.od != null ? `${sf.od >= 0 ? '+' : ''}${sf.od.toFixed(3)} OD` : '-';
      $('ath-fnirs-n').textContent = sf.od != null ? `ΔOD ${sf.od >= 0 ? '+' : ''}${sf.od.toFixed(3)} · <0.18 Hz` : '64 Hz · <0.18 Hz';
    }
    if ($('ath-prv')) {
      const sp = sens.prv || {};
      $('ath-prv').textContent = sp.valid && sp.rmssd != null ? `${Math.round(sp.rmssd)} ms` : sp.valid && sp.score != null ? `${sp.score}/100` : '-';
      $('ath-prv-n').textContent = sp.bpm != null ? `${Math.round(sp.bpm)} bpm · forehead` : 'forehead RMSSD';
    }
    if ($('ath-still')) {
      const ss = sens.stillness || {};
      $('ath-still').textContent = ss.valid && ss.score != null ? `${ss.score}/100` : '-';
      $('ath-still-n').textContent = ss.rms != null ? `${ss.rms.toFixed(3)} g RMS` : '52 Hz · 3-axis g';
    }
    $('eeg-state').textContent = q.deviceName ? `${q.deviceName} · ${q.phase}` : `Muse S · ${q.phase}`;
    $('eeg-why').textContent = q.message || 'A Muse S cannot connect to this page.';
    const activeSensor = sens[sm];
    $('eeg-quality').textContent = (activeSensor && activeSensor.reason) || (q.quality && q.quality.reason) || 'No usable EEG data yet.';
    $('eeg-transport').textContent = `Relay · ${q.transport === true ? 'connected' : q.transport || 'disconnected'}`;
    $('eeg-start').disabled = !q.available || S.eegBusy;
    $('eeg-scan').disabled = !q.available || S.eegBusy;
    $('eeg-pair').disabled = !$('eeg-device').value || S.eegBusy;
    $('eeg-disconnect').disabled = !q.available || q.phase === 'disconnected' || S.eegBusy;
    $('eeg-calibrate').disabled = !q.deviceName || q.simulated || S.eegBusy;
    $('eeg-progress').value = clamp(q.progress || 0, 0, 1);
  }
  bio.on('state', updateConnectDom);

  const cv = $('stage');
  const G = createGL(cv);
  let gl, Post, pSim, pPoint, pTrail, pGas, pOrbit, pAdvect, pSplat, pDiv, pJac, pGrad;
  let tN, tHist, tHrHist, tSeed = null, tHomeA = null, tHomeB = null, tColA = null, tColB = null;
  let simA, simB, N = 0, size = 0;
  let points, trailA, trailB, scene, rw = 0, rh = 0, lastScale = 1;
  let vel, velB, pres, presB, div;
  let wantSnap = null;
  const FV = 160;
  const splats = [];
  const hrBytes = new Uint8Array(64);

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

  function perspective(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
  function lookAt(e, c, u) {
    let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map((v) => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map((v) => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
  }
  function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }

  function addSplat(x, y, fx, fy, strength, radius, radial) { splats.push({ x, y, fx, fy, strength, radius, radial: radial ? 1 : 0 }); if (splats.length > 8) splats.shift(); }
  kit.on('hit', (h) => {
    const v = h.vel * S.reaction * (RM.matches ? 0.35 : 1), th = Math.random() * 6.283;
    if (h.voice === 'kick') addSplat(0, 0, 0, 0, 1.9 * v, 0.34, true);
    else if (h.voice === 'snare') { const r = 0.4 + Math.random() * 0.5; addSplat(Math.cos(th) * r, Math.sin(th) * r, -Math.sin(th), Math.cos(th), 2.0 * v, 0.14); addSplat(-Math.cos(th) * r, -Math.sin(th) * r, Math.sin(th), -Math.cos(th), 1.4 * v, 0.1); }
    else if (h.voice === 'tom') { const r = 0.25 + kit.env.tomPos * 0.8; addSplat(Math.cos(th) * r, Math.sin(th) * r, 0, 0, 1.6 * v, 0.18, true); }
    else if (h.voice === 'crash') { for (let i = 0; i < 3; i++) { const t = th + i * 2.1; addSplat(Math.cos(t) * 0.8, Math.sin(t) * 0.8, -Math.sin(t), Math.cos(t), 1.9 * v, 0.3); } }
    else if (h.voice === 'hat') { const r = 1.1 + Math.random() * 0.5; addSplat(Math.cos(th) * r, Math.sin(th) * r, -Math.sin(th), Math.cos(th), 0.6 * v, 0.03); }
  });
  bio.on('beat', () => {
    if (RM.matches) return;
    S.pulse = 1;
    const strength = (S.mode === 'watch' || (S.mode === 'field' && S.driver === 'heart')) ? 1.45 * S.reaction : 0.65 * S.reaction;
    addSplat(0, 0, 0, 0, strength, 0.32, true);
  });
  kit.on('cc', ({ cc, value }) => { if (cc === 1) setMorph(value / 127); });
  kit.on('column', (x) => {
    if (!G || !tHist) return;
    G.bindTex(0, tHist);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, 0, 1, kit.BANDS, gl.RG, gl.UNSIGNED_BYTE, kit.column);
  });

  /* ---- Form mode clouds & Optimal Transport ---- */
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
  function builtInPicture(kind) {
    const k = kind || S.picPreset || 'sunset';
    const c = document.createElement('canvas'); c.width = 440; c.height = 300; const g = c.getContext('2d');
    if (k === 'galaxy') {
      g.fillStyle = '#070a1c'; g.fillRect(0, 0, 440, 300);
      for (let arm = 0; arm < 2; arm++) {
        for (let i = 0; i < 420; i++) {
          const u = i / 420, th = u * 10.5 + arm * Math.PI, r = 8 + u * 135;
          const x = 220 + Math.cos(th) * r * 1.25, y = 150 + Math.sin(th) * r * 0.82;
          g.fillStyle = `hsla(${Math.round(280 - u * 160)}, 85%, ${Math.round(82 - u * 38)}%, ${0.85 - u * 0.45})`;
          g.beginPath(); g.arc(x, y, 2.2 + (1 - u) * 5.5, 0, 7); g.fill();
        }
      }
      return c;
    }
    if (k === 'lattice') {
      g.fillStyle = '#090e22'; g.fillRect(0, 0, 440, 300);
      for (let y = 24; y < 280; y += 28) {
        for (let x = 28; x < 420; x += 28) {
          const dx = (x - 220) / 200, dy = (y - 150) / 140, d = Math.hypot(dx, dy);
          const hue = Math.round(180 + 140 * Math.sin(d * 5)), l = Math.round(45 + 40 * Math.cos(d * 4));
          g.fillStyle = `hsl(${hue}, 82%, ${l}%)`;
          g.fillRect(x - 7, y - 7, 14, 14);
        }
      }
      return c;
    }
    if (k === 'aurora') {
      g.fillStyle = '#060c18'; g.fillRect(0, 0, 440, 300);
      for (let band = 0; band < 4; band++) {
        for (let x = 0; x < 440; x += 3) {
          const u = x / 440, y0 = 65 + band * 42 + Math.sin(u * 9 + band * 1.4) * 28 + Math.cos(u * 21) * 10;
          const grad = g.createLinearGradient(x, y0 - 45, x, y0 + 55);
          const hue = 135 + band * 32 + Math.sin(u * 6) * 18;
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.5, `hsla(${Math.round(hue)}, 90%, 62%, 0.65)`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad; g.fillRect(x, y0 - 45, 3, 100);
        }
      }
      return c;
    }
    if (k === 'mandala') {
      g.fillStyle = '#0b0818'; g.fillRect(0, 0, 440, 300);
      for (let ring = 1; ring <= 6; ring++) {
        const petals = ring * 6, rad = ring * 21;
        for (let p = 0; p < petals; p++) {
          const a = (p / petals) * Math.PI * 2 + (ring % 2) * 0.25;
          const x = 220 + Math.cos(a) * rad, y = 150 + Math.sin(a) * rad;
          g.fillStyle = `hsla(${(ring * 48 + p * 12) % 360}, 85%, ${80 - ring * 5}%, 0.85)`;
          g.beginPath(); g.arc(x, y, 4 + (7 - ring) * 1.2, 0, 7); g.fill();
        }
      }
      return c;
    }
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
  function builtInSound(kind) {
    const k = kind || S.sndPreset || 'chord';
    const r = mulberry(k === 'bells' ? 8181 : k === 'pulse' ? 6060 : 4242), atoms = [];
    if (k === 'bells') {
      const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < 520; i++) {
        const step = i % 12, t = (step * 0.48 + r() * 0.22) % 6, f0 = notes[step % notes.length], ratio = [1, 2, 2.76, 4.1][i % 4];
        atoms.push({ time: t, f: f0 * ratio, amp: Math.max(0.12, (1 - (i % 4) * 0.22) * (0.6 + 0.4 * r())), ton: 0.92 });
      }
      return { atoms, dur: 6 };
    }
    if (k === 'pulse') {
      for (let i = 0; i < 520; i++) {
        const beat = Math.floor(r() * 16), t = (beat * 0.375 + r() * 0.06) % 6;
        const f = beat % 4 === 0 ? 65 + r() * 90 : beat % 2 === 0 ? 220 + r() * 680 : 1800 + r() * 5200;
        atoms.push({ time: t, f, amp: 0.45 + 0.55 * r(), ton: beat % 4 === 0 ? 0.75 : 0.35 });
      }
      return { atoms, dur: 6 };
    }
    if (k === 'arpeggio') {
      const scale = [196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
      for (let i = 0; i < 520; i++) {
        const step = i % 24, t = ((step / 24) * 6 + r() * 0.08) % 6, f0 = scale[(step * 3 + Math.floor(i / 24)) % scale.length];
        const h = 1 + (i % 3);
        atoms.push({ time: t, f: f0 * h, amp: Math.max(0.15, (0.95 - (h - 1) * 0.28) * (0.65 + 0.35 * r())), ton: 0.9 });
      }
      return { atoms, dur: 6 };
    }
    if (k === 'drone') {
      const roots = [55, 82.41, 110, 164.81, 220];
      for (let i = 0; i < 520; i++) {
        const t = r() * 6, root = roots[i % roots.length], h = 1 + Math.floor(r() * 8);
        atoms.push({ time: t, f: root * h * (1 + (r() - 0.5) * 0.008), amp: Math.max(0.14, (1 - h / 10) * (0.6 + 0.4 * r())), ton: 0.88 });
      }
      return { atoms, dur: 6 };
    }
    for (let i = 0; i < 520; i++) { const t = r() * 6, h = 1 + Math.floor(r() * r() * 14); atoms.push({ time: t, f: 110 * h, amp: Math.max(0.1, 1 - h / 15) * (0.55 + 0.45 * r()), ton: 0.8 }); }
    return { atoms, dur: 6 };
  }

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
    if (hearSrc) refreshHearAudition(true);
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

  function syncAthenaStage() {
    const showAthena = S.mode === 'field' && S.driver === 'brainwaves';
    if ($('stage-athena-sep')) $('stage-athena-sep').hidden = !showAthena;
    if ($('stage-athena-row')) $('stage-athena-row').hidden = !showAthena;
  }

  function setMode(m) {
    S.mode = m;
    bio.setMode(m === 'train' ? 'train' : 'watch');
    S.holdT = 0; S.dawn = 0; S.complete = false; S.clarity = 0;
    document.querySelectorAll('.hud-set').forEach((h) => { h.hidden = h.dataset.for !== m; });
    $('field-opts').hidden = m === 'form';
    $('form-opts').hidden = m !== 'form';
    $('stage-field-bar').hidden = m === 'form' || m === 'train';
    if ($('stage-bar')) $('stage-bar').hidden = m === 'train';
    const showDrv = m === 'field';
    ['stage-driver-sep', 'stage-driver-label', 'drv-drums', 'drv-eeg', 'drv-heart'].forEach((id) => { if ($(id)) $(id).hidden = !showDrv; });
    syncAthenaStage();
    $('stage-form-bar').hidden = m !== 'form';
    if ($('hit-strip')) $('hit-strip').hidden = !(m === 'field' && S.driver === 'drums');
    if (m === 'form' && !F.A) liftMatch();
    kit.noteLane('mode', m);
    renderReading();
    renderHud();
  }

  function selectDriver(drv) {
    S.driver = drv;
    document.querySelectorAll('[data-driver]').forEach((b) => b.classList.toggle('on', b.dataset.driver === drv));
    if ($('hit-strip')) $('hit-strip').hidden = !(S.mode === 'field' && drv === 'drums');
    syncAthenaStage();
    renderHud();
  }
  document.querySelectorAll('[data-driver]').forEach((b) => b.addEventListener('click', () => selectDriver(b.dataset.driver)));

  function setMorph(t) {
    S.morph = clamp(t, 0, 1);
    const pct = Math.round(S.morph * 100);
    const r = $('morph'); if (r) { r.value = pct; shell.syncRange(r); }
    if ($('morph-v')) $('morph-v').textContent = `${pct}%`;
    const sr = $('stage-morph'); if (sr) { sr.value = pct; shell.syncRange(sr); }
    if ($('stage-morph-v')) $('stage-morph-v').textContent = `${pct}%`;
    if ($('fm-pct')) $('fm-pct').textContent = `${pct}%`;
    scheduleHearRefresh();
  }
  $('morph').addEventListener('input', (e) => { S.perform = false; S.formDriver = 'manual'; syncPerform(); setMorph(+e.target.value / 100); });
  if ($('stage-morph')) $('stage-morph').addEventListener('input', (e) => { S.perform = false; S.formDriver = 'manual'; syncPerform(); setMorph(+e.target.value / 100); });

  function syncPerform() {
    $('form-perform').textContent = `Slow sweep: ${S.perform ? 'on' : 'off'}`;
    $('form-perform').classList.toggle('on', S.perform);
    if ($('stage-perform')) {
      $('stage-perform').textContent = `Sweep: ${S.perform ? 'on' : 'off'}`;
      $('stage-perform').classList.toggle('on', S.perform);
    }
    const bioOn = S.formDriver === 'bio';
    if ($('form-bio')) { $('form-bio').textContent = `Bio morph: ${bioOn ? 'on' : 'off'}`; $('form-bio').classList.toggle('on', bioOn); }
    if ($('stage-form-bio')) { $('stage-form-bio').textContent = `Bio morph: ${bioOn ? 'on' : 'off'}`; $('stage-form-bio').classList.toggle('on', bioOn); }
    if ($('fm-ep')) $('fm-ep').textContent = bioOn ? 'Bio Proxy' : S.perform ? 'Sweep' : 'Manual';
  }
  const togglePerform = () => { S.perform = !S.perform; if (S.perform) S.formDriver = 'manual'; S.performT = 0; syncPerform(); };
  const toggleBioMorph = () => { S.formDriver = S.formDriver === 'bio' ? 'manual' : 'bio'; if (S.formDriver === 'bio') S.perform = false; syncPerform(); };
  $('form-perform').addEventListener('click', togglePerform);
  if ($('stage-perform')) $('stage-perform').addEventListener('click', togglePerform);
  if ($('form-bio')) $('form-bio').addEventListener('click', toggleBioMorph);
  if ($('stage-form-bio')) $('stage-form-bio').addEventListener('click', toggleBioMorph);

  const formRequests = { picture: 0, sound: 0 };
  $('form-image').addEventListener('click', () => $('form-image-file').click());
  $('form-sound').addEventListener('click', () => $('form-sound-file').click());
  $('form-image-file').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const request = ++formRequests.picture, img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => { URL.revokeObjectURL(url); if (request !== formRequests.picture) return; F.picture = img; F.pictureName = f.name; if ($('fm-pic')) $('fm-pic').textContent = f.name.slice(0, 10); liftMatch(); };
    img.onerror = () => { URL.revokeObjectURL(url); if (request === formRequests.picture) $('form-status').textContent = 'That file could not be read as a picture.'; };
    img.src = url;
  });
  $('form-sound-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const request = ++formRequests.sound;
    $('form-status').textContent = `Reading ${f.name}.`;
    try {
      const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 44100);
      const buf = await ac.decodeAudioData(await f.arrayBuffer());
      if (request !== formRequests.sound) return;
      const mono = new Float32Array(Math.min(buf.length, buf.sampleRate * 20));
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
      const r = await workerCall({ type: 'atoms', data: mono, rate: buf.sampleRate, k: 600 });
      if (request !== formRequests.sound) return;
      F.sound = { atoms: r.result.atoms, dur: r.result.dur, rate: buf.sampleRate };
      F.soundName = f.name;
      if ($('fm-snd')) $('fm-snd').textContent = f.name.slice(0, 10);
      liftMatch();
    } catch (err) { if (request === formRequests.sound) $('form-status').textContent = `That file could not be decoded: ${err.message}`; }
  });
  $('form-capture').addEventListener('click', () => {
    formRequests.sound++;
    const h = historyAtoms();
    if (h.atoms.length < 24) { $('form-status').textContent = 'There is not enough recent sound yet. Play for a few seconds, or run the demo, and try again.'; return; }
    F.sound = { atoms: h.atoms, dur: h.dur, rate: 44100 };
    F.soundName = 'your last 12 seconds';
    if ($('fm-snd')) $('fm-snd').textContent = '12s live';
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
  let hearCtx = null, hearSrc = null, hearEpoch = 0, hearMorph = -1, hearTimer = null, hearRebuilds = 0;
  function renderCloudWav(t, rate, dur) {
    const lf0 = Math.log(40), lf1 = Math.log(rate / 2), atoms = [], stride = Math.max(1, Math.floor(F.n / 1800));
    for (let i = 0; i < F.n; i += stride) {
      const a = F.A[i], X = F.X, p = [0, 1, 2].map((k) => a.p[k] + t * (X[i * 6 + k] - a.p[k])), c = [0, 1, 2].map((k) => a.c[k] + t * (X[i * 6 + 3 + k] / CW - a.c[k]));
      const mx = Math.max(...c) / 255, mn = Math.min(...c) / 255;
      atoms.push({ time: clamp((p[0] + 1) / 2, 0, 1) * dur, f: Math.exp(lf0 + clamp((p[1] + 1) / 2, 0, 1) * (lf1 - lf0)), amp: clamp(p[2] + 0.5, 0, 1), tone: mx > 0 ? (mx - mn) / mx : 0 });
    }
    const wav = synthAtoms(atoms, dur, rate, 777);
    let pk = 0; for (let i = 0; i < wav.length; i++) pk = Math.max(pk, Math.abs(wav[i]));
    if (pk > 0) for (let i = 0; i < wav.length; i++) wav[i] *= 0.7 / pk;
    return wav;
  }
  function syncHearButtons(on) {
    $('form-hear').textContent = on ? 'Stop listening' : 'Hear this cloud';
    $('form-hear').classList.toggle('on', on);
    if ($('stage-hear')) { $('stage-hear').textContent = on ? 'Stop listening' : 'Hear cloud'; $('stage-hear').classList.toggle('on', on); }
    if ($('form-update')) $('form-update').hidden = !on;
  }
  function refreshHearAudition(force) {
    if (!F.A || !hearCtx || (!hearSrc && !force)) return;
    const dur = 6, rate = hearCtx.sampleRate, t = S.morph, nowT = hearCtx.currentTime;
    const offset = hearSrc ? ((nowT - hearEpoch) % dur + dur) % dur : 0;
    const wav = renderCloudWav(t, rate, dur);
    const buf = hearCtx.createBuffer(1, wav.length, rate); buf.getChannelData(0).set(wav);
    const nextSrc = hearCtx.createBufferSource();
    nextSrc.buffer = buf; nextSrc.loop = true; nextSrc.connect(hearCtx.destination);
    if (hearSrc) { try { hearSrc.stop(); } catch (e) { /* ended */ } }
    nextSrc.start(0, offset);
    hearSrc = nextSrc; hearEpoch = nowT - offset; hearMorph = t; hearRebuilds++;
    syncHearButtons(true);
  }
  function scheduleHearRefresh() {
    if (!hearSrc || Math.abs(S.morph - hearMorph) < 0.025 || hearTimer) return;
    hearTimer = setTimeout(() => { hearTimer = null; if (hearSrc) refreshHearAudition(false); }, 140);
  }
  function toggleHear() {
    if (!F.A) return;
    if (hearSrc) { clearTimeout(hearTimer); hearTimer = null; try { hearSrc.stop(); } catch (e) { /* ended */ } hearSrc = null; syncHearButtons(false); return; }
    hearCtx = hearCtx || new (window.AudioContext || window.webkitAudioContext)();
    hearCtx.resume();
    refreshHearAudition(true);
  }
  $('form-hear').addEventListener('click', toggleHear);
  if ($('stage-hear')) $('stage-hear').addEventListener('click', toggleHear);
  if ($('form-update')) $('form-update').addEventListener('click', () => {
    if (!F.A) return;
    hearCtx = hearCtx || new (window.AudioContext || window.webkitAudioContext)();
    hearCtx.resume();
    refreshHearAudition(true);
  });
  $('form-pic-preset').addEventListener('change', (e) => {
    formRequests.picture++; S.picPreset = e.target.value; F.picture = null;
    F.pictureName = `built-in (${e.target.options[e.target.selectedIndex].text.toLowerCase()})`;
    if ($('fm-pic')) $('fm-pic').textContent = S.picPreset;
    liftMatch();
  });
  $('form-snd-preset').addEventListener('change', (e) => {
    formRequests.sound++; S.sndPreset = e.target.value; F.sound = null;
    F.soundName = `built-in (${e.target.options[e.target.selectedIndex].text.toLowerCase()})`;
    if ($('fm-snd')) $('fm-snd').textContent = S.sndPreset;
    liftMatch();
  });
  $('form-wav').addEventListener('click', () => {
    if (!F.A) return;
    const rate = 44100, dur = 6, t = S.morph, wav = renderCloudWav(t, rate, dur);
    const L = wav.length, buf = new ArrayBuffer(44 + L * 2), dv = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + L * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, 'data'); dv.setUint32(40, L * 2, true);
    for (let i = 0; i < L; i++) dv.setInt16(44 + i * 2, Math.round(clamp(wav[i], -1, 1) * 32767), true);
    const u = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })), l = document.createElement('a');
    l.href = u; l.download = `biofeedback-nebula-t${Math.round(t * 100)}.wav`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  });
  $('form-ply').addEventListener('click', () => {
    if (!F.A) return;
    const n = F.n, t = S.morph, header = `ply\nformat binary_little_endian 1.0\ncomment Biofeedback Nebula point cloud, t=${t.toFixed(2)}\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const hb = new TextEncoder().encode(header), buf = new ArrayBuffer(hb.length + n * 15), dv = new DataView(buf);
    new Uint8Array(buf).set(hb);
    let o = hb.length;
    for (let i = 0; i < n; i++) {
      const a = F.A[i], X = F.X;
      for (let k = 0; k < 3; k++) { dv.setFloat32(o, a.p[k] + t * (X[i * 6 + k] - a.p[k]), true); o += 4; }
      for (let k = 0; k < 3; k++) dv.setUint8(o++, clamp(Math.round(a.c[k] + t * (X[i * 6 + 3 + k] / CW - a.c[k])), 0, 255));
    }
    const u = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })), l = document.createElement('a');
    l.href = u; l.download = `biofeedback-nebula-t${Math.round(t * 100)}.ply`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  });

  function selectShape(sh, fromReplay) {
    S.shape = sh;
    document.querySelectorAll('[data-shape]').forEach((x) => x.classList.toggle('on', +x.dataset.shape === sh));
    if (!fromReplay) kit.noteLane('shape', S.shape);
  }
  $('shape-row').addEventListener('click', (e) => { const b = e.target.closest('[data-shape]'); if (b) selectShape(+b.dataset.shape); });
  $('stage-field-bar').addEventListener('click', (e) => { const b = e.target.closest('[data-shape]'); if (b) selectShape(+b.dataset.shape); });
  kit.on('lane', (l) => { if (l.name === 'shape') selectShape(l.value, true); else if (l.name === 'mode') shell.setMode(l.value); });

  const bind = (id, get, set, fmt, lab) => { const r = $(id); if (!r) return; r.value = get(); shell.syncRange(r); $(lab).textContent = fmt(+r.value); r.addEventListener('input', () => { shell.syncRange(r); set(+r.value); $(lab).textContent = fmt(+r.value); }); };
  bind('react', () => S.reaction * 100, (v) => { S.reaction = v / 100; }, (v) => `${Math.round(v)}%`, 'react-v');
  bind('trail', () => S.trails * 100, (v) => { S.trails = v / 100; }, (v) => `${Math.round(v)}%`, 'trail-v');
  bind('glow', () => S.glow * 100, (v) => { S.glow = v / 100; }, (v) => `${Math.round(v)}%`, 'glow-v');
  bind('full-over', () => bio.fullOver, (v) => { bio.fullOver = v; }, (v) => `+${v} bpm`, 'full-over-v');
  bind('full-swing', () => bio.fullSwing, (v) => { bio.fullSwing = v; }, (v) => `${v} bpm`, 'full-swing-v');
  bind('pace', () => bio.pace.rate, (v) => { bio.setPace(v); }, (v) => v.toFixed(1), 'pace-v');
  $('pace-toggle').addEventListener('click', function () { const on = bio.togglePace(); this.textContent = on ? 'Pause' : 'Resume'; });
  $('set-again').addEventListener('click', () => { S.holdT = 0; S.dawn = 0; S.complete = false; });

  let tierAuto = true;
  $('tier').addEventListener('change', (e) => { tierAuto = e.target.value === 'auto'; if (!tierAuto) buildParticles(+e.target.value); });
  $('auto-rot').addEventListener('change', (e) => { S.autoRot = e.target.checked; });
  if ($('palette')) $('palette').addEventListener('change', (e) => { S.palette = +e.target.value || 0; });
  if ($('demo-style')) $('demo-style').addEventListener('change', (e) => { S.demoStyle = e.target.value; kit.setDemoStyle(e.target.value); });

  let dragging = null;
  cv.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!dragging) return; S.yaw += (e.clientX - dragging.x) * 0.005; S.pitchUser = clamp((S.pitchUser || 0) + (e.clientY - dragging.y) * 0.004, -0.7, 0.5); dragging = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', () => { dragging = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); S.dist = clamp(S.dist * Math.exp(e.deltaY * 0.0009), 1.8, 6); }, { passive: false });

  /* ---- Reading, HUD & Body Signal charts ---- */
  function renderReading() {
    const n = bio.now, h = bio.hr, reading = $('reading');
    if (!reading) return;
    const hasSource = bio.demoOn || bio.replayOn || h.connected;
    const show = S.mode === 'watch' && hasSource;
    reading.hidden = !show;
    if (!show) return;
    let tier, sub = '', cov = '', pct = null, fill = null;
    if (n.phase === 'ready' && n.idx != null) {
      tier = n.label; pct = clamp(n.idx, 0, 100);
      sub = '0 to 100 · shift from your personal reference';
      cov = `${bio.demoOn ? 'Synthetic demo · ' : ''}${n.coverage}`;
    } else if (n.phase === 'calibrating') {
      tier = 'Forming your reference'; fill = n.progress;
      sub = `${mmss(n.seconds)} of 2:00 · sit comfortably`; cov = n.coverage;
    } else {
      tier = 'Waiting for heart-rate readings';
      sub = 'The first reading starts your personal reference.';
    }
    $('read-num').textContent = pct != null ? String(Math.round(n.idx)) : '--';
    $('read-tier').textContent = tier;
    $('read-sub').textContent = sub;
    $('read-cov').textContent = cov;
    $('read-dot').style.left = `${pct != null ? pct : 0}%`; $('read-dot').hidden = pct == null;
    $('read-fill').style.width = `${fill != null ? fill * 100 : 0}%`; $('read-fill').hidden = fill == null;
    $('read-scale').classList.toggle('forming', fill != null);
  }

  function renderHud() {
    const n = bio.now, set = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };
    set('w-hr', n.hr != null ? String(Math.round(n.hr)) : '--');
    set('w-idx', n.idx != null ? String(Math.round(n.idx)) : '--');
    set('w-rmssd', n.rmssd != null ? String(Math.round(n.rmssd)) : '--');
    set('w-trend', n.phase === 'ready' ? n.trend : '--');
    set('ep-hr', bio.demoOn ? 'Demo' : bio.hr.state === 'live' ? 'Measured' : 'Idle');

    if (S.mode === 'field') {
      if (S.driver === 'brainwaves') {
        const sm = eeg.state.sensorMode || 'eeg';
        const sens = eeg.state.sensors || {};
        if (sm === 'fnirs') {
          const sf = sens.fnirs || {};
          set('f-k1', 'fNIRS ΔOD');
          set('g-hits', sf.od != null ? `${sf.od >= 0 ? '+' : ''}${sf.od.toFixed(3)}` : '--');
          set('f-hero-label', 'fNIRS Control');
        } else if (sm === 'prv') {
          const sp = sens.prv || {};
          set('f-k1', 'Forehead PRV');
          set('g-hits', sp.rmssd != null ? `${Math.round(sp.rmssd)}ms` : '--');
          set('f-hero-label', 'Optical PRV');
        } else if (sm === 'stillness') {
          const ss = sens.stillness || {};
          set('f-k1', 'IMU Motion');
          set('g-hits', ss.rms != null ? `${ss.rms.toFixed(3)}g` : '--');
          set('f-hero-label', 'Head Stillness');
        } else if (sm === 'fusion') {
          const sfu = sens.fusion || {};
          set('f-k1', 'Active Sensors');
          set('g-hits', sfu.activeChannels && sfu.activeChannels.length ? `${sfu.activeChannels.length}/4` : '--');
          set('f-hero-label', 'Athena Fusion');
        } else {
          set('f-k1', 'EEG Ratio');
          set('g-hits', S.eegRatio != null ? S.eegRatio.toFixed(2) : '--');
          set('f-hero-label', 'EEG Control');
        }
        set('f-hero-ep', S.eegSimulated ? 'Demo Proxy' : 'Proxy');
        set('g-hero', S.eegScore != null ? String(Math.round(S.eegScore)) : '--');
        set('f-k3', 'Signal');
        set('g-level', S.eegValid ? 'ready' : 'coast');
        set('f-load-label', 'Coherence');
        set('g-load', `${Math.round(S.eegDrive * 100)}`);
        set('g-load-u', '%');
      } else if (S.driver === 'heart') {
        const sp = eeg.state.sensors && eeg.state.sensors.prv;
        const hrVal = n.hr != null ? n.hr : (sp && sp.bpm != null ? sp.bpm : null);
        const rmssdVal = n.rmssd != null ? n.rmssd : (sp && sp.rmssd != null ? sp.rmssd : null);
        set('f-k1', 'RMSSD');
        set('g-hits', rmssdVal != null ? `${Math.round(rmssdVal)}` : '--');
        set('f-hero-label', 'Heart rate');
        set('f-hero-ep', bio.demoOn ? 'Demo' : bio.hr.state === 'live' ? 'Measured' : (sp && sp.valid) ? 'Forehead PPG' : 'Measured');
        set('g-hero', hrVal != null ? String(Math.round(hrVal)) : '--');
        set('f-k3', 'Index');
        set('g-level', n.idx != null ? String(Math.round(n.idx)) : '--');
        set('f-load-label', 'Field load');
        set('g-load', n.hr != null && n.baseHr != null ? `+${(S.bioLoad * 100).toFixed(1)}` : '--');
        set('g-load-u', '%');
      } else {
        set('f-k1', 'Hits');
        set('g-hits', String(kit.hits));
        set('f-hero-label', 'Tempo');
        set('f-hero-ep', kit.demoOn ? 'Demo' : 'Kit');
        set('g-hero', kit.tempo.bpm ? String(Math.round(kit.tempo.bpm)) : '--');
        set('f-k3', 'Level');
        set('g-level', kit.audio.state === 'live' ? `${Math.round(kit.audio.peakDb)}dB` : kit.demoOn ? 'demo' : '--');
        set('f-load-label', 'Field load');
        set('g-load', n.hr != null && n.baseHr != null ? `+${(S.bioLoad * 100).toFixed(1)}` : '--');
        set('g-load-u', '%');
      }
    }

    const cl = S.mode === 'train' ? BioMath.clarity(n.swing, bio.fullSwing) : null;
    set('t-clarity', cl != null ? cl.toFixed(2) : '--');
    if ($('t-bar')) $('t-bar').style.width = `${(cl || 0) * 100}%`;
    set('t-hold', `${mmss(Math.min(SET_SECONDS, S.holdT))} of ${mmss(SET_SECONDS)}`);
    if ($('set-again')) $('set-again').hidden = !S.complete;

    const br = bio.breath(), cue = $('breath-cue'), note = $('breath-note');
    if ($('breath')) $('breath').hidden = S.mode !== 'train';
    if (S.mode === 'train' && cue && note) {
      const c = br.paused ? 'Paused' : br.inhale ? 'Breathe in' : 'Breathe out';
      if (cue.textContent !== c) cue.textContent = c;
      const hasSource = bio.demoOn || bio.replayOn || bio.hr.connected;
      let msg = '';
      if (S.complete) msg = 'Set complete. Supernova dawn bloomed across the nebula.';
      else if (!hasSource) msg = 'The breathing ring runs without a sensor. Clarity needs a heart-rate sensor or demo.';
      else if (n.hr == null) msg = 'Waiting for heart-rate signal.';
      else if (n.swing == null) msg = 'Reading the first two breaths…';
      else if (cl >= CLARITY_TARGET) msg = 'Holding resonance. Stay with the ring.';
      if (note.textContent !== msg) note.textContent = msg;
    }
  }

  function lineChart(id, pts, xSpan, opt) {
    const cvs = $(id); if (!cvs) return;
    const c = cvs.getContext('2d'), w = cvs.width, h = cvs.height, pad = 34, top = 14;
    c.fillStyle = '#0b0f1c'; c.fillRect(0, 0, w, h);
    c.font = '18px ui-sans-serif, -apple-system, sans-serif';
    if (!pts.length) { c.fillStyle = 'rgba(238,237,251,.7)'; c.fillText(opt.empty, 90, h / 2); return; }
    const ys = pts.map((p) => p[1]);
    let lo = opt.lo != null ? opt.lo : Math.min(...ys), hi = opt.hi != null ? opt.hi : Math.max(...ys);
    if (opt.floor && hi - lo < opt.floor) { const m = (hi + lo) / 2; lo = m - opt.floor / 2; hi = m + opt.floor / 2; }
    const X = (x) => w - ((xSpan - x) / xSpan) * (w - 86), Y = (v) => h - pad + 10 - ((v - lo) / Math.max(1e-6, hi - lo)) * (h - pad + 10 - top);
    (opt.marks || [lo, hi]).forEach((v) => {
      c.fillStyle = 'rgba(191,194,236,.14)'; c.fillRect(0, Y(v), w, 1);
      c.fillStyle = 'rgba(238,237,251,.72)'; c.fillText(Math.round(v), 12, Math.max(18, Y(v) - 6));
    });
    c.beginPath();
    pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.strokeStyle = '#b8b7ff'; c.lineWidth = 2.4; c.stroke();
  }
  function renderBioSignal() {
    const n = bio.now, set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('bsig-hr', n.hr != null ? `${Math.round(n.hr)} bpm` : 'none');
    set('bsig-hr-n', bio.demoOn ? 'synthetic demo' : bio.hr.state === 'live' ? bio.hr.label : 'no sensor');
    set('bsig-rmssd', n.rmssd != null ? `${Math.round(n.rmssd)} ms` : 'none');
    set('bsig-sdnn', n.sdnn != null ? `${Math.round(n.sdnn)} ms` : 'none');
    set('bsig-idx', n.idx != null ? String(Math.round(n.idx)) : n.phase);
    set('bsig-ref', n.reference ? 'ready' : `${mmss(n.seconds || 0)} / 2:00`);
    set('bsig-swing', n.swing != null ? `${n.swing.toFixed(1)} bpm` : 'none');
    set('bsig-eeg', S.eegScore != null ? `${Math.round(S.eegScore)} / 100` : eeg.state.phase);
    set('bsig-eeg-n', eeg.state.activeLabel || 'EEG · fNIRS · PRV · IMU');
    set('bsig-pts', N.toLocaleString());
    set('bsig-fps', `${Math.round(shell.fps)} fps`);
  }
  function drawBioSignal() {
    const n = bio.now, t = performance.now() / 1000;
    const trace = bio.series().filter((p) => t - p.t <= 120).map((p) => [120 - (t - p.t), p.hr]);
    lineChart('sig-trace', trace, 120, { floor: 12, empty: 'No heart-rate readings yet.' });
    const rr = bio.beats().map((b) => [32 - (t - b.t / 1000), b.rr]).filter((p) => p[0] >= 0);
    lineChart('sig-rr', rr, 32, { floor: 60, empty: 'No beat intervals yet.' });
    const nowMs = Date.now();
    const idx = (n.history || []).map((p) => [600 - (nowMs - p.timestamp) / 1000, p.value]).filter((p) => p[0] >= 0);
    lineChart('sig-index', idx, 600, { lo: 0, hi: 100, marks: [0, 25, 46, 68], empty: 'Forming reference or waiting for heart-rate sensor.' });
  }

  /* ---- Render loop ---- */
  let last = performance.now(), frameIdx = 0, slow = 0, fast = 0, fails = 0, tierLocked = false, strongGPU = false, settle = false;
  function render(now) {
    requestAnimationFrame(render);
    try {
      const dtMs = Math.min(100, now - last); last = now;
      const dt = Math.min(1 / 30, dtMs / 1000);
      kit.tick(now);
      bio.tick(now);

      const eegActive = (S.mode === 'field' && S.driver === 'brainwaves') || (S.mode === 'form' && S.formDriver === 'bio');
      eeg.tick(dt, (bio.demoOn || kit.demoOn) && eegActive);
      const q = eeg.state;
      const sm = q.sensorMode || 'eeg';
      const activeSensor = q.sensors && q.sensors[sm];
      const liveDrive = eeg.activeDrive(sm);
      S.eegValid = activeSensor ? !!(activeSensor.valid && (q.phase === 'ready' || sm === 'stillness' || sm === 'prv')) : !!(q.quality && q.quality.valid && q.phase === 'ready');
      S.eegScore = S.eegValid && Number.isFinite(q.activeScore) ? q.activeScore : (S.eegValid && Number.isFinite(q.score) ? q.score : null);
      S.eegRatio = q.ratio;
      S.eegSimulated = !!q.simulated;
      S.eegDrive = eegActive ? clamp(Number.isFinite(liveDrive) ? liveDrive : 0, 0, 1) : 0;
      S.fnirsDrive = eegActive && q.sensors && q.sensors.fnirs ? clamp(q.sensors.fnirs.drive || 0, 0, 1) : 0;
      S.stillDrive = eegActive && q.sensors && q.sensors.stillness ? clamp(q.sensors.stillness.drive || 0, 0, 1) : 0;

      shell.frame(now);
      if (!G || gl.isContextLost()) return;
      const env = kit.env, n = bio.now;

      // Update biofeedback state variables
      const loadTarget = n.phase === 'ready' && n.idx != null ? clamp(n.idx / 100, 0, 1) : 0;
      S.load += (loadTarget - S.load) * (1 - Math.exp(-dt / 2.0));
      const bioLoadTarget = BioMath.gradeLoad(n.hr, n.baseHr, bio.fullOver) * LOAD_MAX;
      S.bioLoad += (bioLoadTarget - S.bioLoad) * (1 - Math.exp(-dt / 1.5));
      S.pulse *= Math.exp(-dt / 0.26);

      if (S.mode === 'train') {
        const c = BioMath.clarity(n.swing, bio.fullSwing);
        if (c != null && n.hr != null && bio.pace.on) {
          const above = c >= CLARITY_TARGET;
          S.holdT = Math.max(0, S.holdT + (above ? dt : -dt * 0.5));
          S.dawn = clamp(S.dawn + dt * (above ? 1 / 45 : -1 / 90), 0, 1);
          if (S.holdT >= SET_SECONDS) { S.complete = true; S.holdT = SET_SECONDS; S.dawn = 1; }
        }
        S.clarity += ((c || 0) - S.clarity) * (1 - Math.exp(-dt / 1.6));
      } else {
        S.clarity *= Math.exp(-dt / 1.6);
      }

      // Upload 2-minute heart-rate history into tHrHist
      if (tHrHist && frameIdx % 6 === 0) {
        let lo = 1e9, hi = 0;
        for (let i = 0; i < 64; i++) if (bio.hist[i] > 0) { lo = Math.min(lo, bio.hist[i]); hi = Math.max(hi, bio.hist[i]); }
        const span = Math.max(12, hi - lo);
        for (let i = 0; i < 64; i++) hrBytes[i] = bio.hist[i] > 0 ? Math.round(clamp((bio.hist[i] - lo) / span, 0.1, 1) * 255) : 0;
        G.bindTex(0, tHrHist);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.RED, gl.UNSIGNED_BYTE, hrBytes);
      }

      S.shapeT += ((S.shape === 1 ? 1 : 0) - S.shapeT) * Math.min(1, dt / 0.9);
      S.vortexT += ((S.shape === 2 ? 1 : 0) - S.vortexT) * Math.min(1, dt / 0.9);
      S.shellT += ((S.shape === 3 ? 1 : 0) - S.shellT) * Math.min(1, dt / 0.9);
      S.formT += ((S.mode === 'form' && F.A ? 1 : 0) - S.formT) * Math.min(1, dt / 0.8);
      if (S.perform) { S.performT += dt; setMorph(0.5 - 0.5 * Math.cos((S.performT / 24) * Math.PI * 2)); }
      else if (S.mode === 'form' && S.formDriver === 'bio') {
        const bioTarget = S.eegValid ? S.eegDrive : S.load;
        setMorph(lerp(S.morph, bioTarget, Math.min(1, dt * 2.5)));
      }

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
      if (S.autoRot && !dragging && !RM.matches) S.yaw += dt * (0.035 + S.eegDrive * 0.045);
      const base = 1.02 * (1 - S.shapeT) + 0.2 * S.shapeT, pitch = clamp(base * (1 - S.formT) + 0.12 * S.formT + (S.pitchUser || 0), 0.05, 1.45);
      const yaw = S.yaw * (1 - Math.max(S.shapeT, S.formT)) + Math.sin(S.yaw * 0.7) * 0.12 * Math.max(S.shapeT, S.formT);
      const dist = S.dist * (1 - (RM.matches ? 0 : (env.kick + S.pulse * 0.5) * 0.022));
      const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
      const asp = rw / rh;
      const fit = asp < 1 ? 1 / Math.pow(asp, 0.75) : 1;
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

      /* simulate particles */
      const histX = (kit.histX + 0.5) / kit.HIST_W, blow = S.reaction * (RM.matches ? 0.35 : 1);
      const br = bio.breath();
      const useBioHist = (S.mode === 'watch' || (S.mode === 'field' && S.driver === 'heart')) ? 1 : 0;
      const effBioLoad = S.mode === 'watch' ? S.load : (S.BioLoad || clamp(S.bioLoad / LOAD_MAX, 0, 1));
      const substeps = settle ? 150 : 1;
      settle = false;
      for (let sub = 0; sub < substeps; sub++) {
        const quiet = substeps > 1;
        G.into(simB);
        G.bindTex(0, simA.pos); G.bindTex(1, simA.vel); G.bindTex(2, tSeed); G.bindTex(3, tHist); G.bindTex(4, vel.tex); G.bindTex(5, tN);
        G.bindTex(6, tHomeA || tSeed); G.bindTex(7, tHomeB || tSeed); G.bindTex(8, tHrHist || tSeed);
        G.use(pSim, {
          uPos: 0, uVel: 1, uSeed: 2, uHist: 3, uFluid: 4, uN: 5, uHomeA: 6, uHomeB: 7, uHrHist: 8,
          uDt: quiet ? 1 / 30 : dt, uT: now / 1000, uHistX: histX, uRiver: S.shapeT, uVortex: S.vortexT, uShell: S.shellT, uForm: S.formT, uMorph: S.morph, uLoud: kit.loud,
          uKick: quiet ? 0 : env.kick, uSnare: quiet ? 0 : env.snare, uHat: quiet ? 0 : env.hat, uHatOpen: env.hatOpen, uTom: quiet ? 0 : env.tom, uTomPos: env.tomPos, uCrash: quiet ? 0 : env.crash, uBlow: blow,
          uTrain: S.mode === 'train' ? 1 : 0, uClarity: S.clarity, uBreath: br.ee, uBioLoad: effBioLoad, uEegDrive: S.eegDrive, uFnirs: S.fnirsDrive, uStillness: S.stillDrive, uPulse: quiet ? 0 : S.pulse, uUseBioHist: useBioHist,
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
        uForm: S.formT, uMorph: S.morph, uT: now / 1000, uLoud: kit.loud, uKick: env.kick, uHat: env.hat, uHatOpen: env.hatOpen, uRide: env.ride, uCrash: env.crash, uPalette: S.palette,
        uBioLoad: effBioLoad, uClarity: S.clarity, uDawn: S.dawn, uEegDrive: S.eegDrive, uFnirs: S.fnirsDrive, uPulse: S.pulse, uTrain: S.mode === 'train' ? 1 : 0,
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

      /* gas and composite */
      const follow = (a, b) => a + (b - a) * (1 - Math.exp(-dt / (b > a ? 0.5 : 1.5)));
      S.gasL = follow(S.gasL || 0, kit.low); S.gasM = follow(S.gasM || 0, kit.mid); S.gasH = follow(S.gasH || 0, kit.high); S.gasV = follow(S.gasV || 0, kit.loud);
      G.into(scene); G.bindTex(0, tN); G.bindTex(1, trailA.tex);
      const scale = (3.25 / (dist * fit)) * (1 / 1.25);
      const haze = S.mode === 'train' ? (1 - S.dawn) * (1 - 0.65 * S.clarity) : 0;
      G.use(pGas, {
        uN: 0, uTrail: 1, uRiverGas: S.shapeT, uRes: [rw, rh], uC: c, uT: now / 1000, uTilt: Math.sin(pitch) * (1 - S.shapeT) + S.shapeT, uScale: scale, uYaw: yaw,
        uLow: S.gasL, uMid: S.gasM, uHigh: S.gasH, uLoud: S.gasV, uKick: env.kick, uSnare: env.snare, uHat: env.hat, uHatOpen: env.hatOpen, uRide: env.ride, uCrash: env.crash, uForm: S.formT, uPalette: S.palette,
        uBioLoad: effBioLoad, uClarity: S.clarity, uDawn: S.dawn, uEegDrive: S.eegDrive, uFnirs: S.fnirsDrive, uPulse: S.pulse, uHaze: haze,
      });
      G.draw();

      const bloom = Post.bloom(scene.tex, 0.7);
      Post.finish(scene.tex, bloom, {
        uBloomK: (0.6 + env.kick * 0.06 + env.crash * 0.12 + S.dawn * 0.25 + effBioLoad * 0.14) * S.glow, uExposure: 1.02 + S.dawn * 0.18,
        uFlash: RM.matches ? 0 : Math.min(0.1, env.flash * 0.1), uFlashC: [1, 0.94, 0.86], uGrain: 0.016, uT: now / 1000, uVig: 0.42, uSat: 1.08 + effBioLoad * 0.12, rate: RM.matches ? 0.16 : 0.36,
      }, dtMs / 1000);

      /* Dotted reference / breathing orbit ring in Watch and Train modes */
      const wantOrbit = S.mode === 'watch' ? 0.78 : S.mode === 'train' ? 0.95 : 0;
      S.orbitA += (wantOrbit - S.orbitA) * Math.min(1, dtMs / 450);
      if (S.orbitA > 0.01) {
        const sc = Math.min(1, asp * 1.15);
        const R = S.mode === 'train' ? lerp(0.22, 0.42, br.ee) * sc : 0.52 * sc;
        G.into(null);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        G.use(pOrbit, { uC: [0, S.mode === 'train' ? 0.12 : 0.18], uR: R, uAsp: asp, uT: now / 1000, uA: S.orbitA, uPx: Math.max(1.5, (cv.height / 900) * 2.1), uSquash: S.mode === 'train' ? 1 : 0.84 });
        gl.drawArrays(gl.POINTS, 0, S.mode === 'train' ? 620 : 860);
        gl.disable(gl.BLEND);
      }

      if (lumaRec) lumaRec(now);
      if (wantSnap) { const done = wantSnap; wantSnap = null; cv.toBlob((blob) => done(blob), 'image/png'); }

      if (frameIdx % 6 === 0) {
        renderReading();
        renderHud();
        if ($('connect-sheet') && $('connect-sheet').open) updateConnectDom();
        if ($('biosignal-sheet') && $('biosignal-sheet').open) {
          renderBioSignal();
          drawBioSignal();
        }
      }
    } catch (e) {
      if (fails++ < 3) console.error(e);
    }
  }

  /* ---- boot ---- */
  setMode('watch');
  if (!G || !(G.floatRT || G.gl.getExtension('EXT_color_buffer_half_float'))) {
    shell.glFail('This page needs WebGL2 with floating-point render targets, which this browser did not provide.');
    const idle = (now) => { requestAnimationFrame(idle); kit.tick(now); bio.tick(now); shell.frame(now); };
    requestAnimationFrame(idle);
  } else {
    gl = G.gl;
    try {
      Post = createPost(G);
      pSim = G.program(SIM_FS); pPoint = G.program(POINT_FS, POINT_VS); pTrail = G.program(TRAIL_FS); pGas = G.program(GAS_FS);
      pOrbit = G.program(ORBIT_FS, ORBIT_VS);
      pAdvect = G.program(ADVECT_FS); pSplat = G.program(SPLAT_FS); pDiv = G.program(DIV_FS); pJac = G.program(JAC_FS); pGrad = G.program(GRAD_FS);
      tN = G.noiseTexture(20261103);
      tHist = G.tex(kit.HIST_W, kit.BANDS, { internal: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE }, { data: kit.hist });
      G.bindTex(0, tHist); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      tHrHist = G.tex(64, 1, { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE }, { data: hrBytes });
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

  let lumaRec = null;
  function recordLuma(ms) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d', { willReadFrequently: true }), frames = [], t0 = performance.now();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
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
    S, kit, bio, eeg, F, BioMath, recordLuma, selectDriver, selectShape, setMorph,
    get hearState() { return { playing: !!hearSrc, morph: hearMorph, rebuilds: hearRebuilds }; },
    get N() { return N; },
    pixel() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const g = c.getContext('2d');
      return new Promise((res) => { wantSnap = (blob) => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let sum = 0, min = 1e9, max = 0; const grid = []; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; sum += l; min = Math.min(min, l); max = Math.max(max, l); grid.push(l); } res({ mean: sum / (d.length / 4), min, max, grid }); }; im.src = URL.createObjectURL(blob); }; });
    },
  };
})();
