/* enter.js: walk into a picture, fly through a sound, print the sound.
   Three worlds with one rig. The sound world is a synesthetic map with stated axis laws. The picture world is a
   depth relief, and its depth is a learned estimate unless the page says otherwise. The print world casts sound
   into a watertight solid. Drums move all three, and every link is a stated rule. */
(function () {
  'use strict';
  const { createGL, createPost, FS_HEAD } = GLKit;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const FS = 26, LF0 = Math.log(40), LF1 = Math.log(22050), LIVE_SPAN = 12.8;

  const BADGE = {
    sound: 'Synesthetic map · stated axis laws, not physical space · time→X · log-pitch→Y · salience→depth',
    painted: 'Painted scene · its depth is drawn by hand-written rules, not estimated · relief, not a reconstructed scene',
    estimated: 'Estimated depth · learned model (Depth Anything V2 Small) · relief, not a reconstructed scene',
    brightness: 'Brightness relief · a stated rule, not a depth estimate · relief, not a reconstructed scene',
    print: 'Sculpture of the sound · stated Gabor-atom mapping · deterministic · no model',
  };
  const TRUTH = {
    sound: 'Synesthetic map: stated mappings, not physical space. A sparse decomposition of the sound, not the waveform. Audio and MIDI stay in this browser.',
    picture: 'A relief, not a reconstructed scene. Your picture stays on this computer. Using your own picture downloads a model from Hugging Face and its runtime from jsDelivr, once.',
    print: 'A stated mapping with no model: time along the base, pitch up, loudness as size. Grow World and Make 3D Object stay in the desktop app.',
  };
  const S = {
    world: 'sound', fov: 70, look: 0.22, inv: false, free: false, drift: true, react: 1, glow: 1, depth: 42, tear: 145, lastInput: -1e9, moved: false,
    seg: 512, scale: 1, cast: { dist: 3.9, ry: 0.6, rx: -0.12, auto: true },
  };
  const cams = {
    sound: { pos: [-FS * 1.15, -3, FS * 0.3], yaw: -Math.PI / 2, pitch: -0.1, vel: [0, 0, 0], speed: 7, spawn: null },
    picture: { pos: [0, 0, 8.5], yaw: 0, pitch: 0, vel: [0, 0, 0], speed: 3.2, spawn: null },
  };
  Object.values(cams).forEach((c) => { c.spawn = { pos: c.pos.slice(), yaw: c.yaw, pitch: c.pitch }; });
  const keys = {};

  /* ---------- shaders ---------- */
  const HSL = 'vec3 hsl(float h,float s,float l){vec3 k=mod(vec3(0.,8.,4.)+h*12.,12.);float a=s*min(l,1.-l);return vec3(l)-a*max(vec3(-1.),min(min(k-3.,9.-k),vec3(1.)));}';
  const NOISE = 'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return textureLod(uN,(i+f+.5)/256.,0.).r;}';

  const SPRITE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aA;
layout(location=1) in vec2 aB;
uniform mat4 uVP;
uniform float uNow,uLive,uPxK,uMaxPx,uT,uFS,uI,uKick,uSnare,uHat,uHatOpen,uTom,uTomPos,uRide,uCrash,uBlow;
uniform vec4 uPulse[4];
out vec3 vC;
${HSL}
void main(){
  float age=uLive>.5?(uNow-aB.y)/${LIVE_SPAN.toFixed(1)}:0.;
  if(uLive>.5&&(aB.y<0.||age>1.||age<0.)){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vC=vec3(0.);return;}
  float tx=uLive>.5?1.-2.*age:aA.x,v=aA.y,amp=aA.w,ton=aB.x,b=(v+1.)*.5;
  // The laws: time runs along X, log-pitch climbs Y, salience comes toward depth.
  vec3 p=vec3(tx*uFS,v*uFS*.62,((aA.z*2.-1.)*.5+(amp-.5))*uFS*.55);
  p.x+=sin(uT*.7+p.y*1.7)*.12;p.y+=cos(uT*.9+p.x*1.3)*.12;
  float h1=fract(aA.z*91.7),h2=fract(aA.z*37.3);
  p+=(vec3(h1,h2,fract(aA.z*59.1))-.5)*uSnare*.4*smoothstep(.08,.5,b)*uBlow*step(.7,h2);
  p.y+=exp(-pow((b-(.1+uTomPos*.42))*8.,2.))*uTom*.5*uBlow*(h1>.5?1.:-1.);
  vec4 clip=uVP*vec4(p,1.);
  gl_Position=clip;
  vec3 law=hsl(.66*b,.25+.75*clamp(ton,0.,1.),.28+.5*amp);
  float val=.34+amp*amp*1.9;
  float wave=0.;
  for(int i=0;i<4;i++){float x=(tx-uPulse[i].x)*uPulse[i].y;wave+=exp(-x*x)*uPulse[i].z;}
  val*=1.+wave*.16*(.35+.65*(1.-b));
  if(b>.62&&h1>.86)val*=1.+uHat*(1.+uHatOpen)*(.4+1.1*abs(sin(aA.z*6283.+uT*34.)));
  if(h2>.88)val*=1.+.8*uRide*(.5+.5*sin(uT*16.+aA.z*900.));
  val*=1.+.1*uKick*(1.-b)+.08*uCrash;
  if(uLive>.5){val*=(1.+.9*exp(-age*${LIVE_SPAN.toFixed(1)}*3.))*smoothstep(1.,.84,age)*smoothstep(0.,.025,age);}
  float fog=clamp(exp(-clip.w*.011),.08,1.)*smoothstep(2.5,10.,clip.w);
  float sz=clamp(uPxK*(.7+amp*2.6)/max(clip.w,.3),1.,uMaxPx);
  vC=law*min(val,1.6)*fog*uI;
  gl_PointSize=sz;
}`;
  const SPRITE_FS = FS_HEAD.replace('in vec2 vUv;\n', '') + `
in vec3 vC;
void main(){vec2 q=gl_PointCoord-.5;float d=dot(q,q);float g=exp(-d*26.)+.12*exp(-d*8.);o=vec4(vC*g,1.);}`;

  // The floor is the last twelve seconds as terrain: time along X, frequency across, loudness as height.
  const TERRAIN_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uHist;uniform mat4 uVP;uniform float uHistX,uFS;
out vec2 vG;out vec3 vC;out float vW;
${HSL}
const int NX=320,NZ=64;
const ivec2 C[6]=ivec2[6](ivec2(0,0),ivec2(1,0),ivec2(0,1),ivec2(1,0),ivec2(1,1),ivec2(0,1));
void main(){
  int q=gl_VertexID/6,c=gl_VertexID%6;ivec2 cell=ivec2(q%NX,q/NX)+C[c];
  vec2 g=vec2(cell)/vec2(float(NX),float(NZ));
  float hx=uHistX-(1.-g.x)*.985,px=1./512.;
  vec2 hs=vec2(0.);for(int k=0;k<7;k++)hs+=texture(uHist,vec2(hx+float(k-3)*2.*px,g.y)).rg;hs/=7.;
  float h=hs.r*hs.r;
  vec3 p=vec3((g.x*2.-1.)*uFS*1.25,-uFS*.62-2.+h*4.5,(g.y*2.-1.)*uFS*.8);
  vec4 clip=uVP*vec4(p,1.);gl_Position=clip;
  vG=g*vec2(12.8,16.);vW=clip.w;
  float edge=smoothstep(0.,.06,g.x)*smoothstep(1.,.94,g.x)*smoothstep(0.,.1,g.y)*smoothstep(1.,.9,g.y);
  vC=hsl(.66*g.y,.5+.45*hs.g,.42+.26*hs.r)*(.03+hs.r*.3)*edge;
}`;
  const TERRAIN_FS = FS_HEAD.replace('in vec2 vUv;\n', '') + `
in vec2 vG;in vec3 vC;in float vW;
void main(){
  vec2 f=abs(fract(vG-.5)-.5)/max(fwidth(vG),vec2(1e-4));
  float l=1.-min(min(f.x,f.y),1.);
  o=vec4(vC*(.15+l*1.15)*exp(-vW*.018),1.);
}`;

  const TRAIL_FS = FS_HEAD + `uniform sampler2D uPts,uPrev;uniform float uFade;void main(){o=vec4(min(texture(uPrev,vUv).rgb*uFade+texture(uPts,vUv).rgb,vec3(30.)),1.);}`;

  // A sky seen through the camera: gas and far stars, so looking around reads as looking around.
  const SKY_FS = FS_HEAD + `
uniform sampler2D uN,uTrail;uniform vec3 uF,uR,uU;uniform vec2 uTan;uniform float uT,uLow,uMid,uHigh,uLoud,uKick,uHat,uHatOpen,uRide,uCrash,uSnare;
${NOISE}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*(vn(p.xy)+vn(p.yz+3.1)+vn(p.zx+7.7))/3.;p=p.yzx*2.03+1.7;a*=.5;}return s;}
float h13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
void main(){
  vec2 n=vUv*2.-1.;
  vec3 d=normalize(uF+uR*n.x*uTan.x+uU*n.y*uTan.y);
  vec3 q=d*2.4+vec3(uT*.008,3.1,-uT*.006);
  float w=fbm(q*.9+5.);
  float n1=fbm(q*1.05+w*1.6),n2=fbm(q*2.1-w*1.4+vec3(4.)),n3=fbm(q*1.5+w*2.2+9.);
  vec3 warm=vec3(.60,.18,.27),violet=vec3(.27,.20,.72),teal=vec3(.10,.46,.44);
  vec3 g=violet*smoothstep(.40,.72,n1)*(.34+.5*uMid+.2*uLoud);
  g+=warm*smoothstep(.42,.74,n2)*(.2+.7*uLow+.36*uKick);
  g+=teal*smoothstep(.44,.76,n3)*(.18+.7*uHigh+.26*uHat);
  g*=1.+uCrash*.4+uSnare*.12;
  vec3 sky=vec3(.0055,.0075,.019)+vec3(.012,.012,.03)*(.5+.5*d.y);
  vec3 s=d*150.;vec3 id=floor(s);vec3 f=fract(s)-.5;float h=h13(id);float st=0.;
  if(h>.9965){float b=(h-.9965)/.0035;st=b*b*exp(-dot(f,f)*30.)*(.5+.3*sin(uT*(1.5+h*5.)+h*700.)+uRide*1.1*sin(uT*18.+h*333.)+uHat*(1.2+uHatOpen));}
  o=vec4(sky+g+vec3(.82,.86,1.)*max(st,0.)*1.1+texture(uTrail,vUv).rgb,1.);
}`;

  // The relief. True-Z unprojection and per-triangle tear come straight from the desktop app, for the reasons it gives:
  // displacing by inverse depth made cardboard cutouts, and a continuous sheet cannot show a hole.
  const RELIEF_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDmap;uniform vec2 uDsize,uPlane;uniform float uDscale,uCamZ,uTearT;uniform int uSeg;uniform mat4 uVP;
out vec2 vUv;out float vD;out float vEdge;
const ivec2 C[6]=ivec2[6](ivec2(0,0),ivec2(1,0),ivec2(0,1),ivec2(1,0),ivec2(1,1),ivec2(0,1));
float dAt(ivec2 p){p=clamp(p,ivec2(0),ivec2(uDsize)-1);return texelFetch(uDmap,p,0).r;}
float dBil(vec2 uv){vec2 c=uv*uDsize-.5;ivec2 i0=ivec2(floor(c));vec2 f=fract(c);return mix(mix(dAt(i0),dAt(i0+ivec2(1,0)),f.x),mix(dAt(i0+ivec2(0,1)),dAt(i0+ivec2(1,1)),f.x),f.y);}
void main(){
  int q=gl_VertexID/6,c=gl_VertexID%6;vec2 g=vec2(ivec2(q%uSeg,q/uSeg)+C[c])/float(uSeg);
  vec2 duv=vec2(g.x,1.-g.y);vUv=duv;
  float d=dBil(duv);vD=d;
  vec2 px=1./uDsize;
  float gx=abs(dBil(duv+vec2(px.x*2.,0.))-dBil(duv-vec2(px.x*2.,0.)));
  float gy=abs(dBil(duv+vec2(0.,px.y*2.))-dBil(duv-vec2(0.,px.y*2.)));
  vEdge=clamp((gx+gy)*6.,0.,1.);
  float dn=max(d,.02),Z=1./dn,Znorm=(Z-1.)/49.;
  float D=uCamZ+Znorm*uDscale*uCamZ*.75,k=D/uCamZ;
  vec3 p=vec3((g-.5)*uPlane*k,-(D-uCamZ));
  gl_Position=uVP*vec4(p,1.);
  if(uTearT>0.&&(gx+gy)>uTearT)gl_Position=vec4(2.,2.,2.,1.);
}`;
  const RELIEF_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uMap,uSpec;uniform vec4 uW[8];uniform float uT,uHat,uHatOpen,uRide,uCrash,uSpecK;
in vec2 vUv;in float vD;in float vEdge;out vec4 o;
${HSL}
float h12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
  vec3 c=texture(uMap,vUv).rgb;
  c=mix(c,c*.55,vEdge*.35);
  vec2 bd=min(vUv,1.-vUv);c*=smoothstep(0.,.012,min(bd.x,bd.y));
  float band=1.-vD,lv=texture(uSpec,vec2(band,.5)).r;
  c*=1.+lv*lv*uSpecK*1.5+uCrash*.2;
  vec3 add=hsl(.66*band,.75,.55)*lv*lv*uSpecK*.3;
  for(int i=0;i<8;i++){float x=(vD-uW[i].x)/uW[i].y;add+=hsl(uW[i].w,.72,.62)*uW[i].z*exp(-x*x);}
  float h=h12(floor(gl_FragCoord.xy/2.)+floor(uT*30.));
  add+=vec3(.75,.9,1.)*step(.982,h)*vEdge*uHat*(1.7+uHatOpen*2.2);
  add+=vec3(.6,.75,1.)*uRide*smoothstep(.42,.0,vD)*.22*(.5+.5*sin(uT*16.+vUv.x*140.+vUv.y*90.));
  o=vec4(c+add,1.);
}`;
  const MASK_FS = `#version 300 es
precision highp float;
in vec2 vUv;in float vD;in float vEdge;out vec4 o;void main(){o=vec4(1.);}`;

  // The picture keeps its own values at rest: a soft shoulder above 0.8 and nothing else, not the grade the other worlds use.
  // It then passes the same flicker limiter as Post.finish: each region may change brightness only so fast.
  const PIC_GRADE_FS = FS_HEAD + `
uniform sampler2D uScene,uBloom;uniform float uBloomK,uFlash,uVig;uniform vec3 uFlashC;
void main(){
  vec3 c=texture(uScene,vUv).rgb+texture(uBloom,vUv).rgb*uBloomK+uFlashC*uFlash;
  c=mix(c,.8+.2*(1.-exp(-(c-.8)/.2)),step(.8,c));
  vec2 q=vUv-.5;c*=1.-uVig*smoothstep(.3,.95,dot(q,q)*2.1);
  o=vec4(c,1.);
}`;
  const PIC_LIMIT_FS = FS_HEAD + `
uniform sampler2D uCur,uPrev;uniform float uLod,uMax;
void main(){float cur=dot(textureLod(uCur,vUv,uLod).rgb,vec3(.2126,.7152,.0722));float prev=texture(uPrev,vUv).r;o=vec4(prev+clamp(cur-prev,-uMax,uMax),cur,0.,1.);}`;
  const PIC_OUT_FS = FS_HEAD + `
uniform sampler2D uG,uLim;uniform float uT;
float h12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 enc(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(.0031308,c));}
void main(){
  vec3 c=texture(uG,vUv).rgb;vec2 L=texture(uLim,vUv).rg;
  c*=clamp((L.x+.003)/(L.y+.003),.1,4.);
  o=vec4(enc(min(c,vec3(1.)))+(h12(gl_FragCoord.xy+fract(uT)*97.)-.5)*.006,1.);
}`;

  const GALLERY_FS = FS_HEAD + `
uniform vec3 uF,uR,uU,uEye;uniform vec2 uTan;uniform float uLoud,uKick,uCrash,uT;
${HSL}
void main(){
  vec2 n=vUv*2.-1.;
  vec3 d=normalize(uF+uR*n.x*uTan.x+uU*n.y*uTan.y);
  vec3 c=mix(vec3(.006,.007,.016),vec3(.02,.015,.05),smoothstep(-.3,.7,d.y));
  if(d.y<-.002){
    float t=(-1.02-uEye.y)/d.y;
    if(t>0.){vec3 p=uEye+d*t;float r=length(p.xz);
      float rings=smoothstep(.02,.0,abs(fract(r*2.5)-.5)-.47)*exp(-r*.55);
      c=mix(c,vec3(.008,.009,.02),smoothstep(.0,-.25,d.y));
      c+=vec3(.42,.42,.95)*exp(-r*r*.55)*(.05+.3*uLoud)+vec3(.5,.5,1.)*rings*.035;}
  }
  o=vec4(c,1.);
}`;
  const MESH_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aP;layout(location=1) in vec3 aN;layout(location=2) in float aO;
uniform mat4 uVP,uM;
out vec3 vN,vW,vL;out float vO;
void main(){vL=aP;vO=aO;vec4 w=uM*vec4(aP,1.);vW=w.xyz;vN=mat3(uM)*aN;gl_Position=uVP*w;}`;
  const MESH_FS = `#version 300 es
precision highp float;
uniform vec3 uEye;uniform vec4 uW[8];uniform float uT,uHat,uHatOpen,uRide,uCrash,uKick,uTom,uTomPos;
in vec3 vN,vW,vL;in float vO;out vec4 o;
${HSL}
void main(){
  vec3 N=normalize(vN+vec3(1e-5)),V=normalize(uEye-vW);
  float h=clamp(vL.y*.5+.5,0.,1.);
  // The desktop's height colors: low is amber, high is cyan.
  vec3 alb=pow(vec3(224.-100.*h,164.+40.*h,74.+160.*h)/255.,vec3(2.2))*.62;
  vec3 amb=mix(vec3(.09,.06,.05),vec3(.26,.34,.62),.5+.5*N.y)*vO;
  vec3 L1=normalize(vec3(2.,3.,2.)),L2=normalize(vec3(-2.,1.,-2.));
  vec3 H=normalize(L1+V);
  float nl=max(dot(N,L1),0.),sp=pow(max(dot(N,H),0.),70.),fr=pow(1.-max(dot(N,V),0.),3.2);
  vec3 c=alb*(amb+vec3(1.,.95,.86)*nl*.82*(.35+.65*vO)+vec3(.5,.7,1.)*max(dot(N,L2),0.)*.42)+vec3(1.)*sp*.5*vO+vec3(.5,.56,1.)*fr*(.13+.14*uKick+.08*uCrash)*vO;
  vec3 add=vec3(0.);
  for(int i=0;i<8;i++){float x=(vL.x-uW[i].x)/uW[i].y;add+=hsl(uW[i].w,.72,.6)*uW[i].z*exp(-x*x);}
  add+=hsl(.66*h,.7,.6)*exp(-pow((h-(.12+uTomPos*.42))*9.,2.))*uTom*1.0;
  add+=hsl(.55,.5,.72)*smoothstep(.62,.95,h)*uHat*fr*(1.2+uHatOpen*1.6);
  add+=vec3(.6,.75,1.)*uRide*.12*(.5+.5*sin(uT*16.+vL.x*30.));
  o=vec4(clamp(c*(1.+uCrash*.12)+add,vec3(0.),vec3(16.)),1.);
}`;

  /* ---------- the sheets ---------- */
  const hud = `
    <div class="gauge"><span class="k" id="g-a-k">Time</span><span class="v" id="g-a">--</span></div>
    <div class="gauge"><span class="k" id="g-b-k">Pitch</span><span class="v" id="g-b">--</span></div>
    <div class="gauge hero"><span class="k">Tempo</span><span class="v" id="g-hero">--</span></div>
    <div class="gauge"><span class="k">Hits</span><span class="v" id="g-hits">0</span></div>
    <div class="gauge"><span class="k">Level</span><span class="v" id="g-level">--</span></div>`;

  const worldSheet = `
    <div id="w-sound">
      <div class="row-actions">
        <button class="pill primary" id="snd-choose">Choose a sound</button>
        <button class="pill" id="snd-builtin">Use the built-in sound</button>
        <input type="file" id="snd-file" accept="audio/*" hidden>
      </div>
      <p class="world-readout" id="snd-status" role="status"></p>
      <label class="check" style="margin:0"><input type="checkbox" id="snd-hear"> Hear the field. An artistic mix of this sound, placed in space. It is not where the sound came from.</label>
      <p class="note">Live hits arrive at the far end and flow toward you, so flying forward is flying into the present. A file holds still, and walking along X walks through it.</p>
    </div>
    <div id="w-picture" hidden>
      <div class="row-actions">
        <button class="pill primary" id="pic-choose">Choose a picture</button>
        <button class="pill" id="pic-sample">Estimate depth on the painting</button>
        <button class="pill" id="pic-painted" hidden>Back to the painted scene</button>
        <input type="file" id="pic-file" accept="image/*" hidden>
      </div>
      <p class="world-readout" id="pic-status" role="status"></p>
      <div class="model-card" id="model-card" data-tone="idle">
        <strong>Depth model <span class="dot"></span></strong>
        <p class="state" id="model-state">Not downloaded</p>
        <p class="why" id="model-why">The painted scene needs no model. Your own picture does, once.</p>
        <div class="bar" id="model-bar-wrap" hidden><i id="model-bar"></i></div>
        <div class="row-actions">
          <button class="pill primary" id="model-go" hidden>Download and continue</button>
          <button class="pill" id="model-rule" hidden>Use the brightness rule instead</button>
          <button class="pill" id="model-clear" hidden>Remove the stored model</button>
        </div>
      </div>
      <p class="note">Your picture stays on this computer. The estimate runs in this browser and nothing about the picture is sent anywhere. The only downloads are the model, from Hugging Face, and its runtime, from jsDelivr.</p>
      <p class="note">Estimated depth: a neural network guessed how far away each pixel is. You are stepping into that guess, a relief and not a reconstructed scene. Where the picture tears open, that ground was never in your image. Movement is bounded so the illusion holds.</p>
      <label class="field"><div class="row"><span>Depth</span><b id="k-depth-v"></b></div><input type="range" id="k-depth" min="5" max="100"></label>
      <label class="field"><div class="row"><span>Tear at cliffs</span><b id="k-tear-v"></b></div><input type="range" id="k-tear" min="0" max="200"></label>
      <div class="row-actions"><button class="pill" id="pic-bake">Bake this angle (.zip)</button></div>
      <p class="note" id="bake-note">Saves this view, an exact mask of what the original camera never saw, and the pose. The desktop app's Detail Forge can fill those holes.</p>
    </div>
    <div id="w-print" hidden>
      <label class="field">Sound to cast<select id="cast-source"><option value="builtin">The built-in sound</option><option value="live">My last 12 seconds</option><option value="file" disabled>The sound I chose</option></select></label>
      <label class="field" style="margin-top:9px">Detail<select id="cast-detail"><option value="64">Coarse, grid of 64</option><option value="96" selected>Medium, grid of 96</option><option value="128">Fine, grid of 128</option></select></label>
      <div class="row-actions">
        <button class="pill primary" id="cast-go">Cast this sound</button>
        <button class="pill" id="cast-stl" disabled>Download STL</button>
        <button class="pill" id="cast-hear" disabled>Hear the sculpture</button>
      </div>
      <p class="world-readout" id="cast-status" role="status">Nothing cast yet.</p>
      <p class="note">Time runs along the base, pitch climbs and loudness swells. The same sound always casts the same shape on this page. It is a sculpture of the sound's structure, not a claim that sound looks like this.</p>
      <p class="note" id="cast-hear-note">Hearing it reverses the mapping, with no model: x is time, height is pitch, brightness is loudness and saturation is timbre.</p>
    </div>
    <details open><summary>View</summary><div class="controls-grid" style="padding:10px 0 0">
      <label class="field"><div class="row"><span>Look speed</span><b id="k-look-v"></b></div><input type="range" id="k-look" min="4" max="180"></label>
      <label class="field"><div class="row"><span>Field of view</span><b id="k-fov-v"></b></div><input type="range" id="k-fov" min="45" max="100"></label>
      <label class="field"><div class="row"><span>Reaction to hits</span><b id="k-react-v"></b></div><input type="range" id="k-react" min="0" max="200"></label>
      <label class="field"><div class="row"><span>Glow</span><b id="k-glow-v"></b></div><input type="range" id="k-glow" min="0" max="200"></label>
      <label class="check" style="margin:0"><input type="checkbox" id="k-inv"> Invert vertical look</label>
      <label class="check" style="margin:0"><input type="checkbox" id="k-free"> Free look: push the cursor from the center to turn</label>
      <label class="check" style="margin:0"><input type="checkbox" id="k-drift" checked> Drift when nobody is steering</label>
    </div></details>
    <details><summary>What stays in the desktop app</summary>
      <p>Grow World needs SDXL inpainting and Make 3D Object needs rembg and TripoSR. No browser path was found for them, so they stay in the desktop Enter app. So do the Sculpture Garden, which keeps works on disk, and Send to Detail Forge.</p>
    </details>`;

  const about = `
    <p class="sheet-intro">Three worlds. Sound and drums move them by stated rules. Depth in your own picture is the one learned part, and it is labeled.</p>
    <table class="maptable"><tbody>
      <tr><th>Sound world</th><td>A synesthetic map, not physical space. X is time, Y is log-pitch, depth and glow are salience, and color is timbre: low is warm, high is cool, and tonal sounds are more saturated. It is a sparse, heuristic decomposition of the sound, not the full waveform.</td></tr>
      <tr><th>Floor</th><td>The last twelve seconds as terrain: time along X, frequency across, loudness as height.</td></tr>
      <tr><th>Picture world</th><td>Estimated depth from a learned model, or a depth drawn by rule, and the badge says which. A relief, not a reconstructed scene.</td></tr>
      <tr><th>Print world</th><td>Atoms deposit into a density field, a surface is extracted, and a plinth is fused on. The check that it closes runs on the mesh itself. The desktop app uses marching cubes on the same field. This page uses marching tetrahedra.</td></tr>
      <tr><th>Spectrum</th><td>In the picture, depth carries the live spectrum: near is low, far is high.</td></tr>
      <tr><th>Kick</th><td>A wavefront from the nearest ground to the farthest, and the relief swells. In the field, a pulse back through time.</td></tr>
      <tr><th>Snare</th><td>A faster, paler wavefront, and a scatter of the field's mid and high atoms.</td></tr>
      <tr><th>Hi-hat</th><td>Glints on depth cliffs, or sparkle in the top third of the field. Opening the pedal widens it.</td></tr>
      <tr><th>Toms</th><td>A band at one depth or height, set by which tom.</td></tr>
      <tr><th>Crash</th><td>A wash of light. A choke cuts it short.</td></tr>
      <tr><th>Ride</th><td>A fine shimmer over the far ground.</td></tr>
    </tbody></table>
    <p class="note">Keys: <b>W A S D</b> move · <b>Q E</b> fall and rise · <b>Shift</b> run · <b>arrows</b> look · <b>R</b> reset · <b>1 2 3</b> worlds · <b>J K L</b> kick, snare, hat · <b>U I O</b> toms · <b>P</b> crash · <b>;</b> ride · <b>N</b> demo · <b>C</b> connect · <b>F</b> full screen · <b>H</b> hide controls. Drag to look, scroll to dolly.</p>`;

  const kit = createKit();
  const brand = '<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M5 25V8l7-5 7 5v17"/><path d="M12 25V13"/><circle cx="12" cy="10" r="1.6"/></svg>';
  const shell = mountShell({
    id: 'enter', name: 'Enter', brand, kit,
    modes: [{ id: 'sound', label: 'Sound' }, { id: 'picture', label: 'Picture' }, { id: 'print', label: 'Print' }], mode: 'sound', modeLabel: 'Which world',
    onMode: (m) => setWorld(m),
    intro: { eyebrow: 'Enter · walk into a picture, fly through a sound', title: 'Cross the surface.', subtitle: 'W A S D to move, drag to look. Connect your kit, or run the demo. No helper app.' },
    hud,
    truth: TRUTH.sound,
    sheets: [{ id: 'world', label: 'World', icon: 'sliders', title: 'Choose what to enter.', html: worldSheet }],
    about, canvas: () => cv, snapshot: (done) => { wantSnap = done; }, quality: () => (S.world === 'picture' ? `${S.seg} × ${S.seg} relief` : S.world === 'sound' ? `${(fileN + liveCount).toLocaleString()} atoms` : `${(M ? M.count / 3 : 0).toLocaleString()} faces`),
  });

  // The shell's About text is written for pages that make no requests. This page can make some, so it says so.
  function patchAbout() {
    const details = [...document.querySelectorAll('#about-sheet details')];
    const privacy = details.find((d) => /Safety and privacy/.test(d.textContent));
    const credit = details.find((d) => /Ideas credited/.test(d.textContent));
    const ps = privacy.querySelectorAll('p');
    ps[ps.length - 1].textContent = 'Audio and MIDI are analyzed in this browser and never sent anywhere. Your picture stays on this computer too. The page itself asks the network for nothing until you use the depth model on a picture of your own. Then it downloads the model from Hugging Face and its runtime from jsDelivr, once, and keeps them in this browser. Nothing about your picture goes with those requests. Your device choice and pad map stay in this browser\'s storage.';
    credit.querySelector('summary').textContent = 'Credits';
    const p = credit.querySelector('p');
    p.innerHTML = 'The depth model is <a href="https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf" rel="noopener">Depth Anything V2 Small</a> by Lihe Yang and colleagues (Apache-2.0), in the <a href="https://huggingface.co/onnx-community/depth-anything-v2-small" rel="noopener">ONNX build</a> from onnx-community. It runs on <a href="https://github.com/microsoft/onnxruntime" rel="noopener">ONNX Runtime Web</a> (MIT). Neither is part of this page: both download when you first need them. Everything else is written here, with ideas from <a href="https://github.com/jberg/butterchurn" rel="noopener">Butterchurn</a> (MIT), <a href="https://github.com/PavelDoGreat/WebGL-Fluid-Simulation" rel="noopener">WebGL Fluid Simulation</a> (MIT), <a href="https://github.com/loqwai/paper-cranes" rel="noopener">paper-cranes</a> (BSD-3-Clause), <a href="https://github.com/audiojs/beat" rel="noopener">@audio/beat</a> and <a href="https://github.com/dlepaux/realtime-bpm-analyzer" rel="noopener">realtime-bpm-analyzer</a> (Apache-2.0).';
    const f = [...document.querySelectorAll('#connect-sheet p')].find((x) => /synthetic drum machine/.test(x.textContent));
    if (f) f.textContent = 'The demo is a synthetic drum machine. It runs through the same analysis and is labeled on screen the whole time.';
  }
  patchAbout();
  if (matchMedia('(pointer: coarse)').matches) { const sub = document.querySelector('.intro p:last-child'); if (sub) sub.textContent = 'Drag to look, hold Fwd to fly, pinch to move. Connect your kit, or run the demo.'; }

  const scene0 = $('scene');
  scene0.insertAdjacentHTML('beforeend', `
    <div id="axis-labels" aria-hidden="true"></div>
    <div id="reticle" aria-hidden="true"></div>
    <div id="tether" aria-hidden="true"></div>
    <div id="world-info" class="chrome"><p id="world-badge" data-kind="sound"></p><p id="world-source"></p></div>
    <div id="touch-pad" class="chrome"><button id="touch-fwd" aria-label="Move forward">Fwd</button><button id="touch-back" aria-label="Move back">Back</button></div>`);
  $('truth').insertAdjacentHTML('afterend', '<p id="credit-line" class="chrome">Picture depth, when you ask for it: Depth Anything V2 Small (Apache-2.0) on ONNX Runtime Web (MIT), both downloaded on first use.</p>');
  $('chip-midi').insertAdjacentHTML('afterend', '<button class="chip chrome" id="chip-model" data-tone="wait" hidden><span class="dot" aria-hidden="true"></span><span id="chip-model-text"></span></button>');
  $('chip-model').addEventListener('click', () => { shell.setMode('picture'); shell.openSheet('world'); });

  const cv = $('stage');
  const G = createGL(cv);
  let gl, Post, pSprite, pTerrain, pTrail, pSky, pRelief, pMask, pPicGrade, pPicLimit, pPicOut, pGallery, pMesh;
  const picLim = { graded: null, a: null, b: null, lod: 0, fresh: true };
  let tN, tHist, tSpec, points, trailA, trailB, scene, msaa, maskT, rw = 0, rh = 0;
  let wantSnap = null, strongGPU = false;
  const specBytes = new Uint8Array(kit.BANDS * 4);

  /* ---------- math ---------- */
  function perspective(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
  function lookAt(e, c, u) {
    let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map((v) => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map((v) => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return { m: [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1], x, y, z };
  }
  function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
  function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}<small>kHz</small>` : `${Math.round(f)}<small>Hz</small>`);
  const mb = (n) => (n / 1e6).toFixed(n < 1e7 ? 1 : 0);
  // Where a relief vertex lands. The same arithmetic as the vertex shader, so the numbers can be checked from the page.
  function reliefPoint(x, y, d, dscale, camZ) { const dn = Math.max(d, 0.02), Znorm = (1 / dn - 1) / 49, D = camZ + Znorm * dscale * camZ * 0.75, k = D / camZ; return [x * k, y * k, -(D - camZ)]; }

  /* ---------- rig ---------- */
  const noteInput = () => { S.lastInput = performance.now(); if (!S.moved) { S.moved = true; document.body.classList.add('moved'); } };
  const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, select, textarea, dialog[open]')) return;
    if (MOVE.has(e.code)) { keys[e.code] = true; noteInput(); if (e.code.startsWith('Arrow')) e.preventDefault(); e.stopImmediatePropagation(); }   // the shell's D key is the demo; here D is a step right
  }, true);
  addEventListener('keyup', (e) => { keys[e.code] = false; }, true);
  addEventListener('blur', () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); aim.active = false; });
  const aim = { x: 0, y: 0, active: false };
  let dragging = null, pinch = null;
  const touches = new Map();
  cv.addEventListener('pointerdown', (e) => { touches.set(e.pointerId, e); dragging = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); noteInput(); if (S.world === 'print') S.cast.auto = false; });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(); aim.x = ((e.clientX - r.left) / r.width) * 2 - 1; aim.y = ((e.clientY - r.top) / r.height) * 2 - 1; aim.active = true;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, e);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch != null) dolly((d - pinch) * 0.03);
      pinch = d; return;
    }
    if (!dragging) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; dragging = { x: e.clientX, y: e.clientY };
    if (S.world === 'print') { S.cast.ry += dx * 0.008; S.cast.rx = clamp(S.cast.rx + dy * 0.008, -1.4, 1.4); return; }
    const c = cams[S.world], k = 0.0035 * (S.look / 0.22), sign = S.inv ? 1 : -1;
    c.yaw -= dx * k; c.pitch = clamp(c.pitch + sign * dy * k, -1.45, 1.45);
    cv.style.cursor = 'grabbing';
  });
  const up = (e) => { touches.delete(e.pointerId); pinch = null; if (!touches.size) dragging = null; cv.style.cursor = 'grab'; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { aim.active = false; });
  cv.style.cursor = 'grab';
  function dolly(units) {
    noteInput();
    if (S.world === 'print') { S.cast.dist = clamp(S.cast.dist - units * 0.2, 1.2, 7); return; }
    const f = forward(cams[S.world]), c = cams[S.world];
    for (let i = 0; i < 3; i++) c.pos[i] += f[i] * units;
  }
  cv.addEventListener('wheel', (e) => { e.preventDefault(); dolly(-e.deltaY * 0.012); }, { passive: false });
  const hold = (id, code) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys[code] = true; noteInput(); }); ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, () => { keys[code] = false; })); };
  hold('touch-fwd', 'KeyW'); hold('touch-back', 'KeyS');
  const forward = (c) => [-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch)];
  function resetRig() { const c = cams[S.world]; if (!c) { S.cast.dist = 3.9; S.cast.rx = -0.12; return; } c.pos = c.spawn.pos.slice(); c.yaw = c.spawn.yaw; c.pitch = c.spawn.pitch; c.vel = [0, 0, 0]; }

  function rigStep(dt, now) {
    if (S.world === 'print') {
      const a = keys.ArrowLeft ? -1 : keys.ArrowRight ? 1 : 0, b = keys.ArrowUp ? -1 : keys.ArrowDown ? 1 : 0;
      if (a || b) { S.cast.ry += a * dt * 1.4; S.cast.rx = clamp(S.cast.rx + b * dt, -1.4, 1.4); S.cast.auto = false; }
      if (S.cast.auto && !RM.matches) S.cast.ry += dt * 0.25;
      return;
    }
    const c = cams[S.world];
    if (keys.ArrowLeft) c.yaw += dt * 1.3 * (S.look / 0.22);
    if (keys.ArrowRight) c.yaw -= dt * 1.3 * (S.look / 0.22);
    if (keys.ArrowUp) c.pitch = clamp(c.pitch + dt * (S.look / 0.22), -1.45, 1.45);
    if (keys.ArrowDown) c.pitch = clamp(c.pitch - dt * (S.look / 0.22), -1.45, 1.45);
    if (S.free && aim.active && !dragging) {
      const shape = (v) => { const a = Math.abs(v); if (a < 0.02) return 0; return Math.sign(v) * (0.1 + 0.9 * Math.min(1, (a - 0.02) / 0.98)); }, R = 1.7 * (S.look / 0.22);
      c.yaw -= shape(aim.x) * R * dt; c.pitch = clamp(c.pitch + (S.inv ? 1 : -1) * shape(aim.y) * R * 0.7 * dt, -1.45, 1.45);
    }
    const f = forward(c), r = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)], sp = c.speed * (keys.ShiftLeft || keys.ShiftRight ? 2.6 : 1), acc = [0, 0, 0];
    const add = (v, s) => { acc[0] += v[0] * s; acc[1] += v[1] * s; acc[2] += v[2] * s; };
    if (keys.KeyW) add(f, 1); if (keys.KeyS) add(f, -1); if (keys.KeyD) add(r, 1); if (keys.KeyA) add(r, -1); if (keys.KeyE) acc[1] += 1; if (keys.KeyQ) acc[1] -= 1;
    const l = Math.hypot(...acc); if (l > 0) for (let i = 0; i < 3; i++) acc[i] = (acc[i] / l) * sp;
    const k = 1 - Math.exp(-dt * 8);
    for (let i = 0; i < 3; i++) { c.vel[i] += (acc[i] - c.vel[i]) * k; c.pos[i] += c.vel[i] * dt; }
    // Nobody steering: a slow drift shows the depth and keeps the world alive.
    if (S.drift && !RM.matches && now - S.lastInput > 14000 && !$('world-sheet').open) {
      const t = now / 1000, q = 1 - Math.exp(-dt * 0.5);
      let g;
      if (S.world === 'sound') g = { p: [-FS * 0.82 + Math.sin(t * 0.06) * FS * 0.3, -3 + Math.sin(t * 0.13) * 5, FS * 0.28 + Math.sin(t * 0.09) * 6], yaw: -Math.PI / 2 + Math.sin(t * 0.07) * 0.24, pitch: -0.1 + Math.sin(t * 0.11) * 0.07 };
      else { const camZ = P ? P.camZ : 8.5, x = Math.sin(t * 0.17) * (P ? P.planeW : 12) * 0.045, y = Math.sin(t * 0.13) * (P ? P.planeH : 10) * 0.03, z = camZ * (0.84 + 0.1 * Math.sin(t * 0.11)); g = { p: [x, y, z], yaw: Math.atan2(x, z) * 0.75, pitch: -Math.atan2(y, z) * 0.75 }; }
      for (let i = 0; i < 3; i++) c.pos[i] += (g.p[i] - c.pos[i]) * q;
      c.yaw += (g.yaw - c.yaw) * q; c.pitch += (g.pitch - c.pitch) * q;
    }
    tetherStep(c, dt);
  }
  let tetherOut = false;
  function tetherStep(c, dt) {
    const p = c.pos; let out = false; const pull = (i, lim0, lim1) => { if (p[i] < lim0) { p[i] += (lim0 - p[i]) * Math.min(1, dt * 4); out = true; } if (p[i] > lim1) { p[i] += (lim1 - p[i]) * Math.min(1, dt * 4); out = true; } };
    if (S.world === 'sound') { const lim = FS * 1.6; pull(0, -lim, lim); pull(1, -lim, lim); pull(2, -lim, lim); } else if (P) { pull(2, 1.1, P.planeH * 1.35); const xl = P.planeW * 0.34, yl = P.planeH * 0.34; pull(0, -xl, xl); pull(1, -yl, yl); }
    if (out !== tetherOut) { tetherOut = out; $('tether').classList.toggle('show', out); $('tether').textContent = S.world === 'sound' ? 'Edge of the sound field' : 'Edge of plausible parallax'; }
  }

  /* ---------- the sound world's data ---------- */
  const LIVE_N = 8192, liveData = new Float32Array(LIVE_N * 6).fill(-1), liveR = mulberry(20261102);
  let liveHead = 0, liveCount = 0, vaoLive = null, vboLive = null, vaoFile = null, vboFile = null, fileN = 0, liveDirty = false;
  const Sound = { name: 'built-in', atoms: null, dur: 12, rate: 44100, label: 'Built-in sound: a synthesized pattern, not your audio', fromFile: false };
  const toV = (f, rate) => { const hi = Math.log((rate || 44100) / 2); return ((Math.log(Math.max(40, f)) - LF0) / (hi - LF0)) * 2 - 1; };
  function pushLive(v, amp, ton, born) {
    const i = liveHead * 6;
    liveData.set([0, clamp(v, -1, 1), liveR(), amp, ton, born], i);
    liveHead = (liveHead + 1) % LIVE_N; liveCount = Math.min(LIVE_N, liveCount + 1); liveDirty = true;
  }
  const sTime = () => performance.now() / 1000;
  kit.on('column', (x) => {
    if (G && tHist) { G.bindTex(0, tHist); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, x, 0, 1, kit.BANDS, gl.RG, gl.UNSIGNED_BYTE, kit.column); }
    const c = kit.column, B = kit.BANDS, born = sTime(), ton = kit.tonal;
    for (let i = 1; i < B - 1; i++) {
      const v = c[i * 2] / 255;
      if (v > 0.26 && c[i * 2] >= c[(i - 1) * 2] && c[i * 2] > c[(i + 1) * 2]) pushLive(toV(KitMath.bandFreq(i)) + (liveR() - 0.5) * 0.02, v * v, ton, born);
    }
  });
  // Pulses and wavefronts: each hit starts one, in its stated shape.
  const pulses = [], fronts = []; let lastPulse = -1e9;
  const VOICE_HUE = { kick: 0.03, snare: 0.12, hat: 0.5, tom: 0.28, crash: 0.08, ride: 0.58 };
  kit.on('hit', (h) => {
    const v = h.vel * S.react * (RM.matches ? 0.35 : 1), now = performance.now();
    if (h.voice === 'kick' && now - lastPulse > 450) { pulses.push({ t0: now, s: v, speed: 0.45, k: 6 }); lastPulse = now; }
    if (pulses.length > 4) pulses.shift();
    if (h.voice === 'kick') fronts.push({ t0: now, from: 1.02, to: -0.1, dur: 900, w: 0.045, s: 1.05 * v, hue: VOICE_HUE.kick });
    else if (h.voice === 'snare') fronts.push({ t0: now, from: 1.02, to: -0.1, dur: 430, w: 0.03, s: 0.8 * v, hue: VOICE_HUE.snare });
    else if (h.voice === 'tom') fronts.push({ t0: now, from: 0.8 - kit.env.tomPos * 0.7, to: 0.8 - kit.env.tomPos * 0.7, dur: 500, w: 0.05, s: 1.15 * v, hue: VOICE_HUE.tom, still: true });
    else if (h.voice === 'crash') fronts.push({ t0: now, from: 0.5, to: 0.5, dur: 1200, w: 0.85, s: 0.42 * v, hue: VOICE_HUE.crash, still: true });
    if (fronts.length > 8) fronts.shift();
    // A burst of atoms at this drum's pitch, so the present keeps its sharp events.
    const ctr = { kick: 70, snare: 240, hat: 9000, tom: 95 + kit.env.tomPos * 200, crash: 7000, ride: 4200 }[h.voice] || 300, wide = { kick: 0.05, snare: 0.5, hat: 0.1, tom: 0.05, crash: 0.5, ride: 0.2 }[h.voice] || 0.1, n = Math.round(4 + h.vel * 12), born = sTime();
    for (let i = 0; i < n; i++) pushLive(toV(ctr) + (liveR() - 0.5) * wide, Math.pow(h.vel, 1.3) * (0.5 + liveR() * 0.5), h.voice === 'tom' || h.voice === 'kick' ? 0.8 : 0.2, born - liveR() * 0.04);
  });
  function builtInSound() {
    const r = mulberry(4242), atoms = [], dur = 12, bpm = 104, st = 60 / bpm / 4;
    for (let s = 0; s * st < dur; s++) {
      const t = s * st, b = s % 16;
      const add = (f, amp, ton) => atoms.push({ time: t + (r() - 0.5) * 0.03, f, amp, ton });
      if (b === 0 || b === 6 || b === 8) { for (let i = 0; i < 3; i++) add(52 + r() * 24, 0.56 + r() * 0.2, 0.75); }
      if (b === 4 || b === 12) { for (let i = 0; i < 8; i++) add(160 * Math.pow(30, r()), 0.32 + r() * 0.42, 0.18); }
      if (b % 2 === 0) { for (let i = 0; i < 5; i++) add(6500 + r() * 8000, 0.2 + r() * 0.26, 0.12); }
      if (b % 4 === 2) { [110, 165, 220, 277, 330, 440, 660, 880].forEach((f, i) => { if (r() < 0.8) add(f * (1 + (r() - 0.5) * 0.006), (0.56 - i * 0.05) * (0.7 + 0.3 * r()), 0.92); }); }
    }
    return { atoms, dur, rate: 44100 };
  }
  function atomsToField(atoms, dur, rate) {
    const n = atoms.length, d = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const a = atoms[i]; d.set([((a.time / dur) * 2 - 1), toV(a.f, rate), mulberry(i * 7 + 1)(), a.amp, a.ton == null ? 0.6 : a.ton, 0], i * 6); }
    return d;
  }
  function setField(atoms, dur, rate, label, fromFile) {
    Sound.atoms = atoms; Sound.dur = dur; Sound.rate = rate; Sound.label = label; Sound.fromFile = fromFile;
    fileN = atoms.length;
    if (G && gl) { gl.bindBuffer(gl.ARRAY_BUFFER, vboFile); gl.bufferData(gl.ARRAY_BUFFER, atomsToField(atoms, dur, rate), gl.STATIC_DRAW); }
    $('snd-status').innerHTML = `<b>${label}</b> · ${atoms.length.toLocaleString()} atoms over ${dur.toFixed(1)} s`;
    if (S.world === 'sound') renderWorldLabels();
    rebuildVoices();
  }

  /* positional voices, ported from the desktop: k-means over the atoms, one looping voice for each cluster */
  const Voices = { ac: null, master: null, nodes: [], list: [] };
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
  function stopVoices() { Voices.nodes.forEach((n) => { try { n.src.stop(); n.src.disconnect(); n.gain.disconnect(); n.pan.disconnect(); } catch (e) { /* ended */ } }); Voices.nodes = []; }
  function rebuildVoices() {
    stopVoices(); Voices.list = [];
    if (!$('snd-hear').checked || !Sound.atoms) return;
    const atoms = Sound.atoms.slice(0, 900), n = atoms.length, K = clamp(Math.floor(n / 40), 4, 14), pos = new Float32Array(n * 3), rk = mulberry(99);
    atoms.forEach((a, i) => { const v = toV(a.f, Sound.rate); pos[i * 3] = ((a.time / Sound.dur) * 2 - 1) * FS; pos[i * 3 + 1] = v * FS * 0.62; pos[i * 3 + 2] = ((mulberry(i * 7 + 1)() * 2 - 1) * 0.5 + (a.amp - 0.5)) * FS * 0.55; });
    const cent = [], assign = new Int32Array(n);
    for (let k = 0; k < K; k++) { const i = Math.floor(rk() * n); cent.push([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); }
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < n; i++) { let bd = 1e18, bk = 0; for (let k = 0; k < K; k++) { const dx = pos[i * 3] - cent[k][0], dy = pos[i * 3 + 1] - cent[k][1], dz = pos[i * 3 + 2] - cent[k][2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bk = k; } } assign[i] = bk; }
      const acc = cent.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) { const a = acc[assign[i]]; a[0] += pos[i * 3]; a[1] += pos[i * 3 + 1]; a[2] += pos[i * 3 + 2]; a[3]++; }
      acc.forEach((a, k) => { if (a[3]) cent[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
    Voices.ac = Voices.ac || new (window.AudioContext || window.webkitAudioContext)();
    const ac = Voices.ac; ac.resume();
    if (!Voices.master) { Voices.master = ac.createGain(); Voices.master.gain.value = 0.8; Voices.master.connect(ac.destination); }
    for (let k = 0; k < K; k++) {
      const cat = []; atoms.forEach((a, i) => { if (assign[i] === k) cat.push({ time: (cat.length % 40) * 0.07, f: a.f, amp: a.amp, tone: a.ton }); });
      if (!cat.length) continue;
      const wav = synthAtoms(cat, 3, ac.sampleRate, 777 + k); let pk = 0; for (let i = 0; i < wav.length; i++) pk = Math.max(pk, Math.abs(wav[i]));
      if (pk > 0) for (let i = 0; i < wav.length; i++) wav[i] *= 0.7 / pk;
      const b = ac.createBuffer(1, wav.length, ac.sampleRate); b.getChannelData(0).set(wav);
      const src = ac.createBufferSource(); src.buffer = b; src.loop = true;
      const pan = ac.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 4.5; pan.setPosition(cent[k][0], cent[k][1], cent[k][2]);
      const gain = ac.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(0.85, ac.currentTime, 0.4);
      src.connect(gain); gain.connect(pan); pan.connect(Voices.master); src.start();
      Voices.nodes.push({ src, gain, pan });
    }
    Voices.list = cent;
  }
  function updateListener() {
    if (!Voices.ac || !Voices.nodes.length) return;
    const c = cams.sound, f = forward(c), L = Voices.ac.listener;
    Voices.master.gain.value = S.world === 'sound' ? 0.8 : 0;
    if (L.positionX) { L.positionX.value = c.pos[0]; L.positionY.value = c.pos[1]; L.positionZ.value = c.pos[2]; L.forwardX.value = f[0]; L.forwardY.value = f[1]; L.forwardZ.value = f[2]; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else { L.setPosition(c.pos[0], c.pos[1], c.pos[2]); L.setOrientation(f[0], f[1], f[2], 0, 1, 0); }
  }
  const cast = EnterCast.create();
  async function decodeFile(f) {
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 44100);
    const buf = await ac.decodeAudioData(await f.arrayBuffer());
    const secs = Math.min(20, buf.duration), mono = new Float32Array(Math.floor(secs * buf.sampleRate));
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
    return { mono, rate: buf.sampleRate };
  }
  async function useSoundFile(f) {
    $('snd-status').textContent = `Reading ${f.name}.`;
    try {
      const { mono, rate } = await decodeFile(f);
      let pk = 0; for (let i = 0; i < mono.length; i++) pk = Math.max(pk, Math.abs(mono[i]));
      if (pk < 1e-4) { $('snd-status').textContent = `${f.name} is silent, so there is nothing to lift. The field did not change.`; return; }
      $('snd-status').textContent = 'Lifting the atoms out of the sound.';
      const r = await cast.atoms(mono.slice(0), rate, 1200);
      Cast.file = { name: f.name, atoms: r.atoms, dur: r.dur, rate };
      const opt = document.querySelector('#cast-source option[value=file]'); opt.disabled = false; opt.textContent = `The sound I chose: ${f.name}`; $('cast-source').value = 'file';
      $('snd-hear').checked = true;
      setField(r.atoms, r.dur, rate, `Your sound: ${f.name}`, true);
      updateSource();
      shell.toast(`${r.atoms.length.toLocaleString()} atoms lifted from ${f.name}.`);
    } catch (err) { $('snd-status').textContent = `That file could not be decoded: ${err.message || err}. The field did not change.`; }
  }
  $('snd-choose').addEventListener('click', () => $('snd-file').click());
  $('snd-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) useSoundFile(f); });
  $('snd-builtin').addEventListener('click', () => { const b = builtInSound(); setField(b.atoms, b.dur, b.rate, 'Built-in sound: a synthesized pattern, not your audio', false); updateSource(); });
  $('snd-hear').addEventListener('change', rebuildVoices);

  /* ---------- the picture world's data ---------- */
  let P = null, tMap = null, tDepth = null;
  const depth = EnterDepth.create(onModelState);
  let pending = null;
  function paintScene(W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H), px = img.data, dep = new Float32Array(W * H);
    const r = mulberry(70417), tbl = new Float32Array(2048); for (let i = 0; i < 2048; i++) tbl[i] = r();
    const n1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return tbl[i & 2047] * (1 - u) + tbl[(i + 1) & 2047] * u; };
    const fbm = (x, oct) => { let a = 0.5, s = 0; for (let o = 0; o < oct; o++) { s += a * n1(x); x = x * 2.03 + 17.3; a *= 0.5; } return s; };
    const ramp = (t) => { const S0 = [[0, 12, 16, 48], [0.33, 40, 31, 98], [0.56, 120, 58, 124], [0.74, 224, 112, 96], [0.86, 255, 190, 124], [1, 255, 226, 176]]; for (let i = 1; i < S0.length; i++) if (t <= S0[i][0]) { const a = S0[i - 1], b = S0[i], u = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]; } return [255, 226, 176]; };
    const water = 0.69, sunX = 0.63 * W, sunY = 0.58 * H, sunR = 0.062 * H, A = W / H;
    const L = [
      { y: 0.60, amp: 0.05, f: 2.6, d: 0.035, near: 0.05, seed: 11, pine: 0 }, { y: 0.615, amp: 0.085, f: 3.5, d: 0.05, near: 0.14, seed: 37, pine: 0 },
      { y: 0.64, amp: 0.11, f: 4.3, d: 0.07, near: 0.28, seed: 91, pine: 0 }, { y: 0.67, amp: 0.13, f: 5.5, d: 0.10, near: 0.44, seed: 151, pine: 0.006 },
    ];
    const bank = [{ side: 0, x1: 0.42, y: 0.78, amp: 0.34, f: 3.4, d: 0.42, near: 0.82, seed: 211, pine: 0.022 }, { side: 1, x1: 0.62, y: 0.86, amp: 0.3, f: 3.0, d: 0.62, near: 0.92, seed: 271, pine: 0.034 }, { side: 0, x1: 0.26, y: 0.98, amp: 0.34, f: 4.6, d: 1.0, near: 1, seed: 331, pine: 0.05 }];
    const ridge = (l, x) => { const u = x / W; return l.y - l.amp * (fbm(u * l.f * A + l.seed, 5) - 0.32) - (l.pine ? l.pine * Math.pow(Math.abs(2 * n1(u * 150 * A + l.seed) - 1), 1.4) + l.pine * 0.5 * Math.pow(n1(u * 380 * A), 3) : 0); };
    const hor = new Float32Array(W * L.length); for (let k = 0; k < L.length; k++) for (let x = 0; x < W; x++) hor[x + k * W] = ridge(L[k], x);
    const set = (i, cc) => { px[i * 4] = cc[0]; px[i * 4 + 1] = cc[1]; px[i * 4 + 2] = cc[2]; px[i * 4 + 3] = 255; };
    const n2 = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), h = (a, b) => tbl[((a * 57 + b * 131) ^ (b * 7)) & 2047]; return (h(ix, iy) * (1 - ux) + h(ix + 1, iy) * ux) * (1 - uy) + (h(ix, iy + 1) * (1 - ux) + h(ix + 1, iy + 1) * ux) * uy; };
    const fbm2 = (x, y, o) => { let a = 0.5, s = 0; for (let k = 0; k < o; k++) { s += a * n2(x, y); const nx = x * 1.62 + y * 1.18 + 13.1; y = y * 1.62 - x * 1.18 + 7.7; x = nx; a *= 0.5; } return s; };
    const skyAt = (x, y, plain) => {
      const v = y / (water * H), base = ramp(Math.min(1, Math.pow(v, 1.15))), dx = x - sunX, dy = (y - sunY), d = Math.hypot(dx, dy), glow = Math.exp(-d / (0.3 * H)) * 0.55 + Math.exp(-d / (0.08 * H)) * 0.5;
      const out = [base[0] + 255 * glow * 0.8, base[1] + 190 * glow * 0.8, base[2] + 120 * glow * 0.75];
      if (plain) return out;
      const sx = 3.6 / W, wx = fbm2(x * sx * 1.1 + 40, y * sx * 4, 3) * 2.4, cl = fbm2(x * sx + wx, y * sx * 5.4 + wx * 0.7 + 9, 6), band = Math.max(0, Math.min(1, (cl - 0.46) / 0.26)), lit = Math.pow(Math.min(1, v * 1.25), 1.6);
      const tint = [36 + 214 * lit, 26 + 96 * lit, 74 + 44 * lit]; for (let k = 0; k < 3; k++) out[k] += (tint[k] - out[k]) * band * (0.28 + 0.42 * lit);
      if (d < sunR) { const e = Math.min(1, (sunR - d) / 3); out[0] += 255 * e; out[1] += 225 * e; out[2] += 170 * e; }
      return out;
    };
    for (let y = 0; y < H; y++) {
      const yn = y / H;
      for (let x = 0; x < W; x++) {
        const i = x + y * W;
        let cc = null, d = 0.012 * (1 - yn);
        if (yn < water) {
          cc = skyAt(x, y);
          if (yn < 0.42) { const h = tbl[(x * 31 + y * 57 * 2048) & 2047] * tbl[(x * 13 + y * 1999) & 2047]; if (h > 0.9) cc = cc.map((v, q) => v + (h - 0.9) * 1500 * (1 - yn * 1.9) * [1, 0.95, 1.1][q]); }
          for (let k = 0; k < L.length; k++) {
            const top = hor[x + k * W];
            if (yn >= top) {
              const t = Math.min(1, (yn - top) / 0.14), near = L[k].near, hazeC = skyAt(x, Math.max(0, (top - 0.02) * H), true), dark = [30 - 18 * near, 26 - 14 * near, 62 - 34 * near], mist = (1 - near) * (0.5 + 0.5 * t) * 0.82;
              cc = [dark[0] + (hazeC[0] - dark[0]) * mist, dark[1] + (hazeC[1] - dark[1]) * mist, dark[2] + (hazeC[2] - dark[2]) * mist];
              d = L[k].d * (0.9 + 0.1 * t);
            }
          }
        }
        if (cc) set(i, cc);
        dep[i] = d;
      }
    }
    for (let y = Math.floor(water * H); y < H; y++) {       // the lake: a ground plane with its own depth, mirroring what is above it
      const t = (y / H - water) / (1 - water), my = Math.floor(water * H) - (y - Math.floor(water * H)) * 1.15 - 1;
      for (let x = 0; x < W; x++) {
        const i = x + y * W, wob = (fbm(x * 0.012 + y * 0.45, 3) - 0.35) * (6 + 50 * t), sx = clamp(Math.round(x + wob), 0, W - 1), j = sx + Math.max(0, Math.round(my)) * W;
        const m = 0.74 - 0.5 * t, cc = [px[j * 4] * m + 8, px[j * 4 + 1] * m + 8, px[j * 4 + 2] * m + 18];
        const gl0 = Math.max(0, 1 - Math.abs(x - sunX) / (W * (0.03 + 0.09 * t))) * (fbm(x * 0.05 + y * 0.9, 2) > 0.34 ? 1 : 0.2);
        cc[0] += 120 * gl0 * (1 - t * 0.7); cc[1] += 78 * gl0 * (1 - t * 0.7); cc[2] += 40 * gl0 * (1 - t * 0.7);
        set(i, cc); dep[i] = 0.1 + t * t * 0.58 + t * 0.2;
      }
    }
    for (const b of bank) {                                  // near banks and pines, the things that move most
      for (let x = 0; x < W; x++) {
        const u = x / W, edge = b.side === 0 ? Math.max(0, (b.x1 - u) / b.x1) : Math.max(0, (u - b.x1) / (1 - b.x1));
        if (edge <= 0) continue;
        const top = b.y - b.amp * Math.pow(edge, 0.62) - (b.pine * (Math.pow(Math.abs(2 * n1(u * 46 * A + b.seed) - 1), 1.2) + 0.35 * Math.pow(n1(u * 130 * A + b.seed), 2))) * Math.min(1, edge * 4) + (fbm(u * b.f * 4 + b.seed, 3) - 0.3) * 0.05;
        for (let y = Math.max(0, Math.floor(top * H)); y < H; y++) {
          const i = x + y * W, t = Math.min(1, (y / H - top) / 0.2), rim = Math.exp(-Math.abs(x - sunX) / (0.45 * W)) * Math.exp(-(y / H - top) * 90) * (1.2 - b.near);
          set(i, [14 - 9 * b.near * t + 170 * rim, 11 - 6 * b.near * t + 96 * rim, 30 - 16 * b.near * t + 62 * rim]);
          dep[i] = b.d * (0.93 + 0.07 * t);
        }
      }
    }
    g.putImageData(img, 0, 0);
    // Two passes of a 5-pixel box: real depth maps are smooth at this scale, and the tear behaves on smooth edges.
    const tmp = new Float32Array(W * H);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) { let a = 0; for (let x = -2; x < W; x++) { a += dep[Math.min(W - 1, x + 2) + y * W]; if (x >= 3) a -= dep[x - 3 + y * W]; if (x >= 0) tmp[x + y * W] = a / (Math.min(W - 1, x + 2) - Math.max(0, x - 2) + 1); } }
      for (let x = 0; x < W; x++) { let a = 0; for (let y = -2; y < H; y++) { a += tmp[x + Math.min(H - 1, y + 2) * W]; if (y >= 3) a -= tmp[x + (y - 3) * W]; if (y >= 0) dep[x + y * W] = a / (Math.min(H - 1, y + 2) - Math.max(0, y - 2) + 1); } }
    }
    return { canvas: c, depth: dep, w: W, h: H };
  }
  function setPicture(canvas, dep, w, h, kind, name, extra) {
    const rgba = { internal: gl.R32F, format: gl.RED, type: gl.FLOAT };
    if (tMap) gl.deleteTexture(tMap); if (tDepth) gl.deleteTexture(tDepth);
    tMap = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tMap);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    tDepth = G.tex(w, h, rgba, { nearest: true, data: dep });
    const planeH = 10, planeW = planeH * (w / h), camZ = planeH * 0.85;
    P = { kind, name, w, h, depth: dep, planeW, planeH, camZ, canvas, unseen: null, ...extra };
    const c = cams.picture; c.spawn = { pos: [0, 0, camZ], yaw: 0, pitch: 0 }; if (S.world === 'picture' || kind !== 'painted') { c.pos = [0, 0, camZ]; c.yaw = 0; c.pitch = 0; c.vel = [0, 0, 0]; }
    $('pic-painted').hidden = kind === 'painted';
    updateSource();
  }
  function fitCanvas(src, maxSide) {
    const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height, s = Math.min(1, maxSide / Math.max(iw, ih)), w = Math.max(2, Math.round(iw * s)), h = Math.max(2, Math.round(ih * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
    return c;
  }
  function brightnessDepth(c) {
    const w = c.width, h = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    return KitDepth.normalize(out);
  }
  let paintedCache = null;
  function showPainted() {
    if (!paintedCache) paintedCache = paintScene(innerWidth < 800 ? 1080 : 1620, innerWidth < 800 ? 720 : 1080);
    setPicture(paintedCache.canvas, paintedCache.depth, paintedCache.w, paintedCache.h, 'painted', 'The painted scene');
    $('pic-status').innerHTML = '<b>The painted scene.</b> Drawn on this page by rules, with its depth drawn by the same rules. No model is involved.';
  }

  /* the model's visible state */
  const modelUI = (tone, state, why, opts) => {
    opts = opts || {};
    $('model-card').dataset.tone = tone; $('model-state').textContent = state; $('model-why').textContent = why || '';
    $('model-go').hidden = !opts.go; $('model-rule').hidden = !opts.rule; $('model-clear').hidden = !opts.clear;
    if (opts.goText) $('model-go').textContent = opts.goText;
    const bar = opts.progress != null; $('model-bar-wrap').hidden = !bar; if (bar) $('model-bar').style.width = `${(opts.progress * 100).toFixed(1)}%`;
    const chip = $('chip-model'); chip.hidden = !opts.chip; if (opts.chip) { chip.dataset.tone = tone; $('chip-model-text').textContent = opts.chip; }
  };
  function onModelState(s) {
    if (s.state === 'downloading') {
      const pct = s.total ? s.got / s.total : 0;
      modelUI('wait', `Downloading · ${mb(s.got)} of ${mb(s.total)} MB`, `The model from Hugging Face and its runtime from jsDelivr. Your picture is not part of this. Closing this sheet is fine.`, { progress: pct, chip: `Depth model · downloading ${Math.round(pct * 100)}%` });
    } else if (s.state === 'loading') {
      modelUI('wait', 'Starting the depth runtime', s.cached ? 'Both files were already stored in this browser, so nothing was downloaded.' : 'Download finished and checked against the size and hash this page was tested with.', { chip: 'Depth model · starting' });
    }
  }
  function modelFailure(e) {
    const retry = { go: true, goText: 'Try again', rule: true };
    if (e.code === 'network') modelUI('bad', 'Download failed', 'Hugging Face or jsDelivr could not be reached. You may be offline, or a content blocker may have stopped it. Your picture was not loaded, and the world still shows the last relief.', { ...retry, chip: 'Depth model · download failed' });
    else if (e.code === 'status') modelUI('bad', 'Download refused', `The host answered with status ${e.status}. Your picture was not loaded.`, { ...retry, chip: 'Depth model · download refused' });
    else if (e.code === 'integrity') modelUI('bad', 'File did not match', 'What arrived differs from the file this page was tested with, so it was not loaded. Your picture was not loaded.', { ...retry, chip: 'Depth model · file did not match' });
    else if (depth.path && depth.path.key !== 'cpu') { depth.forceCpu(); modelUI('warn', 'The graphics path failed', `This browser offered WebGPU, and the runtime could not start on it: ${String(e.message).slice(0, 120)}. The processor path is slower and uses a smaller model.`, { go: true, goText: `Use the processor (${mb(EnterDepth.PATHS.cpu.model.bytes + EnterDepth.PATHS.cpu.runtime.bytes)} MB)`, rule: true, chip: 'Depth model · graphics path failed' }); }
    else modelUI('bad', 'The depth runtime could not start', String(e.message).slice(0, 160), { ...retry, chip: 'Depth model · could not start' });
  }
  async function afterChoosing() {
    if (depth.ready) return runEstimate();
    const p = await depth.pickPath();
    if (await depth.stored()) return startModel();
    const total = p.model.bytes + p.runtime.bytes;
    modelUI('warn', `First use downloads ${mb(total)} MB`, `Depth Anything V2 Small, ${p.model.name}, ${mb(p.model.bytes)} MB from Hugging Face, and ONNX Runtime Web, ${mb(p.runtime.bytes)} MB from jsDelivr. It stays in this browser afterward. It will run on your ${p.label}${p.key === 'cpu' ? ', because this browser has no WebGPU. That path is slower, at lower resolution, with a quantized model' : ''}. Your picture is not sent anywhere.`, { go: true, goText: `Download ${mb(total)} MB and continue`, rule: true });
    shell.openSheet('world');
  }
  async function startModel() {
    try { await depth.load(); await runEstimate(); } catch (e) { console.warn('depth model:', e.message); modelFailure(e); }
  }
  async function runEstimate() {
    if (!pending) { modelReady(); return; }
    const job = pending; pending = null;
    modelUI('wait', 'Estimating depth', `On your ${depth.path.label}. The picture stays here.`, { chip: 'Depth model · estimating' });
    try {
      const c = fitCanvas(job.source, 2048);
      const out = await depth.estimate(c, c.width, c.height);
      let truth = null;
      if (job.truth) truth = KitDepth.correlation(out.depth, job.truth);
      setPicture(c, out.depth, c.width, c.height, 'estimated', job.name, { ms: out.ms, modelW: out.modelW, modelH: out.modelH, path: depth.path.label, truth });
      $('pic-status').innerHTML = `<b>${job.name}</b> · ${c.width} × ${c.height} · a guess at depth, from a ${out.modelW} × ${out.modelH} estimate in ${Math.round(out.ms)} ms on your ${depth.path.label}.${truth != null ? ` Against the depth the painting was drawn with, the estimate correlates at r = ${truth.toFixed(2)}. That is one scene, not a measure of the model.` : ''}`;
      modelReady(out.ms);
      if (kitBusy()) shell.toast('Relief ready.');
    } catch (e) { console.warn('depth run:', e.message); modelFailure(e); }
  }
  const kitBusy = () => $('world-sheet').open === false;
  function modelReady(ms) {
    const p = depth.path;
    modelUI('good', `Ready · on your ${p.label}`, `Depth Anything V2 Small, ${p.model.name}, stored in this browser.${ms != null ? ` Last estimate ${Math.round(ms)} ms.` : ''}`, { clear: true });
    setTimeout(() => { if ($('model-state').textContent.startsWith('Ready')) $('chip-model').hidden = true; }, 1500);
  }
  function choosePicture(source, name, truth) { pending = { source, name, truth }; afterChoosing(); }
  $('pic-choose').addEventListener('click', () => $('pic-file').click());
  async function usePictureFile(f) {
    if (f.size > 120e6) { $('pic-status').textContent = 'That file is over 120 MB, which is more than this page reads.'; return; }
    try {
      const url = URL.createObjectURL(f), im = new Image(); im.src = url; await im.decode();
      if (im.naturalWidth < 16 || im.naturalHeight < 16) throw new Error('it is too small');
      $('pic-status').innerHTML = `<b>${f.name}</b> · ${im.naturalWidth} × ${im.naturalHeight}`;
      shell.setMode('picture');
      choosePicture(im, f.name);
    } catch (e) { $('pic-status').textContent = `That file could not be read as a picture: ${e.message || e}.`; }
  }
  $('pic-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) usePictureFile(f); });
  $('pic-sample').addEventListener('click', () => { if (!paintedCache) showPainted(); choosePicture(paintedCache.canvas, 'The painting, estimated', paintedCache.depth); });
  $('pic-painted').addEventListener('click', showPainted);
  $('model-go').addEventListener('click', () => { if (!pending && P && P.canvas) pending = { source: P.canvas, name: P.name }; startModel(); });
  $('model-rule').addEventListener('click', () => {
    const job = pending || (P && { source: P.canvas, name: P.name }); if (!job) return; pending = null;
    const c = fitCanvas(job.source, 1536), d = brightnessDepth(c);
    setPicture(c, d, c.width, c.height, 'brightness', job.name);
    $('pic-status').innerHTML = `<b>${job.name}</b> · brightness sets depth. A stated rule with no model, and no claim that this is how far away anything is.`;
    modelUI('warn', 'Not used for this picture', 'You chose the brightness rule. Pick a picture again to use the model.', { go: false });
  });
  $('model-clear').addEventListener('click', async () => { await depth.clear(); modelUI('idle', 'Removed from this browser', 'The next picture will ask before it downloads again.', {}); });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; if (f.type.startsWith('image/')) usePictureFile(f); else if (f.type.startsWith('audio/')) { shell.setMode('sound'); useSoundFile(f); } });

  /* ---------- the print world's data ---------- */
  const Cast = { file: null, busy: false };
  let M = null, vaoMesh = null, vboMesh = null, iboMesh = null;
  function liveAtoms() {
    const W = kit.HIST_W, B = kit.BANDS, atoms = [], x0 = kit.histX, dur = W / kit.HIST_RATE;
    for (let dx = 0; dx < W; dx += 2) {
      const col = (x0 + 1 + dx) % W;
      for (let b = 1; b < B - 1; b++) { const o = (col + b * W) * 2, v = kit.hist[o] / 255; if (v > 0.2 && kit.hist[o] >= kit.hist[(col + (b - 1) * W) * 2] && kit.hist[o] > kit.hist[(col + (b + 1) * W) * 2]) atoms.push({ time: (dx / W) * dur, f: KitMath.bandFreq(b), amp: v, ton: kit.hist[o + 1] / 255 }); }
    }
    atoms.sort((a, b) => b.amp - a.amp);
    return { atoms: atoms.slice(0, 420), dur, rate: 44100 };
  }
  async function castNow() {
    if (Cast.busy) return;
    const which = $('cast-source').value, G3 = +$('cast-detail').value;
    let src = which === 'file' && Cast.file ? { ...Cast.file, atoms: Cast.file.atoms.slice(0, 420) } : which === 'live' ? liveAtoms() : builtInSound();
    if (which === 'live' && src.atoms.length < 24) { $('cast-status').textContent = 'There is not enough recent sound yet. Play for a few seconds, or run the demo, and try again.'; return; }
    if (which === 'builtin') { const st = Math.max(1, Math.floor(src.atoms.length / 420)); src = { ...src, atoms: src.atoms.filter((_, i) => i % st === 0).slice(0, 420).map((a) => ({ ...a, amp: Math.pow(a.amp, 2.2) })) }; }
    const label = which === 'file' ? Cast.file.name : which === 'live' ? 'your last 12 seconds' : 'the built-in sound';
    Cast.busy = true; $('cast-go').disabled = true; $('cast-status').textContent = `Casting ${label}.`;
    try {
      const r = await cast.cast(src.atoms, src.dur, src.rate, G3, (p, msg) => { $('cast-status').textContent = `Casting ${label}: ${msg}, ${p}%.`; });
      loadMesh(r, label);
    } catch (e) { $('cast-status').textContent = `The cast failed: ${e.message}`; }
    Cast.busy = false; $('cast-go').disabled = false;
  }
  function loadMesh(r, label) {
    const nv = r.pos.length / 3; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = r.pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    const ctr = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2), ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 || 1;
    const vb = new Float32Array(nv * 7), idx = r.idx;
    for (let i = 0; i < nv; i++) { for (let k = 0; k < 3; k++) { vb[i * 7 + k] = (r.pos[i * 3 + k] - ctr[k]) / ext; vb[i * 7 + 3 + k] = r.nrm[i * 3 + k]; } vb[i * 7 + 6] = r.ao[i]; }
    M = { count: idx.length, nv, pos: r.pos, idx, vb, atoms: r.atoms, G: r.G, watertight: r.watertight, openEdges: r.openEdges, bodies: r.bodies, ms: r.ms, label, iso: r.iso };
    gl.bindVertexArray(vaoMesh);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboMesh); gl.bufferData(gl.ARRAY_BUFFER, vb, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboMesh); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    $('cast-stl').disabled = false; $('cast-hear').disabled = false;
    $('cast-stl').textContent = `Download STL (${mb(84 + (idx.length / 3) * 50)} MB)`;
    $('cast-status').innerHTML = `<b>${label}</b> · ${r.atoms} atoms · ${(idx.length / 3).toLocaleString()} faces · ${r.bodies} ${r.bodies === 1 ? 'body' : 'bodies'} · <b>${r.watertight ? 'watertight, checked on every edge' : `not watertight: ${r.openEdges} open edges`}</b> · ${Math.round(r.ms)} ms`;
    updateSource();
    kit.noteLane('cast', label);
  }
  // Binary STL with Z up, which is what slicers expect. One grid cell is one millimeter.
  function stlBlob() {
    const n = M.count / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), hdr = new TextEncoder().encode(`Enter: sculpture of ${M.label}. Stated mapping, no model.`.slice(0, 79));
    new Uint8Array(buf).set(hdr); dv.setUint32(80, n, true);
    let o = 84; const p = M.pos, idx = M.idx;
    const put = (x, y, z) => { dv.setFloat32(o, x, true); dv.setFloat32(o + 4, -z, true); dv.setFloat32(o + 8, y, true); o += 12; };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      put(nx, ny, nz); put(p[a], p[a + 1], p[a + 2]); put(p[b], p[b + 1], p[b + 2]); put(p[c], p[c + 1], p[c + 2]); dv.setUint16(o, 0, true); o += 2;
    }
    return new Blob([buf], { type: 'model/stl' });
  }
  const save = (blob, name) => { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
  $('cast-go').addEventListener('click', castNow);
  $('cast-stl').addEventListener('click', () => { if (M) save(stlBlob(), `enter-sculpture-${M.G}.stl`); });
  let hearCtx = null, hearSrc = null;
  function hearSculpture() {
    if (!M) return;
    if (hearSrc) { try { hearSrc.stop(); } catch (e) { /* ended */ } hearSrc = null; $('cast-hear').textContent = 'Hear the sculpture'; return; }
    hearCtx = hearCtx || new (window.AudioContext || window.webkitAudioContext)(); hearCtx.resume();
    const rate = hearCtx.sampleRate, dur = 6, step = Math.max(1, Math.floor(M.nv / 500)), lf1 = Math.log(rate / 2), atoms = [], vb = M.vb;
    for (let i = 0; i < M.nv; i += step) {
      const h = vb[i * 7 + 1] * 0.5 + 0.5, r = (224 - 100 * h) / 255, g = (164 + 40 * h) / 255, b = (74 + 160 * h) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      atoms.push({ time: ((vb[i * 7] + 1) / 2) * dur * 0.94 + dur * 0.03, f: Math.min(Math.exp(LF0 + h * (lf1 - LF0)), rate * 0.45), amp: 0.15 + 0.85 * (0.2126 * r + 0.7152 * g + 0.0722 * b), tone: mx > 0 ? (mx - mn) / mx : 0 });
    }
    const wav = synthAtoms(atoms, dur, rate, 777); let pk = 0; for (let i = 0; i < wav.length; i++) pk = Math.max(pk, Math.abs(wav[i]));
    if (pk > 0) for (let i = 0; i < wav.length; i++) wav[i] *= 0.7 / pk;
    const buf = hearCtx.createBuffer(1, wav.length, rate); buf.getChannelData(0).set(wav);
    hearSrc = hearCtx.createBufferSource(); hearSrc.buffer = buf; hearSrc.connect(hearCtx.destination);
    hearSrc.onended = () => { hearSrc = null; $('cast-hear').textContent = 'Hear the sculpture'; };
    hearSrc.start(); $('cast-hear').textContent = 'Stop listening';
    $('cast-hear-note').textContent = `Sounding: ${atoms.length} surface points. x is time, height is pitch, brightness is loudness and saturation is timbre. A stated mapping, with no model.`;
  }
  $('cast-hear').addEventListener('click', hearSculpture);

  /* ---------- bake this angle: the view, an exact hole mask and the pose, in one zip ---------- */
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    files.forEach((f) => {
      const n = enc.encode(f.name), c = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, c, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, n.length, true);
      parts.push(new Uint8Array(h.buffer), n, f.data);
      const d = new DataView(new ArrayBuffer(46)); d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint32(16, c, true); d.setUint32(20, f.data.length, true); d.setUint32(24, f.data.length, true); d.setUint16(28, n.length, true); d.setUint32(42, off, true);
      central.push(new Uint8Array(d.buffer), n);
      off += 30 + n.length + f.data.length;
    });
    const csize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
  async function bakeAngle() {
    if (!P) return;
    const c = cams.picture, w = 1280, h = Math.round(1280 * (rh / rw));
    const rgbaT = G.target(w, h, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    const read = () => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const png = (px) => new Promise((res) => { const cc = document.createElement('canvas'); cc.width = w; cc.height = h; const g = cc.getContext('2d'), im = g.createImageData(w, h); for (let y = 0; y < h; y++) im.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); g.putImageData(im, 0, 0); cc.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'); });
    const VP = cameraVP(c, w / h).VP, tear = tearT();
    const dd = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, dd); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rgbaT.fbo); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dd);
    const draw = (prog, t, withMap) => {
      G.into(rgbaT); gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      G.bindTex(0, tDepth); if (withMap) { G.bindTex(1, tMap); G.bindTex(2, tSpec); }
      G.use(prog, { uDmap: 0, uMap: 1, uSpec: 2, uDsize: [P.w, P.h], uPlane: [P.planeW, P.planeH], uDscale: S.depth / 16, uCamZ: P.camZ, uTearT: t, uSeg: S.seg, uVP: VP, uW: new Float32Array(32), uSpecK: 0, uT: 0, uHat: 0, uHatOpen: 0, uRide: 0, uCrash: 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 6 * S.seg * S.seg); gl.disable(gl.DEPTH_TEST);
      return read();
    };
    const view = draw(pRelief, tear, true), whole = draw(pMask, 0), torn = draw(pMask, tear);
    gl.deleteRenderbuffer(dd); G.freeTarget(rgbaT);
    let litW = 0, litT = 0; for (let i = 0; i < whole.length; i += 4) { if (whole[i] > 40) litW++; if (torn[i] > 40) litT++; }
    const holePct = litW ? Math.round((1000 * (litW - litT)) / litW) / 10 : null;
    const pose = { pos: c.pos, yaw: c.yaw, pitch: c.pitch, fov: S.fov, aspect: w / h, refCamZ: P.camZ, depthScale: S.depth / 16, tear, source: { w: P.w, h: P.h, kind: P.kind, name: P.name, model: P.kind === 'estimated' ? 'Depth Anything V2 Small' : null }, holePct, honesty: 'Rendered from a relief. Black in holes.png is ground that was never observed, not empty space.' };
    const [a, b, f] = await Promise.all([png(view), png(torn), png(whole)]);
    save(zip([{ name: 'view.png', data: a }, { name: 'holes.png', data: b }, { name: 'footprint.png', data: f }, { name: 'pose.json', data: new TextEncoder().encode(JSON.stringify(pose, null, 1)) }]), `enter-angle-${Date.now()}.zip`);
    $('bake-note').textContent = holePct != null ? `Baked. ${holePct}% of this view was never seen.` : 'Baked.';
    return holePct;
  }
  $('pic-bake').addEventListener('click', bakeAngle);

  /* ---------- controls ---------- */
  const bind = (id, get, set, fmt) => { const r = $(id), lab = $(`${id}-v`); r.value = get(); shell.syncRange(r); lab.textContent = fmt(+r.value); r.addEventListener('input', () => { shell.syncRange(r); set(+r.value); lab.textContent = fmt(+r.value); }); };
  bind('k-depth', () => S.depth, (v) => { S.depth = v; }, (v) => `${Math.round((v / 42) * 100)}%`);
  bind('k-tear', () => S.tear, (v) => { S.tear = v; }, (v) => (v <= 0 ? 'off' : `${Math.round((v / 200) * 100)}%`));
  bind('k-look', () => S.look * 100, (v) => { S.look = v / 100; }, (v) => `${Math.round(v)}%`);
  bind('k-fov', () => S.fov, (v) => { S.fov = v; }, (v) => `${Math.round(v)}°`);
  bind('k-react', () => S.react * 100, (v) => { S.react = v / 100; }, (v) => `${Math.round(v)}%`);
  bind('k-glow', () => S.glow * 100, (v) => { S.glow = v / 100; }, (v) => `${Math.round(v)}%`);
  $('k-inv').addEventListener('change', (e) => { S.inv = e.target.checked; });
  $('k-free').addEventListener('change', (e) => { S.free = e.target.checked; });
  $('k-drift').addEventListener('change', (e) => { S.drift = e.target.checked; });
  const tearT = () => (S.tear <= 0 ? 0 : 0.3 - 0.28 * (S.tear / 200));
  kit.on('lane', (l) => { if (l.name === 'world') shell.setMode(l.value); });

  /* ---------- world switch and labels ---------- */
  function renderWorldLabels() {
    const box = $('axis-labels'); box.innerHTML = '';
    if (S.world !== 'sound') { labels = []; return; }
    const s = (text, p) => { const e = document.createElement('span'); e.textContent = text; box.appendChild(e); return { e, p }; };
    labels = [];
    if (Sound.fromFile) { const d = Sound.dur; for (let i = 0; i <= 4; i++) labels.push(s(`${((d * i) / 4).toFixed(1)} s`, [(i / 2 - 1) * FS, -FS * 0.62 - 2.6, FS * 0.86])); } else { [0, 3, 6, 9, 12].forEach((t) => labels.push(s(t === 0 ? 'now' : `−${t} s`, [(1 - (2 * t) / LIVE_SPAN) * FS, -FS * 0.62 - 2.6, FS * 0.86]))); }
    [100, 1000, 10000].forEach((f) => labels.push(s(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, [null, toV(f, Sound.rate) * FS * 0.62, -FS * 0.55])));
  }
  let labels = [];
  function updateLabels(VP, eye) {
    const W = cv.clientWidth, H = cv.clientHeight;
    for (const l of labels) {
      const x = l.p[0] == null ? clamp(eye[0] + 9, -FS, FS) : l.p[0], y = l.p[1], z = l.p[2];
      const cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15], cx = VP[0] * x + VP[4] * y + VP[8] * z + VP[12], cy = VP[1] * x + VP[5] * y + VP[9] * z + VP[13];
      if (cw < 0.6) { l.e.style.opacity = '0'; continue; }
      const sx = (cx / cw * 0.5 + 0.5) * W, sy = (1 - (cy / cw * 0.5 + 0.5)) * H;
      l.e.style.opacity = String(clamp(1.1 - cw / 62, 0, 0.85) * (sy > H - 330 ? 0.12 : 1));
      l.e.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%)`;
    }
  }
  function updateSource() {
    const b = $('world-badge'), src = $('world-source');
    let kind = 'sound', text = '';
    if (S.world === 'sound') { text = Sound.label; } else if (S.world === 'picture') { kind = P ? P.kind : 'painted'; text = P ? (P.kind === 'painted' ? 'The painted scene, no model' : P.kind === 'brightness' ? `${P.name}, by the brightness rule` : `${P.name}, ${P.modelW} × ${P.modelH} estimate on your ${P.path}`) : ''; } else { kind = 'print'; text = M ? `${M.label} · ${(M.count / 3).toLocaleString()} faces · ${M.watertight ? 'watertight' : 'not watertight'}` : 'Casting the built-in sound'; }
    b.dataset.kind = kind; b.textContent = BADGE[kind];
    src.textContent = text;
  }
  function setWorld(w) {
    S.world = w; document.body.dataset.world = w;
    $('w-sound').hidden = w !== 'sound'; $('w-picture').hidden = w !== 'picture'; $('w-print').hidden = w !== 'print';
    $('g-a-k').textContent = w === 'sound' ? 'Time' : w === 'picture' ? 'Depth here' : 'Atoms';
    $('g-b-k').textContent = w === 'sound' ? 'Pitch' : w === 'picture' ? 'Unseen' : 'Faces';
    picLim.fresh = true;
    if (w === 'picture' && !P && G && gl) showPainted();
    if (w === 'print' && !M && !Cast.busy && G && gl) castNow();
    $('truth').textContent = TRUTH[w];
    renderWorldLabels(); updateSource();
    kit.noteLane('world', w);
    if (Voices.master) Voices.master.gain.value = w === 'sound' ? 0.8 : 0;
    tetherOut = false; $('tether').classList.remove('show');
  }

  /* ---------- targets ---------- */
  function makeMSAA(w, h) {
    const s = Math.min(4, gl.getParameter(gl.MAX_SAMPLES)), fbo = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, G.hdr.internal, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, c, d, w, h };
  }
  function freeMSAA(m) { if (m) { gl.deleteFramebuffer(m.fbo); gl.deleteRenderbuffer(m.c); gl.deleteRenderbuffer(m.d); } }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.max(320, Math.min(3840, Math.round(cv.clientWidth * dpr))), H = Math.max(240, Math.min(2160, Math.round(cv.clientHeight * dpr)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const budget = 2.0e6 * S.scale, asp = W / H; let h = Math.round(Math.sqrt(budget / asp)), w = Math.round(h * asp);
    if (w > W) { w = W; h = H; }
    if (w === rw && h === rh) return;
    rw = w; rh = h;
    [points, trailA, trailB, scene].forEach((T) => T && G.freeTarget(T)); freeMSAA(msaa);
    points = G.target(rw, rh); trailA = G.target(rw, rh); trailB = G.target(rw, rh); scene = G.target(rw, rh); msaa = makeMSAA(rw, rh);
    Post.resize(rw, rh, 5);
    [picLim.graded, picLim.a, picLim.b].forEach((T) => T && G.freeTarget(T));
    picLim.graded = G.target(rw, rh); G.bindTex(0, picLim.graded.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const lh = Math.max(2, Math.round((128 * rh) / rw)); picLim.a = G.target(128, lh); picLim.b = G.target(128, lh); picLim.lod = Math.log2(rw / 128); picLim.fresh = true;
  }
  function resolveMSAA() {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.fbo);
    gl.blitFramebuffer(0, 0, rw, rh, 0, 0, rw, rh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
  function cameraVP(c, asp) {
    const f = forward(c), V = lookAt(c.pos, [c.pos[0] + f[0], c.pos[1] + f[1], c.pos[2] + f[2]], [0, 1, 0]);
    let fovY = (S.fov * Math.PI) / 180, fit = asp < 1 ? Math.min(1.5, 1 / Math.pow(asp, 0.5)) : 1;
    if (S.world === 'picture' && P) { fovY = 2 * Math.atan(Math.min(P.planeH, P.planeW / asp) / (2 * P.camZ) * 0.985) * (S.fov / 70); fit = 1; }
    const PM = perspective(Math.min(2.2, fovY * fit), asp, 0.05, 600);
    const tanY = Math.tan(Math.min(2.2, fovY * fit) / 2);
    return { VP: mul(PM, V.m), R: V.x, U: V.y, F: f, tan: [tanY * asp, tanY] };
  }

  /* ---------- the frame ---------- */
  const pulseU = new Float32Array(16), frontU = new Float32Array(32);
  function stepPulses(now) {
    pulseU.fill(0); pulseU.set([9, 9, 0, 0], 0);
    let n = 0;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], t = (now - p.t0) / 1000, x = 1 - t * p.speed * 2;
      if (x < -1.2) { pulses.splice(i, 1); continue; }
      if (n < 4) { pulseU.set([x, p.k, p.s * Math.exp(-t * 0.8), 0], n * 4); n++; }
    }
    frontU.fill(0);
    for (let k = 0; k < 8; k++) { frontU[k * 4] = 9; frontU[k * 4 + 1] = 1; }
    n = 0;
    for (let i = fronts.length - 1; i >= 0; i--) {
      const q = fronts[i], t = (now - q.t0) / q.dur;
      if (t >= 1) { fronts.splice(i, 1); continue; }
      if (n < 8) { frontU.set([q.from + (q.to - q.from) * t, q.w, q.s * (q.still ? Math.pow(1 - t, 2) : (1 - t * 0.8)), q.hue], n * 4); n++; }
    }
  }
  let last = performance.now(), frameIdx = 0, slow = 0, fast = 0, fails = 0, unseenAt = 0;
  function measureUnseen(VP) {
    const sg = Math.min(S.seg, 384);
    const one = (t) => {
      G.into(maskT); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      G.bindTex(0, tDepth);
      G.use(pMask, { uDmap: 0, uDsize: [P.w, P.h], uPlane: [P.planeW, P.planeH], uDscale: S.depth / 16, uCamZ: P.camZ, uTearT: t, uSeg: sg, uVP: VP });
      gl.drawArrays(gl.TRIANGLES, 0, 6 * sg * sg);
      const px = new Uint8Array(96 * 54 * 4); gl.readPixels(0, 0, 96, 54, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 40) lit++;
      return lit;
    };
    const whole = one(0), torn = tearT() > 0 ? one(tearT()) : whole;
    P.unseen = whole ? (100 * (whole - torn)) / whole : null;
  }
  const gas = { l: 0, m: 0, h: 0, v: 0 };
  function renderSound(now, dt, dtMs, env) {
    const c = cams.sound, cam = cameraVP(c, rw / rh), t = now / 1000, histX = (kit.histX + 0.5) / kit.HIST_W, blow = S.react * (RM.matches ? 0.35 : 1);
    G.into(points); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (S.floor !== false) {
      G.bindTex(0, tHist);
      G.use(pTerrain, { uHist: 0, uVP: cam.VP, uHistX: histX, uFS: FS });
      gl.drawArrays(gl.TRIANGLES, 0, 6 * 320 * 64);
    }
    const common = { uVP: cam.VP, uNow: sTime(), uPxK: rh * 0.13, uMaxPx: Math.max(6, rh * 0.02), uT: t, uFS: FS, uKick: env.kick, uSnare: env.snare, uHat: env.hat, uHatOpen: env.hatOpen, uTom: env.tom, uTomPos: env.tomPos, uRide: env.ride, uCrash: env.crash, uBlow: blow, uPulse: pulseU };
    if (fileN) { gl.bindVertexArray(vaoFile); G.use(pSprite, { ...common, uLive: 0, uI: Sound.fromFile ? 0.9 : 0.62 }); gl.drawArrays(gl.POINTS, 0, fileN); }
    if (liveCount) { gl.bindVertexArray(vaoLive); if (liveDirty) { gl.bindBuffer(gl.ARRAY_BUFFER, vboLive); gl.bufferSubData(gl.ARRAY_BUFFER, 0, liveData); liveDirty = false; } G.use(pSprite, { ...common, uLive: 1, uI: 0.95 }); gl.drawArrays(gl.POINTS, 0, LIVE_N); }
    gl.bindVertexArray(null); gl.disable(gl.BLEND);
    G.into(trailB); G.bindTex(0, points.tex); G.bindTex(1, trailA.tex);
    G.use(pTrail, { uPts: 0, uPrev: 1, uFade: clamp(Math.pow(0.42 + 0.12 * env.crash, dtMs / 16.67), 0, 0.92) }); G.draw();
    [trailA, trailB] = [trailB, trailA];
    G.into(scene); G.bindTex(0, tN); G.bindTex(1, trailA.tex);
    const gk = 1 - Math.exp(-dt / 0.8); gas.l += (kit.low - gas.l) * gk; gas.m += (kit.mid - gas.m) * gk; gas.h += (kit.high - gas.h) * gk; gas.v += (kit.loud - gas.v) * gk;
    G.use(pSky, { uN: 0, uTrail: 1, uF: cam.F, uR: cam.R, uU: cam.U, uTan: cam.tan, uT: t, uLow: gas.l, uMid: gas.m, uHigh: gas.h, uLoud: gas.v, uKick: 0, uHat: env.hat, uHatOpen: env.hatOpen, uRide: env.ride, uCrash: 0, uSnare: 0 });
    G.draw();
    const bloom = Post.bloom(scene.tex, 0.9);
    Post.finish(scene.tex, bloom, { uBloomK: (0.42 + env.kick * 0.05 + env.crash * 0.08) * S.glow, uExposure: 0.96, uFlash: 0, uFlashC: [1, 0.94, 0.86], uGrain: 0.016, uT: t, uVig: 0.42, uSat: 1.08, rate: RM.matches ? 0.16 : 0.36 }, dtMs / 1000);
    if (labels.length && frameIdx % 2 === 0) updateLabels(cam.VP, c.pos);
    updateListener();
    return cam;
  }
  function renderPicture(now, dt, env, dtS) {
    const c = cams.picture, cam = cameraVP(c, rw / rh), t = now / 1000;
    for (let i = 0; i < kit.BANDS; i++) specBytes[i * 4] = Math.round(kit.spectrum[i] * 255);
    G.bindTex(2, tSpec); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, kit.BANDS, 1, gl.RGBA, gl.UNSIGNED_BYTE, specBytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo); gl.viewport(0, 0, rw, rh);
    gl.clearColor(0.0045, 0.006, 0.012, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    G.bindTex(0, tDepth); G.bindTex(1, tMap); G.bindTex(2, tSpec);
    const swell = 1 + (RM.matches ? 0 : env.kick * 0.05 * S.react);
    G.use(pRelief, { uDmap: 0, uMap: 1, uSpec: 2, uDsize: [P.w, P.h], uPlane: [P.planeW, P.planeH], uDscale: (S.depth / 16) * swell, uCamZ: P.camZ, uTearT: tearT(), uSeg: S.seg, uVP: cam.VP, uW: frontU, uSpecK: S.react, uT: t, uHat: env.hat * S.react, uHatOpen: env.hatOpen, uRide: env.ride * S.react, uCrash: env.crash * S.react });
    gl.drawArrays(gl.TRIANGLES, 0, 6 * S.seg * S.seg);
    gl.disable(gl.DEPTH_TEST);
    resolveMSAA();
    const bloom = Post.bloom(scene.tex, 1.0);
    G.into(picLim.graded); G.bindTex(0, scene.tex); G.bindTex(1, bloom);
    G.use(pPicGrade, { uScene: 0, uBloom: 1, uBloomK: 0.34 * S.glow, uFlash: 0, uFlashC: [1, 0.94, 0.86], uVig: 0.16 });
    G.draw();
    G.bindTex(0, picLim.graded.tex); gl.generateMipmap(gl.TEXTURE_2D);
    G.into(picLim.b); G.bindTex(0, picLim.graded.tex); G.bindTex(1, picLim.a.tex);
    G.use(pPicLimit, { uCur: 0, uPrev: 1, uLod: picLim.lod, uMax: picLim.fresh ? 10 : (RM.matches ? 0.16 : 0.36) * dtS });
    G.draw(); [picLim.a, picLim.b] = [picLim.b, picLim.a]; picLim.fresh = false;
    G.into(null); G.bindTex(0, picLim.graded.tex); G.bindTex(1, picLim.a.tex);
    G.use(pPicOut, { uG: 0, uLim: 1, uT: t }); G.draw();
    if (frameIdx % 30 === 0) measureUnseen(cam.VP);
    return cam;
  }
  function renderPrint(now, dt, env, dtS) {
    const O = S.cast, t = now / 1000, asp = rw / rh, fit = asp < 1 ? 1 / Math.pow(asp, 0.7) : 1, dist = O.dist * fit;
    const eye = [0, 0.05 * dist, dist], V = lookAt(eye, [0, -0.08, 0], [0, 1, 0]), fov = 0.82, PM = perspective(fov, asp, 0.05, 60), VP = mul(PM, V.m), tanY = Math.tan(fov / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo); gl.viewport(0, 0, rw, rh);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const fvec = [-V.z[0], -V.z[1], -V.z[2]];
    const gk = 1 - Math.exp(-dt / 0.8); gas.v += (kit.loud - gas.v) * gk;
    G.use(pGallery, { uF: fvec, uR: V.x, uU: V.y, uEye: eye, uTan: [tanY * asp, tanY], uLoud: gas.v, uKick: 0, uCrash: 0, uT: t });
    G.draw();
    if (M) {
      const cy = Math.cos(O.ry), sy = Math.sin(O.ry), cx = Math.cos(O.rx), sx = Math.sin(O.rx);
      const MM = [cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, 0, 1];
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(vaoMesh);
      G.use(pMesh, { uVP: VP, uM: MM, uEye: eye, uW: printFronts(), uT: t, uHat: env.hat * S.react, uHatOpen: env.hatOpen, uRide: env.ride * S.react, uCrash: env.crash * S.react, uKick: env.kick * S.react, uTom: env.tom * S.react, uTomPos: env.tomPos });
      gl.drawElements(gl.TRIANGLES, M.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST);
    }
    resolveMSAA();
    const bloom = Post.bloom(scene.tex, 1.0);
    Post.finish(scene.tex, bloom, { uBloomK: (0.3 + env.kick * 0.2 + env.crash * 0.26) * S.glow, uExposure: 1.0, uFlash: 0, uFlashC: [1, 0.94, 0.86], uGrain: 0.012, uT: t, uVig: 0.5, uSat: 1.05, rate: RM.matches ? 0.16 : 0.36 }, dtS);
  }
  // Along the print's base a wavefront reads as time moving through the sculpture.
  const printU = new Float32Array(32);
  function printFronts() { printU.fill(0); for (let k = 0; k < 8; k++) { printU[k * 4] = 9; printU[k * 4 + 1] = 1; } for (let k = 0; k < 4; k++) { if (pulseU[k * 4 + 2] <= 0) continue; printU[k * 4] = -pulseU[k * 4]; printU[k * 4 + 1] = 0.085; printU[k * 4 + 2] = pulseU[k * 4 + 2] * 1.6; printU[k * 4 + 3] = VOICE_HUE.kick; } return printU; }

  function updateHud(cam) {
    $('g-hits').textContent = kit.hits;
    $('g-hero').textContent = kit.tempo.bpm ? Math.round(kit.tempo.bpm) : '--';
    $('g-level').innerHTML = kit.audio.state === 'live' ? `${Math.round(kit.audio.peakDb)}<small>dB</small>` : kit.demoOn ? 'demo' : '--';
    const a = $('g-a'), b = $('g-b');
    if (S.world === 'sound') {
      const p = cams.sound.pos, tx = clamp(p[0] / FS, -1, 1);
      a.innerHTML = Sound.fromFile ? `${(((tx + 1) / 2) * Sound.dur).toFixed(1)}<small>s</small>` : `−${(((1 - tx) / 2) * LIVE_SPAN).toFixed(1)}<small>s</small>`;
      const v = p[1] / (FS * 0.62);
      b.innerHTML = Math.abs(v) > 1 ? 'off map' : fmtHz(Math.exp(LF0 + ((v + 1) / 2) * (Math.log(Sound.rate / 2) - LF0)));
    } else if (S.world === 'picture' && P) {
      const c = cams.picture, f = forward(c), t = -c.pos[2] / (f[2] || -1e-3), hx = c.pos[0] + f[0] * t, hy = c.pos[1] + f[1] * t, u = hx / P.planeW + 0.5, w = 0.5 - hy / P.planeH;
      if (t > 0 && u >= 0 && u <= 1 && w >= 0 && w <= 1) { const d = P.depth[Math.min(P.w - 1, Math.floor(u * P.w)) + Math.min(P.h - 1, Math.floor(w * P.h)) * P.w]; a.innerHTML = `${d.toFixed(2)}<small>${P.kind === 'estimated' ? 'est' : 'rule'}</small>`; } else a.textContent = 'off';
      b.innerHTML = P.unseen == null ? '--' : `${P.unseen.toFixed(1)}<small>%</small>`;
    } else if (S.world === 'print') {
      a.textContent = M ? M.atoms : '--'; b.textContent = M ? (M.count / 3 > 999 ? `${Math.round(M.count / 3000)}k` : M.count / 3) : '--';
    }
  }
  function render(now) {
    requestAnimationFrame(render);
    try {
      const dtMs = Math.min(100, now - last); last = now;
      kit.tick(now);
      shell.frame(now);
      if (!G || gl.isContextLost()) return;
      const dt = Math.min(1 / 30, dtMs / 1000), env = kit.env;
      if (dtMs > 26) slow++; else if (dtMs < 11) fast++;
      if (++frameIdx % 120 === 0) {
        if (slow > 40) { if (S.world === 'picture' && S.seg > 256) S.seg = S.seg > 768 ? 768 : S.seg > 512 ? 512 : 256; else if (S.scale > 0.4) { S.scale *= 0.75; resize(); } } else if (fast > 100 && S.scale < 1.6) { S.scale *= 1.2; resize(); } else if (S.world === 'picture' && slow < 4 && strongGPU && S.seg < 1400 && frameIdx > 300) S.seg = S.seg < 1024 ? 1024 : 1400;
        slow = 0; fast = 0;
      }
      rigStep(dt, now);
      stepPulses(now);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      let cam = null;
      if (S.world === 'sound') cam = renderSound(now, dt, dtMs, env);
      else if (S.world === 'picture') { if (!P) showPainted(); cam = renderPicture(now, dt, env, dtMs / 1000); } else renderPrint(now, dt, env, dtMs / 1000);
      if (lumaRec) lumaRec(now);
      if (wantSnap) { const done = wantSnap; wantSnap = null; cv.toBlob((blob) => done(blob), 'image/png'); }
      if (frameIdx % 6 === 0) updateHud(cam);
    } catch (e) { if (fails++ < 3) console.error(e); }
  }

  shell.onKeyHook = null;
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target.closest && e.target.closest('input, select, textarea, dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') resetRig();
    else if (k === 'n') $('demo-button').click();
    else if (k === '1') shell.setMode('sound');
    else if (k === '2') shell.setMode('picture');
    else if (k === '3') shell.setMode('print');
    else if (k === 'v') { S.free = !S.free; $('k-free').checked = S.free; shell.toast(S.free ? 'Free look: push the cursor from the center to turn.' : 'Drag to look.'); } else if (k === 'b' && S.world === 'picture') bakeAngle();
    else if (k === 'g' && S.world === 'print') hearSculpture();
    else if (k === ' ' && S.world === 'print') { S.cast.auto = !S.cast.auto; e.preventDefault(); } else if (k === '-' || k === '=') { S.look = clamp(S.look + (k === '=' ? 0.08 : -0.08), 0.04, 1.8); const r = $('k-look'); r.value = Math.round(S.look * 100); shell.syncRange(r); $('k-look-v').textContent = `${Math.round(S.look * 100)}%`; }
  });

  /* ---------- boot ---------- */
  const b0 = builtInSound();
  Sound.atoms = b0.atoms; Sound.dur = b0.dur; fileN = b0.atoms.length;
  $('snd-status').innerHTML = `<b>${Sound.label}</b> · ${fileN.toLocaleString()} atoms over ${b0.dur.toFixed(1)} s`;
  document.body.dataset.world = 'sound';
  if (!G || !(G.floatRT || G.gl.getExtension('EXT_color_buffer_half_float'))) {
    shell.glFail('This page needs WebGL2 with floating-point render targets, which this browser did not provide. The inputs below still report their state.');
    const idle = (now) => { requestAnimationFrame(idle); kit.tick(now); shell.frame(now); };
    requestAnimationFrame(idle);
  } else {
    gl = G.gl;
    try {
      Post = createPost(G);
      pSprite = G.program(SPRITE_FS, SPRITE_VS); pTerrain = G.program(TERRAIN_FS, TERRAIN_VS); pTrail = G.program(TRAIL_FS); pSky = G.program(SKY_FS);
      pRelief = G.program(RELIEF_FS, RELIEF_VS); pMask = G.program(MASK_FS, RELIEF_VS); pPicGrade = G.program(PIC_GRADE_FS); pPicLimit = G.program(PIC_LIMIT_FS); pPicOut = G.program(PIC_OUT_FS); pGallery = G.program(GALLERY_FS); pMesh = G.program(MESH_FS, MESH_VS);
      tN = G.noiseTexture(20261103);
      tHist = G.tex(kit.HIST_W, kit.BANDS, { internal: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE }, { data: kit.hist });
      G.bindTex(0, tHist); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      tSpec = G.tex(kit.BANDS, 1, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }, { data: specBytes });
      maskT = G.target(96, 54, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
      const attrib = (vao, vbo) => { gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16); gl.bindVertexArray(null); };
      vaoFile = gl.createVertexArray(); vboFile = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vboFile); gl.bufferData(gl.ARRAY_BUFFER, atomsToField(b0.atoms, b0.dur, b0.rate), gl.STATIC_DRAW); attrib(vaoFile, vboFile);
      vaoLive = gl.createVertexArray(); vboLive = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vboLive); gl.bufferData(gl.ARRAY_BUFFER, liveData, gl.DYNAMIC_DRAW); attrib(vaoLive, vboLive);
      vaoMesh = gl.createVertexArray(); vboMesh = gl.createBuffer(); iboMesh = gl.createBuffer();
      const info = gl.getExtension('WEBGL_debug_renderer_info'), renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
      strongGPU = /apple m\d+ (pro|max|ultra)|apple m[3-9]|rtx|radeon rx/i.test(renderer);
      S.seg = navigator.maxTouchPoints > 1 ? 256 : strongGPU ? 1024 : /swiftshader|llvmpipe|software/i.test(renderer) ? 128 : 512;
      resize();
      addEventListener('resize', resize);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); shell.glFail('The graphics context was lost. Reload the page to get the picture back.'); });
      setWorld('sound');
      requestAnimationFrame(render);
    } catch (e) {
      console.error(e);
      shell.glFail(`The picture could not start on this graphics card: ${String(e.message).slice(0, 140)}`);
    }
  }

  // For the flicker check: the picture's brightness on a small grid, on every frame, straight after it is drawn.
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
  const w0 = new URLSearchParams(location.search).get('world');
  if (G && gl && (w0 === 'picture' || w0 === 'print')) shell.setMode(w0);

  window.__app = {
    S, kit, Sound, Cast, cams, depth, recordLuma,
    get P() { return P; }, get M() { return M; }, get liveCount() { return liveCount; }, get fileN() { return fileN; },
    reliefPoint, builtInSound, stlBlob, bakeAngle,
    pixel() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const g = c.getContext('2d');
      return new Promise((res) => { wantSnap = (blob) => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let sum = 0, min = 1e9, max = 0; const grid = []; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; sum += l; min = Math.min(min, l); max = Math.max(max, l); grid.push(l); } res({ mean: sum / (d.length / 4), min, max, grid }); }; im.src = URL.createObjectURL(blob); }; });
    },
  };
})();
