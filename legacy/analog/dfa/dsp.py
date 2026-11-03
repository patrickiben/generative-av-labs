"""Detail Forge Analog — DSP core.

Every transform here is a STATED, deterministic operation. Honesty labels:
  FLOOR   (high-shelf)  = MEASURED     — amplifies existing energy, invents nothing
  SBR     (band replic.)= SYNTHESIZED  — plausible high-frequency texture, NOT the
                                          true lost signal (band-limited sources cannot
                                          be recovered, only continued)
No learned model, no neural net. Numbers the app reports are measured on the actual
output buffers.

All functions operate on float32 arrays shaped (n,) mono or (n, ch); helpers keep the
channel layout intact and process each channel independently.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

EPS = 1e-12


# ----------------------------------------------------------------------------- utils
def _as2d(x: np.ndarray):
    """Return (x2d shaped (n,ch), was_mono)."""
    if x.ndim == 1:
        return x[:, None], True
    return x, False


def _restore(x2d: np.ndarray, was_mono: bool):
    return x2d[:, 0] if was_mono else x2d


def to_mono(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else x.mean(axis=1)


def peak_guard(x: np.ndarray, ceiling_db: float = -1.0) -> np.ndarray:
    """Scale down only if the peak would clip; never boosts."""
    peak = float(np.max(np.abs(x)) + EPS)
    ceil = 10 ** (ceiling_db / 20.0)
    if peak > ceil:
        x = x * (ceil / peak)
    return x.astype(np.float32)


# ----------------------------------------------------------------------- cutoff probe
def estimate_cutoff(x: np.ndarray, sr: int) -> float:
    """Measured source band-limit: the highest frequency still carrying real energy.

    Averages the magnitude spectrum, finds the plateau floor at the top octaves, and
    returns the frequency where energy last rises meaningfully above that floor.
    """
    m = to_mono(x)
    n = min(len(m), 1 << 18)
    if n < 2048:
        return sr / 2.0
    f, pxx = signal.welch(m[:n], fs=sr, nperseg=4096, noverlap=2048, scaling="spectrum")
    pdb = 10 * np.log10(pxx + EPS)
    # noise floor = median of the top 15% of the band (where a band-limited file is dead)
    top = pdb[int(0.85 * len(pdb)):]
    floor = np.median(top)
    peak = np.max(pdb)
    # cutoff = highest freq where energy is still >12 dB above that dead floor,
    # and within 60 dB of the peak (ignore ultra-quiet ripple)
    thresh = max(floor + 12.0, peak - 60.0)
    above = np.where(pdb > thresh)[0]
    if len(above) == 0:
        return sr / 2.0
    fc = float(f[above[-1]])
    return float(np.clip(fc, 1000.0, sr / 2.0))


# ---------------------------------------------------------------- FLOOR: high-shelf EQ
def _rbj_highshelf(fc: float, sr: float, gain_db: float, q: float = 0.707):
    """RBJ cookbook high-shelf biquad -> second-order sections for sosfilt."""
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * fc / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    tsa = 2 * np.sqrt(A) * alpha
    b0 = A * ((A + 1) + (A - 1) * cw + tsa)
    b1 = -2 * A * ((A - 1) + (A + 1) * cw)
    b2 = A * ((A + 1) + (A - 1) * cw - tsa)
    a0 = (A + 1) - (A - 1) * cw + tsa
    a1 = 2 * ((A - 1) - (A + 1) * cw)
    a2 = (A + 1) - (A - 1) * cw - tsa
    b = np.array([b0, b1, b2]) / a0
    a = np.array([1.0, a1 / a0, a2 / a0])
    return signal.tf2sos(b, a)


def floor_highshelf(x: np.ndarray, sr: int, gain_db: float = 8.0,
                    fc: float | None = None) -> np.ndarray:
    """FLOOR / CONTROL arm — the honest reference.

    A high-shelf boost of existing high-frequency content. If the source is
    band-limited (nothing above its cutoff), this adds NOTHING there — which is
    exactly the point: EQ cannot create what was never recorded.
    """
    x2d, mono = _as2d(x)
    if fc is None:
        fc = 0.5 * estimate_cutoff(x, sr)
    sos = _rbj_highshelf(fc, sr, gain_db)
    out = np.empty_like(x2d)
    for c in range(x2d.shape[1]):
        out[:, c] = signal.sosfilt(sos, x2d[:, c]).astype(np.float32)
    return _restore(peak_guard(out), mono)


# --------------------------------------------------- FAITHFUL: spectral band replication
def sbr_enhance(x: np.ndarray, sr: int, fc: float | None = None,
                target_hz: float | None = None, wet: float = 0.65,
                tilt_db_oct: float = -6.0, seed: int = 20260717):
    """FAITHFUL arm — Spectral Band Replication.

    Everything BELOW the measured cutoff fc is passed through UNTOUCHED. Above fc, the
    top valid octave is folded upward continuously (interpolated on the target bin grid,
    NOT bin-doubled — that would comb), shaped with a spectral tilt and seam-matched
    gain, given decorrelated phase, and blended (wet) with the (silent) dry high band.

    Returns (out, info) where info carries the measured seam/tilt used.
    """
    x2d, mono = _as2d(x)
    if fc is None:
        fc = estimate_cutoff(x, sr)
    nyq = sr / 2.0
    if target_hz is None:
        target_hz = min(nyq, 20000.0)
    target_hz = min(target_hz, nyq)

    nper = 2048
    nov = int(nper * 0.75)
    rng = np.random.default_rng(seed)
    out = np.empty_like(x2d)

    for c in range(x2d.shape[1]):
        f, t, Z = signal.stft(x2d[:, c], fs=sr, window="hann", nperseg=nper,
                              noverlap=nov, boundary="zeros")
        mag = np.abs(Z)
        ph = np.angle(Z)
        nfreq = len(f)
        df = f[1] - f[0] if nfreq > 1 else sr / nper

        fc_bin = int(np.clip(round(fc / df), 4, nfreq - 2))
        tgt_bin = int(np.clip(round(target_hz / df), fc_bin + 1, nfreq - 1))
        src_lo = max(2, fc_bin // 2)  # fold-down lands in [fc/2, fc)

        # stable per-target-bin random phase offset — decorrelates the octave copy
        # without warbling frame-to-frame (temporal coherence preserved)
        stable_off = rng.uniform(-np.pi, np.pi, size=nfreq)

        out_mag = mag.copy()
        out_ph = ph.copy()
        for tb in range(fc_bin, tgt_bin + 1):
            tf = tb * df
            # fold target frequency down by octaves into the live source band
            sf = tf
            while sf >= fc and sf / 2.0 >= src_lo * df:
                sf /= 2.0
            sb = sf / df
            lo = int(np.floor(sb))
            frac = sb - lo
            lo = min(max(lo, src_lo), fc_bin - 1)
            hi = min(lo + 1, fc_bin - 1)
            src_row = mag[lo] * (1 - frac) + mag[hi] * frac       # interpolated mag
            tilt = 10 ** ((tilt_db_oct / 20.0) * np.log2(max(tf, df) / fc))
            out_mag[tb] = src_row * tilt
            out_ph[tb] = ph[lo] + stable_off[tb]                  # copied + decorrelated

        # seam continuity: match built energy just above fc to source just below fc
        below = np.mean(mag[max(fc_bin - 4, 1):fc_bin] + EPS)
        above = np.mean(out_mag[fc_bin:fc_bin + 4] + EPS)
        gain = float(np.clip(below / above, 0.05, 20.0))
        out_mag[fc_bin:tgt_bin + 1] *= gain

        # conservative wet/dry blend of the synthesized band (dry is ~silent there)
        out_mag[fc_bin:tgt_bin + 1] = (wet * out_mag[fc_bin:tgt_bin + 1]
                                       + (1 - wet) * mag[fc_bin:tgt_bin + 1])

        Zo = out_mag * np.exp(1j * out_ph)
        _, xo = signal.istft(Zo, fs=sr, window="hann", nperseg=nper, noverlap=nov,
                             boundary=True)
        xo = xo[:x2d.shape[0]]
        if len(xo) < x2d.shape[0]:
            xo = np.pad(xo, (0, x2d.shape[0] - len(xo)))
        out[:, c] = xo.astype(np.float32)

    info = {"fc": float(fc), "target_hz": float(target_hz), "wet": float(wet),
            "tilt_db_oct": float(tilt_db_oct)}
    return _restore(peak_guard(out), mono), info


# ------------------------------------------------- FAITHFUL: psychoacoustic exciter
def exciter(x: np.ndarray, sr: int, fc: float | None = None,
            drive: float = 4.0, mix: float = 0.35) -> np.ndarray:
    """FAITHFUL arm — harmonic exciter (classic studio style, stated DSP).

    The band above ~0.45x the measured cutoff is waveshaped (tanh) to generate
    harmonics of EXISTING content, then mixed back. The nonlinearity runs at 4x
    oversampling so the new harmonics don't alias. SYNTHESIZED label: the added
    energy is harmonics of what was recorded — musically related, not recovered.
    """
    x2d, mono = _as2d(x)
    if fc is None:
        fc = estimate_cutoff(x, sr)
    hp_fc = float(np.clip(fc * 0.45, 800.0, sr * 0.35))
    sos = signal.butter(4, hp_fc, "high", fs=sr, output="sos")
    out = np.empty_like(x2d)
    for c in range(x2d.shape[1]):
        band = signal.sosfilt(sos, x2d[:, c]).astype(np.float32)
        up = signal.resample_poly(band, 4, 1)          # 4x BEFORE the nonlinearity
        odd = np.tanh(drive * up)
        even = 0.22 * (odd * odd - np.mean(odd * odd))     # gentle 2nd-harmonic warmth
        shaped = (odd + even) / max(np.tanh(drive), 1e-6)
        harm = signal.resample_poly(shaped, 1, 4)[:len(band)].astype(np.float32)
        harm = signal.sosfilt(sos, harm)               # keep only the high band
        out[:, c] = x2d[:, c] + mix * harm
    return _restore(peak_guard(out), mono)


# ------------------------------------------------- FAITHFUL: transient restore
def transient_restore(x: np.ndarray, sr: int, amount: float = 0.6) -> np.ndarray:
    """FAITHFUL arm — transient restore (dynamic gain, MEASURED label).

    A fast and a slow envelope follower; where the fast envelope exceeds the slow
    one (attacks), gain rises up to (1 + amount). No content is synthesized —
    existing attacks are emphasized.
    """
    x2d, mono = _as2d(x)
    def onepole(env_in, t_ms):
        a = np.exp(-1.0 / (sr * t_ms / 1000.0))
        zi = signal.lfilter_zi([1 - a], [1, -a]).reshape(-1, 1) * env_in[0:1]
        y, _ = signal.lfilter([1 - a], [1, -a], env_in, axis=0, zi=zi)
        return y
    from scipy.ndimage import gaussian_filter1d
    mag = np.abs(x2d).mean(axis=1, keepdims=True)
    mag = gaussian_filter1d(mag, sigma=sr * 0.0008, axis=0)   # kill audio-rate ripple
    fast = onepole(mag, 3.0)
    slow = onepole(mag, 60.0)
    ratio = np.clip(2.6 * (fast - slow) / (slow + 1e-5) - 0.45, 0.0, 3.0)  # deadband
    gain = 1.0 + amount * np.clip(ratio, 0, 2.0)
    gain = gaussian_filter1d(gain, sigma=sr * 0.0015, axis=0)  # zero-phase smooth: no AM buzz

    out = np.clip(x2d * gain, -0.999, 0.999).astype(np.float32)   # local limit,
    return _restore(out, mono)                    # no global rescale (sustain untouched)


# ------------------------------------------------------------------------ K-weighting
def _kweight_energy(x: np.ndarray, sr: int) -> float:
    """ITU-R BS.1770 K-weighted mean-square energy (relative loudness).

    Two-stage filter (high-shelf pre + RLB high-pass) with the standard 48 kHz
    coefficients. Absolute LUFS is not the goal — A and B are filtered identically, so
    the relative match is exact.
    """
    m = to_mono(x).astype(np.float64)
    # stage 1: high-shelf (BS.1770, fs=48k reference)
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    # stage 2: RLB high-pass
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    y = signal.lfilter(b1, a1, m)
    y = signal.lfilter(b2, a2, y)
    return float(np.mean(y ** 2) + EPS)


def loudness_gain(target: np.ndarray, reference: np.ndarray, sr: int) -> float:
    """Gain to apply to `target` so its K-weighted loudness matches `reference`."""
    g = np.sqrt(_kweight_energy(reference, sr) / _kweight_energy(target, sr))
    return float(np.clip(g, 0.1, 10.0))


# ---------------------------------------------------------------------------- metrics
def bandwidth_hz(x: np.ndarray, sr: int) -> float:
    """Measured spectral bandwidth (the -3 dB-from-floor cutoff)."""
    return estimate_cutoff(x, sr)


def synthesis_fraction(out: np.ndarray, orig: np.ndarray, fc: float, sr: int) -> float:
    """Fraction of OUTPUT energy that lives above the source cutoff — i.e. how much of
    what you hear is synthesized rather than original. MEASURED."""
    mo = to_mono(out)
    n = min(len(mo), 1 << 18)
    f, pxx = signal.welch(mo[:n], fs=sr, nperseg=4096, noverlap=2048, scaling="spectrum")
    hi = pxx[f > fc].sum()
    tot = pxx.sum() + EPS
    return float(np.clip(hi / tot, 0.0, 1.0))


def high_band_level_db(x: np.ndarray, fc: float, sr: int) -> float:
    """RMS energy level (dB) of the band ABOVE the source cutoff. For a band-limited
    source this is near-silent; the rise after enhancement is the synthesized energy.
    MEASURED."""
    m = to_mono(x)
    n = min(len(m), 1 << 18)
    if n < 2048:
        return -120.0
    f, pxx = signal.welch(m[:n], fs=sr, nperseg=4096, noverlap=2048, scaling="spectrum")
    band = (f > fc) & (f < sr / 2)
    e = pxx[band].sum()
    return float(10 * np.log10(e + EPS))


def lsd_shared_band(out: np.ndarray, orig: np.ndarray, fc: float, sr: int) -> float:
    """Log-spectral distance between output and original BELOW fc (dB). Near 0 proves
    the original content was preserved, not damaged. MEASURED faithfulness gate."""
    mo, mi = to_mono(out), to_mono(orig)
    n = min(len(mo), len(mi), 1 << 18)
    if n < 2048:
        return 0.0
    fo, po = signal.welch(mo[:n], fs=sr, nperseg=4096, noverlap=2048, scaling="spectrum")
    fi, pi = signal.welch(mi[:n], fs=sr, nperseg=4096, noverlap=2048, scaling="spectrum")
    band = fo < fc
    lo = 10 * np.log10(po[band] + EPS)
    li = 10 * np.log10(pi[band] + EPS)
    return float(np.sqrt(np.mean((lo - li) ** 2)))


def nr_quality(out: np.ndarray, fc: float, sr: int) -> dict:
    """No-reference quality proxy for the SYNTHESIZED band. Flatness near 1 = hiss/noise
    (bad); moderate flatness with structure = plausible texture (good). Also flags an
    abrupt ledge at fc. MEASURED."""
    mo = to_mono(out)
    n = min(len(mo), 1 << 18)
    f, pxx = signal.welch(mo[:n], fs=sr, nperseg=4096, noverlap=2048, scaling="spectrum")
    band = (f > fc) & (f < min(sr / 2, 20000))
    p = pxx[band] + EPS
    if len(p) < 4:
        return {"flatness": 0.0, "verdict": "n/a"}
    gmean = np.exp(np.mean(np.log(p)))
    amean = np.mean(p)
    flat = float(gmean / amean)
    # near 1 = flat noise (hiss, the artifact to avoid); low = tonal/harmonic (fine)
    if flat > 0.6:
        verdict = "hiss-like"      # bad — synthesized band is just noise
    elif flat > 0.02:
        verdict = "plausible"      # good — textured, harmonic + air
    else:
        verdict = "tonal"          # fine — harmonic content, not noise
    return {"flatness": flat, "verdict": verdict, "ok": flat <= 0.6}


def spectrogram(x: np.ndarray, sr: int, nfft: int = 1024, max_frames: int = 900):
    """Log-magnitude spectrogram (freq, time) normalized to [0,1] for display."""
    m = to_mono(x)
    f, t, Z = signal.stft(m, fs=sr, window="hann", nperseg=nfft, noverlap=nfft // 2,
                          boundary=None)
    S = 20 * np.log10(np.abs(Z) + EPS)
    S = np.clip(S, -100, 0)
    S = (S + 100) / 100.0
    if S.shape[1] > max_frames:
        idx = np.linspace(0, S.shape[1] - 1, max_frames).astype(int)
        S = S[:, idx]
        t = t[idx]
    return f, t, S.astype(np.float32)
