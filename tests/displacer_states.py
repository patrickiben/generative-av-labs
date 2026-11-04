#!/usr/bin/env python3
"""Displacer's states, driven in real Chrome: boot, both kinds, every method, real files of each format, every saved file
checked by its bytes, Genopatch, the kit as a controller, performance mode, keys, a phone, and a flicker measurement of the
one thing only this page can do: dragging the slider fast between a dark picture and a bright one.
Needs Chrome, Pillow and macOS afconvert (for the AIFF, M4A and CAF test files). Run: python3 tests/displacer_states.py"""
import http.server, json, struct, subprocess, sys, tempfile, threading, wave
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_port}/displacer.html'
TMP = Path(tempfile.mkdtemp(prefix='displacer-states-'))
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(f"{'PASS' if ok else 'FAIL'}  {name}{'  · ' + str(detail) if detail else ''}", flush=True)

# ---- test media ----
img = Image.new('RGB', (900, 600))
img.putdata([(int(255 * x / 900), int(120 + 100 * (y / 600)), 200 - int(150 * x / 900)) for y in range(600) for x in range(900)])
img.save(TMP / 'gradient.png'); Image.new('RGB', (640, 480), (230, 220, 40)).save(TMP / 'yellow.jpg', quality=90)
def write_wav(path, freq, secs=8.0, rate=44100):
    import math
    n = int(secs * rate)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<hh', *(2 * [int(12000 * math.sin(2 * math.pi * freq * i / rate))])) for i in range(n)))
write_wav(TMP / 'low.wav', 220); write_wav(TMP / 'high.wav', 1760, 3.0)
for fmt, ext, data in (('AIFF', 'aif', 'BEI16'), ('m4af', 'm4a', 'aac'), ('caff', 'caf', 'LEI16')):
    subprocess.run(['afconvert', '-f', fmt, '-d', data, str(TMP / 'high.wav'), str(TMP / f'high.{ext}')], check=True, capture_output=True)
(TMP / 'notes.txt').write_text('not media')
def detailed(path, seed, warm):   # a busy 1600 x 1066 picture: fine lines, small squares and text, so softness shows
    import random
    from PIL import ImageDraw
    r = random.Random(seed); im = Image.new('RGB', (1600, 1066)); d = ImageDraw.Draw(im)
    for y in range(1066): d.line([(0, y), (1599, y)], fill=(int(40 + 140 * warm * y / 1066), int(30 + (y * 7) % 90), int(60 + 150 * (1 - warm) * (1 - y / 1066))))
    for _ in range(1400): x, y, k = r.randrange(1600), r.randrange(1066), r.randrange(2, 10); d.rectangle([x, y, x + k, y + k], fill=tuple(r.randrange(256) for _ in range(3)))
    for _ in range(60): d.text((r.randrange(1500), r.randrange(1040)), 'DISPLACER 0123', fill=(255, 255, 255))
    im.save(path)
detailed(TMP / 'detail_a.png', 1, 1.0); detailed(TMP / 'detail_b.png', 2, 0.0)
def mad(a, b):   # mean absolute difference per channel, 0 to 255
    from PIL import ImageChops, ImageStat
    return sum(ImageStat.Stat(ImageChops.difference(a.convert('RGB'), b.convert('RGB'))).mean) / 3

