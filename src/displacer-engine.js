/* displacer-engine.js: the blend engine of the desktop Displacer (Displacer_OT_Blender.html), copied by line range.
   1D optimal transport per color channel or per sound frame, spatial OT on sampled pixel clouds, sliced OT in six
   dimensions, Gabor atoms, Genopatch's differential evolution and the FX rack. The transport maths is retained. Browser adaptations,
   each marked: Genopatch reads its effort from state, the granular effect is seeded so a saved sound repeats exactly,
   the overlap-add no longer divides by a near-zero window at the edges (which left blends about 250 times too quiet),
   the two map builders run their sliced OT in a worker, and mixed-rate audio uses an anti-alias filter before downsampling. createEngine(S) reads its
   settings from the page's state object S, as the desktop page did. No drawing happens here. The public page is sound
   only: it calls the sound parts, and the picture functions stay so this file remains a line-range copy of the desktop
   engine. */
(function (global) {
  'use strict';
  function createEngine(S) {
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,a,b){return v<a?a:v>b?b:v;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
let rng=mulberry32(20260625);

/* ============================== 1D OT CORE ============================== */
// histogram (256) → CDF for a Uint8-ish channel sampled from an array with stride
function chanCDF(data,off,stride,n){ const h=new Float64Array(256);
  for(let i=0,p=off;i<n;i++,p+=stride){ h[data[p]]++; }
  const cdf=new Float64Array(256); let s=0; for(let v=0;v<256;v++){s+=h[v];cdf[v]=s;} const tot=s||1; for(let v=0;v<256;v++)cdf[v]/=tot; return cdf; }
// continuous inverse CDF over 256 bins: returns value in [0,255] where cdf reaches p
function invCDF256(cdf,p){ if(p<=cdf[0])return 0; if(p>=1)return 255; let lo=0,hi=255;
  while(lo<hi){const mid=(lo+hi)>>1; if(cdf[mid]<p)lo=mid+1; else hi=mid;} const c0=lo>0?cdf[lo-1]:0,c1=cdf[lo]; const f=c1>c0?(p-c0)/(c1-c0):0; return (lo-1)+f; }
// McCann LUT for channel: maps source value v → transported value at t (with optional dither cumLo)
function buildLUT(cdfA,cdfB,t,dither){ const lut=new Float32Array(256);
  for(let v=0;v<256;v++){ let p; if(dither){ const lo=v>0?cdfA[v-1]:0; p=lo+rng()*(cdfA[v]-lo); } else p=cdfA[v]; const q=invCDF256(cdfB,p); lut[v]=clamp((1-t)*v + t*q,0,255); }
  return lut; }

// RGB<->YCoCg (integer, lossless)
function toSpace(d){ if(S.cspace==='rgb')return; for(let i=0;i<d.length;i+=4){ const r=d[i],g=d[i+1],b=d[i+2]; const co=r-b; const tmp=b+(co>>1); const cg=g-tmp; const y=tmp+(cg>>1); d[i]=clamp(y,0,255);d[i+1]=clamp(cg+128,0,255);d[i+2]=clamp(co+128,0,255); } }
function fromSpace(d){ if(S.cspace==='rgb')return; for(let i=0;i<d.length;i+=4){ const y=d[i],cg=d[i+1]-128,co=d[i+2]-128; const tmp=y-(cg>>1); const g=cg+tmp; const b=tmp-(co>>1); const r=b+co; d[i]=clamp(r,0,255);d[i+1]=clamp(g,0,255);d[i+2]=clamp(b,0,255); } }
let cdfA=[null,null,null], cdfB=[null,null,null];
function cacheImageDists(){ if(!S.imgA||!S.imgB)return;
  const a=S.imgA.dataA.data.slice(0), b=S.imgB.dataA.data.slice(0); // copies we can transform to working space
  // store transformed copies on the records for reuse
  const ta=new Uint8ClampedArray(a), tb=new Uint8ClampedArray(b); toSpace(ta); toSpace(tb);
  S._ta=ta; S._tb=tb; S._slMap=null; S._spMap=null; const na=ta.length/4, nb=tb.length/4;
  for(let c=0;c<3;c++){ cdfA[c]=chanCDF(ta,c,4,na); cdfB[c]=chanCDF(tb,c,4,nb); }
}

function applySliced(d,t){ if(!S._slMap)buildSlicedMap(); const {acc,G}=S._slMap;
  for(let i=0;i<d.length;i+=4){ const r=d[i],g=d[i+1],b=d[i+2];
    const ci=(Math.min(G-1,r/256*G|0)*G+Math.min(G-1,g/256*G|0))*G+Math.min(G-1,b/256*G|0);
    d[i]=clamp(r+t*acc[ci*3],0,255); d[i+1]=clamp(g+t*acc[ci*3+1],0,255); d[i+2]=clamp(b+t*acc[ci*3+2],0,255); } }
// produce ImageData of the morph (OT or xfade) into a target ctx sized to A
function renderImage(t,method,srcData,W,H){
  const out=new Uint8ClampedArray(srcData.data.length);
  if(method==='xfade'){ // resample B to A size via temp canvas done at caller; here srcData has both — handled separately
    return null;
  }
  if(S.quality==='sliced'){ const d2=new Uint8ClampedArray(srcData.data); applySliced(d2,t); return new ImageData(d2,W,H); }
  // OT: transform A to working space, apply per-channel LUT, transform back
  const d=new Uint8ClampedArray(srcData.data); toSpace(d);
  rng=mulberry32(20260625); // deterministic dither
  const dith=S.quality==='dither';
  if(S.quality==='exact'){ // exact sorted-rank per channel (uses full distributions) — fall back to fine LUT (1024 effective via dither off + monotone) ; approximate exact with no-dither LUT for speed
  }
  const lutc=[buildLUT(cdfA[0],cdfB[0],t,dith),buildLUT(cdfA[1],cdfB[1],t,dith),buildLUT(cdfA[2],cdfB[2],t,dith)];
  for(let i=0;i<d.length;i+=4){ d[i]=Math.round(lutc[0][d[i]]); d[i+1]=Math.round(lutc[1][d[i+1]]); d[i+2]=Math.round(lutc[2][d[i+2]]); d[i+3]=srcData.data[i+3]; }
  fromSpace(d);
  return new ImageData(d,W,H);
}

function renderSpatial(t,W,H){
  const m=S._spMap||buildSpatialMap(), n=m.n;
  const acc=new Float32Array(W*H*3), wgt=new Float32Array(W*H);
  const ar=W/H, sx=W/(2*Math.min(1.2,ar)), sy=H*Math.max(0.83,ar)/2;
  const kerns=[]; for(let R=1;R<=3;R++){ const k=[]; for(let ky=-R;ky<=R;ky++)for(let kx=-R;kx<=R;kx++)k.push([kx,ky,Math.exp(-(kx*kx+ky*ky)/(R*1.6))]); kerns.push(k); }
  for(let i=0;i<n;i++){
    const px=(m.x0[i]+t*m.dx[i])*sx+W/2, py=(m.y0[i]+t*m.dy[i])*sy+H/2;
    const r=m.c0[i*3]+(m.c1[i*3]-m.c0[i*3])*t, g=m.c0[i*3+1]+(m.c1[i*3+1]-m.c0[i*3+1])*t, b=m.c0[i*3+2]+(m.c1[i*3+2]-m.c0[i*3+2])*t;
    const ix=px|0, iy=py|0, sharp=(S.spComp==='sharp');
    const kern=kerns[S.spAdapt?clamp(Math.round(m.sz[i]*1.6)-1,0,2):1];
    for(const [kx,ky,w0] of kern){ const xx=ix+kx,yy=iy+ky; if(xx<0||yy<0||xx>=W||yy>=H)continue;
      const w=sharp?w0*w0*w0:w0;   // weight-sharpening ≈ soft-nearest: dominant mass wins pixel collisions
      const o=yy*W+xx; acc[o*3]+=r*w; acc[o*3+1]+=g*w; acc[o*3+2]+=b*w; wgt[o]+=w; } }
  const out=new Uint8ClampedArray(W*H*4);
  for(let o=0;o<W*H;o++){ if(wgt[o]>0.06){ out[o*4]=acc[o*3]/wgt[o]; out[o*4+1]=acc[o*3+1]/wgt[o]; out[o*4+2]=acc[o*3+2]/wgt[o]; out[o*4+3]=255; } }
  // hole-fill: 2-pass pull from filled neighbours
  for(let pass=0;pass<2;pass++){ for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const o=y*W+x; if(out[o*4+3])continue;
    let r=0,g=0,b=0,mS=0; for(const [ddx,ddy] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
      const xx=x+ddx,yy=y+ddy; if(xx<0||yy<0||xx>=W||yy>=H)continue; const q=(yy*W+xx)*4; if(out[q+3]){r+=out[q];g+=out[q+1];b+=out[q+2];mS++;} }
    if(mS){ out[o*4]=r/mS; out[o*4+1]=g/mS; out[o*4+2]=b/mS; out[o*4+3]=254; } } }
  return new ImageData(out,W,H);
}
function xfadeImage(t,recA,recB){ // returns ImageData sized to A, with B drawn to A's size
  const W=recA.w,H=recA.h; const tmp=document.createElement('canvas');tmp.width=W;tmp.height=H; const tctx=tmp.getContext('2d',{willReadFrequently:true});
  tctx.drawImage(recB.cv,0,0,W,H); const bd=tctx.getImageData(0,0,W,H).data; const ad=recA.dataA.data; const out=new Uint8ClampedArray(ad.length);
  for(let i=0;i<ad.length;i+=4){ out[i]=ad[i]+(bd[i]-ad[i])*t; out[i+1]=ad[i+1]+(bd[i+1]-ad[i+1])*t; out[i+2]=ad[i+2]+(bd[i+2]-ad[i+2])*t; out[i+3]=255; }
  return new ImageData(out,W,H);
}

function fft(re,im,inv){ const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit; if(i<j){let tr=re[i];re[i]=re[j];re[j]=tr;tr=im[i];im[i]=im[j];im[j]=tr;} }
  for(let len=2;len<=n;len<<=1){ const ang=(inv?2:-2)*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0, half=len>>1; for(let k=0;k<half;k++){ const a=i+k,b=a+half;
      const ur=re[a],ui=im[a], vr=re[b]*cr-im[b]*ci, vi=re[b]*ci+im[b]*cr;
      re[a]=ur+vr;im[a]=ui+vi;re[b]=ur-vr;im[b]=ui-vi; const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
  if(inv){for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}} }
function resampleLinear(data,sr,dr){ if(sr===dr)return data.slice(); const ratio=sr/dr,L=Math.floor(data.length*dr/sr),out=new Float32Array(L);
  for(let i=0;i<L;i++){const x=i*ratio,i0=Math.floor(x),f=x-i0; out[i]=data[i0]*(1-f)+(data[i0+1]||0)*f;} return out; }
// Mixing sample rates must not fold inaudible source highs into audible low frequencies.
// A normalized, Blackman-windowed sinc at 90% of the destination Nyquist filters before
// decimation. Phase tables keep the six-second import bounded; reflected ends avoid a DC step.
function resampleAudio(data,sr,dr){
  if(sr<=dr)return resampleLinear(data,sr,dr);
  const ratio=sr/dr,L=Math.floor(data.length*dr/sr),out=new Float32Array(L);
  if(!data.length)return out;
  const radius=Math.ceil(24*ratio),phases=256,cutoff=0.45/ratio,kernels=[];
  for(let p=0;p<=phases;p++){
    const h=new Float64Array(2*radius+1);let sum=0;
    for(let j=-radius;j<=radius;j++){
      const d=j-p/phases,u=d/radius;
      const win=Math.abs(u)>1?0:0.42+0.5*Math.cos(Math.PI*u)+0.08*Math.cos(2*Math.PI*u);
      const v=(Math.abs(d)<1e-10?2*cutoff:Math.sin(2*Math.PI*cutoff*d)/(Math.PI*d))*win;
      h[j+radius]=v;sum+=v;
    }
    for(let j=0;j<h.length;j++)h[j]/=sum;kernels.push(h);
  }
  const reflect=(j)=>{if(data.length===1)return 0;const period=2*(data.length-1);j=((j%period)+period)%period;return j<data.length?j:period-j;};
  for(let i=0;i<L;i++){
    const x=i*ratio,base=Math.floor(x),h=kernels[Math.round((x-base)*phases)];let v=0;
    for(let j=-radius;j<=radius;j++){const k=base+j;v+=data[k<0||k>=data.length?reflect(k):k]*h[j+radius];}
    out[i]=v;
  }
  return out;
}
function prepAudio(){ if(!S.srcA||!S.srcB)return false; const rate=Math.min(S.srcA.rate,S.srcB.rate); S.audRate=rate;
  let a=resampleAudio(S.srcA.data,S.srcA.rate,rate), b=resampleAudio(S.srcB.data,S.srcB.rate,rate);
  const L=Math.min(a.length,b.length,Math.floor(rate*6)); S.audA=a.subarray(0,L); S.audB=b.subarray(0,L); S.audDirty=true; return true; }
function invCDFarr(cdf,p,K){ if(p<=cdf[0])return 0; if(p>=1)return K; let lo=0,hi=K; while(lo<hi){const mid=(lo+hi)>>1; if(cdf[mid]<p)lo=mid+1; else hi=mid;} const c0=lo>0?cdf[lo-1]:0,c1=cdf[lo]; const f=c1>c0?(p-c0)/(c1-c0):0; return (lo-1)+f; }
function buildCDFmag(mag,K){ const cdf=new Float64Array(K+1); let mx=0; for(let k=0;k<=K;k++)if(mag[k]>mx)mx=mag[k]; const fl=mx*1e-4; let s=0;
  for(let k=0;k<=K;k++){s+=Math.max(0,mag[k]-fl);cdf[k]=s;} const tot=s||1; for(let k=0;k<=K;k++)cdf[k]/=tot; return {cdf,tot}; }
function renderAudioOT(t,tFn,oA,oB,subA,subB){
  const A=oA||S.audA,B=oB||S.audB,N=2048,hop=512,K=N/2,L=A.length;
  const win=new Float32Array(N); for(let i=0;i<N;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/N);
  const out=new Float32Array(L), wsum=new Float32Array(L);
  const re=new Float32Array(N),im=new Float32Array(N),reB=new Float32Array(N),imB=new Float32Array(N),reS=new Float32Array(N),imS=new Float32Array(N);
  const magA=new Float32Array(K+1),phA=new Float32Array(K+1),magB=new Float32Array(K+1),phB=new Float32Array(K+1);
  const om=new Float32Array(K+2), orr=new Float32Array(N), oii=new Float32Array(N);
  const phSyn=new Float32Array(K+1), phPrev=new Float32Array(K+1); let firstFrame=true;
  const frames=Math.max(1,1+Math.floor((L-N)/hop)), Q=4*K, pv=(S.phasemode==='pv');
  let tv=t;
  for(let fr=0;fr<frames;fr++){ const start=fr*hop; if(tFn){tv=tFn(fr/Math.max(1,frames-1));t=tv;}
    for(let i=0;i<N;i++){ const s=start+i; const wa=s<L?A[s]:0, wb=s<L?B[s]:0; re[i]=wa*win[i];im[i]=0;reB[i]=wb*win[i];imB[i]=0; }
    fft(re,im,false); fft(reB,imB,false);
    for(let k=0;k<=K;k++){ magA[k]=Math.hypot(re[k],im[k]); phA[k]=Math.atan2(im[k],re[k]); magB[k]=Math.hypot(reB[k],imB[k]); phB[k]=Math.atan2(imB[k],reB[k]); }
    // MP-hybrid residual mode: spectral subtraction of the skeleton, clamped >= 0
    if(subA){ for(let i=0;i<N;i++){ const q=start+i; reS[i]=(q<L?subA[q]:0)*win[i]; imS[i]=0; } fft(reS,imS,false);
      for(let k=0;k<=K;k++) magA[k]=Math.max(0,magA[k]-Math.hypot(reS[k],imS[k]));
      for(let i=0;i<N;i++){ const q=start+i; reS[i]=(q<L?subB[q]:0)*win[i]; imS[i]=0; } fft(reS,imS,false);
      for(let k=0;k<=K;k++) magB[k]=Math.max(0,magB[k]-Math.hypot(reS[k],imS[k])); }
    // OT transport of magnitude along frequency
    const A1=buildCDFmag(magA,K), B1=buildCDFmag(magB,K); const totMass=(1-t)*A1.tot+t*B1.tot, dm=totMass/Q;
    om.fill(0);
    for(let q=0;q<Q;q++){ const p=(q+0.5)/Q; const xa=invCDFarr(A1.cdf,p,K), xb=invCDFarr(B1.cdf,p,K); let x=(1-t)*xa+t*xb; if(x<0)x=0; if(x>K)x=K; const i0=x|0,f=x-i0; om[i0]+=dm*(1-f); om[i0+1]+=dm*f; }
    // phase
    for(let k=0;k<=K;k++){ const m=om[k]; let ph;
      const dom=((1-t)*magA[k]>=t*magB[k]);
      if(pv){ const cur=dom?phA[k]:phB[k]; if(firstFrame){phSyn[k]=cur;} else { const expct=2*Math.PI*hop*k/N; let dphi=cur-phPrev[k]-expct; dphi=dphi-2*Math.PI*Math.round(dphi/(2*Math.PI)); phSyn[k]+=expct+dphi; } phPrev[k]=cur; ph=phSyn[k]; }
      else ph=dom?phA[k]:phB[k];
      orr[k]=m*Math.cos(ph); oii[k]=m*Math.sin(ph); }
    for(let k=1;k<K;k++){ orr[N-k]=orr[k]; oii[N-k]=-oii[k]; } oii[0]=0; oii[K]=0; orr[K]=om[K];
    fft(orr,oii,true); firstFrame=false;
    for(let i=0;i<N;i++){ const s=start+i; if(s<L){ out[s]+=orr[i]*win[i]; wsum[s]+=win[i]*win[i]; } }
  }
  for(let i=0;i<L;i++) out[i]/= Math.max(wsum[i],0.15);   // patch: floor the window sum, see the engine notes
  return normalize(out);
}
// ---- MP HYBRID: transported atom skeleton (own clean phase) + OT residual field ----
function synthAtomList(atoms,dur,rate,seed){ const L=Math.floor(dur*rate),out=new Float32Array(L),arng=mulberry32(seed||4242);
  // optional a.tone (0..1, from color saturation): adds 2nd/3rd partials — timbre from color
  for(const a of atoms){ const sg=0.02*rate,GL=Math.floor(sg*6),t0=Math.floor(a.time*rate-GL/2),w=2*Math.PI*a.f/rate,ph=arng()*6.2832;
    const tn=a.tone||0;
    for(let j=0;j<GL;j++){ const idx=t0+j; if(idx<0||idx>=L)continue; const e=Math.exp(-0.5*Math.pow((j-GL/2)/sg,2));
      let sVal=Math.sin(w*j+ph);
      if(tn>0.02) sVal+=tn*(0.45*Math.sin(2*w*j+ph)+0.22*Math.sin(3*w*j+ph));
      out[idx]+=a.amp*e*sVal*0.28; } }
  return out; }
function renderAudioMP(t){
  const rate=S.audRate, dur=S.audA.length/rate, KA=300;
  const ea=extractAtoms(S.audA,rate,KA), eb=extractAtoms(S.audB,rate,KA);
  const lf0=Math.log(40), lf1=Math.log(rate/2);
  const mk=e=>e.atoms.map(a=>({p:[(a.time/e.dur)*2-1,((Math.log(Math.max(40,a.f))-lf0)/(lf1-lf0))*2-1,(a.amp-0.5)*0.8],c:[0,0,0]}));
  const A=mk(ea),B=mk(eb); const n=Math.min(A.length,B.length); A.length=n; B.length=n;
  const {X}=slicedOT(A,B);
  const atomsAt=tt=>{ const out=[]; for(let i=0;i<n;i++){
    const tn=A[i].p[0]+tt*(X[i*6]-A[i].p[0]), lfn=A[i].p[1]+tt*(X[i*6+1]-A[i].p[1]), an=A[i].p[2]+tt*(X[i*6+2]-A[i].p[2]);
    out.push({time:(tn+1)/2*dur, f:Math.exp(lf0+(lfn+1)/2*(lf1-lf0)), amp:Math.max(0,an/0.8+0.5)}); } return out; };
  const skel=synthAtomList(atomsAt(t),dur,rate);
  const skelA=synthAtomList(atomsAt(0),dur,rate), skelB=synthAtomList(atomsAt(1),dur,rate);
  const resid=renderAudioOT(t,null,S.audA,S.audB,skelA,skelB);
  const mix=S.mpMix, L=skel.length, out=new Float32Array(L);
  let ps=0,pr=0; for(let i=0;i<L;i++){ps+=skel[i]*skel[i];pr+=resid[i]*resid[i];} const gs=ps>0?1/Math.sqrt(ps/L):1, gr=pr>0?1/Math.sqrt(pr/L):1;
  for(let i=0;i<L;i++) out[i]=mix*skel[i]*gs*0.18+(1-mix)*resid[i]*gr*0.18;
  return normalize(out); }
function renderAudioXfade(t){ const L=S.audA.length,A=S.audA,B=S.audB,out=new Float32Array(L);
  const ga=S.xlaw==='ep'?Math.cos(t*Math.PI/2):(1-t), gb=S.xlaw==='ep'?Math.sin(t*Math.PI/2):t;
  for(let i=0;i<L;i++)out[i]=A[i]*ga+B[i]*gb; return normalize(out); }
function normalize(out){ const L=out.length; let mean=0; for(let i=0;i<L;i++)mean+=out[i]; mean/=L; let pk=0; for(let i=0;i<L;i++){out[i]-=mean; const a=Math.abs(out[i]); if(a>pk)pk=a;} if(pk>0){const g=0.97/pk; for(let i=0;i<L;i++)out[i]*=g;} return out; }

function distFromImage(rec){ // luma histogram (working space already? use raw RGB luma)
  const d=rec.dataA.data,h=new Float64Array(256); for(let i=0;i<d.length;i+=4){const y=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)|0; h[y]++;} return h; }
function distFromAudio(data){ // averaged magnitude spectrum over a few frames → 256-bin log-freq profile
  const N=2048,K=N/2,re=new Float32Array(N),im=new Float32Array(N),acc=new Float64Array(K+1),win=new Float32Array(N);
  for(let i=0;i<N;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/N); const frames=Math.min(40,Math.max(1,Math.floor(data.length/N)));
  for(let f=0;f<frames;f++){ const st=f*N; for(let i=0;i<N;i++){re[i]=(data[st+i]||0)*win[i];im[i]=0;} fft(re,im,false); for(let k=0;k<=K;k++)acc[k]+=Math.hypot(re[k],im[k]); }
  // resample to 256 log bins
  const out=new Float64Array(256); for(let b=0;b<256;b++){ const k=Math.round(Math.pow(K,b/255)); out[b]=acc[Math.min(K,Math.max(1,k))]; } return out; }
function mean256(h){ let s=0,n=0; for(let v=0;v<256;v++){s+=v*h[v];n+=h[v];} return n?s/n:0; }

function cdf256(h){const c=new Float64Array(256);let s=0;for(let v=0;v<256;v++){s+=h[v];c[v]=s;}const tot=s||1;for(let v=0;v<256;v++)c[v]/=tot;return c;}
function pushforward(hA,cA,cB,t){ const out=new Float64Array(256); for(let v=0;v<256;v++){ if(hA[v]<=0)continue; const lo=v>0?cA[v-1]:0; const p=lo+(cA[v]-lo)*0.5; const q=invCDF256(cB,p); const dst=clamp((1-t)*v+t*q,0,255); const i0=dst|0,f=dst-i0; out[i0]+=hA[v]*(1-f); if(i0+1<256)out[i0+1]+=hA[v]*f; } return out; }
function maxv(h){let m=0;for(let v=0;v<256;v++)if(h[v]>m)m=h[v];return m;}

function encodeWav(data,rate){ const len=data.length,ab=new ArrayBuffer(44+len*2),dv=new DataView(ab);
  const wr=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
  wr(0,"RIFF");dv.setUint32(4,36+len*2,true);wr(8,"WAVE");wr(12,"fmt ");dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
  dv.setUint32(24,rate,true);dv.setUint32(28,rate*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);wr(36,"data");dv.setUint32(40,len*2,true);
  let o=44;for(let i=0;i<len;i++){let s=Math.max(-1,Math.min(1,data[i]));dv.setInt16(o,s*0x7fff,true);o+=2;} return ab; }

/* ============================== GENOPATCH — EVOLUTIONARY RESYNTHESIS ============================== */
/* Grows a playable FM+formant patch that matches a target spectrum, by Differential Evolution.
   Pure DSP (Node-testable). Population fitness runs on a Web-Worker pool (M4 Max) with a single-thread fallback. */
const GP_N=2048, GP_NB=96, GP_D=13, GP_NYQ=11025;        // candidate render @ 22050 → Nyquist 11025
const _gpWin=(()=>{const w=new Float32Array(GP_N);for(let i=0;i<GP_N;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/GP_N);return w;})();
const _gpRe=new Float32Array(GP_N), _gpIm=new Float32Array(GP_N);
function gpParams(g){ const f0=50*Math.pow(12,g[0]), ratio=0.5*Math.pow(16,g[1]), index=g[2]*14, F=[];
  for(let i=0;i<3;i++){const o=3+i*3; F.push({f:150*Math.pow(7000/150,g[o]), Q:0.7+g[o+1]*11.3, gain:g[o+2]});}
  return {f0,ratio,index,F,noise:g[12]*0.6}; }
function bpResp(f,fc,Q){ if(f<=0)return 0; const r=f/fc-fc/f; return 1/Math.sqrt(1+(Q*r)*(Q*r)); }
// candidate log-magnitude descriptor (NB log bins, mean-removed) — same axis as the target
function candSpec(g,target){ const SR=22050,N=GP_N,K=N/2,p=gpParams(g),re=_gpRe,im=_gpIm;
  const wc=2*Math.PI*p.f0/SR, wm=2*Math.PI*p.f0*p.ratio/SR;
  for(let i=0;i<N;i++){ re[i]=Math.sin(wc*i+p.index*Math.sin(wm*i))*_gpWin[i]; im[i]=0; }
  fft(re,im,false);
  const NB=target.length,out=new Float32Array(NB),lf0=Math.log(40),lf1=Math.log(GP_NYQ);
  for(let b=0;b<NB;b++){ const f=Math.exp(lf0+(lf1-lf0)*b/(NB-1)), k=Math.round(f/SR*N);
    let mag=(k<1||k>K)?0:Math.hypot(re[k],im[k]); let sh=0.12; for(let j=0;j<p.F.length;j++)sh+=p.F[j].gain*bpResp(f,p.F[j].f,p.F[j].Q);
    mag=mag*sh+p.noise*0.04*(f>1500?1:0.3); out[b]=Math.log(mag+1e-6); }
  let m=0; for(let b=0;b<NB;b++)m+=out[b]; m/=NB; for(let b=0;b<NB;b++)out[b]-=m; return out; }
function gpLoss(desc,target){ let s=0; for(let i=0;i<desc.length;i++){const d=desc[i]-target[i];s+=d*d;} return s/desc.length; }
// target descriptor from a real buffer (same 40..11025 log axis, mean-removed)
function specDescriptor(data,rate){ const N=GP_N,K=N/2,NB=GP_NB,re=new Float32Array(N),im=new Float32Array(N),acc=new Float64Array(K+1);
  const frames=Math.min(60,Math.max(1,Math.floor(data.length/N)));
  for(let f=0;f<frames;f++){const st=f*N;for(let i=0;i<N;i++){re[i]=(data[st+i]||0)*_gpWin[i];im[i]=0;}fft(re,im,false);for(let k=0;k<=K;k++)acc[k]+=Math.hypot(re[k],im[k]);}
  const out=new Float32Array(NB),lf0=Math.log(40),lf1=Math.log(GP_NYQ);
  for(let b=0;b<NB;b++){const f=Math.exp(lf0+(lf1-lf0)*b/(NB-1)),k=Math.round(f/rate*N);out[b]=Math.log((acc[Math.min(K,Math.max(1,k))]/frames)+1e-6);}
  let m=0;for(let b=0;b<NB;b++)m+=out[b];m/=NB;for(let b=0;b<NB;b++)out[b]-=m; return out; }
// seed a few individuals with formants at the target's spectral peaks (faster convergence)
function seedFromPeaks(pop,target){ const NB=target.length,peaks=[];
  for(let b=2;b<NB-2;b++){ if(target[b]>target[b-1]&&target[b]>target[b+1]&&target[b]>0.2) peaks.push([b,target[b]]); }
  peaks.sort((a,b)=>b[1]-a[1]); const lf0=Math.log(40),lf1=Math.log(GP_NYQ);
  for(let s=0;s<Math.min(8,pop.length);s++){ const g=pop[s];
    for(let i=0;i<3;i++){ const pk=peaks[i+(s%2)]||peaks[i]; if(pk){ const jit=s<4?0:(Math.random()*2-1)*0.05; const f=Math.exp(lf0+(lf1-lf0)*pk[0]/(NB-1)); g[3+i*3]=clamp(Math.log(f/150)/Math.log(7000/150)+jit,0,1); g[4+i*3]=clamp(0.5+(s>=4?(Math.random()*2-1)*0.2:0),0,1); g[5+i*3]=0.8; } } } }
// ---- worker pool (built from an inline Blob; offline/file:// safe; transferable typed arrays) ----
let workerPool=null, workerURL=null;
const WORKER_SRC=[ fft.toString(), gpParams.toString(), bpResp.toString(), candSpec.toString(), gpLoss.toString(),
  "const GP_N=2048,GP_NYQ=11025;",
  "const _gpWin=(()=>{const w=new Float32Array(GP_N);for(let i=0;i<GP_N;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/GP_N);return w;})();",
  "const _gpRe=new Float32Array(GP_N),_gpIm=new Float32Array(GP_N);",
  "onmessage=function(e){var d=e.data,t=new Float32Array(d.target),L=new Float32Array(d.P);for(var i=0;i<d.P;i++){var g=d.genomes.subarray(i*d.D,(i+1)*d.D);L[i]=gpLoss(candSpec(g,t),t);}postMessage(L,[L.buffer]);};"
].join("\n");
function initWorkers(){ if(workerPool)return; try{ const blob=new Blob([WORKER_SRC],{type:'text/javascript'}); workerURL=URL.createObjectURL(blob);
  const n=Math.min(16,Math.max(2,navigator.hardwareConcurrency||4)); workerPool=[]; for(let i=0;i<n;i++)workerPool.push(new Worker(workerURL));
  // smoke-test one worker; if it throws asynchronously we still have the fallback in evalPop
  }catch(e){ workerPool=null; } }
async function evalPop(list,target,outFit){ const P=list.length,D=list[0].length;
  if(workerPool&&workerPool.length){ const nw=workerPool.length,chunk=Math.ceil(P/nw),jobs=[];
    for(let w=0;w<nw;w++){ const s=w*chunk,e=Math.min(P,s+chunk); if(s>=e)break; const cnt=e-s;
      const flat=new Float32Array(cnt*D); for(let i=0;i<cnt;i++)flat.set(list[s+i],i*D); const tc=new Float32Array(target);
      jobs.push(new Promise((res,rej)=>{ const wk=workerPool[w]; const to=setTimeout(()=>rej('worker timeout'),8000);
        wk.onmessage=ev=>{clearTimeout(to); const L=ev.data; for(let i=0;i<cnt;i++)outFit[s+i]=L[i]; res();};
        wk.onerror=err=>{clearTimeout(to); rej(err);};
        wk.postMessage({genomes:flat,P:cnt,D,target:tc},[flat.buffer,tc.buffer]); }));
    }
    try{ await Promise.all(jobs); return; }catch(e){ workerPool=null; /* fall through to single-thread */ }
  }
  for(let i=0;i<P;i++) outFit[i]=gpLoss(candSpec(list[i],target),target);
}
async function genopatch(target,onProgress){ const D=GP_D,big=(workerPool&&workerPool.length>=8),eff=(S.gp&&S.gp.effort)||'std',mul=eff==='fast'?0.5:eff==='deep'?2.2:1,P=Math.round((big?64:48)*(eff==='deep'?1.5:1)),G=Math.round((big?110:40)*mul),F=0.6,CR=0.9;
  let pop=[]; for(let i=0;i<P;i++){const g=new Float32Array(D);for(let d=0;d<D;d++)g[d]=Math.random();pop.push(g);} seedFromPeaks(pop,target);
  const fit=new Float64Array(P); await evalPop(pop,target,fit); let best=0; for(let i=1;i<P;i++)if(fit[i]<fit[best])best=i;
  for(let gen=0;gen<G;gen++){
    if(S.gp&&S.gp.cancel) return {genome:pop[best],loss:fit[best],cancelled:true};
    const trials=[];
    for(let i=0;i<P;i++){ let a,b,c; do{a=Math.floor(Math.random()*P)}while(a===i); do{b=Math.floor(Math.random()*P)}while(b===i||b===a); do{c=Math.floor(Math.random()*P)}while(c===i||c===a||c===b);
      const tr=new Float32Array(D),R=Math.floor(Math.random()*D);
      for(let d=0;d<D;d++) tr[d]=(Math.random()<CR||d===R)?clamp(pop[a][d]+F*(pop[b][d]-pop[c][d]),0,1):pop[i][d]; trials.push(tr); }
    const tfit=new Float64Array(P); await evalPop(trials,target,tfit);
    for(let i=0;i<P;i++) if(tfit[i]<=fit[i]){pop[i]=trials[i];fit[i]=tfit[i]; if(fit[i]<fit[best])best=i;}
    if(onProgress) onProgress(gen+1,G,fit[best],pop[best]);
    if(gen%4===0) await new Promise(r=>setTimeout(r,0));
  }
  return {genome:pop[best],loss:fit[best],cancelled:false};
}
// biquad bandpass (RBJ) for time-domain resynthesis of the won patch
function biquadBP(fc,Q,sr){ const w0=2*Math.PI*fc/sr,al=Math.sin(w0)/(2*Q),c=Math.cos(w0),a0=1+al;
  return {b0:al/a0,b1:0,b2:-al/a0,a1:-2*c/a0,a2:(1-al)/a0}; }
function synthFromPatch(g,dur,rate,semis){ const p=gpParams(g),L=Math.floor(dur*rate),core=new Float32Array(L);
  const pr=Math.pow(2,(semis||0)/12), f0=p.f0*pr, wc=2*Math.PI*f0/rate, wm=2*Math.PI*f0*p.ratio/rate;
  for(let i=0;i<L;i++)core[i]=Math.sin(wc*i+p.index*Math.sin(wm*i));
  const out=new Float32Array(L);
  for(let j=0;j<p.F.length;j++){ const fc=Math.min(rate/2-100,p.F[j].f*pr),bq=biquadBP(fc,p.F[j].Q,rate); let x1=0,x2=0,y1=0,y2=0;
    for(let i=0;i<L;i++){const x=core[i],y=bq.b0*x+bq.b1*x1+bq.b2*x2-bq.a1*y1-bq.a2*y2;x2=x1;x1=x;y2=y1;y1=y;out[i]+=y*p.F[j].gain;} }
  for(let i=0;i<L;i++)out[i]+=core[i]*0.12;
  if(p.noise>0)for(let i=0;i<L;i++)out[i]+=(Math.random()*2-1)*p.noise*0.15;
  const a=Math.floor(rate*0.012),r=Math.floor(rate*0.06); for(let i=0;i<a;i++)out[i]*=i/a; for(let i=0;i<r;i++)out[L-1-i]*=i/r;
  return normalize(out); }

/* ============================== FX RACK (buffer DSP: saturate → transient → granular) ============================== */
function fxSaturate(d,o){ const out=new Float32Array(d.length),k=o.drive*9+0.01;
  for(let i=0;i<d.length;i++){ const x=d[i]; let y; if(o.type==='tape')y=Math.tanh(x*(1+k))/Math.tanh(1+k); else if(o.type==='hard')y=Math.max(-1,Math.min(1,x*(1+k))); else y=(1+k)*x/(1+k*Math.abs(x)); out[i]=x*(1-o.mix)+y*o.mix; }
  return normalize(out); }
function fxTransient(d,o,rate){ const L=d.length,out=new Float32Array(L);
  const aF=Math.exp(-1/(0.002*rate)),rF=Math.exp(-1/(0.03*rate)),aS=Math.exp(-1/(0.08*rate)),rS=Math.exp(-1/(0.2*rate));
  let ef=0,es=0; for(let i=0;i<L;i++){ const x=Math.abs(d[i]);
    ef = x>ef? aF*ef+(1-aF)*x : rF*ef+(1-rF)*x; es = x>es? aS*es+(1-aS)*x : rS*es+(1-rS)*x;
    const diff=ef-es; let g; if(diff>0) g=1+o.attack*Math.min(2.5,diff*10); else g=1+o.sustain*Math.min(1.5,(-diff)*10);
    out[i]=d[i]*Math.max(0,g); }
  return normalize(out); }
function fxGranular(d,o,rate){ const gr=mulberry32(4099),L=d.length,out=new Float32Array(L),gss=Math.max(64,Math.floor(o.size/1000*rate)),step=Math.max(1,Math.floor(rate/Math.max(1,o.density))),pr=Math.pow(2,o.pitch/12);
  for(let t=0;t<L;t+=step){ let pos=t+(gr()*2-1)*o.spray*rate*0.12; pos=Math.max(0,Math.min(L-Math.ceil(gss*pr)-2,pos)); const rev=gr()<o.reverse;
    for(let j=0;j<gss;j++){ const wj=0.5-0.5*Math.cos(2*Math.PI*j/gss); const src=rev?pos+(gss-1-j)*pr:pos+j*pr; const i0=Math.floor(src),f=src-i0; const s=(d[i0]||0)*(1-f)+(d[i0+1]||0)*f; const oi=t+j; if(oi<L)out[oi]+=s*wj; } }
  for(let i=0;i<L;i++)out[i]=d[i]*(1-o.mix)+out[i]*o.mix; return normalize(out); }
function applyFX(data,rate){ let d=data;
  if(S.fx.sat.on)   d=fxSaturate(d,S.fx.sat);
  if(S.fx.trans.on) d=fxTransient(d,S.fx.trans,rate);
  if(S.fx.gran.on)  d=fxGranular(d,S.fx.gran,rate);
  return d; }

/* ============================== SPLAT SPACE (2D→3D, sliced-OT displacement) ============================== */
function liftSplats(rec,N){ const stepp=Math.max(2,Math.round(Math.sqrt(rec.w*rec.h/N)));
  const d=rec.dataA.data,out=[],ar=rec.w/rec.h,W=rec.w;
  const lumAt=(x,y)=>{const i=(y*W+x)*4;return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];};
  for(let y=stepp>>1;y<rec.h;y+=stepp)for(let x=stepp>>1;x<rec.w;x+=stepp){ const i=(y*W+x)*4;
    const r=d[i],g=d[i+1],b=d[i+2],lum=(0.299*r+0.587*g+0.114*b)/255;
    // local contrast → per-point size (ladder rung: ONE per-point param; small in detail, big in smooth)
    let cont=0; if(x>1&&y>1&&x<rec.w-2&&y<rec.h-2){ const c0=lumAt(x,y);
      cont=(Math.abs(lumAt(x+2,y)-c0)+Math.abs(lumAt(x-2,y)-c0)+Math.abs(lumAt(x,y+2)-c0)+Math.abs(lumAt(x,y-2)-c0))/1020; }
    const sz=clamp(1.55-cont*3.2,0.55,1.55);
    out.push({p:[ (x/rec.w-0.5)*1.7*Math.min(1.3,ar), (y/rec.h-0.5)*1.7/Math.max(0.77,ar), (lum-0.5) ], c:[r,g,b], sz}); }
  return out; }
