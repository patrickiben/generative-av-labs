/* enter-workers.js: the two background jobs. EnterDepth estimates depth off the main thread, so the drums and the
   picture never stall. EnterCast turns sound into a printable mesh. Both ship as source strings and start from blob URLs. */
(function (global) {
  'use strict';
  const ORT = '1.30.0', CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist/`;
  const MODEL_REV = '4472b7362082ad9968fee890ca0f1e5aca36b93d';
  const MODEL_BASE = `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${MODEL_REV}/onnx/`;
  // Every byte count and hash below was measured on 2026-11-02. A file that differs is refused, not loaded.
  const PATHS = {
    gpu: { label: 'graphics card', short: 518, runtime: { js: 'ort.webgpu.min.mjs', wasm: 'ort-wasm-simd-threaded.asyncify.wasm', mjs: 'ort-wasm-simd-threaded.asyncify.mjs', bytes: 26781914 }, model: { file: 'model_fp16.onnx', bytes: 49642442, sha: '2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04', name: 'half precision' } },
    gpu32: { label: 'graphics card', short: 518, runtime: { js: 'ort.webgpu.min.mjs', wasm: 'ort-wasm-simd-threaded.asyncify.wasm', mjs: 'ort-wasm-simd-threaded.asyncify.mjs', bytes: 26781914 }, model: { file: 'model.onnx', bytes: 99060839, sha: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c', name: 'full precision' } },
    cpu: { label: 'processor', short: 392, runtime: { js: 'ort.wasm.min.mjs', wasm: 'ort-wasm-simd-threaded.wasm', mjs: 'ort-wasm-simd-threaded.mjs', bytes: 14239897 }, model: { file: 'model_quantized.onnx', bytes: 27258801, sha: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d', name: 'quantized' } },
  };

  const DEPTH_SRC = `
let ort, session, queue = Promise.resolve();
onmessage = (e) => { queue = queue.then(async () => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const t0 = performance.now();
      ort = await import(m.cdn + m.js); ort = ort.default || ort;
      ort.env.wasm.wasmPaths = m.cdn;
      ort.env.wasm.wasmBinary = m.wasm;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.logLevel = 'error';
      session = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: m.gpu ? ['webgpu'] : ['wasm'] });
      postMessage({ id: m.id, type: 'ready', ms: performance.now() - t0, threads: ort.env.wasm.numThreads });
    } else if (m.type === 'run') {
      const t0 = performance.now();
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', m.data, [1, 3, m.h, m.w]) });
      const d = out[session.outputNames[0]], a = new Float32Array(d.data);
      postMessage({ id: m.id, type: 'depth', ms: performance.now() - t0, dims: d.dims, data: a }, [a.buffer]);
    }
  } catch (err) { postMessage({ id: m.id, type: 'error', msg: String((err && err.message) || err) }); }
}); };`;

  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

  async function openCache() { try { return global.caches ? await global.caches.open('enter-depth-v1') : null; } catch (e) { return null; } }

  // Download with a real byte count, verify when a hash is known, keep in this browser's storage.
  async function grab(url, bytes, sha, onBytes, signal) {
    const cache = await openCache();
    if (cache) { try { const hit = await cache.match(url); if (hit) { const ab = await hit.arrayBuffer(); onBytes(ab.byteLength); return { ab, cached: true }; } } catch (e) { /* storage may refuse; download instead */ } }
    let r;
    try { r = await fetch(url, { credentials: 'omit', mode: 'cors', signal }); } catch (e) { const err = new Error('network'); err.code = 'network'; throw err; }
    if (!r.ok) { const err = new Error(`status ${r.status}`); err.code = 'status'; err.status = r.status; throw err; }
    const reader = r.body.getReader(), parts = []; let got = 0;
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch (e) { const err = new Error('network'); err.code = 'network'; throw err; }
      if (chunk.done) break;
      parts.push(chunk.value); got += chunk.value.length; onBytes(got);
    }
    const out = new Uint8Array(got); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    if (bytes && got !== bytes) { const err = new Error(`size ${got}`); err.code = 'integrity'; throw err; }
    if (sha) { const h = hex(await crypto.subtle.digest('SHA-256', out)); if (h !== sha) { const err = new Error('hash'); err.code = 'integrity'; throw err; } }
    if (cache) { try { await cache.put(url, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* quota: it still runs, it just downloads next time */ } }
    return { ab: out.buffer, cached: false };
  }

  function pickPath() {
    return (async () => {
      let gpu = false, f16 = false, adapterName = '';
      try {
        if (navigator.gpu) {
          const a = await navigator.gpu.requestAdapter();
          if (a) { gpu = true; f16 = a.features.has('shader-f16'); adapterName = (a.info && (a.info.description || a.info.architecture || a.info.vendor)) || ''; }
        }
      } catch (e) { gpu = false; }
      const key = gpu ? (f16 ? 'gpu' : 'gpu32') : 'cpu';
      return { key, gpu, f16, adapterName, ...PATHS[key] };
    })();
  }

  function createDepth(onState) {
    let worker = null, path = null, loading = null, callSeq = 0;
    const calls = new Map();
    const stopWorker = (message) => {
      if (worker) worker.terminate(); worker = null;
      for (const p of calls.values()) p.rej(new Error(message || 'Depth processing stopped.'));
      calls.clear();
    };
    const call = (msg, transfer) => new Promise((res, rej) => {
      if (!worker) { rej(new Error('The depth worker is not ready.')); return; }
      const id = ++callSeq; calls.set(id, { res, rej });
      try { worker.postMessage({ ...msg, id }, transfer || []); }
      catch (e) { calls.delete(id); rej(e); }
    });
    let force = null;
    const pick = async () => { const p = await pickPath(); return force ? { ...p, key: 'cpu', ...PATHS.cpu } : p; };
    const api = {
      PATHS, MODEL_BASE, CDN,
      pickPath: pick,
      forceCpu() { force = 'cpu'; stopWorker('The depth processor changed.'); },
      async stored() {
        const cache = await openCache(); if (!cache) return null;
        const p = path || await pick();
        try { const hit = await cache.match(MODEL_BASE + p.model.file); return !!hit; } catch (e) { return null; }
      },
      async clear() {
        try { if (global.caches) await global.caches.delete('enter-depth-v1'); } catch (e) { /* nothing stored */ }
        stopWorker('The depth model was removed.');
        loading = null; path = null;
      },
      get path() { return path; },
      get ready() { return !!worker && !loading; },
      load() {
        if (loading) return loading;
        if (worker) return Promise.resolve(path);
        loading = (async () => {
          path = await pick();
          const total = path.model.bytes + path.runtime.bytes;
          let gotM = 0, gotW = 0, dead = false;
          const stop = new AbortController();
          // Once either download fails, the other stops too, and no late progress can paint over the failure.
          const tick = () => { if (!dead) onState({ state: 'downloading', got: gotM + gotW, total }); };
          onState({ state: 'downloading', got: 0, total });
          const [wasm, model] = await Promise.all([
            grab(CDN + path.runtime.wasm, path.runtime.bytes, null, (n) => { gotW = n; tick(); }, stop.signal),
            grab(MODEL_BASE + path.model.file, path.model.bytes, path.model.sha, (n) => { gotM = n; tick(); }, stop.signal),
          ]).catch((e) => { dead = true; stop.abort(); throw e; });
          onState({ state: 'loading', cached: wasm.cached && model.cached });
          const url = URL.createObjectURL(new Blob([DEPTH_SRC], { type: 'text/javascript' }));
          worker = new Worker(url); URL.revokeObjectURL(url);
          worker.onmessage = (e) => {
            const p = calls.get(e.data.id); if (!p) return; calls.delete(e.data.id);
            if (e.data.type === 'error') p.rej(new Error(e.data.msg)); else p.res(e.data);
          };
          worker.onerror = (e) => stopWorker(e.message || 'The depth worker failed.');
          const r = await call({ type: 'load', cdn: CDN, js: path.runtime.js, gpu: path.key !== 'cpu', wasm: wasm.ab, model: model.ab }, [wasm.ab, model.ab]);
          path.cached = wasm.cached && model.cached;
          path.loadMs = r.ms; path.threads = r.threads;
          loading = null;
          return path;
        })().catch((e) => { loading = null; stopWorker('Depth loading failed.'); throw e; });
        return loading;
      },
      // Picture to normalized inverse depth, at the picture's own proportions. 1 is near, as on the desktop worker.
      async estimate(source, outW, outH) {
        const iw = source.naturalWidth || source.width, ih = source.naturalHeight || source.height;
        const size = KitDepth.modelSize(iw, ih, path.short);
        const c = document.createElement('canvas'); c.width = size.w; c.height = size.h;
        const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(source, 0, 0, size.w, size.h);
        const tensor = KitDepth.toTensor(g.getImageData(0, 0, size.w, size.h).data, size.w, size.h);
        const r = await call({ type: 'run', data: tensor, w: size.w, h: size.h }, [tensor.buffer]);
        const hh = r.dims[r.dims.length - 2], ww = r.dims[r.dims.length - 1];
        const up = KitDepth.upsample(r.data, ww, hh, outW, outH);
        return { depth: KitDepth.normalize(up), ms: r.ms, modelW: ww, modelH: hh };
      },
    };
    return api;
  }

  /* ---------- the sculpture worker: atoms to density to a watertight mesh ---------- */
  const CAST_SRC = `
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const u=i+j,v=i+j+len/2,tr=re[v]*cr-im[v]*ci,ti=re[v]*ci+im[v]*cr;re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const nc=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nc}}}}
function extractAtoms(data,rate,KA){const N=1024,K2=N/2,hop=256,win=new Float32Array(N);for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/N);
const frames=Math.max(1,Math.floor((data.length-N)/hop)),mag=new Float32Array(frames*K2),re=new Float32Array(N),im=new Float32Array(N),flat=new Float32Array(frames);
for(let fr=0;fr<frames;fr++){const st=fr*hop;for(let i=0;i<N;i++){re[i]=(data[st+i]||0)*win[i];im[i]=0}fft(re,im);let lsum=0,asum=0,cnt=0;for(let k=1;k<K2;k++){const m=Math.hypot(re[k],im[k]);mag[fr*K2+k]=m;if(m>1e-9){lsum+=Math.log(m);asum+=m;cnt++}}flat[fr]=cnt?Math.exp(lsum/cnt)/((asum/cnt)||1e-9):0}
const atoms=[];const taken=new Uint8Array(frames*K2);for(let a=0;a<KA;a++){let bi=-1,bv=0;for(let i=0;i<frames*K2;i++)if(!taken[i]&&mag[i]>bv){bv=mag[i];bi=i}if(bi<0||bv<=0)break;const fr=Math.floor(bi/K2),k=bi%K2;for(let df=-2;df<=2;df++)for(let dk=-3;dk<=3;dk++){const f2=fr+df,k2=k+dk;if(f2>=0&&f2<frames&&k2>=0&&k2<K2)taken[f2*K2+k2]=1}atoms.push({time:fr*hop/rate,f:k*rate/N,amp:bv,ton:1-Math.min(1,flat[fr])})}
let mx=0;for(const at of atoms)mx=Math.max(mx,at.amp);if(mx>0)for(const at of atoms)at.amp/=mx;return{atoms,dur:data.length/rate}}
function cast(atoms,dur,sr,G,stage){
  const t0=performance.now(),D=new Float32Array(G*G*G),I=(x,y,z)=>x+y*G+z*G*G,lf0=Math.log(40),lf1=Math.log(sr/2),rng=mulberry32(4242),n=atoms.length,zj=new Float32Array(n);
  for(let i=0;i<n;i++)zj[i]=rng()*0.7-0.35;
  const cxOf=(a)=>(a.time/Math.max(dur,1e-6))*0.86+0.07,cyOf=(a)=>(Math.log(Math.max(40,a.f))-lf0)/(lf1-lf0)*0.8+0.1,czOf=(i,a)=>0.5+zj[i]*(0.4+0.6*a.amp);
  stage(35,'depositing '+n+' atoms into the density field');
  for(let i=0;i<n;i++){const a=atoms[i],r=(0.024+0.055*a.amp)*G,cx=cxOf(a)*G,cy=cyOf(a)*G,cz=czOf(i,a)*G,R=Math.ceil(r*3.6),q=2*r*r;
    for(let z=Math.max(0,Math.floor(cz-R));z<Math.min(G,cz+R);z++){const dz=z-cz;for(let y=Math.max(0,Math.floor(cy-R));y<Math.min(G,cy+R);y++){const dy=y-cy;for(let x=Math.max(0,Math.floor(cx-R));x<Math.min(G,cx+R);x++){const dx=x-cx;D[I(x,y,z)]+=a.amp*Math.exp(-(dx*dx+dy*dy+dz*dz)/q)}}}}
  // stems: the loudest atoms grow columns down to the plinth, so it prints as one piece
  const strong=atoms.map((a,i)=>[a.amp,i]).sort((p,q)=>q[0]-p[0]).slice(0,8);
  for(const [,i] of strong){const a=atoms[i],cx=cxOf(a)*G,cy=cyOf(a)*G,cz=czOf(i,a)*G,rt=(0.010+0.014*a.amp)*G,R=Math.ceil(rt*3.6),q=2*rt*rt,top=Math.floor(cy);
    for(let z=Math.max(0,Math.floor(cz-R));z<Math.min(G,cz+R);z++){const dz=z-cz;for(let x=Math.max(0,Math.floor(cx-R));x<Math.min(G,cx+R);x++){const dx=x-cx,v=a.amp*0.9*Math.exp(-(dx*dx+dz*dz)/q);for(let y=0;y<top;y++)D[I(x,y,z)]+=v}}}
  // base slab along X: the timeline is the plinth the sound stands on
  let xmin=1,xmax=0;for(const a of atoms){const v=cxOf(a);if(v<xmin)xmin=v;if(v>xmax)xmax=v}
  const yb=Math.floor(G*0.05),zb0=Math.floor(G*0.42),zb1=Math.floor(G*0.58),xb0=Math.max(0,Math.floor(xmin*G)-2),xb1=Math.min(G,Math.floor(xmax*G)+3);
  for(let z=zb0;z<zb1;z++)for(let y=0;y<yb;y++)for(let x=xb0;x<xb1;x++)D[I(x,y,z)]+=1.2;
  // threshold: the 72nd percentile of occupied cells, floored at 0.18, as on the desktop worker
  const occ=[];for(let i=0;i<D.length;i++)if(D[i]>0.01)occ.push(D[i]);occ.sort((p,q)=>p-q);
  const iso=Math.max(occ.length?occ[Math.floor((occ.length-1)*0.72)]:0.3,0.18);
  stage(65,'extracting the surface');
  const mesh=tetSurface(D,G,iso);
  stage(90,'checking that it closes');
  const kept=dropDebris(mesh,50),W=watertight(kept.idx),sh=shading(kept.pos,D,G,iso);
  return{...kept,...sh,G,iso,atoms:n,watertight:W.ok,openEdges:W.open,ms:performance.now()-t0}}
