#!/usr/bin/env python3
"""Detail Forge Analog: does the page compute what the desktop app computed?

Runs the desktop app's own Python (legacy/analog/dfa/dsp.py, with app.py's processing run copied below) and the page's
JavaScript (src/analog-dsp.js, the file its Worker runs, here under Node) on the same synthetic sounds. The tolerances
were set before any run:

  FLOOR, EXCITER, TRANSIENT, and SBR handed the desktop's own random phases
      every output sample within one 16-bit step (2^-15) of the desktop's output
  every number the app reports, on those runs
      cutoff and bandwidth on the same Welch bin, levels and LSD within 0.01 dB, flatness within 0.0001 with the same
      verdict, and the A/B loudness match within 0.01 %
  SBR with the page's own random phases, where samples differ by design
      below half the cutoff, the two outputs within 0.05 dB (log-spectral distance); each reported number and each
      third-octave level above the cutoff within four standard deviations of the spread the desktop itself shows over
      sixteen seeds, and never closer than 0.1 dB or one Welch bin
  the desktop's self-test (selftest.py), ported: its four invariants hold on the page's output
  display spectrograms within 0.001 of full scale (0.1 dB), and the 24-bit WAV export sample for sample what
      soundfile writes (libsndfile 1.2 rounds to 32 bits and keeps the top 24), or that rule without soundfile

Python runs the SBR transform in single precision and JavaScript in double, so exact equality is not expected: the
largest differences are printed. The Python is the desktop code with one word changed in a comment.

usage: python3 tests/analog_numbers.py [--json out.json] [--keep]     (numpy, scipy and node; soundfile optional)
"""
import importlib.util, json, shutil, subprocess, sys, tempfile, time
from pathlib import Path
import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('dsp', ROOT / 'legacy' / 'analog' / 'dfa' / 'dsp.py')
dsp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dsp)

STEP16 = 2.0 ** -15
SEEDS = range(1, 17)
DEFAULTS = dict(mode='sbr', gain_db=9.0, drive=4.0, emix=0.35, tamt=0.6, wet=0.65, tilt=-6.0, target_hz=20000.0)
NFREQ = 1025                                      # SBR's 2048-point frames