function slicedOT(A,B){ // returns per-splat 6D transport destinations for A (positions+colors)
  const n=Math.min(A.length,B.length), CW=0.0035, srng=mulberry32(777);
  const X=new Float64Array(n*6), Y=new Float64Array(n*6);
  for(let i=0;i<n;i++){ for(let k=0;k<3;k++){X[i*6+k]=A[i].p[k];Y[i*6+k]=B[i].p[k];}
    for(let k=0;k<3;k++){X[i*6+3+k]=A[i].c[k]*CW;Y[i*6+3+k]=B[i].c[k]*CW;} }
  const idxA=new Array(n),idxB=new Array(n),pa=new Float64Array(n),pb=new Float64Array(n);
  const ITER=32;
  for(let it=0;it<ITER;it++){ // random unit dir in 6D
    let v=[0,0,0,0,0,0],norm=0; for(let k=0;k<6;k++){v[k]=srng()*2-1;norm+=v[k]*v[k];} norm=Math.sqrt(norm)||1; for(let k=0;k<6;k++)v[k]/=norm;
    for(let i=0;i<n;i++){ let a=0,b2=0; for(let k=0;k<6;k++){a+=X[i*6+k]*v[k];b2+=Y[i*6+k]*v[k];} pa[i]=a;pb[i]=b2;idxA[i]=i;idxB[i]=i; }
    idxA.sort((i,j)=>pa[i]-pa[j]); idxB.sort((i,j)=>pb[i]-pb[j]);
    const stepp=0.55*(1-it/ITER)+0.12;
    for(let r=0;r<n;r++){ const ia=idxA[r],ib=idxB[r],delta=pb[ib]-pa[ia];
      for(let k=0;k<6;k++) X[ia*6+k]+=stepp*delta*v[k]; } }
  return {X,n};
}