// Normals and occlusion come from the field, not the facets, so the tetrahedral grid never shows in the light.
function shading(pos,F,G,iso){
  const at=(x,y,z)=>{const X=Math.max(0,Math.min(G-1.001,x)),Y=Math.max(0,Math.min(G-1.001,y)),Z=Math.max(0,Math.min(G-1.001,z)),i=X|0,j=Y|0,k=Z|0,a=X-i,b=Y-j,c=Z-k,I=(p,q,r)=>F[p+q*G+r*G*G];
    return((I(i,j,k)*(1-a)+I(i+1,j,k)*a)*(1-b)+(I(i,j+1,k)*(1-a)+I(i+1,j+1,k)*a)*b)*(1-c)+((I(i,j,k+1)*(1-a)+I(i+1,j,k+1)*a)*(1-b)+(I(i,j+1,k+1)*(1-a)+I(i+1,j+1,k+1)*a)*b)*c};
  const n=pos.length/3,nrm=new Float32Array(n*3),ao=new Float32Array(n);
  for(let v=0;v<n;v++){const x=pos[v*3],y=pos[v*3+1],z=pos[v*3+2],e=1.2;let nx=at(x-e,y,z)-at(x+e,y,z),ny=at(x,y-e,z)-at(x,y+e,z),nz=at(x,y,z-e)-at(x,y,z+e),l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;nrm[v*3]=nx;nrm[v*3+1]=ny;nrm[v*3+2]=nz;
    let occ=0;for(const k of [2.5,5,9]){occ+=Math.max(0,at(x+nx*k,y+ny*k,z+nz*k)-iso*.4)/(k*.5+1)}ao[v]=Math.max(.38,1-occ/(iso*4+.5))}
  return{nrm,ao}}