# ---- the flash measure, the same definition as tests/flash_check.py ----
W, H = 64, 36
def rel(v):
    c = v / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def per_second(series, times):
    turns, ref, d = [], series[0], 0
    for v, t in zip(series, times):
        if d >= 0 and v - ref >= 0.1 and min(v, ref) < 0.8: turns.append(t); d = -1; ref = v
        elif d <= 0 and ref - v >= 0.1 and min(v, ref) < 0.8: turns.append(t); d = 1; ref = v
        else: ref = max(ref, v) if d == -1 else min(ref, v) if d == 1 else ref
    return max([sum(1 for x in turns[i:] if x < t + 1000) // 2 for i, t in enumerate(turns)] or [0])
def flash(frames):
    times = [f['t'] for f in frames]; grids = [[rel(v) for v in f['grid']] for f in frames]
    cells = [per_second([g[c] for g in grids], times) for c in range(W * H)]; worst = 0
    for ry in range(3):
        for rx in range(3):
            cs = [x + y * W for y in range(ry * H // 3, (ry + 1) * H // 3) for x in range(rx * W // 3, (rx + 1) * W // 3)]
            worst = max(worst, sum(1 for c in cs if cells[c] > 3) / len(cs))
    return round(worst, 3), per_second([sum(g) / len(g) for g in grids], times)

def save(pg, button, sheet='save'):
    pg.click(f'#{sheet}-button'); pg.wait_for_timeout(250)
    with pg.expect_download(timeout=60000) as d: pg.click(f'#{button}')
    data = Path(d.value.path()).read_bytes(); name = d.value.suggested_filename
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    return name, data
def wav_info(b): return (b[:4] == b'RIFF' and b[8:12] == b'WAVE', struct.unpack('<I', b[24:28])[0], (len(b) - 44) // 2)

with sync_playwright() as p:
    br = p.chromium.launch(channel='chrome', headless=True, args=['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'])
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_function('window.__app && __app.spaceReady && __app.spaceN > 0', timeout=30000)
    A = lambda js: pg.evaluate(js)
    check('boots with no page errors', not errors, errors[:1])
    check('no drum parts: no drum demo, hit strip, kit badge or audio input; MIDI stays', not pg.is_visible('#demo-button') and not pg.is_visible('#hit-strip') and not pg.is_visible('#source-badge') and not pg.is_visible('#chip-audio') and pg.is_visible('#chip-midi'))
    check('opens on the cloud of the built-in pair', A('__app.spaceN') > 10000 and A('__app.S.view') == 'space', A('__app.spaceN'))
    px = A('__app.pixel()'); check('the stage is not blank', px['mean'] > 8 and px['max'] - px['min'] > 25, (round(px['mean'], 1), round(px['min']), round(px['max'])))
    check('the intro shows first', pg.is_visible('.intro h1') and A("getComputedStyle(document.querySelector('.intro')).opacity") == '1')
    check('the badge names the space rule', 'depth from brightness' in pg.inner_text('#method-badge').lower())
    check('the scope sits on a wide stage', pg.is_visible('#scope-card') and 'blend' in pg.inner_text('#scope-mini'))

    # flat view and the methods
    A('__app.setView("flat")'); pg.wait_for_timeout(700)
    A('__app.setT(0)'); pg.wait_for_timeout(500); g0 = A('__app.pixel()')['grid']
    A('__app.setT(1)'); pg.wait_for_timeout(2500); g1 = A('__app.pixel()')['grid']
    check('flat: the blend changes from A to B', sum(abs(a - b) for a, b in zip(g0, g1)) / len(g0) > 4, round(sum(abs(a - b) for a, b in zip(g0, g1)) / len(g0), 1))
    check('the intro has gone after the first move', A("document.body.classList.contains('moved')"))
    A('__app.setT(0.5)')
    for m, kind in (('ot', 'image-ot'), ('spatial', 'image-spatial'), ('xfade', 'image-xfade')):
        A(f'__app.setMethod("{m}")'); pg.wait_for_timeout(300)
        pg.wait_for_function('!__app.busy', timeout=20000); pg.wait_for_timeout(500)
        check(f'method {m}: badge and caption follow', pg.get_attribute('#method-badge', 'data-kind') == kind and len(A("document.getElementById('method-caption').textContent")) > 40)
    A('__app.setMethod("spatial")'); A("document.getElementById('compare').click()"); pg.wait_for_function('!__app.busy'); pg.wait_for_timeout(800)
    f = A('__app.flat'); check('split compare: two panels, two labels', f['w'] > 1.8 * f['h'] and A("document.querySelectorAll('#flat-labels span').length") == 2 and pg.is_visible('#flat-labels'), f)
    A("document.getElementById('compare').click()"); A('__app.setMethod("ot")')

    # real pictures
    pg.set_input_files('#file-A', str(TMP / 'gradient.png')); pg.wait_for_timeout(800)
    pg.set_input_files('#file-B', str(TMP / 'yellow.jpg')); pg.wait_for_timeout(800)
    check('a PNG and a JPEG load into A and B', pg.inner_text('#name-A') == 'gradient.png' and pg.inner_text('#name-B') == 'yellow.jpg' and not A('__app.S.built.image.A'))
    pg.set_input_files('#file-A', str(TMP / 'notes.txt')); pg.wait_for_timeout(400)
    check('a text file is refused with a reason', 'not a picture or a sound' in pg.inner_text('#toast'))
    name, b = save(pg, 'save-blend')
    im = Image.open(__import__('io').BytesIO(b)) if b[:8] == b'\x89PNG\r\n\x1a\n' else None
    check("save the blend: a PNG at A's own size", im is not None and im.size == (900, 600) and name.endswith('_t50.png'), (name, im.size if im else None))
    name, b = save(pg, 'save-sweep'); check('save a sweep: a strip PNG', b[:4] == b'\x89PNG' and 'strip' in name, name)
    name, b = save(pg, 'save-poster'); po = Image.open(__import__('io').BytesIO(b)); check('save a poster: 1600 by 900', po.size == (1600, 900), name)
    A('__app.setView("space")'); pg.wait_for_function('__app.spaceReady', timeout=30000)
    name, b = save(pg, 'save-cloud'); head = b[:400].decode('latin1')
    n = int(head.split('element vertex ')[1].split('\n')[0]) if 'element vertex' in head else -1
    check('cloud .ply: a header and the right length', head.startswith('ply\n') and len(b) == head.index('end_header\n') + 11 + n * 15, (name, n))
    name, b = save(pg, 'save-splats'); head = b[:900].decode('latin1')
    n = int(head.split('element vertex ')[1].split('\n')[0]); check('splats .ply: 17 floats a splat', len(b) == head.index('end_header\n') + 11 + n * 68, (name, n))
    # full resolution: a 1600 px pair, saved at 0.00 by every method, must be A pixel for pixel, and Spatial OT at 1.00 must be B
    pg.set_input_files('#file-A', str(TMP / 'detail_a.png')); pg.wait_for_timeout(900)
    pg.set_input_files('#file-B', str(TMP / 'detail_b.png')); pg.wait_for_timeout(900)
    A('__app.setView("flat")')
    da, db = Image.open(TMP / 'detail_a.png'), Image.open(TMP / 'detail_b.png')
    for m in ('ot', 'spatial', 'xfade'):
        A(f'__app.setMethod("{m}"); __app.setT(0)'); pg.wait_for_timeout(300); pg.wait_for_function('!__app.busy', timeout=30000); pg.wait_for_timeout(600)
        name, b = save(pg, 'save-blend'); im = Image.open(__import__('io').BytesIO(b))
        check(f'{m} saved at 0.00 is A itself, at full size', im.size == (1600, 1066) and mad(im, da) < 1.0, (name, im.size, round(mad(im, da), 3)))
    A('__app.setMethod("spatial"); __app.setT(1)'); pg.wait_for_timeout(300)
    name, b = save(pg, 'save-blend'); im = Image.open(__import__('io').BytesIO(b))
    check('Spatial OT saved at 1.00 is B itself', im.size == (1600, 1066) and mad(im, db) < 1.0, (name, round(mad(im, db), 3)))
    A('__app.setT(0.5)'); pg.wait_for_timeout(1500)
    r = A('__app.flatRT')
    check('the stage draws the blend at the size it shows it', r and r['h'] >= 0.95 * min(1066, r['shownH']), r)
    A("document.querySelector('#builtin-image').click()"); pg.wait_for_timeout(600)

    # sounds
    pg.click('.mode-switch button[data-mode="audio"]')
    pg.wait_for_function('__app.S.lastRender && !__app.busy', timeout=30000)
    r = A('(()=>{const d=__app.S.lastRender.data;let q=0;for(let i=0;i<d.length;i++)q+=d[i]*d[i];return {rms:Math.sqrt(q/d.length),n:d.length,rate:__app.S.lastRender.rate}})()')
    check('sounds: the built-in blend renders at a healthy level', r['rms'] > 0.05, r)
    check('sounds: Hear and Patch appear', pg.is_visible('#hear') and pg.is_visible('#patch-button'))
    for m in ('mp', 'xfade', 'ot'):
        A(f'__app.setMethod("{m}")'); pg.wait_for_timeout(200); pg.wait_for_function(f'__app.S.lastRender && __app.S.lastRender.method==="{m}" && !__app.busy', timeout=30000)
        check(f'sounds: {m} renders', A('__app.S.lastRender.data.length') > 10000)
    det = A("(async()=>{const S=__app.S;S.fx.gran.on=true;S.audDirty=true;const a=await __app.currentRender();const x=a.data.slice();S.audDirty=true;const b=await __app.currentRender();S.fx.gran.on=false;S.audDirty=true;let same=x.length===b.data.length;for(let i=0;same&&i<x.length;i++)if(x[i]!==b.data[i])same=false;return same})()")
    check('the granular effect repeats exactly', det)
    for ext, secs in (('aif', 3.0), ('m4a', 3.0)):
        pg.set_input_files('#file-B', str(TMP / f'high.{ext}')); pg.wait_for_timeout(1500)
        o = A('({n:__app.S.srcB.data.length, rate:__app.S.srcB.rate, name:__app.S.names.audio.B})')
        check(f'a .{ext} file decodes', o['name'] == f'high.{ext}' and abs(o['n'] / o['rate'] - secs) < 0.1, o)
    pg.set_input_files('#file-A', str(TMP / 'low.wav')); pg.wait_for_timeout(1500)
    o = A('({n:__app.S.srcA.data.length, rate:__app.S.srcA.rate})'); check('a long WAV is cut to its first six seconds', abs(o['n'] / o['rate'] - 6) < 0.01, o)
    pg.set_input_files('#file-B', str(TMP / 'high.caf')); pg.wait_for_timeout(1500)
    t = pg.inner_text('#toast'); check('a CAF file is refused, naming the format', 'CAF' in t or 'loaded' in t.lower() or A('__app.S.names.audio.B') == 'high.caf', t[:120])
    pg.wait_for_function('__app.S.lastRender && !__app.busy', timeout=30000)
    name, b = save(pg, 'save-blend'); ok, rate, n = wav_info(b)
    check('save the blend: a 16-bit WAV at the render rate', ok and rate == A('__app.S.audRate') and n == A('__app.S.lastRender.data.length'), (name, rate, n))
    name, b = save(pg, 'save-sweep'); check('save a sweep: one WAV from A to B', wav_info(b)[0] and 'sweep' in name, name)
    A('__app.setView("space")'); pg.wait_for_function('__app.spaceReady && __app.S.mode==="audio"', timeout=30000)
    check('sounds: the atom cloud builds', 200 < A('__app.spaceN') <= 340, A('__app.spaceN'))
    name, b = save(pg, 'save-atoms'); check('save the atoms: a WAV', wav_info(b)[0], name)

    # Genopatch
    pg.click('#patch-button'); pg.select_option('#gp-effort', 'fast'); pg.click('#gp-grow')
    pg.wait_for_function("document.getElementById('gp-stat').textContent==='grown'", timeout=90000)
    m = pg.inner_text('#gp-match'); check('Genopatch grows a patch', m.endswith('%') and int(m[:-1]) > 20, m)
    with pg.expect_download() as d: pg.click('#gp-json')
    js = json.loads(Path(d.value.path()).read_text()); check('the patch saves as JSON', js['app'] == 'displacer-genopatch' and len(js['genome']) == 13)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # the kit and the keys
    A('__app.kit.feedMidi([0xB0,1,127])'); pg.wait_for_timeout(150); t1 = A('__app.S.t')
    A('__app.kit.feedMidi([0xB0,1,0])'); pg.wait_for_timeout(150); t0 = A('__app.S.t')
    check('the mod wheel moves the blend', t1 == 1 and t0 == 0, (t1, t0))
    pg.click('#patch-button'); pg.check('#gp-keys'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    A('__app.kit.feedMidi([0x90,64,100])'); pg.wait_for_timeout(150); check('a MIDI keyboard note plays the grown patch', A('__app.playing') == 'patch', A('__app.playing'))
    pg.keyboard.press('j'); pg.keyboard.press('d'); pg.wait_for_timeout(200); check('the drum keys and the drum demo key do nothing here', A('!__app.kit.demoOn && __app.kit.hits === 1'), A('__app.kit.hits'))
    pg.click('body', position={'x': 700, 'y': 300}); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(100)
    check('Right arrow nudges the blend', abs(A('__app.S.t') - 0.01) < 1e-9, A('__app.S.t'))
    v0 = A('__app.S.view'); pg.keyboard.press('v'); pg.wait_for_timeout(100); check('V switches the view', A('__app.S.view') != v0)
    pg.click('#perform-button'); pg.wait_for_timeout(500); on = A("document.body.classList.contains('performance')")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500); off = not A("document.body.classList.contains('performance')")
    check('Perform hides the controls and Esc brings them back', on and off, (on, off))
    check('no page errors through all of it', not errors, errors[:2])

    # flicker while scrubbing fast between a dark picture and a bright one, both views, as hard as a hand can go
    A("document.querySelector('.mode-switch button[data-mode=\"image\"]').click()"); A("document.querySelector('#builtin-image').click()"); pg.wait_for_timeout(1500)
    for view, meth in (('flat', 'ot'), ('flat', 'spatial'), ('space', 'ot')):
        A(f'__app.setMethod("{meth}"); __app.setView("{view}")'); pg.wait_for_function('!__app.busy && (__app.S.view!=="space" || __app.spaceReady)', timeout=30000); pg.wait_for_timeout(1200)
        A("window.__scrub=setInterval(()=>__app.setT(__app.S.t>.5?0:1),100)")
        worst, whole = flash(A('__app.recordLuma(6000)')); A('clearInterval(window.__scrub)')
        check(f'flicker, scrubbing at five swings a second, {view} {meth}: under the WCAG limit', worst <= 0.25 and whole <= 3, f'worst region {worst:.0%}, whole frame {whole}/s')

    # a phone
    ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pp = ph.new_page(); perr = []; pp.on('pageerror', lambda e: perr.append(str(e)[:200]))
    pp.goto(URL); pp.wait_for_function('window.__app && __app.spaceReady', timeout=30000); pp.wait_for_timeout(800)
    lay = pp.evaluate("({sw:document.documentElement.scrollWidth, dock:document.querySelector('.dock').getBoundingClientRect().right, hud:document.getElementById('t').getBoundingClientRect().width})")
    check('phone: nothing runs off the side', lay['sw'] <= 390 and lay['dock'] <= 390 and lay['hud'] > 120, lay)
    check('phone: no page errors', not perr, perr[:1])
    ph.close()
    mic = br.new_context(viewport={'width': 1200, 'height': 800}); mic.grant_permissions(['microphone', 'midi'])
    mic.add_init_script("localStorage.setItem('drv.reconnect','true'); window.__gum=0; const g=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); if(g) navigator.mediaDevices.getUserMedia=(...a)=>{window.__gum++;return g(...a);};")
    mp = mic.new_page(); mp.goto(URL); mp.wait_for_function('window.__app && __app.spaceReady', timeout=30000); mp.wait_for_timeout(1500)
    mp.click('#connect-button'); mp.keyboard.press('c'); mp.wait_for_timeout(500)
    check('never opens the microphone, even with reconnect set by another page and permission granted', mp.evaluate('window.__gum') == 0 and mp.evaluate("__app.kit.audio.state") != 'live', (mp.evaluate('window.__gum'), mp.evaluate("__app.kit.audio.state")))
    mic.close()
    hi = br.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2); hp = hi.new_page()
    hp.goto(URL); hp.wait_for_function('window.__app && __app.spaceReady', timeout=30000)
    hp.set_input_files('#file-A', str(TMP / 'detail_a.png')); hp.set_input_files('#file-B', str(TMP / 'detail_b.png')); hp.wait_for_timeout(1500)
    hp.evaluate('__app.setView("flat")'); hp.wait_for_timeout(1500); r = hp.evaluate('__app.flatRT')
    check('on a retina screen the stage draws more than the 560 px working copy', r and r['h'] > 800 and r['h'] >= 0.95 * min(1066, r['shownH']), r)
    hi.close()
    rm = br.new_context(viewport={'width': 1200, 'height': 800}, reduced_motion='reduce'); rp = rm.new_page()
    rp.goto(URL); rp.wait_for_function('window.__app && __app.spaceReady', timeout=30000); a0 = rp.evaluate('__app.S.space.phase'); rp.wait_for_timeout(1500)
    check('reduced motion: the cloud holds still', rp.evaluate('__app.S.space.phase') == a0)
    rm.close(); br.close()
srv.shutdown()
bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)} of {len(results)} passed" + (''.join(f"\nFAIL {n}: {d}" for n, _, d in bad)))
sys.exit(1 if bad else 0)