/* ============================== GABOR ATOMS — the audio splat analogue ============================== */
function extractAtoms(data,rate,KA){ const N=1024,K2=N/2,hop=256,win=new Float32Array(N);
  for(let i=0;i<N;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/N);
  const frames=Math.max(1,Math.floor((data.length-N)/hop)), mag=new Float32Array(frames*K2);
  const re=new Float32Array(N),im=new Float32Array(N);
  const flat=new Float32Array(frames);   // spectral flatness per frame (tonalness = 1-flat)
  for(let fr=0;fr<frames;fr++){ const st=fr*hop; for(let i=0;i<N;i++){re[i]=(data[st+i]||0)*win[i];im[i]=0;} fft(re,im,false);
    let lsum=0,asum=0,cnt=0;
    for(let k=1;k<K2;k++){ const m=Math.hypot(re[k],im[k]); mag[fr*K2+k]=m;
      if(m>1e-9){lsum+=Math.log(m);asum+=m;cnt++;} }
    flat[fr]=cnt?Math.exp(lsum/cnt)/((asum/cnt)||1):1; }
  const atoms=[];
  for(let a=0;a<KA;a++){ let bi=0,bv=0; for(let i=0;i<mag.length;i++)if(mag[i]>bv){bv=mag[i];bi=i;}
    if(bv<=0)break; const fr=(bi/K2)|0,k=bi%K2;
    atoms.push({time:fr*hop/rate, f:k*rate/N, amp:bv, ton:1-Math.min(1,flat[fr])});
    for(let df=-3;df<=3;df++)for(let dk=-5;dk<=5;dk++){ const f2=fr+df,k2=k+dk; if(f2<0||k2<1||f2>=frames||k2>=K2)continue;
      mag[f2*K2+k2]*=1-Math.exp(-(df*df/4+dk*dk/8)); } }
  let mx=0; for(const at of atoms)mx=Math.max(mx,at.amp); for(const at of atoms)at.amp/=mx||1;
  return {atoms,dur:data.length/rate}; }