// Marching tetrahedra: every cube splits the same way around one diagonal, so neighbours share faces and a closed
// field gives a closed surface by construction, with no ambiguous cases. The desktop worker uses marching cubes on the same field.
const CORN=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],TETS=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
function tetSurface(F,G,iso){
  const S=G+4,P=new Float32Array(S*S*S),IP=(x,y,z)=>x+y*S+z*S*S;                       // a two-cell zero shell: every surface closes
  for(let z=0;z<G;z++)for(let y=0;y<G;y++)for(let x=0;x<G;x++)P[IP(x+2,y+2,z+2)]=F[x+y*G+z*G*G]-iso+1e-5;
  for(let i=0;i<P.length;i++){if(P[i]===0)P[i]=1e-6;}
  for(let z=0;z<S;z++)for(let y=0;y<S;y++)for(let x=0;x<S;x++){if(x<2||y<2||z<2||x>=S-2||y>=S-2||z>=S-2)P[IP(x,y,z)]=-iso}
  const pos=[],idx=[],map=new Map();
  const vert=(a,b,ax,ay,az,bx,by,bz)=>{const lo=a<b?a:b,hi=a<b?b:a,key=lo*S*S*S+hi;let v=map.get(key);if(v!==undefined)return v;const va=P[a],vb=P[b],t=va/(va-vb);pos.push(ax+(bx-ax)*t-2,ay+(by-ay)*t-2,az+(bz-az)*t-2);v=pos.length/3-1;map.set(key,v);return v};
  const tri=(i0,i1,i2,ins,outs)=>{ // wind so the normal points from inside to outside
    const a=i0*3,b=i1*3,c=i2*3,ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2],vx=pos[c]-pos[a],vy=pos[c+1]-pos[a+1],vz=pos[c+2]-pos[a+2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nx*(outs[0]-ins[0])+ny*(outs[1]-ins[1])+nz*(outs[2]-ins[2])>=0)idx.push(i0,i1,i2);else idx.push(i0,i2,i1)};
  const id=new Array(8),cx=new Array(8),cy=new Array(8),cz=new Array(8);
  for(let z=0;z<S-1;z++)for(let y=0;y<S-1;y++)for(let x=0;x<S-1;x++){
    let any=0,all=1;for(let k=0;k<8;k++){const q=CORN[k];cx[k]=x+q[0];cy[k]=y+q[1];cz[k]=z+q[2];id[k]=IP(cx[k],cy[k],cz[k]);if(P[id[k]]>0)any=1;else all=0}
    if(!any||all)continue;
    for(const T of TETS){const In=[],Out=[];for(const k of T)(P[id[k]]>0?In:Out).push(k);if(!In.length||!Out.length)continue;
      const e=(i,o)=>vert(id[i],id[o],cx[i],cy[i],cz[i],cx[o],cy[o],cz[o]),c=(k)=>[cx[k],cy[k],cz[k]];
      if(In.length===1){tri(e(In[0],Out[0]),e(In[0],Out[1]),e(In[0],Out[2]),c(In[0]),c(Out[0]))}
      else if(In.length===3){tri(e(In[0],Out[0]),e(In[1],Out[0]),e(In[2],Out[0]),c(In[0]),c(Out[0]))}
      else{const a=e(In[0],Out[0]),b=e(In[0],Out[1]),d=e(In[1],Out[1]),f=e(In[1],Out[0]);tri(a,b,d,c(In[0]),c(Out[0]));tri(a,d,f,c(In[0]),c(Out[0]))}}}
  return{pos:new Float32Array(pos),idx:new Uint32Array(idx)}}
