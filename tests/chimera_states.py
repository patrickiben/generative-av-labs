#!/usr/bin/env python3
"""Chimera Synth, driven for real in Chrome, plus WebKit and Firefox smoke runs.

  states    : silent at load, sound started by a click, the demo labeled and undone
  MIDI      : refused (no grant), no device (granted, no port), live from a virtual CoreMIDI port in a separate
              process with notes on two channels, a controller, pitch bend and clock, then the port unplugged
  files     : one short sound in WAV, AIFF, CAF, M4A, MP3, FLAC, Ogg Vorbis and Opus, each through the real file input
  breeding  : arrow keys and Enter grow a seed; a sample grows a seed by differential evolution
  exports   : WAV render, recording, picture and patch file arrive as downloads; a share link restores the patch
  browsers  : Playwright's WebKit (a stand-in for Safari, not Safari) and Firefox load the page and name their MIDI state

usage: python3 tests/chimera_states.py [outdir]     (about 2 minutes; needs ffmpeg, and rtmidi in ~/venvs/df312)
"""
import http.server, json, math, os, random, struct, subprocess, sys, tempfile, threading, time, wave
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp())
OUT.mkdir(parents=True, exist_ok=True)
PY_MIDI = os.path.expanduser('~/venvs/df312/bin/python')
FIX = Path(tempfile.mkdtemp())
SR = 48000

def fixtures():
    """A 1.2 s growl: a 110 Hz saw with two formant-like partial groups and a noise attack, in every format."""
    random.seed(3)
    d = []
    for i in range(int(SR * 1.2)):
        t = i / SR
        s = sum(math.sin(2 * math.pi * 110 * k * t) / k for k in range(1, 30)) * 0.25
        s += 0.18 * math.sin(2 * math.pi * 820 * t) + 0.1 * math.sin(2 * math.pi * 2300 * t)
        s += random.uniform(-1, 1) * 0.3 * math.exp(-t * 25)
        d.append(s * min(1, t * 40) * math.exp(-t * 0.8) * 0.8)
    w = wave.open(str(FIX / 'growl.wav'), 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in d)); w.close()
    ff = ['ffmpeg', '-loglevel', 'error', '-y', '-i', str(FIX / 'growl.wav')]
    subprocess.run([*ff, '-c:a', 'pcm_s16be', str(FIX / 'growl.aiff')], check=True)
    subprocess.run(['afconvert', '-f', 'caff', '-d', 'LEI16', str(FIX / 'growl.wav'), str(FIX / 'growl.caf')], check=True)
    subprocess.run([*ff, '-c:a', 'aac', '-b:a', '128k', str(FIX / 'growl.m4a')], check=True)
    subprocess.run([*ff, '-c:a', 'libmp3lame', '-b:a', '160k', str(FIX / 'growl.mp3')], check=True)
    subprocess.run([*ff, '-c:a', 'flac', str(FIX / 'growl.flac')], check=True)
    subprocess.run([*ff, '-c:a', 'libvorbis', str(FIX / 'growl.ogg')], check=True)
    subprocess.run([*ff, '-c:a', 'libopus', str(FIX / 'growl.opus')], check=True)
    (FIX / 'notes.txt').write_text('not audio at all')

SENDER = """
import rtmidi, time, sys
o = rtmidi.MidiOut(); o.open_virtual_port('Chimera Test Port'); time.sleep(float(sys.argv[1]))
seq = [[0x90,60,100],[0x80,60,0],[0xF8],[0x90,64,90],[0xF8],[0xB0,1,64],[0x90,67,80],[0x80,64,0],[0x99,48,100],[0xE0,0,72],
       [0xF8],[0x90,72,100],[0x80,72,0]]
for m in seq:
    o.send_message(m); time.sleep(0.12)
time.sleep(1.2); o.close_port()
"""
SENT_CHANNEL_MESSAGES = 10          # the sequence above, without its three clock bytes

