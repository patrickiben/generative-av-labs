"""Detail Forge Analog — numeric self-test (harness A7).
Decimate a full-band signal, run FLOOR + SBR, assert the honest invariants."""
import sys, os
import numpy as np
from scipy import signal
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dfa import dsp

sr = 44100
t = np.arange(int(sr * 2.0)) / sr
rng = np.random.default_rng(0)
x = np.zeros_like(t)
for k, f0 in enumerate([220, 330, 440, 660, 880, 1320, 2640, 5280, 9000, 13000]):
    x += (0.7 ** k) * np.sin(2 * np.pi * f0 * t + rng.uniform(0, 6))
x += 0.02 * rng.standard_normal(len(t))
x /= np.max(np.abs(x)) * 1.05
band = signal.sosfilt(signal.butter(10, 6000, 'low', fs=sr, output='sos'), x).astype(np.float32)

fc = dsp.estimate_cutoff(band, sr)
fl = dsp.floor_highshelf(band, sr, gain_db=9.0)
out, info = dsp.sbr_enhance(band, sr)
bwa = dsp.bandwidth_hz(out, sr)
lsd = dsp.lsd_shared_band(out, band, fc, sr)
nr = dsp.nr_quality(out, fc, sr)
print(f"cutoff={fc:.0f} bw_after={bwa:.0f} lsd={lsd:.2f} nr={nr['verdict']} flat={nr['flatness']:.3f}")
ok = fc < 6500 and bwa > fc * 1.4 and lsd < 2.5 and nr["ok"]
print("SELFTEST", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