function dropDebris(m,minFaces){
  const nv=m.pos.length/3,par=new Int32Array(nv);for(let i=0;i<nv;i++)par[i]=i;const find=(a)=>{while(par[a]!==a){par[a]=par[par[a]];a=par[a]}return a};
  for(let i=0;i<m.idx.length;i+=3){const a=find(m.idx[i]),b=find(m.idx[i+1]),c=find(m.idx[i+2]);par[b]=a;par[c]=a}
  const count=new Map();for(let i=0;i<m.idx.length;i+=3){const r=find(m.idx[i]);count.set(r,(count.get(r)||0)+1)}
  const out=[],remap=new Int32Array(nv).fill(-1),pos=[];for(let i=0;i<m.idx.length;i+=3){if(count.get(find(m.idx[i]))<minFaces)continue;for(let k=0;k<3;k++){const v=m.idx[i+k];if(remap[v]<0){remap[v]=pos.length/3;pos.push(m.pos[v*3],m.pos[v*3+1],m.pos[v*3+2])}out.push(remap[v])}}
  let bodies=0;for(const n of count.values())if(n>=minFaces)bodies++;
  return{pos:new Float32Array(pos),idx:new Uint32Array(out),bodies}}
// Watertight means every directed edge appears once and its reverse appears once.
function watertight(idx){const m=new Map();let open=0;const add=(a,b)=>{const k=a*4294967296+b;m.set(k,(m.get(k)||0)+1)};
  for(let i=0;i<idx.length;i+=3){add(idx[i],idx[i+1]);add(idx[i+1],idx[i+2]);add(idx[i+2],idx[i])}
  for(const [k,n] of m){const a=Math.floor(k/4294967296),b=k-a*4294967296;if(n!==1||m.get(b*4294967296+a)!==1)open++}
  return{ok:open===0&&idx.length>0,open}}
