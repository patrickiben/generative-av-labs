/* gl.js: a small WebGL2 toolkit. Programs, HDR targets, bloom and the final grade. No dependencies. */
(function (global) {
  'use strict';

  const FS_VERT = `#version 300 es
out vec2 vUv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;

  function createGL(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) return null;
    const floatRT = gl.getExtension('EXT_color_buffer_float');
    const halfRT = gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('EXT_float_blend');
    const hdr = floatRT || halfRT ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST);

    function shader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        throw new Error(`shader failed: ${log}`);
      }
      return s;
    }
    function program(fs, vs) {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs || FS_VERT));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`);
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const a = gl.getActiveUniform(p, i), name = a.name.replace(/\[0\]$/, '');
        u[name] = { loc: gl.getUniformLocation(p, a.name), type: a.type };
      }
      return { p, u };
    }
    function use(P, vals) {
      gl.useProgram(P.p);
      if (vals) setU(P, vals);
      return P;
    }
    function setU(P, vals) {
      for (const k in vals) {
        const u = P.u[k];
        if (!u) continue;
        const v = vals[k];
        switch (u.type) {
          case gl.FLOAT: if (typeof v === 'number') gl.uniform1f(u.loc, v); else gl.uniform1fv(u.loc, v); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
          case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
          default: gl.uniform1i(u.loc, v);    // samplers and ints
        }
      }
    }
    function tex(w, h, fmt, opt) {
      opt = opt || {};
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      const f = fmt || hdr;
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, opt.data || null);
      const fl = opt.nearest ? gl.NEAREST : gl.LINEAR, wr = opt.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, fl);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fl);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
      return t;
    }
    function target(w, h, fmt, opt) {
      const t = tex(w, h, fmt, opt), fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo, tex: t, w, h };
    }
    function freeTarget(T) { if (T) { gl.deleteFramebuffer(T.fbo); gl.deleteTexture(T.tex); } }
    function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }
    function into(T) { gl.bindFramebuffer(gl.FRAMEBUFFER, T ? T.fbo : null); gl.viewport(0, 0, T ? T.w : canvas.width, T ? T.h : canvas.height); }
    function draw() { gl.drawArrays(gl.TRIANGLES, 0, 3); }
    // A shared 256 x 256 noise texture. Half float so low-frequency hills do not stair-step.
    function noiseTexture(seed) {
      const N = 256, d = new Float32Array(N * N);
      let s = (seed || 12345) >>> 0;
      for (let i = 0; i < d.length; i++) { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; d[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
      return tex(N, N, { internal: gl.R16F, format: gl.RED, type: gl.FLOAT }, { repeat: true, data: d });
    }
    return { gl, program, use, setU, tex, target, freeTarget, bindTex, into, draw, hdr, noiseTexture, FS_VERT, floatRT: !!floatRT };
  }

  const FS_HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
`;

  const DOWN_FS = FS_HEAD + `
uniform sampler2D uTex; uniform vec2 uPx; uniform float uThresh;
void main(){
  vec3 c=texture(uTex,vUv).rgb*4.;
  c+=texture(uTex,vUv+uPx*vec2(-1.,-1.)).rgb+texture(uTex,vUv+uPx*vec2(1.,-1.)).rgb+texture(uTex,vUv+uPx*vec2(-1.,1.)).rgb+texture(uTex,vUv+uPx*vec2(1.,1.)).rgb;
  c/=8.;
  if(uThresh>0.){ float l=max(c.r,max(c.g,c.b)); c*=smoothstep(uThresh*.55,uThresh*1.35,l); }
  o=vec4(min(c,vec3(24.)),1.);
}`;
  const UP_FS = FS_HEAD + `
uniform sampler2D uTex; uniform vec2 uPx; uniform float uK;
void main(){
  vec3 c=texture(uTex,vUv+uPx*vec2(-2.,0.)).rgb+texture(uTex,vUv+uPx*vec2(2.,0.)).rgb+texture(uTex,vUv+uPx*vec2(0.,-2.)).rgb+texture(uTex,vUv+uPx*vec2(0.,2.)).rgb;
  c+=2.*(texture(uTex,vUv+uPx*vec2(-1.,-1.)).rgb+texture(uTex,vUv+uPx*vec2(1.,-1.)).rgb+texture(uTex,vUv+uPx*vec2(-1.,1.)).rgb+texture(uTex,vUv+uPx*vec2(1.,1.)).rgb);
  o=vec4(c/12.*uK,1.);
}`;
  const GRADE_FS = FS_HEAD + `
uniform sampler2D uScene,uBloom;
uniform float uBloomK,uExposure,uFlash,uGrain,uT,uVig,uSat;
uniform vec3 uFlashC,uLift;
float h12(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){
  vec3 c=texture(uScene,vUv).rgb+texture(uBloom,vUv).rgb*uBloomK;
  c+=uFlashC*uFlash;
  c*=uExposure;
  c=aces(c);
  float g=dot(c,vec3(.2126,.7152,.0722));
  c=mix(vec3(g),c,uSat);
  vec2 q=vUv-.5;
  c*=1.-uVig*smoothstep(.25,.95,dot(q,q)*2.1);
  c=pow(c,vec3(1./2.2))+uLift;
  c+=(h12(gl_FragCoord.xy+fract(uT)*97.)-.5)*uGrain;
  o=vec4(c,1.);
}`;

  // Bloom chain and final grade, shared by both pages.
  function createPost(G) {
    const { gl } = G;
    const down = G.program(DOWN_FS), up = G.program(UP_FS), grade = G.program(GRADE_FS);
    let mips = [];
    function resize(w, h, levels) {
      mips.forEach(G.freeTarget);
      mips = [];
      let a = Math.max(2, w >> 1), b = Math.max(2, h >> 1);
      for (let i = 0; i < (levels || 5); i++) { mips.push(G.target(a, b)); a = Math.max(2, a >> 1); b = Math.max(2, b >> 1); }
    }
    function bloom(srcTex, thresh) {
      gl.disable(gl.BLEND);
      G.use(down, { uTex: 0 });
      let src = srcTex;
      mips.forEach((m, i) => {
        G.into(m);
        G.bindTex(0, src);
        G.setU(down, { uPx: [1 / m.w, 1 / m.h], uThresh: i === 0 ? thresh : 0 });
        G.draw();
        src = m.tex;
      });
      G.use(up, { uTex: 0 });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = mips.length - 1; i > 0; i--) {
        const to = mips[i - 1];
        G.into(to);
        G.bindTex(0, mips[i].tex);
        G.setU(up, { uPx: [1 / to.w, 1 / to.h], uK: 0.9 });
        G.draw();
      }
      gl.disable(gl.BLEND);
      return mips[0].tex;
    }
    function finish(sceneTex, bloomTex, vals) {
      G.into(null);
      G.bindTex(0, sceneTex);
      G.bindTex(1, bloomTex);
      G.use(grade, Object.assign({ uScene: 0, uBloom: 1, uBloomK: 0.6, uExposure: 1, uFlash: 0, uFlashC: [1, 0.94, 0.84], uGrain: 0.02, uT: 0, uVig: 0.5, uSat: 1, uLift: [0, 0, 0] }, vals));
      G.draw();
    }
    return { resize, bloom, finish };
  }

  const srgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
  };

  global.GLKit = { createGL, createPost, FS_HEAD, FS_VERT, srgb };
})(window);