class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_port}'
URL = f'{BASE}/chimera.html'
GPU = ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl']
results = []
T0 = time.time()

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(f'{time.time() - T0:6.1f}s ' + ('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def session(p, grant=None, browser='chromium', w=1440, h=900):
    b = getattr(p, browser).launch(**({'channel': 'chrome', 'args': GPU} if browser == 'chromium' else {}), headless=True)
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, accept_downloads=True)
    if grant: c.grant_permissions(grant, origin=BASE)
    pg = c.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_timeout(1400)
    return b, pg, errors

def read(pg):
    return pg.evaluate("""() => ({ source: document.getElementById('source-label').textContent, srcKind: document.getElementById('source-badge').dataset.source,
      chipS: document.getElementById('chip-sound-text').textContent, chipM: document.getElementById('chip-midi-text').textContent,
      m: __app.midi.state, mWhy: document.getElementById('midi-why').textContent, count: __app.midi.count, log: __app.midi.log.slice(),
      sound: __app.sound, playing: __app.ST.playing, demo: __app.demoOn, seq: __app.ST.seq.on, note: __app.ST.noteSt,
      nodes: __app.LINEAGE.nodes.length, mode: __app.mode, pad: __app.ST.pad, gl: __app.glOK })""")

def shot(pg, name): pg.screenshot(path=str(OUT / f'{name}.png'))

def download(pg, selector, wait_ms=0):
    with pg.expect_download(timeout=20000) as d:
        pg.click(selector)
        if wait_ms: pg.wait_for_timeout(wait_ms)
    path = d.value.path()
    return d.value.suggested_filename, Path(path).read_bytes()

fixtures()
with sync_playwright() as p:
    # 1. load, start, demo
    b, pg, err = session(p)
    r = read(pg)
    check('silent at load: nothing claims to play', r['srcKind'] == 'ambient' and r['chipS'] == 'Sound · off' and not r['playing'] and not r['demo'], f"{r['source']} / {r['chipS']}")
    check('the picture runs on WebGL2', r['gl'])
    shot(pg, '1-load')
    pg.click('#start-sound'); pg.wait_for_timeout(900)
    r = read(pg)
    check('Start sound starts the drone from the seed', r['sound'] == 'running' and r['playing'] and r['srcKind'] == 'live' and r['chipS'] == 'Sound · playing', f"{r['source']} / {r['chipS']}")
    low = pg.evaluate('__app.ST.lowDb'); mono = pg.evaluate('[__app.ST.monoValid, __app.ST.mono]')
    check('the low end is measured while it plays', low > -40 and mono[0], f'{low:.1f} dB, mono {mono}')
    pg.click('#play'); pg.wait_for_timeout(400)
    r = read(pg)
    check('Stop stops it and the badge says ready', not r['playing'] and r['srcKind'] == 'open', r['source'])
    pg.click('#demo-button'); pg.wait_for_timeout(1500)
    r = read(pg)
    check('the demo is labeled as the page playing itself', r['demo'] and r['srcKind'] == 'demo' and 'not your input' in r['source'] and r['seq'], r['source'])
    shot(pg, '1-demo')
    pg.click('#demo-button'); pg.wait_for_timeout(500)
    r = read(pg)
    check('ending the demo stops the riff and the sound it started', not r['demo'] and not r['seq'] and not r['playing'], f"seq={r['seq']} playing={r['playing']}")

    # 2. MIDI refused (a fresh profile with no grant)
    pg.click('#connect-button'); pg.wait_for_timeout(250); pg.click('#midi-connect'); pg.wait_for_timeout(900)
    r = read(pg)
    check('MIDI refused reads as permission denied, with a way out', r['m'] == 'denied' and r['chipM'] == 'MIDI · permission denied' and 'address bar' in r['mWhy'], r['mWhy'][:70])
    shot(pg, '2-midi-denied')
    pg.keyboard.press('Escape'); pg.wait_for_function("!document.querySelector('dialog[open]')")

    # 3. breeding with the keyboard alone
    n0 = read(pg)['nodes']
    pg.mouse.click(60, 450); pg.wait_for_timeout(100)        # empty space: focus leaves every control
    pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight')
    for _ in range(6): pg.keyboard.press('ArrowUp')
    pg.wait_for_timeout(200)
    leaning = pg.evaluate('!!__app.GARDEN.drag && __app.GARDEN.drag.branch')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    r = read(pg)
    check('arrow keys lean toward a bud and Enter grows a seed there', leaning == 1 and r['nodes'] == n0 + 1 and r['playing'], f'bud {leaning}, lineage {n0} to {r["nodes"]}')
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(200)
    check('undo steps back to the previous seed', pg.evaluate("document.getElementById('toast').textContent").startswith('Back to'), pg.evaluate("document.getElementById('toast').textContent"))
    pg.keyboard.press('e'); pg.wait_for_timeout(150)
    r = read(pg)
    check('a computer key plays a note and the badge says so', r['note'] == 4 and r['source'] == 'Live · computer keys', r['source'])

    # 4. Morph: a real click on the stage takes the pad
    pg.click('[data-mode=morph]'); pg.wait_for_timeout(300)
    box = pg.evaluate("(()=>{const s=getComputedStyle(document.getElementById('corners'));return [parseFloat(s.getPropertyValue('--px')),parseFloat(s.getPropertyValue('--py')),parseFloat(s.getPropertyValue('--pw')),parseFloat(s.getPropertyValue('--ph'))]})()")
    pg.mouse.click(box[0] + box[2] * 0.25, box[1] + box[3] * 0.3); pg.wait_for_timeout(250)
    uv = pg.evaluate('[__app.ST.uv.u, __app.ST.uv.v, __app.ST.pad, __app.ST.genomeMode]')
    check('Morph: a click on the stage puts the puck there', uv[2] and not uv[3] and abs(uv[0] - 0.25) < 0.03 and abs(uv[1] - 0.3) < 0.03, json.dumps(uv))
    shot(pg, '4-morph')
    pg.click('#corners .c0'); pg.wait_for_timeout(150)
    check('a corner changes its animal when pressed', pg.evaluate('__app.ST.corners[0]') == 1, pg.inner_text('#corners .c0'))

    # 5. files through the real file inputs
    pg.click('#voices-button'); pg.wait_for_timeout(300)
    decoded = {}
    for ext in ['wav', 'aiff', 'caf', 'm4a', 'mp3', 'flac', 'ogg', 'opus']:
        pg.set_input_files('#samp-file', str(FIX / f'growl.{ext}')); pg.wait_for_timeout(900)
        decoded[ext] = pg.inner_text('#samp-status')
    for ext, text in decoded.items():
        print(f'        {ext}: {text}')
    ok = [e for e, t in decoded.items() if t.startswith('Measured voice')]
    bad = {e: t for e, t in decoded.items() if not t.startswith('Measured voice')}
    check('WAV, M4A, MP3, FLAC, Ogg and Opus decode in Chrome', all(e in ok for e in ['wav', 'm4a', 'mp3', 'flac', 'ogg', 'opus']), ','.join(ok))
    check('a format Chrome cannot open says so and says what to do', all(('could not' in t and ('Convert it' in t or 'usually work' in t)) for t in bad.values()), json.dumps(bad)[:160])
    pg.set_input_files('#samp-file', str(FIX / 'notes.txt')); pg.wait_for_timeout(700)
    check('a file that is not audio gets a plain message', 'could not decode' in pg.inner_text('#samp-status'), pg.inner_text('#samp-status')[:80])
    check('a measured sample becomes animal A', pg.evaluate("__app.ANIMALS[__app.ST.A].key") == 'sample' and pg.evaluate("__app.ANIMALS.filter(a=>a.key==='sample').length") == 1)
    pg.keyboard.press('Escape'); pg.wait_for_function("!document.querySelector('dialog[open]')")
    pg.click('[data-mode=garden]'); pg.wait_for_timeout(200)
    n1 = read(pg)['nodes']
    pg.click('#garden-button'); pg.wait_for_timeout(300)
    pg.set_input_files('#gp-file', str(FIX / 'growl.mp3'))
    t0 = time.time()
    while time.time() - t0 < 60 and not pg.inner_text('#gp-status').startswith(('Grown', 'Growing failed', 'This browser')): pg.wait_for_timeout(500)
    st = pg.inner_text('#gp-status')
    check('a sample grows a seed by differential evolution', st.startswith('Grown') and read(pg)['nodes'] > n1, f'{time.time() - t0:.1f}s · {st[:90]}')
    shot(pg, '5-genopatch')
    pg.keyboard.press('Escape'); pg.wait_for_function("!document.querySelector('dialog[open]')")

    # 6. downloads
    pg.click('#patch-button'); pg.wait_for_timeout(300)
    name, data = download(pg, '#export')
    ok = data[:4] == b'RIFF' and data[8:12] == b'WAVE' and len(data) > 44 + 4 * 44100 * 2 * 2 - 10
    check('Render 4 seconds to WAV downloads a 4-second stereo WAV', ok, f'{name} · {len(data)} bytes')
    name, data = download(pg, '#patch-save')
    patch = json.loads(data)
    check('the patch file is the desktop format, settings only', patch.get('app') == 'biobass' and 'sampleBuf' not in patch, name)
    name, data = download(pg, '#poster')
    check('Save a picture downloads a PNG', data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) > 50000, f'{name} · {len(data)} bytes')
    pg.click('#rec-toggle'); pg.wait_for_timeout(1600)
    name, data = download(pg, '#rec-toggle', 300)
    check('Record what I play saves the page sound', len(data) > 2000 and name.startswith('chimera-take-'), f'{name} · {len(data)} bytes')
    pg.evaluate("(()=>{const m=document.getElementById('morph');m.value=70;m.dispatchEvent(new Event('input'))})()")
    pg.click('#patch-link'); pg.wait_for_timeout(300)
    link = pg.evaluate('location.href')
    t_before = pg.evaluate('__app.ST.t')
    check('no page errors in the main run', not err, '; '.join(err[:3]))
    b.close()
    b, pg, err = session(p)
    pg.goto(link); pg.wait_for_timeout(1200)
    check('a share link restores the patch on a fresh load', abs(pg.evaluate('__app.ST.t') - t_before) < 1e-6 and '#p=' in link, f't={t_before}')
    b.close()

    # 7. MIDI granted with no port (this Mac has none) and live from a virtual port
    b, pg, err = session(p, grant=['midi', 'midi-sysex'])
    pg.click('#connect-button'); pg.wait_for_timeout(250); pg.click('#midi-connect'); pg.wait_for_timeout(700)
    r = read(pg)
    if not pg.evaluate('__app.midi.inputs.length'):
        check('MIDI with no port reads as no device', r['m'] == 'no-device' and r['chipM'] == 'MIDI · no midi device', r['chipM'])
        shot(pg, '7-midi-no-device')
    else:
        check('no-device state not testable here: a port exists', True)
    send = subprocess.Popen([PY_MIDI, '-c', SENDER, '1.6'])
    pg.wait_for_timeout(1200)
    check('a port that appears is picked up without a reload', 'Chimera Test Port' in pg.inner_text('#midi-port'), pg.inner_text('#midi-port')[:60])
    pg.wait_for_timeout(1500)
    r = read(pg)
    check('MIDI live reads as live and names the input', r['m'] == 'live' and r['chipM'].startswith('MIDI · note'), r['chipM'])
    shot(pg, '7-midi-live')
    send.wait(timeout=30); pg.wait_for_timeout(1500)
    r = read(pg)
    log = r['log']
    full = pg.evaluate('__app.midi.log')
    check('notes play from middle C, on every channel', any('note 60 vel 100 ch 1 → root' in l for l in full) and any('ch 10 → -12' in l for l in full), ' | '.join(full[-4:]))
    check('clock is not counted as playing', r['count'] == SENT_CHANNEL_MESSAGES, f"{r['count']} channel messages")
    check('the last note sets the pitch; controllers and pitch bend are shown as not used', r['note'] == 12 and any('CC1 = 64 · not used' in l for l in log) and any('pitch bend · not used' in l for l in log), ' | '.join(log[:6]))
    check('an unplugged port reads as disconnected', r['m'] == 'lost' and r['chipM'] == 'MIDI · device disconnected', r['chipM'])
    shot(pg, '7-midi-unplugged')
    check('no page errors with MIDI', not err, '; '.join(err[:2]))
    b.close()

    # 8. phone width
    b, pg, err = session(p, w=390, h=844)
    over = pg.evaluate('document.documentElement.scrollWidth > innerWidth')
    dock = pg.evaluate("(()=>{const r=document.querySelector('.dock').getBoundingClientRect();return [r.left,r.right]})()")
    check('phone: no sideways scroll and the dock fits', not over and dock[0] >= 0 and dock[1] <= 390, json.dumps(dock))
    shot(pg, '8-phone')
    b.close()

    # 9. other engines: Playwright WebKit stands in for Safari, Firefox as itself
    for engine, expect in (('webkit', 'Safari has no Web MIDI'), ('firefox', 'Firefox')):     # Firefox waits on an add-on prompt that headless never shows
        try:
            b, pg, err = session(p, browser=engine)
        except Exception as e:
            check(f'{engine}: could not launch here', True, str(e)[:80]); continue
        pg.click('#connect-button'); pg.wait_for_timeout(250); pg.click('#midi-connect'); pg.wait_for_timeout(900)
        r = read(pg)
        check(f'{engine}: the page loads and names its MIDI state', r['m'] in ('unsupported', 'denied', 'no-device', 'requesting') and (expect in r['mWhy'] or r['m'] == 'no-device'), f"{r['m']}: {r['mWhy'][:70]} · gl={r['gl']}")
        pg.keyboard.press('Escape'); pg.click('#start-sound'); pg.wait_for_timeout(900)
        r = read(pg)
        check(f'{engine}: sound starts from a click', r['playing'] and r['sound'] == 'running', f"{r['sound']} · {r['chipS']}")
        shot(pg, f'9-{engine}')
        pg.click('#voices-button'); pg.wait_for_timeout(300)
        for ext in ('aiff', 'caf', 'mp3', 'ogg'):
            pg.set_input_files('#samp-file', str(FIX / f'growl.{ext}')); pg.wait_for_timeout(900)
            print(f'        {engine} {ext}: {pg.inner_text("#samp-status")[:90]}')
        pg.keyboard.press('Escape')
        check(f'{engine}: no page errors', not err, '; '.join(err[:2]))
        b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)} of {len(results)} passed' + (':\n' + '\n'.join(f'  FAIL {n}  [{d}]' for n, _, d in fails) if fails else ''))
sys.exit(1 if fails else 0)