onmessage=(e)=>{const m=e.data;try{
  if(m.type==='atoms'){const r=extractAtoms(m.data,m.rate,m.k);postMessage({id:m.id,result:r});return}
  const stage=(p,msg)=>postMessage({id:m.id,stage:p,msg});
  const R=cast(m.atoms,m.dur,m.rate,m.G,stage);
  postMessage({id:m.id,result:R},[R.pos.buffer,R.idx.buffer,R.nrm.buffer,R.ao.buffer]);
}catch(err){postMessage({id:m.id,error:String(err&&err.message||err)})}};`;

  function createCast() {
    let w = null, seq = 0; const pend = {};
    const ensure = () => {
      if (w) return;
      w = new Worker(URL.createObjectURL(new Blob([CAST_SRC], { type: 'text/javascript' })));
      w.onmessage = (e) => { const p = pend[e.data.id]; if (!p) return; if (e.data.stage != null) { if (p.onStage) p.onStage(e.data.stage, e.data.msg); return; } delete pend[e.data.id]; if (e.data.error) p.rej(new Error(e.data.error)); else p.res(e.data.result); };
    };
    const send = (msg, onStage, tr) => new Promise((res, rej) => { ensure(); const id = ++seq; pend[id] = { res, rej, onStage }; w.postMessage({ ...msg, id }, tr || []); });
    return { atoms: (data, rate, k) => send({ type: 'atoms', data, rate, k }), cast: (atoms, dur, rate, G, onStage) => send({ type: 'cast', atoms, dur, rate, G }, onStage) };
  }

  /* ---------- pure math, testable from the page ---------- */
  const KitDepth = {
    // The DPT processor's resize: the side nearer its target decides the scale, then both round to a multiple of the patch.
    modelSize(iw, ih, target) {
      const sw = target / iw, sh = target / ih, s = Math.abs(1 - sw) < Math.abs(1 - sh) ? sw : sh, mult = (v) => Math.max(14, Math.round(v / 14) * 14);
      return { w: mult(iw * s), h: mult(ih * s) };
    },
    toTensor(rgba, w, h) {
      const n = w * h, D = new Float32Array(3 * n), M = [0.485, 0.456, 0.406], SD = [0.229, 0.224, 0.225];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) D[k * n + i] = (rgba[i * 4 + k] / 255 - M[k]) / SD[k];
      return D;
    },
    upsample(src, sw, sh, dw, dh) {
      const out = new Float32Array(dw * dh);
      for (let y = 0; y < dh; y++) {
        const fy = Math.max(0, Math.min(sh - 1.001, ((y + 0.5) * sh) / dh - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
        for (let x = 0; x < dw; x++) {
          const fx = Math.max(0, Math.min(sw - 1.001, ((x + 0.5) * sw) / dw - 0.5)), x0 = Math.floor(fx), tx = fx - x0, i = x0 + y0 * sw;
          out[x + y * dw] = (src[i] * (1 - tx) + src[i + 1] * tx) * (1 - ty) + (src[i + sw] * (1 - tx) + src[i + sw + 1] * tx) * ty;
        }
      }
      return out;
    },
    // Percentile clamp, p2 to p98, so sky and glare cannot own the range. Identical to depth_worker.py.
    normalize(d) {
      const s = Float32Array.from(d).sort(), pick = (p) => { const f = (s.length - 1) * p, i = Math.floor(f), t = f - i; return s[i] * (1 - t) + s[Math.min(s.length - 1, i + 1)] * t; };
      const p2 = pick(0.02), p98 = pick(0.98), r = Math.max(p98 - p2, 1e-6), out = new Float32Array(d.length);
      for (let i = 0; i < d.length; i++) out[i] = Math.min(1, Math.max(0, (d[i] - p2) / r));
      return out;
    },
    correlation(a, b) {
      let ma = 0, mb = 0; const n = a.length;
      for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
      ma /= n; mb /= n; let sa = 0, sb = 0, c = 0;
      for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; c += x * y; }
      return c / Math.sqrt(sa * sb || 1);
    },
  };

  global.KitDepth = KitDepth;
  global.EnterDepth = { create: createDepth, PATHS, ORT, MODEL_REV };
  global.EnterCast = { create: createCast };
})(window);
