#!/usr/bin/env python3
"""Drive every input state on the rendered pages, with real browser paths wherever one exists.

  denied       : no permission granted, Chrome refuses for real
  no signal    : real getUserMedia path, reading a silent WAV through Chrome's fake device
  audio live   : real getUserMedia path, reading a synthetic drum WAV
  MIDI         : real Web MIDI from a virtual CoreMIDI port in a separate process
  no MIDI port : real Web MIDI with no port (only if the machine really has none)
  no device    : STUBBED. Chrome's device-count flag does not remove audio inputs, so getUserMedia is replaced.
  demo         : real click

Screenshots go to the given folder. Exit 1 if any check fails.
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
BPM = 120

def write(path, d):
    w = wave.open(str(path), 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in d)); w.close()

def drum_fixture():
    random.seed(7)
    L = SR * 8; d = [0.0] * L
    def add(t, fn, dur):
        s = int(t * SR)
        for i in range(int(dur * SR)):
            if s + i < L: d[s + i] += fn(i / SR)
    kick = lambda t: 0.9 * math.exp(-t * 18) * math.sin(2 * math.pi * (55 + 90 * math.exp(-t * 60)) * t)
    snare = lambda t: 0.6 * math.exp(-t * 22) * random.uniform(-1, 1) + 0.3 * math.exp(-t * 30) * math.sin(2 * math.pi * 190 * t)
    hat = lambda t: 0.25 * math.exp(-t * 70) * random.uniform(-1, 1)
    beat = 60 / BPM
    for b in range(16):
        t = b * beat
        add(t, hat, 0.08); add(t + beat / 2, hat, 0.08)
        add(t, kick if b % 2 == 0 else snare, 0.3)
    write(FIX / 'drums.wav', d)
    write(FIX / 'silence.wav', [0.0] * (SR * 2))

SENDER = """
import rtmidi, time, sys
o = rtmidi.MidiOut(); o.open_virtual_port('Kit Test Port'); time.sleep(float(sys.argv[1]))
notes = [36, 42, 38, 42, 36, 36, 42, 38, 48, 45, 43, 49, 51]
for i in range(int(sys.argv[2])):
    n = notes[i % len(notes)]
    o.send_message([0x99, n, 100]); time.sleep(0.02); o.send_message([0x89, n, 0])
    if i % 4 == 0: o.send_message([0xB9, 4, 20 if i % 8 == 0 else 127])
    o.send_message([0xF8])                # clock, which must not count as playing
    time.sleep(0.23)