function hsl2rgb(h,sv,l){ const a=sv*Math.min(l,1-l);
  const f=n=>{const k=(n+h*12)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  return [f(0)*255,f(8)*255,f(4)*255]; }
function atomColor(v,ton,amp){ // v in [-1,1] (log-freq), ton 0..1, amp 0..1
  const hue=0.66*((v+1)/2);                   // low=0 (warm red) -> high=0.66 (cool blue-violet)
  return hsl2rgb(hue, 0.25+0.75*Math.max(0,Math.min(1,ton)), 0.28+0.5*amp); }

function specCorr(a,b){ const n=Math.min(a.length,b.length); let ma=0,mb=0;
  for(let i=0;i<n;i++){ma+=a[i];mb+=b[i];} ma/=n;mb/=n;
  let num=0,da=0,db=0; for(let i=0;i<n;i++){const xa=a[i]-ma,xb=b[i]-mb;num+=xa*xb;da+=xa*xa;db+=xb*xb;}
  return (da>0&&db>0)?num/Math.sqrt(da*db):0; }

// ---- patch: the two map builders, split so the sliced OT inside them can run off the main thread ----
// sliced-OT in full 3D RGB (joint color transport; approximate via random projections)
function slicedClouds(){ const MAXS=9000;
  const a=S.imgA.dataA.data, b=S.imgB.dataA.data, na=a.length/4, nb=b.length/4;
  const stepA=Math.max(1,Math.floor(na/MAXS)), stepB=Math.max(1,Math.floor(nb/MAXS));
  const A=[],B=[];
  for(let i=0;i<na;i+=stepA){const o=i*4;A.push({p:[a[o]/85,a[o+1]/85,a[o+2]/85],c:[0,0,0]});}
  for(let i=0;i<nb;i+=stepB){const o=i*4;B.push({p:[b[o]/85,b[o+1]/85,b[o+2]/85],c:[0,0,0]});}
  const n=Math.min(A.length,B.length); A.length=n; B.length=n; return {A,B,n}; }
function slicedAssemble(A,X,n){ const G=16;
  const acc=new Float32Array(G*G*G*3), cnt=new Float32Array(G*G*G);
  for(let i=0;i<n;i++){ const r=A[i].p[0]*85,g=A[i].p[1]*85,bb=A[i].p[2]*85;
    const ci=(Math.min(G-1,r/256*G|0)*G+Math.min(G-1,g/256*G|0))*G+Math.min(G-1,bb/256*G|0);
    acc[ci*3]+=X[i*6]*85-r; acc[ci*3+1]+=X[i*6+1]*85-g; acc[ci*3+2]+=X[i*6+2]*85-bb; cnt[ci]++; }
  for(let ci=0;ci<G*G*G;ci++) if(cnt[ci]>0){acc[ci*3]/=cnt[ci];acc[ci*3+1]/=cnt[ci];acc[ci*3+2]/=cnt[ci];}
  // dilate-fill empty cells from filled neighbours
  for(let pass=0;pass<6;pass++){ let empty=0;
    for(let x=0;x<G;x++)for(let y=0;y<G;y++)for(let z=0;z<G;z++){ const ci=(x*G+y)*G+z; if(cnt[ci]>0)continue; empty++;
      let sr=0,sg=0,sb=0,m=0;
      for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const nx=x+dx,ny=y+dy,nz=z+dz; if(nx<0||ny<0||nz<0||nx>=G||ny>=G||nz>=G)continue;
        const nc=(nx*G+ny)*G+nz; if(cnt[nc]>0){sr+=acc[nc*3];sg+=acc[nc*3+1];sb+=acc[nc*3+2];m++;} }
      if(m>0){acc[ci*3]=sr/m;acc[ci*3+1]=sg/m;acc[ci*3+2]=sb/m;cnt[ci]=0.5;} }
    if(!empty)break; }
  S._slMap={acc,G}; return S._slMap; }
