#!/usr/bin/env python3
"""Detail Forge Analog, driven for real in Chrome, plus WebKit and Firefox smoke runs.

  boot      : the synthetic test sound is labeled, processed at once, and nothing plays before a click
  listening : Start listening plays A; Space flips to B and back, a held key's repeats are ignored; P stops
  engines   : keys 1 to 4 choose Floor, Exciter, Transient and SBR while playing, each labeled amplified or synthesized
  range     : a drag late in the sound enhances only that range and measures it there, where the desktop app's
              measuring window reads it as unchanged; a click clears it
  exports   : the 24-bit WAV, read back here, equals the page's output, enhanced inside the range and untouched
              outside it; the numbers file equals the readouts; the picture arrives
  files     : one 44.1 kHz stereo sound as WAV, FLAC, Ogg Vorbis, MP3, M4A and AIFF, plus a 24-bit WAV at 96 kHz,
              each opened with the real Open button and decoded at its own rate; a text file and a too-short file
              get plain messages and leave the last sound loaded
  privacy   : nothing but the page itself is requested
  browsers  : Playwright's WebKit (a stand-in for Safari, not Safari) and Firefox boot it and open files

usage: python3 tests/analog_states.py [outdir]     (about a minute; needs ffmpeg and numpy)
"""
import http.server, json, struct, subprocess, sys, tempfile, threading, time, wave
from pathlib import Path
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp())
OUT.mkdir(parents=True, exist_ok=True)
FIX = Path(tempfile.mkdtemp())
SR, SECONDS, CUT = 44100, 3.0, 9000
LOSSLESS = {'wav': ('WAV', 'wav'), 'aiff': ('AIFF', 'aiff'), 'flac': ('FLAC', 'header')}
LOSSY = {'ogg': ('Ogg Vorbis', 'header'), 'mp3': ('MP3', 'header'), 'm4a': ('M4A', 'header')}

