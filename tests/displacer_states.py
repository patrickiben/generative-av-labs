#!/usr/bin/env python3
"""Displacer's states, driven in real Chrome: boot, every method, real sound files of each format, every saved file
checked by its bytes, Genopatch, MIDI as a controller, performance mode, keys, a phone, no picture mode and no drum
parts or drum wording anywhere a visitor can reach, no network requests after load, and a flicker measurement of the
fastest ways a hand can change the stage: dragging the slider, and flipping between the flat and space views.
Needs Chrome, Pillow and macOS afconvert (for the AIFF, M4A and CAF test files). Run: python3 tests/displacer_states.py"""
import http.server, io, json, re, struct, subprocess, sys, tempfile, threading, wave
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
Image.new('RGB', (640, 480), (230, 220, 40)).save(TMP / 'yellow.png')
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

# Every sheet opened with every section expanded, plus the visible chrome, labels, title and description: all the text
# a visitor can reach.
REACHABLE_TEXT = """(async () => {
  const out = [], attrs = (root, all) => root.querySelectorAll('[aria-label],[title],[alt],[placeholder]').forEach((el) => {
    if (!all && el.closest('dialog')) return;
    if (el.checkVisibility && !el.checkVisibility()) return;
    ['aria-label', 'title', 'alt', 'placeholder'].forEach((a) => { const v = el.getAttribute(a); if (v) out.push(v); });
  });
  for (const d of document.querySelectorAll('dialog.sheet')) {
    d.showModal(); d.querySelectorAll('details').forEach((x) => { x.open = true; });
    await new Promise((r) => setTimeout(r, 60));
    out.push(d.innerText); attrs(d, true); d.close();
  }
  out.push(document.body.innerText); attrs(document, false);
  out.push(document.title, document.querySelector('meta[name=description]').content);
  return out.join('\\n');
})()"""
DRUM = re.compile(r'\b(drums?|drummer|drumming|kits?|pads?|hits?|kick|snare|hi-?hat|cymbals?|sticks?|pedal|sessions?|hard playing)\b', re.I)
def overlaps(a, b): return a and b and not (a['right'] <= b['left'] or b['right'] <= a['left'] or a['bottom'] <= b['top'] or b['bottom'] <= a['top'])
BOXES = "Object.fromEntries(['#method-badge', '.brand', '.top-actions', '.dock-wrap'].map((s) => { const e = document.querySelector(s); if (!e) return [s, null]; const r = e.getBoundingClientRect(); return [s, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }]; }))"