function buildSlicedMap(){ const c=slicedClouds(); const {X}=slicedOT(c.A,c.B); return slicedAssemble(c.A,X,c.n); }
// SPATIAL OT: pixels move. slicedOT on (x,y)+(r,g,b) clouds; splat-accumulate reconstruction
function spatialClouds(step){
  const recA=S.imgA,recB=S.imgB; step=step||3;
  function cloud(rec){ const d=rec.dataA.data,out=[],ar=rec.w/rec.h,W=rec.w;
    const lumAt=(x,y)=>{const i=(y*W+x)*4;return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];};
    for(let y=1;y<rec.h;y+=step)for(let x=1;x<rec.w;x+=step){ const i=(y*W+x)*4;
      let cont=0; if(x>1&&y>1&&x<rec.w-2&&y<rec.h-2){ const c0=lumAt(x,y);
        cont=(Math.abs(lumAt(x+2,y)-c0)+Math.abs(lumAt(x-2,y)-c0)+Math.abs(lumAt(x,y+2)-c0)+Math.abs(lumAt(x,y-2)-c0))/1020; }
      out.push({p:[(x/rec.w-0.5)*2*Math.min(1.2,ar),(y/rec.h-0.5)*2/Math.max(0.83,ar),0],c:[d[i],d[i+1],d[i+2]],sz:clamp(1.55-cont*3.2,0.55,1.55)}); }
    return out; }
  const A=cloud(recA),B=cloud(recB); const n=Math.min(A.length,B.length); A.length=n; B.length=n; return {A,B,n}; }
