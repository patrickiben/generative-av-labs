/* analog-dsp.js: Detail Forge Analog's signal processing, ported line by line from the desktop app's dsp.py, with the
   processing run its worker thread did (app.py, Worker.run). Plain functions on planar Float32Array channels and no
   DOM: the page runs this in a Worker, and tests/analog_numbers.py runs it under Node beside the Python original.
   FLOOR and TRANSIENT amplify what is there; EXCITER and SBR synthesize. Nothing here recovers lost audio. */
(function (root) {
  'use strict';

  function build() {
    const EPS = 1e-12;
    const f32 = Math.fround;
    const clip = (v, a, b) => (v < a ? a : v > b ? b : v);
    const pmod = (a, b) => ((a % b) + b) % b;                       // Python's % for a positive divisor
    // Python's round() and C's lrintf: halves go to the even neighbor
    const roundEven = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
    const DEFAULTS = { mode: 'sbr', gain_db: 9, drive: 4.0, emix: 0.35, tamt: 0.6, wet: 0.65, tilt: -6, target_hz: 20000 };

    /* ---------------- FFT: radix 2 in place, real transforms by the half-length trick ---------------- */
    const plans = new Map();
    function plan(n) {
      let p = plans.get(n);
      if (p) return p;
      const bits = Math.round(Math.log2(n));
      if (n < 1 || 1 << bits !== n) throw new Error(`FFT size ${n} is not a power of two`);
      const h = Math.max(1, n >> 1), rev = new Uint32Array(n), cos = new Float64Array(h), sin = new Float64Array(h);
      for (let i = 0; i < n; i++) { let r = 0; for (let b = 0, v = i; b < bits; b++, v >>= 1) r = (r << 1) | (v & 1); rev[i] = r; }
      for (let i = 0; i < n >> 1; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
      p = { rev, cos, sin, zr: new Float64Array(n), zi: new Float64Array(n) };
      plans.set(n, p);
      return p;
    }
    function cfft(re, im, inv) {
      const n = re.length, { rev, cos, sin } = plan(n), sg = inv ? 1 : -1;
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const c = cos[k], s = sg * sin[k], a = i + j, b = a + half;
            const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
    }
    // rfft of x (length n) into re, im (length n/2 + 1)
    function rfft(x, re, im) {
      const n = x.length, m = n >> 1, P = plan(m), T = plan(n), zr = P.zr, zi = P.zi;
      for (let k = 0; k < m; k++) { zr[k] = x[2 * k]; zi[k] = x[2 * k + 1]; }
      cfft(zr, zi, false);
      for (let k = 0; k <= m; k++) {
        const a = k % m, b = (m - k) % m;
        const ar = zr[a], ai = zi[a], br = zr[b], bi = -zi[b];             // Z[k] and conj(Z[m-k])
        const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi);                  // the even samples' spectrum
        const or = 0.5 * (ai - bi), oi = -0.5 * (ar - br);                 // the odd samples' spectrum
        const c = k < m ? T.cos[k] : -1, s = k < m ? -T.sin[k] : 0;        // e^(-2 pi i k / n)
        re[k] = er + or * c - oi * s; im[k] = ei + or * s + oi * c;
      }
    }
    // irfft of re, im (length n/2 + 1) into x (length n). Like pocketfft, it ignores the imaginary parts at DC and Nyquist.
    function irfft(re, im, x) {
      const n = x.length, m = n >> 1, P = plan(m), T = plan(n), zr = P.zr, zi = P.zi;
      for (let k = 0; k < m; k++) {
        const b = m - k, ar = re[k], ai = k === 0 ? 0 : im[k], br = re[b], bi = b === m ? 0 : -im[b];
        const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi), dr = 0.5 * (ar - br), di = 0.5 * (ai - bi);
        const c = T.cos[k], s = T.sin[k], orr = dr * c - di * s, oi = dr * s + di * c;
        zr[k] = er - oi; zi[k] = ei + orr;
      }
      cfft(zr, zi, true);
      for (let k = 0; k < m; k++) { x[2 * k] = zr[k] / m; x[2 * k + 1] = zi[k] / m; }
    }
    // power spectrum of a frame of any length, for the rare short signal (a plain DFT, slow but exact)
    function framePower(seg, out) {
      const n = seg.length;
      if (1 << Math.round(Math.log2(n)) === n && n >= 2) {
        const re = new Float64Array((n >> 1) + 1), im = new Float64Array((n >> 1) + 1);
        rfft(seg, re, im);
        for (let k = 0; k < out.length; k++) out[k] = re[k] * re[k] + im[k] * im[k];
        return;
      }
      for (let k = 0; k < out.length; k++) {
        let r = 0, i = 0;
        for (let t = 0; t < n; t++) { const a = (-2 * Math.PI * k * t) / n; r += seg[t] * Math.cos(a); i += seg[t] * Math.sin(a); }
        out[k] = r * r + i * i;
      }
    }

    const hannCache = new Map();
    function hann(n) {                                // periodic, as scipy's get_window('hann', n)
      let w = hannCache.get(n);
      if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); hannCache.set(n, w); }
      return w;
    }

    /* ---------------- utils ---------------- */
    function toMono(ch) {                             // numpy's float32 mean across channels
      if (ch.length === 1) return ch[0];
      const n = ch[0].length, k = ch.length, m = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = ch[0][i]; for (let c = 1; c < k; c++) s = f32(s + ch[c][i]); m[i] = s / k; }
      return m;
    }
    function peakGuard(ch, ceilingDb = -1.0) {        // scale down only if the peak would clip; never boosts
      let peak = 0;
      for (const x of ch) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
      peak = f32(peak + EPS);
      const ceil = 10 ** (ceilingDb / 20.0);
      if (peak > ceil) { const g = f32(ceil / peak); return ch.map((x) => x.map((v) => v * g)); }
      return ch.map((x) => Float32Array.from(x));
    }

    /* ---------------- Welch, as dsp.py calls it ---------------- */
    // scipy.signal.welch(m[:n], fs=sr, nperseg=4096, noverlap=2048, scaling='spectrum') on the first 2^18 samples:
    // periodic Hann, each segment's mean removed, one-sided, the mean over segments, cast to float32 at the end
    function welch(m, sr) {
      const n = Math.min(m.length, 1 << 18);
      const nper = Math.min(4096, n), nov = 2048;
      if (nov >= nper) throw new Error('signal too short to measure');
      const step = nper - nov, nseg = Math.floor((n - nov) / step), w = hann(nper), nb = (nper >> 1) + 1;
      let ws = 0; for (let i = 0; i < nper; i++) ws += w[i];
      const acc = new Float64Array(nb), seg = new Float64Array(nper), pw = new Float64Array(nb);
      for (let s = 0; s < nseg; s++) {
        const o = s * step;
        let mean = 0; for (let i = 0; i < nper; i++) mean += m[o + i];
        mean /= nper;
        for (let i = 0; i < nper; i++) seg[i] = ((m[o + i] - mean) * w[i]) / ws;
        framePower(seg, pw);
        for (let k = 0; k < nb; k++) acc[k] += pw[k];
      }
      const pxx = new Float32Array(nb), f = new Float64Array(nb), val = 1.0 / (nper * (1 / sr));
      const lastDoubled = nper % 2 === 0 ? nb - 1 : nb;
      for (let k = 0; k < nb; k++) { pxx[k] = ((k > 0 && k < lastDoubled ? 2 : 1) * acc[k]) / nseg; f[k] = k * val; }
      return { f, pxx };
    }
    const dB32 = (p) => f32(10 * f32(Math.log10(f32(p + EPS))));
    function median32(arr) {
      const a = Array.from(arr).sort((x, y) => x - y), n = a.length;
      return n % 2 ? a[(n - 1) >> 1] : f32(f32(a[n / 2 - 1] + a[n / 2]) / 2);
    }

    /* ---------------- cutoff probe ---------------- */
    // the highest frequency still more than 12 dB above the dead floor of the top 15 % of the band, and within 60 dB of the peak
    function cutoffFromWelch(W, sr) {
      const L = W.pxx.length, pdb = new Float32Array(L);
      let peak = -Infinity;
      for (let k = 0; k < L; k++) { pdb[k] = dB32(W.pxx[k]); if (pdb[k] > peak) peak = pdb[k]; }
      const floor = median32(pdb.subarray(Math.trunc(0.85 * L)));
      const thresh = Math.max(f32(floor + 12.0), f32(peak - 60.0));
      let last = -1;
      for (let k = 0; k < L; k++) if (pdb[k] > thresh) last = k;
      if (last < 0) return sr / 2.0;
      return clip(W.f[last], 1000.0, sr / 2.0);
    }
    function estimateCutoff(ch, sr) {
      const m = toMono(ch);
      if (Math.min(m.length, 1 << 18) < 2048) return sr / 2.0;
      return cutoffFromWelch(welch(m, sr), sr);
    }

    /* ---------------- filters ---------------- */
    function rbjHighShelf(fc, sr, gainDb, q = 0.707) {   // RBJ cookbook high shelf, normalized by a0
      const A = 10 ** (gainDb / 40.0), w0 = (2 * Math.PI * fc) / sr, cw = Math.cos(w0), sw = Math.sin(w0);
      const alpha = sw / (2 * q), tsa = 2 * Math.sqrt(A) * alpha;
      const b0 = A * ((A + 1) + (A - 1) * cw + tsa), b1 = -2 * A * ((A - 1) + (A + 1) * cw), b2 = A * ((A + 1) + (A - 1) * cw - tsa);
      const a0 = (A + 1) - (A - 1) * cw + tsa, a1 = 2 * ((A - 1) - (A + 1) * cw), a2 = (A + 1) - (A - 1) * cw - tsa;
      return [b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0];
    }
    // scipy.signal.butter(order, fc, 'high', fs=sr, output='sos'): prewarped bilinear Butterworth, gain in the first section
    function butterHighpassSOS(order, fc, sr) {
      const Wn = (2 * fc) / sr, fsn = 2.0, warped = 2 * fsn * Math.tan((Math.PI * Wn) / fsn), fs2 = 2.0 * fsn;
      const cdiv = (ar, ai, br, bi) => { const d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]; };
      const cmul = (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br];
      let kr = 1, ki = 0, gr = 1, gi = 0;
      const zs = [];
      for (let k = -order + 1; k < order; k += 2) {
        const th = (Math.PI * k) / (2 * order), p = [-Math.cos(th), -Math.sin(th)];
        [kr, ki] = cmul(kr, ki, -p[0], -p[1]);                        // prod(-p)
        const hp = cdiv(warped, 0, p[0], p[1]);                          // lowpass to highpass: wo / p
        [gr, gi] = cmul(gr, gi, fs2 - hp[0], -hp[1]);                    // prod(fs2 - p_hp)
        zs.push(cdiv(fs2 + hp[0], hp[1], fs2 - hp[0], -hp[1]));          // bilinear: (fs2 + p) / (fs2 - p)
      }
      const kHp = cdiv(1, 0, kr, ki)[0];
      const kZ = kHp * cdiv(fs2 ** order, 0, gr, gi)[0];                  // zeros at s = 0 map to z = 1
      const pairs = zs.filter((p) => p[1] > 0).sort((a, b) => Math.abs(1 - Math.hypot(...b)) - Math.abs(1 - Math.hypot(...a)));
      return pairs.map((p, i) => [i ? 1 : kZ, i ? -2 : -2 * kZ, i ? 1 : kZ, 1, -2 * p[0], p[0] * p[0] + p[1] * p[1]]);
    }
    function sosfilt(sos, x) {                        // direct form II transposed, zero initial state, in float64
      const n = x.length, y = Float64Array.from(x);
      for (const [b0, b1, b2, , a1, a2] of sos) {
        let z0 = 0, z1 = 0;
        for (let i = 0; i < n; i++) { const xi = y[i], yi = b0 * xi + z0; z0 = b1 * xi - a1 * yi + z1; z1 = b2 * xi - a2 * yi; y[i] = yi; }
      }
      return y;
    }
    function lfilter2(b, a, x) {                      // scipy.signal.lfilter for a biquad with a[0] = 1, zero state
      const n = x.length, y = new Float64Array(n);
      let z0 = 0, z1 = 0;
      for (let i = 0; i < n; i++) { const xi = x[i], yi = z0 + b[0] * xi; z0 = z1 + xi * b[1] - yi * a[1]; z1 = xi * b[2] - yi * a[2]; y[i] = yi; }
      return y;
    }
    const i0 = (x) => { let s = 1, t = 1; const q = (x * x) / 4; for (let k = 1; k < 80; k++) { t *= q / (k * k); s += t; if (t < s * 1e-18) break; } return s; };
    function firwinKaiser(numtaps, cutoff, beta) {   // scipy.signal.firwin(numtaps, cutoff, window=('kaiser', beta))
      const alpha = 0.5 * (numtaps - 1), h = new Float64Array(numtaps), den = i0(beta);
      const sinc = (v) => { const y = Math.PI * (v === 0 ? 1.0e-20 : v); return Math.sin(y) / y; };
      for (let i = 0; i < numtaps; i++) { const m = i - alpha, r = m / alpha; h[i] = cutoff * sinc(cutoff * m) * (i0(beta * Math.sqrt(1 - r * r)) / den); }
      let s = 0; for (let i = 0; i < numtaps; i++) s += h[i];
      for (let i = 0; i < numtaps; i++) h[i] /= s;
      return h;
    }
    // scipy.signal.resample_poly(x, up, down): Kaiser-windowed FIR (beta 5), zero padding, the output centered
    function resamplePoly(x, up, down) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a), g = gcd(up, down);
      up /= g; down /= g;
      const single = x instanceof Float32Array, nIn = x.length;
      if (up === 1 && down === 1) return single ? Float32Array.from(x) : Float64Array.from(x);
      const nOut = Math.floor((nIn * up) / down) + ((nIn * up) % down ? 1 : 0);
      const maxRate = Math.max(up, down), halfLen = 10 * maxRate;
      const h0 = firwinKaiser(2 * halfLen + 1, 1 / maxRate, 5.0);
      const nPre = down - (halfLen % down), nPreRemove = Math.floor((halfLen + nPre) / down);
      const outLen = (lh) => Math.floor(((nIn - 1) * up + lh - 1) / down) + 1;
      let nPost = 0;
      while (outLen(h0.length + nPre + nPost) < nOut + nPreRemove) nPost++;
      const h = new Float64Array(nPre + h0.length + nPost);
      for (let i = 0; i < h0.length; i++) h[nPre + i] = (single ? f32(h0[i]) : h0[i]) * up;   // h takes x's dtype, then *= up
      const y = single ? new Float32Array(nOut) : new Float64Array(nOut), L = h.length;
      for (let o = 0; o < nOut; o++) {
        const j = (o + nPreRemove) * down;
        let acc = 0;
        for (let k = j % up; k < L; k += up) { const idx = (j - k) / up; if (idx < 0) break; if (idx < nIn) acc += h[k] * x[idx]; }
        y[o] = acc;
      }
      return y;
    }
    // scipy.ndimage.gaussian_filter1d(x, sigma), truncate 4, mode 'reflect', with ndimage's folded sum for symmetric weights
    function gaussianFilter1d(x, sigma) {
      const r = Math.trunc(4.0 * sigma + 0.5), w = new Float64Array(2 * r + 1), s2 = sigma * sigma;
      let ws = 0;
      for (let i = -r; i <= r; i++) { w[i + r] = Math.exp((-0.5 / s2) * i * i); ws += w[i + r]; }
      for (let i = 0; i < w.length; i++) w[i] /= ws;
      const n = x.length, y = new Float64Array(n), p = 2 * n;
      const at = (j) => { if (j >= 0 && j < n) return x[j]; j = pmod(j, p); return j < n ? x[j] : x[p - 1 - j]; };
      for (let i = 0; i < n; i++) {
        let acc = x[i] * w[r];
        if (i >= r && i + r < n) for (let k = r; k >= 1; k--) acc += (x[i - k] + x[i + k]) * w[r - k];
        else for (let k = r; k >= 1; k--) acc += (at(i - k) + at(i + k)) * w[r - k];
        y[i] = acc;
      }
      return y;
    }

    /* ---------------- FLOOR: the honest control ---------------- */
    // a high shelf boosts what is already there; above a band-limited source's cutoff it adds nothing
    function floorHighshelf(ch, sr, gainDb = 8.0, fc = null) {
      if (fc == null) fc = 0.5 * estimateCutoff(ch, sr);
      const sos = [rbjHighShelf(fc, sr, gainDb)];
      return peakGuard(ch.map((x) => Float32Array.from(sosfilt(sos, x))));
    }

    /* ---------------- SBR: spectral band replication ---------------- */
    function mulberry32(a) {
      return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    // Below the measured cutoff the signal passes untouched. Above it, the top valid octave is folded upward,
    // interpolated on the target grid, tilted, seam-matched in level, given decorrelated phase and blended wet/dry.
    // o.phases (one array of nfreq offsets per channel) replaces this page's own random draws, so a test can hand in
    // the desktop's numpy draws and compare samples.
    function sbrEnhance(ch, sr, o = {}) {
      const fc = o.fc != null ? o.fc : estimateCutoff(ch, sr), nyq = sr / 2.0;
      let target = o.target_hz == null ? Math.min(nyq, 20000.0) : o.target_hz;
      target = Math.min(target, nyq);
      const wet = o.wet ?? 0.65, tiltDb = o.tilt_db_oct ?? -6.0;
      const nper = 2048, nov = Math.trunc(nper * 0.75), step = nper - nov, half = nper >> 1, nfreq = half + 1;
      const df = 1.0 / (nper * (1.0 / sr));
      const fcBin = clip(roundEven(fc / df), 4, nfreq - 2), tgtBin = clip(roundEven(target / df), fcBin + 1, nfreq - 1);
      const srcLo = Math.max(2, Math.floor(fcBin / 2));
      const map = [];
      for (let tb = fcBin; tb <= tgtBin; tb++) {
        const tf = tb * df;
        let sf = tf;
        while (sf >= fc && sf / 2.0 >= srcLo * df) sf /= 2.0;           // fold down by octaves into the live band
        const sb = sf / df;
        let lo = Math.floor(sb);
        const frac = sb - lo;
        lo = Math.min(Math.max(lo, srcLo), fcBin - 1);
        map.push({ lo, hi: Math.min(lo + 1, fcBin - 1), frac, tilt: 10 ** ((tiltDb / 20.0) * Math.log2(Math.max(tf, df) / fc)) });
      }
      const w = hann(nper);
      let ws = 0; for (let i = 0; i < nper; i++) ws += w[i];
      const sc = 1 / ws, rng = mulberry32(o.seed ?? 20260717);
      const re = new Float64Array(nfreq), im = new Float64Array(nfreq), mag = new Float64Array(nfreq), frame = new Float64Array(nper);
      const out = ch.map((x, c) => {
        const n = x.length, L = n + 2 * half, nadd = pmod(-(L - nper), step) % nper, total = L + nadd;
        const nseg = (total - nper) / step + 1;
        let off = o.phases && o.phases[c];
        if (!off) { off = new Float64Array(nfreq); for (let k = 0; k < nfreq; k++) off[k] = -Math.PI + 2 * Math.PI * rng(); }
        const load = (s) => {                         // frame s of the zero-extended signal, windowed, then rfft
          const base = s * step - half;
          for (let i = 0; i < nper; i++) { const j = base + i; frame[i] = j >= 0 && j < n ? x[j] * w[i] : 0; }
          rfft(frame, re, im);
          for (let k = 0; k < nfreq; k++) { re[k] *= sc; im[k] *= sc; mag[k] = Math.hypot(re[k], im[k]); }
        };
        const built = (k) => { const m = map[k - fcBin]; return (mag[m.lo] * (1 - m.frac) + mag[m.hi] * m.frac) * m.tilt; };
        // pass 1, the seam: built energy just above fc against the source just below it, over every frame
        const bLo = Math.max(fcBin - 4, 1), aHi = Math.min(fcBin + 4, nfreq);
        let below = 0, above = 0;
        for (let s = 0; s < nseg; s++) {
          load(s);
          for (let k = bLo; k < fcBin; k++) below += mag[k] + EPS;
          for (let k = fcBin; k < aHi; k++) above += (k <= tgtBin ? built(k) : mag[k]) + EPS;
        }
        below /= nseg * (fcBin - bLo); above /= nseg * (aHi - fcBin);
        const gain = clip(below / above, 0.05, 20.0);
        // pass 2: build each frame, inverse transform, window and overlap-add
        const acc = new Float64Array(total), norm = new Float64Array(total);
        for (let s = 0; s < nseg; s++) {
          load(s);
          const ph = new Float64Array(fcBin);
          for (let k = 0; k < fcBin; k++) ph[k] = Math.atan2(im[k], re[k]);
          for (let k = fcBin; k <= tgtBin; k++) {
            const m = map[k - fcBin], om = wet * (built(k) * gain) + (1 - wet) * mag[k], p = ph[m.lo] + off[k];
            re[k] = om * Math.cos(p); im[k] = om * Math.sin(p);
          }
          irfft(re, im, frame);
          const o0 = s * step;
          for (let i = 0; i < nper; i++) { acc[o0 + i] += frame[i] * ws * w[i]; norm[o0 + i] += w[i] * w[i]; }
        }
        const y = new Float32Array(n);
        for (let i = 0; i < n; i++) { const nv = norm[i + half]; y[i] = acc[i + half] / (nv > 1e-10 ? nv : 1.0); }
        return y;
      });
      return { out: peakGuard(out), info: { fc, target_hz: target, wet, tilt_db_oct: tiltDb } };
    }

    /* ---------------- EXCITER: harmonics of what is there ---------------- */
    // the band above about 0.45 of the cutoff is waveshaped at 4x oversampling, so the new harmonics do not alias,
    // then high-passed again and mixed back
    function exciter(ch, sr, o = {}) {
      const fc = o.fc != null ? o.fc : estimateCutoff(ch, sr), drive = o.drive ?? 4.0, mix = o.mix ?? 0.35;
      const hpFc = clip(fc * 0.45, 800.0, sr * 0.35), sos = butterHighpassSOS(4, hpFc, sr), norm = Math.max(Math.tanh(drive), 1e-6);
      return peakGuard(ch.map((x) => {
        const band = Float32Array.from(sosfilt(sos, x));
        const up = resamplePoly(band, 4, 1), N = up.length, odd = new Float32Array(N);
        let ms = 0;
        for (let i = 0; i < N; i++) { odd[i] = Math.tanh(f32(drive * up[i])); ms += f32(odd[i] * odd[i]); }
        const mean = f32(ms / N), shaped = new Float64Array(N);
        for (let i = 0; i < N; i++) { const even = f32(0.22 * f32(f32(odd[i] * odd[i]) - mean)); shaped[i] = f32(odd[i] + even) / norm; }
        const harm = sosfilt(sos, Float32Array.from(resamplePoly(shaped, 1, 4).subarray(0, band.length)));
        const y = new Float32Array(x.length);
        for (let i = 0; i < x.length; i++) y[i] = x[i] + mix * harm[i];
        return y;
      }));
    }

    /* ---------------- TRANSIENT: attacks lifted by a dynamic gain ---------------- */
    function transientRestore(ch, sr, amount = 0.6) {
      const n = ch[0].length, k = ch.length, mag = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = Math.abs(ch[0][i]); for (let c = 1; c < k; c++) s = f32(s + Math.abs(ch[c][i])); mag[i] = s / k; }
      const env = Float32Array.from(gaussianFilter1d(mag, sr * 0.0008));     // ndimage keeps the float32 input type
      const onepole = (e, tMs) => {
        const a = Math.exp(-1.0 / ((sr * tMs) / 1000.0)), b0 = 1 - a, y = new Float64Array(e.length);
        let z = ((a * (1 - a)) / (1 - a)) * e[0];                         // lfilter_zi: start settled on the first value
        for (let i = 0; i < e.length; i++) { const yi = z + b0 * e[i]; z = a * yi; y[i] = yi; }
        return y;
      };
      const fast = onepole(env, 3.0), slow = onepole(env, 60.0), gain = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const ratio = clip((2.6 * (fast[i] - slow[i])) / (slow[i] + 1e-5) - 0.45, 0.0, 3.0);
        gain[i] = 1.0 + amount * clip(ratio, 0, 2.0);
      }
      const g = gaussianFilter1d(gain, sr * 0.0015);
      return { out: ch.map((x) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = clip(x[i] * g[i], -0.999, 0.999); return y; }), gain: g };
    }

    /* ---------------- loudness and metrics ---------------- */
    const K1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1.0, -1.69065929318241, 0.73248077421585] };
    const K2 = { b: [1.0, -2.0, 1.0], a: [1.0, -1.99004745483398, 0.99007225036621] };
    function kweightEnergy(ch) {                      // ITU-R BS.1770 K-weighted mean square, the 48 kHz coefficients
      const y = lfilter2(K2.b, K2.a, lfilter2(K1.b, K1.a, toMono(ch)));
      let s = 0; for (let i = 0; i < y.length; i++) s += y[i] * y[i];
      return s / y.length + EPS;
    }
    const loudnessGain = (target, reference) => clip(Math.sqrt(kweightEnergy(reference) / kweightEnergy(target)), 0.1, 10.0);
    function highBandFromWelch(W, fc, sr) {
      let e = 0; for (let k = 0; k < W.f.length; k++) if (W.f[k] > fc && W.f[k] < sr / 2) e += W.pxx[k];
      return dB32(e);
    }
    function lsdFromWelch(Wo, Wi, fc) {
      let s = 0, c = 0;
      for (let k = 0; k < Wo.f.length; k++) if (Wo.f[k] < fc) { const d = f32(dB32(Wo.pxx[k]) - dB32(Wi.pxx[k])); s += d * d; c++; }
      return c ? Math.sqrt(s / c) : NaN;
    }
    function nrFromWelch(W, fc, sr) {
      const hi = Math.min(sr / 2, 20000), p = [];
      for (let k = 0; k < W.f.length; k++) if (W.f[k] > fc && W.f[k] < hi) p.push(f32(W.pxx[k] + EPS));
      if (p.length < 4) return { flatness: 0.0, verdict: 'n/a', ok: false };
      let ls = 0, as = 0; for (const v of p) { ls += Math.log(v); as += v; }
      const flat = f32(Math.exp(ls / p.length)) / f32(as / p.length);
      return { flatness: flat, verdict: flat > 0.6 ? 'hiss-like' : flat > 0.02 ? 'plausible' : 'tonal', ok: flat <= 0.6 };
    }
    const short = (ch) => Math.min(ch[0].length, 1 << 18) < 2048;
    const bandwidthHz = estimateCutoff;
    const highBandLevelDb = (ch, fc, sr) => (short(ch) ? -120.0 : highBandFromWelch(welch(toMono(ch), sr), fc, sr));
    const lsdSharedBand = (out, orig, fc, sr) => (short(out) || short(orig) ? 0.0 : lsdFromWelch(welch(toMono(out), sr), welch(toMono(orig), sr), fc));
    const nrQuality = (out, fc, sr) => nrFromWelch(welch(toMono(out), sr), fc, sr);
    // every number the desktop app reported, from one Welch spectrum of each side
    function measure(out, x, fc, sr) {
      const Wx = welch(toMono(x), sr), Wo = welch(toMono(out), sr);
      return {
        bw_before: cutoffFromWelch(Wx, sr), bw_after: cutoffFromWelch(Wo, sr),
        hb_before: highBandFromWelch(Wx, fc, sr), hb_after: highBandFromWelch(Wo, fc, sr),
        lsd: lsdFromWelch(Wo, Wx, fc), nr: nrFromWelch(Wo, fc, sr), gain: loudnessGain(out, x),
        welch_before: Wx, welch_after: Wo,
      };
    }

    // log-magnitude spectrogram (freq by time, row-major by frequency) in [0, 1], as dsp.spectrogram draws it
    function spectrogram(ch, sr, nfft = 1024, maxFrames = 900) {
      const m = toMono(ch), n = m.length, step = nfft >> 1, w = hann(nfft), nb = (nfft >> 1) + 1;
      if (n < nfft) return { S: new Float32Array(0), bins: nb, frames: 0, t: [] };
      const nadd = pmod(-(n - nfft), step) % nfft, nseg = (n + nadd - nfft) / step + 1;
      let ws = 0; for (let i = 0; i < nfft; i++) ws += w[i];
      const idx = [];
      if (nseg > maxFrames) { const d = (nseg - 1) / (maxFrames - 1); for (let k = 0; k < maxFrames; k++) idx.push(k === maxFrames - 1 ? nseg - 1 : Math.trunc(k * d)); }
      else for (let k = 0; k < nseg; k++) idx.push(k);
      const F = idx.length, S = new Float32Array(nb * F), seg = new Float64Array(nfft), re = new Float64Array(nb), im = new Float64Array(nb);
      idx.forEach((s, t) => {
        const o = s * step;
        for (let i = 0; i < nfft; i++) seg[i] = o + i < n ? m[o + i] * w[i] : 0;
        rfft(seg, re, im);
        for (let k = 0; k < nb; k++) { const db = 20 * Math.log10(Math.hypot(re[k], im[k]) / ws + EPS); S[k * F + t] = (clip(db, -100, 0) + 100) / 100; }
      });
      return { S, bins: nb, frames: F, t: idx.map((s) => (s * step + nfft / 2) / sr) };
    }

    /* ---------------- the processing run (app.py, Worker.run) ---------------- */
    // p: mode, gain_db, drive, emix, tamt, wet, tilt, target_hz, sel [t0, t1] in seconds or null.
    // With a range selected the desktop app processed only that range, crossfaded 50 ms at each seam, and then measured
    // the first 2^18 samples of the whole file, which can miss the range entirely. The page measures the processed
    // range instead (p.measure 'span'); p.measure 'desktop' keeps the desktop's window, for the comparison test.
    function run(src, sr, prm = {}, progress = () => {}) {
      const p = { ...DEFAULTS, ...prm }, full = src, n = src[0].length;
      const [t0, t1] = p.sel || [0, 0];
      const n0 = Math.trunc(t0 * sr), n1 = Math.trunc(t1 * sr);
      const selective = 0 <= n0 && n0 < n1 && n1 <= n && n1 - n0 < n - Math.trunc(0.05 * sr);
      let x = selective ? src.map((c) => c.slice(n0, n1)) : src;
      progress(10, 'measuring the source cutoff');
      const fc = estimateCutoff(x, sr);
      let out, info = { fc }, gainCurve = null;
      if (p.mode === 'floor') { progress(45, 'high shelf, the honest control'); out = floorHighshelf(x, sr, p.gain_db, 0.5 * fc); }
      else if (p.mode === 'exciter') { progress(40, 'harmonic exciter, 4x oversampled'); out = exciter(x, sr, { fc, drive: p.drive, mix: p.emix }); }
      else if (p.mode === 'transient') { progress(40, 'transient restore, dynamic gain'); const r = transientRestore(x, sr, p.tamt); out = r.out; gainCurve = r.gain; }
      else { progress(35, 'spectral band replication'); const r = sbrEnhance(x, sr, { fc, target_hz: p.target_hz, wet: p.wet, tilt_db_oct: p.tilt, phases: p.phases, seed: p.seed }); out = r.out; info = r.info; }
      if (selective) {
        const spliced = full.map((c) => Float32Array.from(c)), len = n1 - n0, xf = Math.min(Math.trunc(0.05 * sr), Math.floor(len / 4));
        const t = new Float32Array(xf);
        for (let i = 0; i < xf; i++) t[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / xf);
        out.forEach((seg, c) => {
          const sp = spliced[c];
          for (let i = 0; i < xf; i++) seg[i] = f32(f32(seg[i] * t[i]) + f32(sp[n0 + i] * f32(1 - t[i])));
          for (let i = 0; i < xf; i++) { const j = len - xf + i, tr = t[xf - 1 - i]; seg[j] = f32(f32(seg[j] * tr) + f32(sp[n1 - xf + i] * f32(1 - tr))); }
          sp.set(seg.subarray(0, len), n0);
        });
        out = spliced; x = full;
      }
      progress(80, 'measuring the result');
      const span = selective && p.measure !== 'desktop', cut = (ch) => (span ? ch.map((c) => c.subarray(n0, n1)) : ch);
      const metrics = measure(cut(out), cut(x), fc, sr);
      return { out, fc, info, metrics, selective, n0: selective ? n0 : 0, n1: selective ? n1 : n, gainCurve, mode: p.mode };
    }

    /* ---------------- 24-bit WAV, sample for sample what the desktop's soundfile writes as PCM_24 ---------------- */
    function encodeWav24(ch, sr) {
      const k = ch.length, n = ch[0].length, data = n * k * 3, buf = new ArrayBuffer(44 + data), v = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, k, true); v.setUint32(24, sr, true); v.setUint32(28, sr * k * 3, true);
      v.setUint16(32, k * 3, true); v.setUint16(34, 24, true); str(36, 'data'); v.setUint32(40, data, true);
      const u8 = new Uint8Array(buf);
      let o = 44;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < k; c++) {
          // libsndfile 1.2, under soundfile 0.14: round to 32 bits, then keep the top 24
          const s = clip(roundEven(f32(ch[c][i] * 2147483648)), -2147483648, 2147483647) >> 8;
          u8[o++] = s & 255; u8[o++] = (s >> 8) & 255; u8[o++] = (s >> 16) & 255;
        }
      }
      return buf;
    }

    return {
      DEFAULTS, EPS, toMono, peakGuard, welch, estimateCutoff, cutoffFromWelch, rbjHighShelf, butterHighpassSOS, sosfilt,
      firwinKaiser, resamplePoly, gaussianFilter1d, floorHighshelf, sbrEnhance, exciter, transientRestore, kweightEnergy,
      loudnessGain, bandwidthHz, highBandLevelDb, lsdSharedBand, nrQuality, measure, spectrogram, run, encodeWav24,
      rfft, irfft, hann, roundEven,
    };
  }

  const API = build();
  API.build = build;
  root.AnalogDSP = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