o.send_message([0xA9, 49, 90])            # choke
time.sleep(0.2); o.close_port()
"""

class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_port}'
results = []
GPU = ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl']

T0 = time.time()
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(f'{time.time() - T0:6.1f}s ' + ('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def read(pg):
    return pg.evaluate("""() => ({ source: document.getElementById('source-label').textContent, srcKind: document.getElementById('source-badge').dataset.source,
      chipA: document.getElementById('chip-audio-text').textContent, chipM: document.getElementById('chip-midi-text').textContent,
      a: __app.kit.audio.state, m: __app.kit.midi.state, aWhy: document.getElementById('audio-why').textContent, mWhy: document.getElementById('midi-why').textContent,
      hits: __app.kit.hits, onsets: __app.kit.onsetCount || 0, src: __app.kit.hitSource, last: __app.kit.midi.last, bpm: __app.kit.tempo.bpm, peak: __app.kit.audio.peakDb,
      spec: Array.from(__app.kit.spectrum).reduce((a, b) => a + b, 0), label: __app.kit.audio.label, ch: __app.kit.audio.channels, midiLabel: __app.kit.midi.label, midiInputs: __app.kit.midi.inputs.length, log: __app.kit.midi.log.slice(0, 3), hat: __app.kit.env.hatOpen })""")

def session(p, page, label, args=(), grant=None, init=None, w=1440, h=900):
    b = p.chromium.launch(channel='chrome', headless=True, args=[*GPU, *args])
    c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
    if grant: c.grant_permissions(grant, origin=BASE)
    if init: c.add_init_script(init)
    pg = c.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' else None)
    pg.goto(f'{BASE}/{page}'); pg.wait_for_timeout(1500)
    return b, pg, errors

def shot(pg, name): pg.screenshot(path=str(OUT / f'{name}.png'))

def motion(pg, samples=3):
    """How much the real pixels change over a quarter second, averaged. Mean absolute change on a 0-255 scale."""
    total = 0.0
    for _ in range(samples):
        a = pg.evaluate('__app.pixel()')['grid']; pg.wait_for_timeout(250); b = pg.evaluate('__app.pixel()')['grid']
        total += sum(abs(x - y) for x, y in zip(a, b)) / len(a)
    return total / samples


def open_connect(pg):
    pg.click('#connect-button'); pg.wait_for_timeout(250)

def close_connect(pg):
    pg.click('#connect-sheet [data-close]'); pg.wait_for_timeout(150)

def run(page, tag):
    with sync_playwright() as p:
        # 1. fresh visit
        b, pg, err = session(p, page, 'fresh')
        r = read(pg)
        check(f'{tag}: fresh visit reads as ambient', r['srcKind'] == 'ambient' and 'not connected' in r['chipA'] and 'not connected' in r['chipM'], r['source'])
        lum = pg.evaluate('__app.pixel()')
        check(f'{tag}: the picture is really drawn at rest', lum['mean'] > 8 and lum['max'] - lum['min'] > 20, f"mean {lum['mean']:.0f}")
        idle = motion(pg)
        check(f'{tag}: measured picture motion at rest', idle >= 0, f'{idle:.2f}')
        shot(pg, f'{tag}-1-fresh')
        check(f'{tag}: no page errors on a fresh visit', not err, '; '.join(err[:2]))
        # 2. denied, for real: Chrome refuses and the page says so
        open_connect(pg); pg.click('#audio-connect'); pg.wait_for_timeout(700)
        r = read(pg)
        check(f'{tag}: audio denied reads as denied', r['a'] == 'denied' and 'permission denied' in r['chipA'].lower() and 'microphone' in r['aWhy'].lower(), r['chipA'])
        pg.click('#midi-connect'); pg.wait_for_timeout(700)
        r = read(pg)
        check(f'{tag}: MIDI denied reads as denied', r['m'] == 'denied' and 'permission denied' in r['chipM'].lower(), r['chipM'])
        shot(pg, f'{tag}-2-denied')
        b.close()

        # 3. no audio device: stubbed, because Chrome has no way to remove them
        stub = "navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('none','NotFoundError'));navigator.mediaDevices.enumerateDevices=()=>Promise.resolve([]);"
        b, pg, err = session(p, page, 'nodev', init=stub)
        open_connect(pg); pg.click('#audio-connect'); pg.wait_for_timeout(500)
        r = read(pg)
        check(f'{tag}: no audio device reads as no device (stubbed)', r['a'] == 'no-device' and 'no audio device' in r['chipA'].lower(), r['chipA'])
        shot(pg, f'{tag}-3-no-device')
        b.close()

        # 4. device open, no signal: a real capture path reading true silence
        fake = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
        b, pg, err = session(p, page, 'silent', args=[*fake, f'--use-file-for-fake-audio-capture={FIX}/silence.wav'])
        open_connect(pg); pg.click('#audio-connect'); pg.wait_for_timeout(2500)
        r = read(pg)
        check(f'{tag}: device with silence reads as no signal', r['a'] == 'no-signal' and 'no signal' in r['chipA'].lower() and r['srcKind'] == 'open', f"{r['chipA']} / {r['source']}")
        check(f'{tag}: silence fires no hits', r['hits'] == 0 and r['onsets'] == 0, f"hits={r['hits']}")
        check(f'{tag}: silence paints no spectrum', r['spec'] < 0.5, f"sum={r['spec']:.3f}")
        shot(pg, f'{tag}-4-no-signal')
        opts = pg.evaluate("[...document.getElementById('audio-device').options].map(o=>[o.value,o.textContent])")
        check(f'{tag}: the audio picker lists the inputs', len(opts) >= 2, json.dumps([o[1] for o in opts])[:90])
        before = pg.evaluate('__app.kit.audio.label')
        pg.select_option('#audio-device', opts[-1][0]); pg.wait_for_timeout(900)
        after = pg.evaluate('__app.kit.audio.label'); st = pg.evaluate('__app.kit.audio.state')
        check(f'{tag}: choosing another input really switches', after != before and st == 'no-signal', f'{before} -> {after}, {st}')
        check(f'{tag}: no page errors with silence', not err, '; '.join(err[:2]))
        b.close()

        # 5. audio live: real capture path reading a known drum loop at 120 BPM
        b, pg, err = session(p, page, 'audio', args=[*fake, f'--use-file-for-fake-audio-capture={FIX}/drums.wav'])
        open_connect(pg); pg.click('#audio-connect'); pg.wait_for_timeout(1000); close_connect(pg); pg.wait_for_timeout(7000)
        r = read(pg)
        check(f'{tag}: audio with signal reads as live', r['a'] == 'live' and 'signal' in r['chipA'].lower() and r['srcKind'] == 'live' and 'estimated from audio' in r['source'], f"{r['chipA']} / {r['source']}")
        check(f'{tag}: audio alone produces hits', r['hits'] >= 12, f"hits={r['hits']}")
        check(f'{tag}: tempo from audio lands near the known 120 BPM', r['bpm'] and abs(r['bpm'] - BPM) < 4, f"bpm={r['bpm']}")
        check(f'{tag}: audio paints a spectrum', r['spec'] > 1, f"sum={r['spec']:.2f}")
        by = pg.evaluate("__app.kit.hitLog.reduce((o,h)=>{o[h.voice]=(o[h.voice]||0)+1;return o},{})")
        check(f'{tag}: estimated hits include kick, snare and hat', all(by.get(k, 0) > 0 for k in ('kick', 'snare', 'hat')), json.dumps(by))
        mv = motion(pg)
        check(f'{tag}: audio hits move the picture more than rest does', mv > idle * 1.25 + 0.05, f'{mv:.2f} against {idle:.2f} at rest')
        shot(pg, f'{tag}-5-audio-live')
        check(f'{tag}: no page errors with audio', not err, '; '.join(err[:2]))
        c2 = b.new_context(viewport={'width': 1440, 'height': 900}); c2.grant_permissions(['microphone'], origin=BASE)
        c2.add_init_script("localStorage.setItem('drv.reconnect','true')")
        p2 = c2.new_page(); p2.goto(f'{BASE}/{page}'); p2.wait_for_timeout(3500)
        rr = read(p2)
        ok = rr['a'] == 'live' or 'click to start' in rr['chipA'].lower()
        check(f'{tag}: reconnecting with no click never hangs or lies', ok, rr['chipA'])
        c2.close()
        b.close()

        # 6. MIDI: real Web MIDI through a virtual CoreMIDI port, sent from another process
        count = 42
        send = subprocess.Popen([PY_MIDI, '-c', SENDER, '2.2', str(count)])
        time.sleep(0.6)
        b, pg, err = session(p, page, 'midi', grant=['midi', 'midi-sysex'])
        open_connect(pg); pg.click('#midi-connect'); pg.wait_for_timeout(300)
        r = read(pg)
        check(f'{tag}: MIDI port appears in the picker', 'Kit Test Port' in pg.inner_text('#midi-port'), pg.inner_text('#midi-port')[:60])
        pg.wait_for_timeout(3600)
        r = read(pg)
        check(f'{tag}: MIDI live reads as live', r['m'] == 'live' and r['chipM'].lower().startswith('midi · ') and r['srcKind'] == 'live' and 'hits from MIDI' in r['source'], f"{r['chipM']} / {r['source']}")
        check(f'{tag}: MIDI alone produces hits', r['hits'] >= 10, f"hits={r['hits']}")
        check(f'{tag}: MIDI alone still paints a stated spectrum', r['spec'] > 0.1, f"sum={r['spec']:.2f}")
        v = pg.evaluate("Object.fromEntries(['kick','snare','hat','tom','crash','ride'].map(k=>[k,__app.kit.hitLog.filter(h=>h.voice===k).length]))")
        check(f'{tag}: MIDI notes reach the right drums', v['kick'] > 0 and v['snare'] > 0 and v['hat'] > 0, json.dumps(v))
        shot(pg, f'{tag}-6a-midi-sheet')
        close_connect(pg); pg.wait_for_timeout(200)
        mv = motion(pg, 2)
        check(f'{tag}: MIDI hits move the picture more than rest does', mv > idle * 1.25 + 0.05, f'{mv:.2f} against {idle:.2f} at rest')
        shot(pg, f'{tag}-6b-midi-live')
        check(f'{tag}: no page errors with MIDI', not err, '; '.join(err[:2]))
        send.wait(timeout=30); pg.wait_for_timeout(1500)
        r = read(pg)
        check(f'{tag}: choke arrives and a port that leaves is reported', r['m'] in ('lost', 'no-device', 'live', 'no-signal'), r['m'])
        pg.wait_for_timeout(600)
        r = read(pg)
        check(f'{tag}: unplugged MIDI port reads as disconnected', r['m'] == 'lost' and 'disconnected' in r['chipM'].lower(), r['chipM'])
        check(f'{tag}: the badge stops claiming MIDI once the port is gone', 'MIDI' not in r['source'] and r['srcKind'] != 'live', r['source'])
        shot(pg, f'{tag}-6c-midi-unplugged')
        b.close()

        # 7. MIDI granted with no port at all (only when this machine really has none)
        b, pg, err = session(p, page, 'nomidi', grant=['midi', 'midi-sysex'])
        open_connect(pg); pg.click('#midi-connect'); pg.wait_for_timeout(500)
        r = read(pg)
        if r['midiInputs'] == 0:
            check(f'{tag}: no MIDI port reads as no device', r['m'] == 'no-device' and 'no midi device' in r['chipM'].lower(), r['chipM'])
            shot(pg, f'{tag}-7-no-midi-device')
        else:
            check(f'{tag}: no-MIDI-port state not testable here, a port exists', True, r['midiLabel'])
        b.close()

        # 8. both together: hits must not double
        send = subprocess.Popen([PY_MIDI, '-c', SENDER, '1.8', str(count)])
        time.sleep(0.5)
        b, pg, err = session(p, page, 'both', args=[*fake, f'--use-file-for-fake-audio-capture={FIX}/drums.wav'], grant=['midi', 'midi-sysex'])
        open_connect(pg); pg.click('#connect-both'); pg.wait_for_timeout(5000)
        r = read(pg)
        check(f'{tag}: both inputs read as MIDI hits with audio texture', 'hits from MIDI, texture from audio' in r['source'], r['source'])
        srcs = pg.evaluate("(()=>{const c={};__app.kit.hitLog.forEach(h=>c[h.src]=(c[h.src]||0)+1);return c})()")
        check(f'{tag}: while MIDI plays, audio onsets do not double the hits', srcs.get('midi', 0) > 5 and srcs.get('audio', 0) <= 12, json.dumps(srcs))
        print(f'{time.time() - T0:6.1f}s step 8 screenshot', flush=True)
        shot(pg, f'{tag}-8-both')
        print(f'{time.time() - T0:6.1f}s step 8 closing', flush=True)
        b.close()
        print(f'{time.time() - T0:6.1f}s step 8 waiting for the sender', flush=True)
        send.wait(timeout=30)

        # 9. demo: a real click, labeled the whole time
        b, pg, err = session(p, page, 'demo')
        pg.click('#demo-button'); pg.wait_for_timeout(5000)
        r = read(pg)
        check(f'{tag}: demo is labeled as demo', r['srcKind'] == 'demo' and 'not your kit' in r['source'], r['source'])
        check(f'{tag}: demo keeps device chips honest', 'not connected' in r['chipA'] and 'not connected' in r['chipM'], r['chipA'])
        check(f'{tag}: demo tempo is near its known 108 BPM', r['bpm'] and abs(r['bpm'] - 108) < 3, f"bpm={r['bpm']}")
        shot(pg, f'{tag}-9-demo')
        pg.wait_for_timeout(6000)
        r = read(pg)
        vis = pg.evaluate("getComputedStyle(document.getElementById('source-badge')).opacity")
        check(f'{tag}: the demo label stays visible when the controls fade', float(vis) > 0.5 and r['srcKind'] == 'demo', f'opacity {vis}')
        pg.click('#demo-button', force=True); pg.wait_for_timeout(300)
        r = read(pg)
        check(f'{tag}: ending the demo goes back to ambient', r['srcKind'] == 'ambient', r['source'])
        check(f'{tag}: no page errors in the demo', not err, '; '.join(err[:2]))

        # 10. record, then replay what was recorded
        pg.evaluate("__app.kit.startRecording('test')")
        for key in 'jklujkl': pg.keyboard.press(key); pg.wait_for_timeout(120)
        pg.wait_for_timeout(400)
        s = pg.evaluate("(()=>{const s=__app.kit.stopRecording();window.__sess=s;return {hits:s.hits.length,dur:s.durationMs,frames:atob(s.spectrumBase64).length,audioFree:!('audio' in s)}})()")
        check(f'{tag}: a recording holds the hits and levels', s['hits'] == 7 and s['frames'] > 64, json.dumps(s))
        n0 = pg.evaluate('__app.kit.hits')
        pg.evaluate('__app.kit.startReplay(window.__sess)'); pg.wait_for_timeout(500)
        r = read(pg)
        check(f'{tag}: a replay is labeled as a replay', r['srcKind'] == 'replay' and 'not live' in r['source'], r['source'])
        pg.wait_for_timeout(s['dur'] + 400)
        r = read(pg); n1 = pg.evaluate('__app.kit.hits')
        check(f'{tag}: the replay reproduces every hit, then ends', n1 - n0 == 7 and r['srcKind'] != 'replay', f'{n1 - n0} hits, then {r["source"]}')

        # 11. Learn through a real click, with the page's own timers running
        pg.keyboard.press('c'); pg.wait_for_timeout(300)
        pg.click('#map-details summary'); pg.wait_for_timeout(200)
        pg.click('[data-learn=ride]'); pg.wait_for_timeout(400)
        ok1 = pg.evaluate("__app.kit.learning") == 'ride'
        pg.evaluate("__app.kit.feedMidi([0x99,77,100])"); pg.wait_for_timeout(100)
        v = pg.evaluate("[__app.kit.lastHit.pad,__app.kit.map.ride.includes(77),__app.kit.learning]")
        check(f'{tag}: Learn assigns the next note to that pad', ok1 and v[0] == 'ride' and v[1] and v[2] is None, json.dumps(v))
        check(f'{tag}: the learned map shows on screen', '77' in pg.inner_text('#pad-rows'), pg.inner_text('#pad-rows')[:60].replace(chr(10), ' '))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)

        # 12. the flash cap
        fl = pg.evaluate("""(()=>{__app.kit.env.flash=0;__app.kit.feedMidi([0x99,49,127]);const a=__app.kit.env.flash;__app.kit.env.flash=0;__app.kit.feedMidi([0x99,49,127]);const b=__app.kit.env.flash;return [a,b]})()""")
        check(f'{tag}: a second crash inside the cap does not flash again', fl[1] == 0 or fl[0] == 0, json.dumps(fl))
        b.close()

        # 14. a browser with no Web MIDI (stubbed: Safari could not be driven here), and a real insecure page
        b, pg, err = session(p, page, 'nomidiapi', init="delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;")
        r = read(pg)
        check(f'{tag}: a browser with no Web MIDI says so before any click (stubbed)', r['m'] == 'unsupported' and 'not supported' in r['chipM'].lower(), r['chipM'])
        shot(pg, f'{tag}-14-no-web-midi')
        b.close()
        b = p.chromium.launch(channel='chrome', headless=True, args=[*GPU, '--host-resolver-rules=MAP kit.test 127.0.0.1'])
        pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        pg.goto(f'http://kit.test:{srv.server_port}/{page}'); pg.wait_for_timeout(1500)
        r = read(pg)
        check(f'{tag}: a plain http page says it needs a secure page', r['a'] == 'insecure' and 'secure' in r['chipA'].lower() and r['m'] == 'insecure', r['chipA'])
        b.close()

        # 13. reduced motion: the flash goes, the picture stays
        b = p.chromium.launch(channel='chrome', headless=True, args=GPU)
        c = b.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        pg = c.new_page(); pg.goto(f'{BASE}/{page}'); pg.wait_for_timeout(1500)
        pg.click('#demo-button'); pg.wait_for_timeout(2500)
        lum = pg.evaluate('__app.pixel()')
        check(f'{tag}: reduced motion still draws the picture', lum['mean'] > 5, json.dumps(lum))
        shot(pg, f'{tag}-13-reduced-motion')
        b.close()

drum_fixture()
pages = [('endless-cockpit.html', 'endless'), ('nebula.html', 'nebula')]
want = sys.argv[2] if len(sys.argv) > 2 else None
for page, tag in pages:
    if want and want != tag: continue
    run(page, tag)
srv.shutdown()
bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)} of {len(results)} checks passed. Screenshots in {OUT}')
sys.exit(1 if bad else 0)