function spatialAssemble(A,B,X,n){ const CW=0.0035;
  const m={n, x0:new Float32Array(n),y0:new Float32Array(n),dx:new Float32Array(n),dy:new Float32Array(n),
    c0:new Uint8ClampedArray(n*3), c1:new Uint8ClampedArray(n*3), sz:new Float32Array(n)};
  for(let i=0;i<n;i++){ m.x0[i]=A[i].p[0]; m.y0[i]=A[i].p[1]; m.dx[i]=X[i*6]-A[i].p[0]; m.dy[i]=X[i*6+1]-A[i].p[1]; m.sz[i]=((A[i].sz||1)+(B[i].sz||1))/2;
    for(let k=0;k<3;k++){ m.c0[i*3+k]=A[i].c[k]; m.c1[i*3+k]=clamp(X[i*6+3+k]/CW,0,255); } }
  S._spMap=m; return m; }
function buildSpatialMap(){ const c=spatialClouds(); const {X}=slicedOT(c.A,c.B); return spatialAssemble(c.A,c.B,X,c.n); }
// the same sliced OT as slicedOT(A,B) above, on flat typed arrays, for the worker
function packClouds(A,B,n){ const CW=0.0035, X=new Float64Array(n*6), Y=new Float64Array(n*6);
  for(let i=0;i<n;i++){ for(let k=0;k<3;k++){X[i*6+k]=A[i].p[k];Y[i*6+k]=B[i].p[k];} for(let k=0;k<3;k++){X[i*6+3+k]=A[i].c[k]*CW;Y[i*6+3+k]=B[i].c[k]*CW;} }
  return {X,Y}; }