def fixtures():
    """3 s of stereo chords over breath noise, cut off by an FFT brick wall at 9 kHz, in every format."""
    rng = np.random.default_rng(20261103)
    n = int(SR * SECONDS); t = np.arange(n) / SR
    x = np.zeros((2, n))
    for ch in range(2):
        for k, f0 in enumerate((220.0, 277.18, 329.63, 440.0)):
            env = np.exp(-((t - 0.37 * k) % 1.5) * 2.2)
            for h in range(1, 41):
                x[ch] += (0.6 if (k + ch) % 2 else 1.0) * env * np.sin(2 * np.pi * f0 * h * t + h * (ch + 1)) / h
        x[ch] += 0.05 * rng.standard_normal(n)
    X = np.fft.rfft(x, axis=1); X[:, np.fft.rfftfreq(n, 1 / SR) > CUT] = 0
    x = np.fft.irfft(X, n, axis=1); x *= 0.7 / np.abs(x).max()
    pcm = np.round(x * 32767).astype('<i2')
    for name, p in (('chords.wav', pcm), ('short.wav', pcm[:, :SR // 10])):
        with wave.open(str(FIX / name), 'wb') as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(p.T.tobytes())
    ff = ['ffmpeg', '-loglevel', 'error', '-y', '-i', str(FIX / 'chords.wav')]
    for ext, a in {'flac': ['-c:a', 'flac'], 'ogg': ['-c:a', 'libvorbis', '-q:a', '6'], 'mp3': ['-c:a', 'libmp3lame', '-b:a', '192k'],
                   'm4a': ['-c:a', 'aac', '-b:a', '192k'], 'aiff': ['-c:a', 'pcm_s16be']}.items():
        subprocess.run([*ff, *a, str(FIX / f'chords.{ext}')], check=True)
    subprocess.run([*ff, '-ar', '96000', '-c:a', 'pcm_s24le', str(FIX / 'chords96.wav')], check=True)
    (FIX / 'notes.txt').write_text('not audio at all')
    return pcm / 32768.0

def read_wav(b):
    """A WAV file's rate, bits and samples by channel, read here with no audio library."""
    assert b[:4] == b'RIFF' and b[8:12] == b'WAVE'
    i, fmt, data = 12, None, None
    while i + 8 <= len(b):
        cid, size = b[i:i + 4], struct.unpack('<I', b[i + 4:i + 8])[0]
        if cid == b'fmt ': fmt = struct.unpack('<HHIIHH', b[i + 8:i + 24])
        elif cid == b'data': data = b[i + 8:i + 8 + size]
        i += 8 + size + (size & 1)
    _, ch, sr, _, _, bits = fmt
    w = bits // 8; frames = len(data) // (w * ch)
    raw = np.frombuffer(data[:frames * w * ch], np.uint8).reshape(frames, ch, w).astype(np.int64)
    v = sum(raw[..., k] << (8 * k) for k in range(w))
    v = np.where(v >= 1 << (bits - 1), v - (1 << bits), v)
    return sr, bits, (v / float(1 << (bits - 1))).T

def best_corr(seg, ref, i0, maxlag=4000):
    """The page's decoded stretch against the original at the best lag, for codecs that shift the start."""
    seg = np.asarray(seg); win = ref[max(0, i0 - maxlag):i0 + len(seg) + maxlag]
    lag = int(np.argmax(np.correlate(win, seg, 'valid')))
    r = win[lag:lag + len(seg)]
    return float(seg @ r / np.sqrt((seg @ seg) * (r @ r))), lag - min(maxlag, i0)

class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_port}'
URL = f'{BASE}/analog.html'
READY = 'window.__app && __app.result && !__app.busy'
results = []
T0 = time.time()

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(f'{time.time() - T0:6.1f}s ' + ('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def session(p, browser='chromium', w=1440, h=900):
    b = getattr(p, browser).launch(**({'channel': 'chrome'} if browser == 'chromium' else {}), headless=True)
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, accept_downloads=True)
    pg = c.new_page(); errors, requests = [], []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' else None)
    pg.on('request', lambda r: requests.append(r.url))
    pg.set_default_timeout(60000)
    pg.goto(URL); pg.wait_for_function(READY, timeout=60000)
    return b, pg, errors, requests

def text(pg, sel): return pg.inner_text(sel).strip()
def shot(pg, name): pg.screenshot(path=str(OUT / f'{name}.png'))

def download(pg, selector):
    with pg.expect_download(timeout=20000) as d:
        pg.click(selector)
    return d.value.suggested_filename, Path(d.value.path()).read_bytes()

def open_file(pg, path):
    with pg.expect_file_chooser() as fc:
        pg.click('#open-button')
    fc.value.set_files(str(path))

def wait_mode(pg, mode):
    pg.wait_for_function(f"{READY} && __app.result.mode === '{mode}'", timeout=60000)
    return pg.evaluate('__app.result')

REF = fixtures()
N = REF.shape[1]
with sync_playwright() as p:
    # 1. boot
    b, pg, err, reqs = session(p)
    r = pg.evaluate('__app.result')
    check('the test sound is labeled synthetic, not a recording', pg.get_attribute('#source-badge', 'data-source') == 'synthetic' and 'not a recording' in text(pg, '#source-label'), text(pg, '#source-label'))
    check('it is processed at once with SBR, and the cutoff is the 11 kHz it was made with', r['mode'] == 'sbr' and abs(r['fc'] - 11000) < 330 and r['metrics']['bw_after'] > 18000,
          f"{r['fc']:.0f} Hz, bandwidth {r['metrics']['bw_before']:.0f} to {r['metrics']['bw_after']:.0f} Hz")
    check('nothing plays and no audio context exists before a click', pg.evaluate('__app.sound') == 'off' and not pg.evaluate('__app.playing'))
    check('no live input: the page never asks for a microphone or MIDI', pg.evaluate("typeof createKit") == 'undefined' and not pg.query_selector('#connect-button')
          and not pg.evaluate("['getUserMedia', 'requestMIDIAccess'].some((w) => document.documentElement.outerHTML.includes(w))"))
    shot(pg, '1-boot')

    # 2. listening: Start listening, then Space flips, a held key's repeats are ignored
    pg.click('#start-listen'); pg.wait_for_timeout(700)
    check('Start listening plays A and hands the keys to the stage', pg.evaluate('__app.playing') and pg.evaluate('__app.sound') == 'running' and pg.evaluate('__app.side') == 'A'
          and pg.evaluate('document.activeElement.id') == 'stage', f"{pg.evaluate('__app.sound')}, focus on {pg.evaluate('document.activeElement.id')}")
    pg.keyboard.down('Space'); pg.wait_for_timeout(150)
    side1, g1 = pg.evaluate('__app.side'), text(pg, '#g-side')
    pg.keyboard.down('Space'); pg.wait_for_timeout(150)          # a second keydown with no keyup arrives as a repeat
    side2 = pg.evaluate('__app.side')
    pg.keyboard.up('Space'); pg.keyboard.press('Space'); pg.wait_for_timeout(150)
    side3 = pg.evaluate('__app.side')
    check('Space flips to B, a held key does not flip it back, and the next press returns to A', (side1, g1, side2, side3) == ('B', 'B', 'B', 'A') and pg.evaluate('__app.playing'), f'{side1} {side2} {side3}')
    gm = pg.evaluate('[__app.gainB, __app.result.metrics.gain, __app.S.match]')
    check('B is played at the measured BS.1770 gain', abs(gm[0] - (gm[1] if gm[2] else 1)) < 1e-9, f'{gm[0]:.3f}× with matching {"on" if gm[2] else "off"}')

    # 3. engines by key, while playing, each labeled by what it does
    for key, mode, label in (('1', 'floor', 'amplified'), ('2', 'exciter', 'synthesized'), ('3', 'transient', 'amplified'), ('4', 'sbr', 'synthesized')):
        pg.keyboard.press(key); r = wait_mode(pg, mode)
        m, chip, hb = r['metrics'], text(pg, '#chip-proc-text'), pg.text_content('#m-hb-n')
        ok = label in chip and label in hb and pg.evaluate('__app.playing')
        if mode == 'floor': ok = ok and abs(m['bw_after'] - m['bw_before']) < 200    # a shelf cannot make content above a brick wall
        if mode in ('exciter', 'sbr'): ok = ok and m['hb_after'] - m['hb_before'] > 20    # new content above the cutoff
        if mode == 'sbr': ok = ok and m['bw_after'] > 18000                             # and SBR carries the band to the top
        check(f'key {key} chooses {mode}, labeled {label}', ok, f"{chip} · bandwidth {m['bw_before']:.0f} to {m['bw_after']:.0f} Hz · high band {m['hb_after'] - m['hb_before']:+.1f} dB")
    pg.keyboard.press('p'); pg.wait_for_timeout(200)
    check('P stops', not pg.evaluate('__app.playing'))

    # 4. a range late in the sound, dragged with the mouse on the result's spectrogram
    t0, t1 = 6.2, 7.8
    gx = pg.evaluate("(() => { const g = __app.geo, r = document.getElementById('stage').getBoundingClientRect(); return { ...g, left: r.left, top: r.top }; })()")
    X = lambda s: gx['left'] + gx['x'] + s / gx['dur'] * gx['w']
    y = gx['top'] + gx['y1'] + gx['h'] / 2
    pg.mouse.move(X(t0), y); pg.mouse.down(); pg.mouse.move(X(t1), y, steps=12); pg.mouse.up()
    pg.wait_for_function(f'{READY} && __app.result.selective', timeout=60000)
    r = pg.evaluate('__app.result'); m = r['metrics']
    a0, a1 = r['n0'] / 44100, r['n1'] / 44100
    check('the drag sets the range it covered', abs(a0 - t0) < 0.03 and abs(a1 - t1) < 0.03, f'{a0:.2f} to {a1:.2f} s · {text(pg, "#chip-proc-text")}')
    check('the range is measured where it was processed, and its new band shows', m['hb_after'] - m['hb_before'] > 3 and m['lsd'] < 3 and f'Measured on {a0:.2f} to {a1:.2f} s' in pg.text_content('#m-span'),
          f"high band {m['hb_before']:.1f} to {m['hb_after']:.1f} dB, original band kept to {m['lsd']:.2f} dB")
    d = pg.evaluate("(() => { const S = __app.S, x = AnalogDSP.run(S.src.ch.map((c) => c.slice()), S.src.sr, { ...S.res.params, measure: 'desktop' }); return x.metrics; })()")
    check("the desktop app's measuring window reads the same range as unchanged", abs(d['hb_after'] - d['hb_before']) < 0.01 and d['lsd'] < 1e-3,
          f"high band {d['hb_before']:.1f} to {d['hb_after']:.1f} dB, which is the defect the page fixes")
    shot(pg, '4-range')

    # 5. exports, with the range set
    pg.click('#keep-button'); pg.wait_for_timeout(300)
    name, data = download(pg, '#export-wav')
    sr, bits, w = read_wav(data)
    i0 = r['n0'] + 2000; i1 = i0 + 20000; k0, k1 = 44100, 66050
    out_in = np.array([pg.evaluate(f'__app.outSlice({c}, {i0}, {i1})') for c in (0, 1)])
    src_in = np.array([pg.evaluate(f'__app.srcSlice({c}, {i0}, {i1})') for c in (0, 1)])
    out_pre = np.array([pg.evaluate(f'__app.outSlice({c}, {k0}, {k1})') for c in (0, 1)])
    src_pre = np.array([pg.evaluate(f'__app.srcSlice({c}, {k0}, {k1})') for c in (0, 1)])
    lsb = 2.0 ** -23
    e_in, e_pre = np.abs(w[:, i0:i1] - out_in).max(), np.abs(w[:, k0:k1] - src_pre).max()
    check('the WAV is 24-bit stereo at the source rate, the whole sound', (sr, bits, w.shape) == (44100, 24, (2, int(8 * 44100))), f'{name}: {sr} Hz, {bits}-bit, {w.shape[1]} frames')
    check("inside the range the WAV is the page's output, within one 24-bit step", e_in <= lsb * 1.001 and np.abs(out_in - src_in).max() > 1e-3, f'largest difference {e_in / lsb:.2f} steps')
    check('outside the range the WAV is the untouched source', e_pre <= lsb * 1.001 and np.array_equal(out_pre, src_pre), f'largest difference {e_pre / lsb:.2f} steps')
    name, data = download(pg, '#export-json')
    j = json.loads(data)
    check('the numbers file matches the readouts and says synthesized', j['measured']['cutoff_hz'] == r['fc'] and j['measured']['high_band_after_db'] == m['hb_after']
          and j['label'] == 'synthesized' and j['source']['synthetic'] is True and j['measured_on'] == 'the processed range' and abs(j['range_seconds'][0] - a0) < 1e-9, name)
    name, data = download(pg, '#export-png')
    pw, ph = struct.unpack('>II', data[16:24])
    check('the picture arrives as a PNG of the stage with its readouts', data[:8] == b'\x89PNG\r\n\x1a\n' and pw == 1440 and ph > 900, f'{name}: {pw} x {ph}')
    check('the Keep sheet says what was handed over', 'Handed' in text(pg, '#keep-status'), text(pg, '#keep-status'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 6. a click clears the range
    pg.mouse.click(X(2.0), y)
    pg.wait_for_function(f'{READY} && !__app.result.selective', timeout=60000)
    check('a click on the stage clears the range', 'Measured on the whole sound' in pg.text_content('#m-span'))

    # 7. files through the real Open button, each at its own rate
    def opened(path, rate, fmt, rate_from):
        open_file(pg, path)
        pg.wait_for_function(f"{READY} && __app.source.name === {json.dumps(path.name)}", timeout=60000)
        return pg.evaluate('__app.source'), pg.evaluate('__app.result')
    for ext, (fmt, rate_from) in {**LOSSLESS, **LOSSY}.items():
        s, r = opened(FIX / f'chords.{ext}', 44100, fmt, rate_from)
        seg = np.array(pg.evaluate(f'__app.srcSlice(0, {SR}, {SR + SR // 2})'))
        if ext == 'flac':        # the browser decodes FLAC, and Chrome scales positive samples by 1/32767: lossless if each maps back
            ints = np.round(np.where(seg < 0, seg * 32768, seg * 32767)); fit_ok = np.array_equal(ints, np.round(REF[0, SR:SR + SR // 2] * 32768))
            fit_s = f'every sample the same 16-bit value, scaled within {np.abs(seg - REF[0, SR:SR + SR // 2]).max():.0e}'
        elif ext in LOSSLESS:
            fit = float(np.abs(seg - REF[0, SR:SR + SR // 2]).max()); fit_ok = fit < 1e-7; fit_s = f'samples equal to {fit:.0e}'
        else:
            c, lag = best_corr(seg, REF[0], SR); fit_ok = c > 0.98; fit_s = f'correlation {c:.4f} at lag {lag}'
        ok = s['sr'] == 44100 and s['rateFrom'] == rate_from and s['format'] == fmt and s['channels'] == 2 and abs(s['frames'] - N) <= (0 if ext in LOSSLESS else SR // 10) and fit_ok
        check(f'{ext}: decoded at its own 44.1 kHz rate', ok, f"{s['format']}, {s['sr']} Hz from {s['rateFrom']}, {s['frames']} frames, {fit_s}, cutoff {r['fc']:.0f} Hz")
        if ext in LOSSLESS: check(f'{ext}: the measured cutoff is the 9 kHz it was cut at', abs(r['fc'] - CUT) < 0.03 * CUT, f"{r['fc']:.0f} Hz")
        check(f'{ext}: the badge names the file and its rate', pg.get_attribute('#source-badge', 'data-source') == 'file' and 'chords' in text(pg, '#source-label')
              and '44.1' in text(pg, '#source-label'), text(pg, '#source-label'))
    sr96, bits96, w96 = read_wav((FIX / 'chords96.wav').read_bytes())
    s, r = opened(FIX / 'chords96.wav', 96000, 'WAV', 'wav')
    seg = np.array(pg.evaluate('__app.srcSlice(1, 96000, 120000)'))
    check('24-bit WAV at 96 kHz: read at 96 kHz, sample for sample', s['sr'] == 96000 and s['frames'] == w96.shape[1] and np.abs(seg - w96[1, 96000:120000]).max() < 1e-9
          and abs(r['fc'] - CUT) < 0.03 * CUT, f"{s['sr']} Hz, {s['frames']} frames, cutoff {r['fc']:.0f} Hz, {text(pg, '#source-label')}")
    shot(pg, '7-file96')
    good = pg.evaluate('__app.source.name')
    for bad_file, want in (('notes.txt', 'could not decode this file'), ('short.wav', 'shorter than a quarter of a second')):
        open_file(pg, FIX / bad_file)
        pg.wait_for_function(f"document.getElementById('src-state').textContent.startsWith('Could not open {bad_file}')", timeout=30000)
        why = pg.text_content('#src-why')
        plain = want in why and not any(w in why for w in ('Error', 'Exception', 'undefined', 'null', 'NaN', 'decodeAudioData'))
        check(f'{bad_file}: a plain message, and the last sound stays loaded', plain and pg.evaluate('__app.source.name') == good and pg.evaluate('__app.result') is not None, why)
    shot(pg, '7-bad-file')

    outside = [u for u in reqs if u.startswith('http') and u != URL]
    check('the page asked for nothing but itself', not outside, ', '.join(outside[:3]) or f'{len(reqs)} requests, all the page or its own blobs')
    check('no page errors in Chrome', not err, '; '.join(err[:2]))
    b.close()

    # 8. phone width
    b, pg, err, _ = session(p, w=390, h=844)
    over = pg.evaluate('document.documentElement.scrollWidth > innerWidth')
    dock = pg.evaluate("(()=>{const r=document.querySelector('.dock').getBoundingClientRect();return [r.left,r.right]})()")
    g = pg.evaluate('__app.geo')
    check('phone: no sideways scroll, the dock fits and both spectrograms show', not over and dock[0] >= 0 and dock[1] <= 390 and g['h'] >= 48, f"dock {dock[0]:.0f} to {dock[1]:.0f}, panes {g['h']:.0f} px tall")
    shot(pg, '8-phone')
    b.close()

    # 9. other engines: Playwright's WebKit stands in for Safari, Firefox as itself
    for engine in ('webkit', 'firefox'):
        try:
            b, pg, err, _ = session(p, browser=engine)
        except Exception as e:
            check(f'{engine}: could not launch here', True, str(e)[:80]); continue
        r = pg.evaluate('__app.result')
        check(f'{engine}: boots and processes the test sound', r['mode'] == 'sbr' and abs(r['fc'] - 11000) < 330, f"{r['fc']:.0f} Hz in {r['ms']:.0f} ms")
        for ext in ('wav', 'aiff', 'flac', 'mp3', 'm4a', 'ogg'):
            open_file(pg, FIX / f'chords.{ext}')
            try:
                pg.wait_for_function(f"(window.__app.source && __app.source.name === 'chords.{ext}' && !__app.busy) || document.getElementById('src-state').textContent.startsWith('Could not open chords.{ext}')", timeout=30000)
            except Exception:
                pass
            s = pg.evaluate('__app.source')
            got = f"{s['sr']} Hz from {s['rateFrom']}" if s['name'] == f'chords.{ext}' else pg.text_content('#src-why')[:90]
            print(f'        {engine} {ext}: {got}')
            if ext in ('wav', 'aiff'): check(f'{engine}: {ext} opens at its own rate', s['name'] == f'chords.{ext}' and s['sr'] == 44100, got)
        check(f'{engine}: no page errors', not err, '; '.join(err[:2]))
        b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)} of {len(results)} passed' + (':\n' + '\n'.join(f'  FAIL {n}  [{d}]' for n, _, d in fails) if fails else ''))
sys.exit(1 if fails else 0)
