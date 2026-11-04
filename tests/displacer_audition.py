#!/usr/bin/env python3
"""Live blend audition: actual Web Audio starts, playhead continuity, and delayed-worker races."""
import http.server
import json
import math
from pathlib import Path
import struct
import tempfile
import threading
import wave
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_port}/displacer.html?view=flat'
checks = []

def check(name, condition, detail=None):
    checks.append(bool(condition))
    print(f"{'PASS' if condition else 'FAIL'} {name}" + (f' · {detail}' if detail else ''), flush=True)


try:
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        browser = p.chromium.launch(channel='chrome', args=['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'])
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        # Slow only audio worker requests, while keeping the real DSP, Web Audio nodes and UI.
        page.add_init_script('''
          window.__audioDelay = 0; window.__audioStarts = [];
          const OriginalWorker = window.Worker;
          window.Worker = class extends OriginalWorker {
            postMessage(message, transfer) {
              if (message.type === 'audio' && window.__audioDelay) {
                const copy = structuredClone(message), delay = window.__audioDelay;
                setTimeout(() => super.postMessage(copy, transfer), delay);
              } else super.postMessage(message, transfer);
            }
          };
          const start = AudioBufferSourceNode.prototype.start;
          AudioBufferSourceNode.prototype.start = function(when = 0, offset = 0) {
            const data = this.buffer.getChannelData(0);
            window.__audioStarts.push({when, offset, duration: this.buffer.duration,
              probe: Array.from(data.slice(2000, 2010))});
            return start.apply(this, arguments);
          };
        ''')
        page.goto(url)
        page.wait_for_function('window.__app && __app.S.lastRender && !__app.busy', timeout=60000)
        page.click('#hear')
        page.wait_for_function('__app.audition.playing')
        page.wait_for_timeout(250)
        before = page.evaluate('__app.audition.position')
        page.evaluate('__app.setT(.8)')
        page.wait_for_function('__app.audition.t === .8', timeout=15000)
        state = page.evaluate('({a:__app.audition, starts:__audioStarts, probe:Array.from(__app.S.lastRender.data.slice(2000,2010))})')
        check('slider changes the actual playing buffer', len(state['starts']) == 2 and state['starts'][-1]['probe'] == state['probe'])
        check('new buffer starts at the existing playhead', state['starts'][-1]['offset'] >= before and state['starts'][-1]['offset'] < 2, state['starts'][-1]['offset'])
        check('button identifies the blend actually heard', '0.80' in page.inner_text('#hear'))

        # Superseded render must not overwrite the requested blend or enter the sound path.
        page.evaluate('''window.__audioDelay=550; window.__rendered=[];
          window.__watch=setInterval(()=>{if(__app.S.lastRender) __rendered.push(__app.S.lastRender.t)},10);
          __app.setT(.2); void __app.currentRender();''')
        page.wait_for_timeout(60)
        page.evaluate('__app.setT(.7); void __app.currentRender()')
        page.wait_for_function('__app.S.lastRender.t === .7 && __app.audition.t === .7', timeout=15000)
        check('superseded worker result never appears', page.evaluate('!__rendered.includes(.2)'))
        page.evaluate('clearInterval(__watch)')

        # Stop while another render is pending: its completion must remain silent.
        page.evaluate('__app.setT(.1); void __app.currentRender()')
        page.click('#hear')
        starts = page.evaluate('__audioStarts.length')
        page.wait_for_function('__app.S.lastRender.t === .1', timeout=15000)
        check('Stop prevents a pending render from restarting sound', page.evaluate('!__app.audition.playing') and page.evaluate('__audioStarts.length') == starts)

        page.evaluate('__app.setT(.9)')
        page.click('#hear')
        page.wait_for_function('__app.audition.pending')
        page.click('#hear')
        page.wait_for_function('__app.S.lastRender.t === .9', timeout=15000)
        check('a pending Hear can be canceled', page.evaluate('!__app.audition.playing && !__app.audition.pending') and page.evaluate('__audioStarts.length') == starts)

        page.evaluate('window.__audioDelay=1400')
        page.click('#hear')
        page.wait_for_function('__app.audition.playing')
        page.wait_for_function('__app.audition.position > 2.3')
        page.evaluate('__app.setT(.4); void __app.currentRender()')
        starts = page.evaluate('__audioStarts.length')
        page.wait_for_function('__app.S.lastRender.t === .4', timeout=15000)
        check('natural end stays ended when a late render arrives', page.evaluate('!__app.audition.playing') and page.evaluate('__audioStarts.length') == starts)

        own = Path(tmp) / 'new-source.wav'
        with wave.open(str(own), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
            w.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * 523.25 * i / 44100))) for i in range(44100 * 3)))
        page.evaluate('window.__audioDelay=500; __app.setT(.3); void __app.currentRender()')
        old_ver = page.evaluate('__app.S.ver')
        page.set_input_files('#file-A', str(own))
        page.wait_for_function(f'__app.S.ver > {old_ver} && __app.S.lastRender && __app.S.lastRender.ver === __app.S.ver', timeout=15000)
        check('file replacement invalidates the in-flight render', page.evaluate("__app.S.names.A === 'new-source.wav' && __app.S.lastRender.ver === __app.S.ver && !__app.S.audDirty"))
        page.evaluate('window.__audioDelay=0; __app.S.sweep=true; void __app.currentRender()')
        page.wait_for_function('!__app.S.sweep && __app.S.lastRender && !__app.S.audDirty')
        check('fixed-blend requests hold the visual sweep', page.evaluate('!__app.S.sweep'))
        check('no browser exceptions', not errors, errors)
        browser.close()
finally:
    srv.shutdown()

print(f'{sum(checks)}/{len(checks)} passed')
raise SystemExit(0 if all(checks) else 1)