function slicedOTxy(X,Y,n){ const srng=mulberry32(777), idxA=new Array(n), idxB=new Array(n), pa=new Float64Array(n), pb=new Float64Array(n), ITER=32;
  for(let it=0;it<ITER;it++){ let v=[0,0,0,0,0,0],norm=0; for(let k=0;k<6;k++){v[k]=srng()*2-1;norm+=v[k]*v[k];} norm=Math.sqrt(norm)||1; for(let k=0;k<6;k++)v[k]/=norm;
    for(let i=0;i<n;i++){ let a=0,b2=0; for(let k=0;k<6;k++){a+=X[i*6+k]*v[k];b2+=Y[i*6+k]*v[k];} pa[i]=a;pb[i]=b2;idxA[i]=i;idxB[i]=i; }
    idxA.sort((i,j)=>pa[i]-pa[j]); idxB.sort((i,j)=>pb[i]-pb[j]);
    const stepp=0.55*(1-it/ITER)+0.12;
    for(let r=0;r<n;r++){ const ia=idxA[r],ib=idxB[r],delta=pb[ib]-pa[ia]; for(let k=0;k<6;k++) X[ia*6+k]+=stepp*delta*v[k]; } }
  return X; }

// ---- new: AIFF and AIFF-C (uncompressed or sowt or fl32), which Chrome's decoder does not read. Returns mono. ----
function ext80(dv,o){ const se=dv.getUint16(o), e=se&0x7fff, hi=dv.getUint32(o+2), lo=dv.getUint32(o+6); if(!e&&!hi&&!lo)return 0;
  const v=(hi*4294967296+lo)*Math.pow(2,e-16383-63); return (se&0x8000)?-v:v; }