def desktop_run(x, sr, c, measure='desktop'):
    """app.py, Worker.run, without Qt. measure='span' measures the processed range, as the page does."""
    c = {**DEFAULTS, **c}
    full_x = x
    t0, t1 = c.get('sel') or (0.0, 0.0)
    n0, n1 = int(t0 * sr), int(t1 * sr)
    selective = 0 <= n0 < n1 <= len(x) and (n1 - n0) < len(x) - int(0.05 * sr)
    if selective:
        x = np.ascontiguousarray(x[n0:n1])
    fc = dsp.estimate_cutoff(x, sr)
    if c['mode'] == 'floor':
        out = dsp.floor_highshelf(x, sr, gain_db=c['gain_db'], fc=0.5 * fc)
    elif c['mode'] == 'exciter':
        out = dsp.exciter(x, sr, fc=fc, drive=c['drive'], mix=c['emix'])
    elif c['mode'] == 'transient':
        out = dsp.transient_restore(x, sr, amount=c['tamt'])
    else:
        out, _ = dsp.sbr_enhance(x, sr, fc=fc, target_hz=c['target_hz'], wet=c['wet'], tilt_db_oct=c['tilt'],
                                 seed=c.get('seed', 20260717))
    if selective:
        spliced = np.array(full_x, copy=True)
        seg = out[:n1 - n0]
        xf = min(int(0.05 * sr), len(seg) // 4)
        if xf > 0:
            t = (0.5 - 0.5 * np.cos(np.pi * np.arange(xf) / xf)).astype(np.float32)
            tt = t[:, None] if seg.ndim == 2 else t
            seg[:xf] = seg[:xf] * tt + spliced[n0:n0 + xf] * (1 - tt)
            seg[-xf:] = seg[-xf:] * tt[::-1] + spliced[n1 - xf:n1] * (1 - tt[::-1])
        spliced[n0:n1] = seg
        out = spliced
        x = full_x
    mx, mo = (x[n0:n1], out[n0:n1]) if (selective and measure == 'span') else (x, out)
    nr = dsp.nr_quality(mo, fc, sr)
    return out, dict(fc=fc, bw_before=dsp.bandwidth_hz(mx, sr), bw_after=dsp.bandwidth_hz(mo, sr),
                     hb_before=dsp.high_band_level_db(mx, fc, sr), hb_after=dsp.high_band_level_db(mo, fc, sr),
                     lsd=dsp.lsd_shared_band(mo, mx, fc, sr), flatness=nr['flatness'], verdict=nr['verdict'],
                     ok=bool(nr['ok']), gain=dsp.loudness_gain(mo, mx, sr))


# ---------------------------------------------------------------- synthetic sounds, nothing recorded
def selftest_sound():
    """selftest.py's signal: ten partials and a little noise, low-passed at 6 kHz, 2 s mono at 44.1 kHz."""
    sr = 44100
    t = np.arange(int(sr * 2.0)) / sr
    rng = np.random.default_rng(0)
    x = np.zeros_like(t)
    for k, f0 in enumerate([220, 330, 440, 660, 880, 1320, 2640, 5280, 9000, 13000]):
        x += (0.7 ** k) * np.sin(2 * np.pi * f0 * t + rng.uniform(0, 6))
    x += 0.02 * rng.standard_normal(len(t))
    x /= np.max(np.abs(x)) * 1.05
    return signal.sosfilt(signal.butter(10, 6000, 'low', fs=sr, output='sos'), x).astype(np.float32), sr


def chord_sound():
    """7 s of a sawtooth chord with vibrato and noise, stereo at 48 kHz, cut at 9 kHz on the left and 11 kHz on the right.
    Longer than 2^18 samples, so the desktop's measuring window is exercised."""
    sr, n = 48000, 7 * 48000
    t = np.arange(n) / sr
    rng = np.random.default_rng(1)
    chans = []
    for lim, rate in ((9000, 4.5), (11000, 4.9)):
        x = np.zeros(n)
        tv = t + 0.0015 * np.sin(2 * np.pi * rate * t)
        for f0 in (110.0, 138.6, 164.8):
            for h in range(1, 41):
                x += np.sin(2 * np.pi * f0 * h * tv + rng.uniform(0, 6)) / h
        x += 0.05 * rng.standard_normal(n)
        x /= np.max(np.abs(x)) * 1.25
        chans.append(signal.sosfilt(signal.butter(10, lim, 'low', fs=sr, output='sos'), x))
    return np.stack(chans, axis=1).astype(np.float32), sr


def drum_sound():
    """3 s of synthetic drums: swept-sine kicks, noise snares and hats, low-passed at 7 kHz, mono at 44.1 kHz."""
    sr, n = 44100, 3 * 44100
    rng = np.random.default_rng(2)
    x = np.zeros(n)
    for k, start in enumerate(np.arange(0, 3.0, 0.25)):
        i0 = int(start * sr)
        tt = np.arange(n - i0) / sr
        if k % 4 == 0:
            x[i0:] += 0.9 * np.sin(2 * np.pi * (50 * tt + 2 * (1 - np.exp(-tt * 30)))) * np.exp(-tt * 9)
        elif k % 4 == 2:
            x[i0:] += 0.5 * rng.standard_normal(n - i0) * np.exp(-tt * 18) + 0.3 * np.sin(2 * np.pi * 190 * tt) * np.exp(-tt * 20)
        x[i0:] += 0.25 * rng.standard_normal(n - i0) * np.exp(-tt * 60)
    x += 0.01 * rng.standard_normal(n)
    x /= np.max(np.abs(x)) * 1.1
    return signal.sosfilt(signal.butter(10, 7000, 'low', fs=sr, output='sos'), x).astype(np.float32), sr


def desktop_phases(x, seed=20260717):
    rng = np.random.default_rng(seed)
    return [rng.uniform(-np.pi, np.pi, size=NFREQ) for _ in range(1 if x.ndim == 1 else x.shape[1])]


def third_octaves(x, sr, fc, top):
    """Welch levels (dB) in third-octave bands from the cutoff to the target ceiling, as dsp.py's Welch sees them."""
    m = dsp.to_mono(x)
    f, p = signal.welch(m[:1 << 18], fs=sr, nperseg=4096, noverlap=2048, scaling='spectrum')
    edges = fc * 2.0 ** (np.arange(0, 12) / 3.0)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        if hi > top:
            break
        band = (f >= lo) & (f < hi)
        if band.sum():
            out.append(10 * np.log10(p[band].sum() + 1e-12))
    return np.array(out)


def lsd_below(a, b, sr, limit):
    m1, m2 = dsp.to_mono(a), dsp.to_mono(b)
    f, p1 = signal.welch(m1[:1 << 18], fs=sr, nperseg=4096, noverlap=2048, scaling='spectrum')
    _, p2 = signal.welch(m2[:1 << 18], fs=sr, nperseg=4096, noverlap=2048, scaling='spectrum')
    band = f < limit
    return float(np.sqrt(np.mean((10 * np.log10(p1[band] + 1e-12) - 10 * np.log10(p2[band] + 1e-12)) ** 2)))


# ---------------------------------------------------------------- the comparison
class Report:
    def __init__(self):
        self.rows, self.bad = [], []

    def check(self, name, ok, detail):
        self.rows.append((name, bool(ok), detail))
        if not ok:
            self.bad.append(f'{name}: {detail}')


def compare_numbers(rep, rid, py, js, sr):
    binw = sr / 4096
    for k in ('fc', 'bw_before', 'bw_after'):
        rep.check(f'{rid} {k}', abs(py[k] - js[k]) < 0.5 * binw, f'{py[k]:.1f} vs {js[k]:.1f} Hz')
    for k in ('hb_before', 'hb_after', 'lsd'):
        rep.check(f'{rid} {k}', abs(py[k] - js[k]) <= 0.01, f'{py[k]:.4f} vs {js[k]:.4f} dB')
    rep.check(f'{rid} flatness', abs(py['flatness'] - js['flatness']) <= 1e-4 and py['verdict'] == js['verdict'],
              f"{py['flatness']:.5f} {py['verdict']} vs {js['flatness']:.5f} {js['verdict']}")
    rep.check(f'{rid} loudness match', abs(py['gain'] / js['gain'] - 1) <= 1e-4, f"{py['gain']:.6f} vs {js['gain']:.6f}")


def main():
    args = sys.argv[1:]
    keep = '--keep' in args
    jpath = args[args.index('--json') + 1] if '--json' in args else None
    if not shutil.which('node'):
        sys.exit('node is not installed: the page\'s processing runs under Node for this test')
    work = Path(tempfile.mkdtemp(prefix='analog-numbers-'))
    t_start = time.time()
    sounds = {'selftest': selftest_sound(), 'chord48': chord_sound(), 'drums': drum_sound()}
    job = {'inputs': [], 'runs': [], 'wav': []}
    for name, (x, sr) in sounds.items():
        x2 = x[:, None] if x.ndim == 1 else x
        files = []
        for c in range(x2.shape[1]):
            f = f'in_{name}_{c}.f32'
            np.ascontiguousarray(x2[:, c], dtype='<f4').tofile(work / f)
            files.append(f)
        job['inputs'].append({'name': name, 'sr': sr, 'files': files})
        job['wav'].append({'input': name, 'file': f'js_{name}.wav'})

    runs = {}

    def add(rid, inp, params, phases='desktop', measure='desktop', spectrogram=False):
        x, sr = sounds[inp]
        r = {'id': rid, 'input': inp, 'params': {**params, 'measure': measure}, 'spectrogram': spectrogram}
        if params.get('mode', 'sbr') == 'sbr' and phases == 'desktop':
            r['phases'] = []
            for c, ph in enumerate(desktop_phases(x, params.get('seed', 20260717))):
                f = f'ph_{rid}_{c}.f64'
                np.ascontiguousarray(ph, dtype='<f8').tofile(work / f)
                r['phases'].append(f)
        job['runs'].append(r)
        runs[rid] = dict(inp=inp, params=params, phases=phases, measure=measure)

    for inp in sounds:
        for mode in ('floor', 'exciter', 'transient', 'sbr'):
            add(f'{inp}_{mode}', inp, {'mode': mode}, spectrogram=True)
        add(f'{inp}_sbr_own', inp, {'mode': 'sbr'}, phases='own')
    add('chord48_floor_15dB', 'chord48', {'mode': 'floor', 'gain_db': 15.0})
    add('chord48_exciter_hot', 'chord48', {'mode': 'exciter', 'drive': 7.0, 'emix': 0.6})
    add('chord48_transient_full', 'chord48', {'mode': 'transient', 'tamt': 1.0})
    add('chord48_sbr_alt', 'chord48', {'mode': 'sbr', 'wet': 0.9, 'tilt': -3.0, 'target_hz': 22000.0})
    add('drums_sbr_range', 'drums', {'mode': 'sbr', 'sel': [0.8, 1.9]})
    add('drums_sbr_range_span', 'drums', {'mode': 'sbr', 'sel': [0.8, 1.9]}, measure='span')
    add('chord48_exciter_late', 'chord48', {'mode': 'exciter', 'sel': [5.6, 6.7]})
    add('chord48_exciter_late_span', 'chord48', {'mode': 'exciter', 'sel': [5.6, 6.7]}, measure='span')

    (work / 'job.json').write_text(json.dumps(job))
    t_js = time.time()
    subprocess.run(['node', str(ROOT / 'tests' / 'analog_run.js'), str(work / 'job.json')], check=True)
    t_js = time.time() - t_js
    js_all = json.loads((work / 'js_results.json').read_text())

    rep = Report()
    summary = {'runs': {}, 'selftest': {}, 'seed_spread': {}}
    t_py = 0.0
    for rid, r in runs.items():
        x, sr = sounds[r['inp']]
        t = time.time()
        out, py = desktop_run(x, sr, r['params'], r['measure'])
        t_py += time.time() - t
        js = js_all[rid]
        nch = 1 if x.ndim == 1 else x.shape[1]
        jo = np.stack([np.fromfile(work / f'js_{rid}_{c}.f32', dtype='<f4') for c in range(nch)], axis=1)
        po = out[:, None] if out.ndim == 1 else out
        row = {'py': py, 'js': {k: js[k] for k in py}, 'ms_js': js['ms']}
        if r['phases'] == 'desktop':
            d = np.abs(po.astype(np.float64) - jo.astype(np.float64))
            rel = float(np.sqrt(np.mean(d ** 2)) / (np.sqrt(np.mean(po.astype(np.float64) ** 2)) + 1e-30))
            row.update(max_abs=float(d.max()), rel_rms=rel)
            rep.check(f'{rid} samples', d.max() <= STEP16, f'largest difference {d.max():.2e} (one 16-bit step is {STEP16:.2e}), relative RMS {rel:.1e}')
            compare_numbers(rep, rid, py, js, sr)
            if 'spec' in js:
                bins, frames = js['spec']
                for side, src in (('specb', x), ('speca', out)):
                    _, _, S = dsp.spectrogram(src, sr)
                    J = np.fromfile(work / f'js_{rid}_{side}.f32', dtype='<f4').reshape(bins, frames)
                    dd = float(np.abs(S.astype(np.float64) - J).max()) if S.shape == J.shape else float('inf')
                    rep.check(f'{rid} {"before" if side == "specb" else "after"} spectrogram', dd <= 1e-3, f'largest difference {dd:.1e} of full scale, shape {S.shape} vs {(bins, frames)}')
        else:
            # the page's own phases: levels and spectra against the desktop's spread over sixteen seeds
            fc = py['fc']
            top = min(sr / 2, r['params'].get('target_hz', 20000.0))
            spread = {k: [] for k in ('bw_after', 'hb_after', 'lsd', 'flatness', 'gain')}
            bands = []
            for s in SEEDS:
                o2, m2 = desktop_run(x, sr, {**r['params'], 'seed': s})
                for k in spread:
                    spread[k].append(m2[k])
                bands.append(third_octaves(o2, sr, fc, top))
            jb = third_octaves(jo[:, 0] if nch == 1 else jo, sr, fc, top)
            bands = np.array(bands)
            below = lsd_below(po, jo, sr, fc / 2)
            rep.check(f'{rid} below half the cutoff', below <= 0.05, f'{below:.4f} dB between the desktop\'s and the page\'s output')
            floors = {'bw_after': sr / 4096, 'hb_after': 0.1, 'lsd': 0.1, 'flatness': 0.002, 'gain': 0.001}
            sp = {}
            for k, vals in spread.items():
                v = np.array(vals, dtype=float)
                tol = max(4 * v.std(ddof=1), floors[k])
                sp[k] = dict(mean=float(v.mean()), sd=float(v.std(ddof=1)), js=js[k])
                rep.check(f'{rid} {k}', abs(js[k] - v.mean()) <= tol, f'page {js[k]:.4g}, desktop over 16 seeds {v.mean():.4g} ± {v.std(ddof=1):.2g} (limit ± {tol:.2g})')
            bm, bs = bands.mean(axis=0), bands.std(axis=0, ddof=1)
            worst = float(np.max(np.abs(jb - bm) - np.maximum(4 * bs, 0.1))) if len(jb) == len(bm) else float('inf')
            rep.check(f'{rid} third-octave levels', worst <= 0, f'{len(bm)} bands above the cutoff, largest gap {np.max(np.abs(jb - bm)):.2f} dB against limits of {np.maximum(4 * bs, 0.1).min():.2f} to {np.maximum(4 * bs, 0.1).max():.2f} dB')
            row.update(below_half_cutoff_lsd=below, seed_spread=sp, third_octave_gap_db=float(np.max(np.abs(jb - bm))))
            summary['seed_spread'][rid] = sp
        summary['runs'][rid] = row

    # the desktop's self-test, ported: the page's SBR output must keep selftest.py's four invariants
    js = js_all['selftest_sbr_own']
    _, py = desktop_run(*sounds['selftest'], {'mode': 'sbr'})
    for side, m in (('desktop', py), ('page', js)):
        ok = m['fc'] < 6500 and m['bw_after'] > m['fc'] * 1.4 and m['lsd'] < 2.5 and m['ok']
        summary['selftest'][side] = dict(cutoff=m['fc'], bw_after=m['bw_after'], lsd=m['lsd'], verdict=m['verdict'], flat=m['flatness'], passed=bool(ok))
        rep.check(f'selftest.py invariants, {side}', ok, f"cutoff={m['fc']:.0f} bw_after={m['bw_after']:.0f} lsd={m['lsd']:.2f} nr={m['verdict']} flat={m['flatness']:.3f}")

    # 24-bit WAV export
    try:
        import soundfile as sf
    except ImportError:
        sf = None
    for name, (x, sr) in sounds.items():
        raw = (work / f'js_{name}.wav').read_bytes()
        js24 = np.frombuffer(raw[44:], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        js24 = (js24[:, 0] | (js24[:, 1] << 8) | (js24[:, 2] << 16))
        js24 = np.where(js24 >= 1 << 23, js24 - (1 << 24), js24)
        if sf is not None:
            sf.write(str(work / f'sf_{name}.wav'), x, sr, subtype='PCM_24')
            ref, _ = sf.read(str(work / f'sf_{name}.wav'), dtype='int32', always_2d=True)
            ref = (ref >> 8).reshape(-1)
            how = 'soundfile'
        else:
            ref = np.clip(np.rint(np.asarray(x, dtype=np.float32) * np.float32(2 ** 31)), -2 ** 31, 2 ** 31 - 1).astype(np.int64) >> 8
            ref = ref.reshape(-1)
            how = "libsndfile 1.2's rule (soundfile is not installed)"
        same = js24.shape == ref.shape and np.array_equal(js24, ref)
        hdr_ok = raw[:4] == b'RIFF' and raw[8:12] == b'WAVE' and int.from_bytes(raw[34:36], 'little') == 24 and int.from_bytes(raw[24:28], 'little') == sr
        rep.check(f'{name} 24-bit WAV', same and hdr_ok, f'{js24.size} samples identical to {how}' if same else f'{int(np.sum(js24 != ref)) if js24.shape == ref.shape else "shape"} samples differ from {how}')

    w = max(len(r[0]) for r in rep.rows)
    for name, ok, detail in rep.rows:
        print(f"{'ok  ' if ok else 'FAIL'} {name.ljust(w)}  {detail}")
    print(f'\n{len(rep.rows) - len(rep.bad)} of {len(rep.rows)} checks passed. Desktop Python {t_py:.1f} s (plus the seed spread), page JavaScript under Node {t_js:.1f} s, {time.time() - t_start:.0f} s in all.')
    print('numpy', np.__version__, '| scipy', __import__('scipy').__version__, '| node', subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip())
    if jpath:
        summary['checks'] = [dict(name=n, ok=o, detail=d) for n, o, d in rep.rows]
        Path(jpath).write_text(json.dumps(summary, indent=1, default=float))
    if keep:
        print('files kept in', work)
    else:
        shutil.rmtree(work, ignore_errors=True)
    sys.exit(1 if rep.bad else 0)


if __name__ == '__main__':
    main()