with sync_playwright() as p:
    br = p.chromium.launch(channel='chrome', headless=True, args=['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'])
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page(); errors = []; net = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.on('console', lambda m: errors.append('console: ' + m.text[:200]) if m.type == 'error' else None)   # errors the page catches and logs count too
    pg.goto(URL); pg.wait_for_function('window.__app && __app.spaceReady && __app.spaceN > 0', timeout=30000)
    pg.on('request', lambda r: net.append(r.url) if r.url.startswith('http') else None)
    A = lambda js: pg.evaluate(js)
    check('boots with no page or console errors', not errors, errors[:1])
    check('sounds only: no picture mode, picture controls or picture files', A("""!document.querySelector('.mode-switch') && !document.getElementById('builtin-image') && !document.querySelector('[data-m="spatial"]')
      && !document.getElementById('compare') && !document.getElementById('img-opts') && !document.getElementById('flat-labels') && !document.getElementById('file-A').accept.includes('image')"""))
    check('no drum parts: no drum demo, hit strip, kit badge, audio input, session or signal view; MIDI stays',
          not pg.is_visible('#demo-button') and not A("!!document.getElementById('hit-strip')") and not pg.is_visible('#source-badge') and not pg.is_visible('#chip-audio')
          and pg.is_visible('#chip-midi') and A("!document.getElementById('session-sheet') && !document.getElementById('session-button') && !document.getElementById('signal-sheet') && !document.getElementById('signal-button')"))
    check('opens on the atom cloud of the built-in pair', 200 < A('__app.spaceN') <= 340 and A('__app.S.view') == 'space', A('__app.spaceN'))
    px = A('__app.pixel()'); check('the stage is not blank', px['mean'] > 4 and px['max'] - px['min'] > 25, (round(px['mean'], 1), round(px['min']), round(px['max'])))
    check('the intro shows first, and names sound', pg.is_visible('.intro h1') and A("getComputedStyle(document.querySelector('.intro')).opacity") == '1' and 'sound' in pg.inner_text('.intro').lower())
    check('the badge names the atom rule', 'gabor atoms' in pg.inner_text('#method-badge').lower(), pg.inner_text('#method-badge'))
    b = A(BOXES); check('the badge clears the header on a desktop', not overlaps(b['#method-badge'], b['.brand']) and not overlaps(b['#method-badge'], b['.top-actions']), b)
    check('the scope sits on a wide stage', pg.is_visible('#scope-card') and 'blend' in pg.inner_text('#scope-mini'))
    check('Hear, Patch and Play the atoms are there from the start', pg.is_visible('#hear') and pg.is_visible('#patch-button') and A("!document.getElementById('atom-actions').hidden"))

    # every word a visitor can reach
    text = A(REACHABLE_TEXT)
    hits = sorted(set(m.group(0).lower() for m in DRUM.finditer(text)))
    check('no drum wording in any sheet, label, title or description', not hits, hits)
    rest = text.replace('A picture of the stage', '').replace('between a picture and a sound', '')
    check('no picture wording except the stage snapshot and the pointer to Nebula', not re.search(r'\bpictures?\b', rest, re.I), re.findall(r'.{30}\bpictures?\b.{30}', rest, re.I)[:3])
    about = A("document.getElementById('about-sheet').textContent")
    check("About credits Displacer's own methods, not another page's", 'McCann' in about and 'Butterchurn' not in about and 'beat' not in about.lower())
    check('About states the measured flicker rule for the slider, and the privacy of sound files', 'slider dragged fast' in about and 'never uploaded' in about)

    # flat view and the methods
    A('__app.setView("flat")'); pg.wait_for_timeout(500)
    A('__app.setT(0)'); pg.wait_for_function('__app.S.lastRender && __app.S.lastRender.t === 0 && !__app.busy', timeout=30000); pg.wait_for_timeout(600); g0 = A('__app.pixel()')['grid']
    A('__app.setT(1)'); pg.wait_for_function('__app.S.lastRender && __app.S.lastRender.t === 1 && !__app.busy', timeout=30000); pg.wait_for_timeout(600); g1 = A('__app.pixel()')['grid']
    d01 = sum(abs(a - b) for a, b in zip(g0, g1)) / len(g0)
    check('flat: the spectrogram changes from A to B', d01 > 4 and A('__app.flat.spec'), round(d01, 1))
    check('the intro has gone after the first move', A("document.body.classList.contains('moved')"))
    A('__app.setT(0.5)')
    r = A('(()=>{return new Promise(res=>{const go=()=>{const L=__app.S.lastRender;if(L&&L.t===0.5&&!__app.busy){const d=L.data;let q=0;for(let i=0;i<d.length;i++)q+=d[i]*d[i];res({rms:Math.sqrt(q/d.length),n:d.length,rate:L.rate})}else setTimeout(go,100)};go()})})()')
    check('the built-in blend renders at a healthy level', r['rms'] > 0.05, r)
    for m in ('mp', 'xfade', 'ot'):
        A(f'__app.setMethod("{m}")'); pg.wait_for_timeout(200); pg.wait_for_function(f'__app.S.lastRender && __app.S.lastRender.method==="{m}" && !__app.busy', timeout=30000)
        check(f'method {m}: renders, and the badge and caption follow', A('__app.S.lastRender.data.length') > 10000 and pg.get_attribute('#method-badge', 'data-kind') == f'audio-{m}' and len(A("document.getElementById('method-caption').textContent")) > 40)
    det = A("(async()=>{const S=__app.S;S.fx.gran.on=true;S.audDirty=true;const a=await __app.currentRender();const x=a.data.slice();S.audDirty=true;const b=await __app.currentRender();S.fx.gran.on=false;S.audDirty=true;let same=x.length===b.data.length;for(let i=0;same&&i<x.length;i++)if(x[i]!==b.data[i])same=false;return same})()")
    check('the granular effect repeats exactly', det)

    # real files
    for ext, secs in (('aif', 3.0), ('m4a', 3.0)):
        pg.set_input_files('#file-B', str(TMP / f'high.{ext}')); pg.wait_for_timeout(1500)
        o = A('({n:__app.S.srcB.data.length, rate:__app.S.srcB.rate, name:__app.S.names.B})')
        check(f'a .{ext} file decodes', o['name'] == f'high.{ext}' and abs(o['n'] / o['rate'] - secs) < 0.1, o)
    pg.set_input_files('#file-A', str(TMP / 'low.wav')); pg.wait_for_timeout(1500)
    o = A('({n:__app.S.srcA.data.length, rate:__app.S.srcA.rate})'); check('a long WAV is cut to its first six seconds', abs(o['n'] / o['rate'] - 6) < 0.01, o)
    check('the sheet names both files', pg.inner_text('#name-A') == 'low.wav' and pg.inner_text('#name-B') == 'high.m4a' and not A('__app.S.built.A'))
    pg.set_input_files('#file-B', str(TMP / 'high.caf')); pg.wait_for_timeout(1500)
    t = pg.inner_text('#toast'); check('a CAF file is refused, naming the format', 'CAF' in t or A('__app.S.names.B') == 'high.caf', t[:120])
    A("__app.loadFile(new File([new Uint8Array([137,80,78,71])], 'yellow.png', {type:'image/png'}), 'A')"); pg.wait_for_timeout(300)
    check('a picture is refused with a reason', 'is a picture' in pg.inner_text('#toast') and A('__app.S.names.A') == 'low.wav', pg.inner_text('#toast'))
    pg.set_input_files('#file-A', str(TMP / 'notes.txt')); pg.wait_for_timeout(400)
    check('a text file is refused with a reason', 'not a sound' in pg.inner_text('#toast'), pg.inner_text('#toast'))

    # saved files
    pg.wait_for_function('__app.S.lastRender && !__app.busy', timeout=30000)
    name, b = save(pg, 'save-blend'); ok, rate, n = wav_info(b)
    check('save the blend: a 16-bit WAV at the render rate', ok and rate == A('__app.S.audRate') and n == A('__app.S.lastRender.data.length'), (name, rate, n))
    name, b = save(pg, 'save-sweep'); check('save a sweep: one WAV from A to B', wav_info(b)[0] and 'sweep' in name, name)
    name, b = save(pg, 'save-poster'); po = Image.open(io.BytesIO(b)); check('save a poster: 1600 by 900, for sounds', po.size == (1600, 900) and 'sounds' in name, name)
    A('__app.setView("space")'); pg.wait_for_function('__app.spaceReady', timeout=30000)
    check('the atom cloud of the new pair builds', 200 < A('__app.spaceN') <= 340, A('__app.spaceN'))
    name, b = save(pg, 'save-cloud'); head = b[:400].decode('latin1')
    n = int(head.split('element vertex ')[1].split('\n')[0]) if 'element vertex' in head else -1
    check('cloud .ply: a header naming Gabor atoms, and the right length', head.startswith('ply\n') and 'Gabor atoms' in head and len(b) == head.index('end_header\n') + 11 + n * 15, (name, n))
    name, b = save(pg, 'save-splats'); head = b[:900].decode('latin1')
    n = int(head.split('element vertex ')[1].split('\n')[0]); check('splats .ply: 17 floats a splat', len(b) == head.index('end_header\n') + 11 + n * 68, (name, n))
    name, b = save(pg, 'save-atoms'); check('save the atoms: a WAV', wav_info(b)[0], name)
    name, b = save(pg, 'save-stage'); check('a picture of the stage: a PNG', b[:8] == b'\x89PNG\r\n\x1a\n' and 'stage' in name, name)

    # Genopatch
    pg.click('#patch-button'); pg.select_option('#gp-effort', 'fast'); pg.click('#gp-grow')
    pg.wait_for_function("document.getElementById('gp-stat').textContent==='grown'", timeout=90000)
    m = pg.inner_text('#gp-match'); check('Genopatch grows a patch', m.endswith('%') and int(m[:-1]) > 20, m)
    with pg.expect_download() as d: pg.click('#gp-json')
    js = json.loads(Path(d.value.path()).read_text()); check('the patch saves as JSON', js['app'] == 'displacer-genopatch' and len(js['genome']) == 13)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # MIDI and the keys
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
    check('no page or console errors through all of it', not errors, errors[:2])
    check('no network requests after the page loaded', not net, net[:3])

    # flicker: the fastest ways a hand can change the stage
    A("document.querySelector('#builtin-audio').click()"); pg.wait_for_function('__app.S.lastRender && !__app.busy', timeout=30000); pg.wait_for_timeout(800)
    for view, every, label in (('flat', 100, 'slider at five swings a second'), ('flat', 400, 'slider slow enough for each render to land'), ('space', 100, 'slider at five swings a second')):
        A(f'__app.setMethod("ot"); __app.setView("{view}")'); pg.wait_for_function('!__app.busy && (__app.S.view!=="space" || __app.spaceReady)', timeout=30000); pg.wait_for_timeout(1500)
        A(f"window.__scrub=setInterval(()=>__app.setT(__app.S.t>.5?0:1),{every})")
        worst, whole = flash(A('__app.recordLuma(6000)')); A('clearInterval(window.__scrub)')
        check(f'flicker, {view}, {label}: under the WCAG limit', worst <= 0.25 and whole <= 3, f'worst region {worst:.0%}, whole frame {whole}/s')
    A('__app.setT(0.5)'); pg.wait_for_timeout(800)
    A("window.__flip=setInterval(()=>__app.setView(__app.S.view==='space'?'flat':'space'),100)")
    worst, whole = flash(A('__app.recordLuma(6000)')); A('clearInterval(window.__flip)')
    check('flicker, flipping flat and space ten times a second: under the WCAG limit', worst <= 0.25 and whole <= 3, f'worst region {worst:.0%}, whole frame {whole}/s')

    # a phone
    ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pp = ph.new_page(); perr = []; pp.on('pageerror', lambda e: perr.append(str(e)[:200])); pp.on('console', lambda m: perr.append('console: ' + m.text[:200]) if m.type == 'error' else None)
    pp.goto(URL); pp.wait_for_function('window.__app && __app.spaceReady', timeout=30000); pp.wait_for_timeout(800)
    lay = pp.evaluate("({sw:document.documentElement.scrollWidth, dock:document.querySelector('.dock').getBoundingClientRect().right, hud:document.getElementById('t').getBoundingClientRect().width})")
    check('phone: nothing runs off the side', lay['sw'] <= 390 and lay['dock'] <= 390 and lay['hud'] > 120, lay)
    b = pp.evaluate(BOXES); check('phone: the badge clears the header and the dock', not overlaps(b['#method-badge'], b['.brand']) and not overlaps(b['#method-badge'], b['.top-actions']) and b['#method-badge']['bottom'] < b['.dock-wrap']['top'], b)
    check('phone: no page or console errors', not perr, perr[:1])
    ph.close()
    mic = br.new_context(viewport={'width': 1200, 'height': 800}); mic.grant_permissions(['microphone', 'midi'])
    mic.add_init_script("localStorage.setItem('drv.reconnect','true'); window.__gum=0; const g=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); if(g) navigator.mediaDevices.getUserMedia=(...a)=>{window.__gum++;return g(...a);};")
    mp = mic.new_page(); mp.goto(URL); mp.wait_for_function('window.__app && __app.spaceReady', timeout=30000); mp.wait_for_timeout(1500)
    mp.click('#connect-button'); mp.keyboard.press('c'); mp.wait_for_timeout(500)
    check('never opens the microphone, even with reconnect set by another page and permission granted', mp.evaluate('window.__gum') == 0 and mp.evaluate("__app.kit.audio.state") != 'live', (mp.evaluate('window.__gum'), mp.evaluate("__app.kit.audio.state")))
    mic.close()
    rm = br.new_context(viewport={'width': 1200, 'height': 800}, reduced_motion='reduce'); rp = rm.new_page()
    rp.goto(URL); rp.wait_for_function('window.__app && __app.spaceReady', timeout=30000); a0 = rp.evaluate('__app.S.space.phase'); rp.wait_for_timeout(1500)
    check('reduced motion: the cloud holds still', rp.evaluate('__app.S.space.phase') == a0)
    rm.close(); br.close()
srv.shutdown()
bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)} of {len(results)} passed" + (''.join(f"\nFAIL {n}: {d}" for n, _, d in bad)))
sys.exit(1 if bad else 0)