function decodeAiff(ab){ const dv=new DataView(ab), tag=o=>String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
  if(ab.byteLength<12||tag(0)!=='FORM')return null; const form=tag(8); if(form!=='AIFF'&&form!=='AIFC')return null;
  let o=12,ch=0,frames=0,bits=0,rate=0,comp='NONE',ss=-1,ssLen=0;
  while(o+8<=ab.byteLength){ const id=tag(o), len=dv.getUint32(o+4), b=o+8;
    if(id==='COMM'){ ch=dv.getInt16(b); frames=dv.getUint32(b+2); bits=dv.getInt16(b+6); rate=ext80(dv,b+8); if(form==='AIFC'&&len>=22)comp=tag(b+18); }
    else if(id==='SSND'){ const off=dv.getUint32(b); ss=b+8+off; ssLen=Math.min(len-8-off,ab.byteLength-ss); }
    o=b+len+(len&1); }
  if(ss<0||!ch||!rate)return null;
  const le=comp==='sowt', fl=comp==='fl32'||comp==='FL32';
  if(!(comp==='NONE'||le||fl))throw new Error('this AIFF-C file is compressed ('+comp.trim()+')');
  const bytes=fl?4:Math.ceil(bits/8), n=Math.min(frames,Math.floor(ssLen/(bytes*ch))), out=new Float32Array(n);
  for(let i=0;i<n;i++){ let s=0; for(let c=0;c<ch;c++){ const p=ss+(i*ch+c)*bytes; let v;
      if(fl)v=dv.getFloat32(p,le); else if(bytes===1)v=dv.getInt8(p)/128; else if(bytes===2)v=dv.getInt16(p,le)/32768;
      else if(bytes===3)v=(le?((dv.getInt8(p+2)<<16)|(dv.getUint8(p+1)<<8)|dv.getUint8(p)):((dv.getInt8(p)<<16)|(dv.getUint8(p+1)<<8)|dv.getUint8(p+2)))/8388608;
      else v=dv.getInt32(p,le)/2147483648;
      s+=v; } out[i]=s/ch; }
  return {data:out,rate:Math.round(rate)}; }

    return { lerp, clamp, mulberry32, chanCDF, invCDF256, buildLUT, toSpace, fromSpace, cacheImageDists, applySliced, renderImage,
      renderSpatial, xfadeImage, fft, resampleLinear, resampleAudio, prepAudio, renderAudioOT, renderAudioMP, renderAudioXfade, normalize,
      distFromImage, distFromAudio, mean256, cdf256, pushforward, maxv, encodeWav, gpParams, candSpec, specDescriptor, genopatch,
      initWorkers, synthFromPatch, applyFX, liftSplats, slicedOT, extractAtoms, hsl2rgb, atomColor, specCorr,
      slicedClouds, slicedAssemble, buildSlicedMap, spatialClouds, spatialAssemble, buildSpatialMap, packClouds, slicedOTxy, decodeAiff,
      get workers() { return workerPool ? workerPool.length : 0; } };
  }

  // The worker runs the heavy steps with its own engine, so the stage never stalls: sound blends, atoms and sliced OT.
  const WORKER_SRC = `'use strict';
const createEngine=${createEngine.toString()};
onmessage=(e)=>{const m=e.data;try{
if(m.type==='audio'){const E=createEngine({audA:m.A,audB:m.B,audRate:m.rate,phasemode:m.phasemode,mpMix:m.mpMix,xlaw:m.xlaw,fx:m.fx});let d;
 if(m.sweep){if(m.method==='xfade'||m.method==='mp'){const L=m.A.length;d=new Float32Array(L);for(let i=0;i<L;i++){const tt=i/L;d[i]=m.A[i]*Math.cos(tt*Math.PI/2)+m.B[i]*Math.sin(tt*Math.PI/2);}d=E.normalize(d);}else d=E.renderAudioOT(0,x=>x);}
 else d=m.method==='mp'?E.renderAudioMP(m.t):m.method==='xfade'?E.renderAudioXfade(m.t):E.renderAudioOT(m.t);
 d=E.applyFX(d,m.rate);postMessage({id:m.id,data:d},[d.buffer]);}
else if(m.type==='atoms'){const E=createEngine({});postMessage({id:m.id,result:E.extractAtoms(m.data,m.rate,m.k)});}
else if(m.type==='ot'){const E=createEngine({});const t0=performance.now();const X=E.slicedOTxy(m.X,m.Y,m.n);postMessage({id:m.id,X,ms:performance.now()-t0},[X.buffer]);}
}catch(err){postMessage({id:m.id,error:String(err&&err.message||err)});}};`;

  global.DisplacerEngine = { createEngine, WORKER_SRC };
})(window);
