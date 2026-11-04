#!/usr/bin/env python3
"""Real Nebula video/audio exports, overlapping stop/start callbacks, and owned-track cleanup.

Requires Chrome, Playwright, and FFmpeg. Only recorder construction failure is
stubbed; successful takes use the real canvas, demo audio, encoder and downloads.
"""
import array
import http.server
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp())
OUT.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
checks = []


def check(name, ok, detail=None):
    checks.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' · {detail}' if detail is not None else ''), flush=True)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'])
        pg = browser.new_page(viewport={'width': 1280, 'height': 800})
        errors, downloads = [], []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('download', lambda d: downloads.append(d))
        pg.add_init_script('''
          window.__takes=[];window.__captures=[];window.__failRecorder=false;
          const capture=HTMLCanvasElement.prototype.captureStream;
          HTMLCanvasElement.prototype.captureStream=function(...args){
            const stream=capture.apply(this,args);__captures.push(stream);return stream;
          };
          const NativeRecorder=MediaRecorder;
          window.MediaRecorder=class extends NativeRecorder{
            constructor(stream,options){
              if(__failRecorder){__failRecorder=false;throw new Error('test encoder unavailable');}
              super(stream,options);__takes.push({recorder:this,stream});
            }
          };
        ''')
        pg.goto(f'http://127.0.0.1:{srv.server_port}/nebula.html')
        pg.wait_for_function('window.__app && __app.kit')
        pg.click('#demo-button')
        pg.wait_for_function('__app.kit.demoOn && __app.kit.recordingStream()')
        pg.evaluate('window.__sourceAudio=__app.kit.recordingStream().getAudioTracks()[0]')
        pg.click('#session-button'); pg.check('#rec-video')
        pg.click('#rec-toggle'); pg.wait_for_timeout(1400)
        check('a real take records video and audio', pg.evaluate("__takes[0].stream.getTracks().map(t=>t.kind).sort().join(',')") == 'audio,video')
        check('each take owns an audio clone', pg.evaluate('__takes[0].stream.getAudioTracks()[0] !== __sourceAudio'))

        # Start take two in the same task that stops take one: its delayed final
        # data/stop events must retain take one's chunks and recorder reference.
        pg.evaluate("document.getElementById('rec-toggle').click();document.getElementById('rec-toggle').click()")
        pg.wait_for_timeout(1400)
        check('stopping the prior take leaves the next take live', pg.evaluate("__takes.length===2 && __takes[1].recorder.state==='recording' && __takes[1].stream.getTracks().every(t=>t.readyState==='live')"))
        pg.click('#rec-toggle')
        deadline = time.monotonic() + 8
        videos = []
        while time.monotonic() < deadline:
            videos = [d for d in downloads if d.suggested_filename.endswith(('.webm', '.mp4'))]
            if len(videos) >= 2:
                break
            pg.wait_for_timeout(100)
        pg.wait_for_timeout(200)
        check('both back-to-back takes download a video', len(videos) == 2, [d.suggested_filename for d in videos])
        check('both takes also save their session JSON', len([d for d in downloads if d.suggested_filename.endswith('.json')]) == 2)
        for i, download in enumerate(videos):
            path = OUT / f'take-{i + 1}{Path(download.suggested_filename).suffix}'
            download.save_as(str(path))
            probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', str(path)], capture_output=True, text=True)
            kinds = [s['codec_type'] for s in json.loads(probe.stdout or '{}').get('streams', [])]
            check(f'take {i + 1} is a valid video/audio container', probe.returncode == 0 and sorted(kinds) == ['audio', 'video'], kinds)
            decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ac', '1', '-f', 'f32le', '-'], capture_output=True)
            samples = array.array('f', decoded.stdout)
            if sys.byteorder != 'little':
                samples.byteswap()
            rms = math.sqrt(sum(float(x) ** 2 for x in samples) / max(1, len(samples)))
            check(f'take {i + 1} contains audible demo audio', decoded.returncode == 0 and rms > .0001, rms)
        check('all completed capture tracks stop', pg.evaluate("__captures.every(s=>s.getTracks().every(t=>t.readyState==='ended'))"))
        check('the persistent audio destination survives both takes', pg.evaluate("__sourceAudio.readyState==='live' && __app.kit.recordingStream().getAudioTracks()[0]===__sourceAudio && __app.kit.demoOn"))
        check('successful recording raises no page errors', not errors, errors)

        # A browser encoder can reject an otherwise valid stream. Session JSON
        # must remain usable and no newly captured video/audio tracks may leak.
        pg.evaluate('window.__failRecorder=true')
        pg.click('#rec-toggle'); pg.wait_for_timeout(150)
        check('encoder failure is explained while session recording continues', pg.evaluate('__app.kit.recording') and 'video' in pg.inner_text('#rec-status').lower() and 'could not' in pg.inner_text('#rec-status').lower(), pg.inner_text('#rec-status'))
        check('encoder failure releases its capture tracks', pg.evaluate("__captures.at(-1).getTracks().every(t=>t.readyState==='ended')"))
        pg.click('#rec-toggle'); pg.wait_for_timeout(150)
        check('a failed video take still saves session JSON', len([d for d in downloads if d.suggested_filename.endswith('.json')]) == 3)

        pg.click('#rec-toggle'); pg.wait_for_timeout(250)
        pg.evaluate("__takes.at(-1).recorder.dispatchEvent(new Event('error'))")
        pg.wait_for_function("__captures.at(-1).getTracks().every(t=>t.readyState==='ended')")
        check('an encoder error stops its take but preserves the source', pg.evaluate("__app.kit.recording && __sourceAudio.readyState==='live'") and 'could not' in pg.inner_text('#rec-status').lower())
        pg.click('#rec-toggle'); pg.wait_for_timeout(150)
        check('an encoder error still permits saving session JSON', len([d for d in downloads if d.suggested_filename.endswith('.json')]) == 4)
        check('handled encoder errors raise no page errors', not errors, errors)
        browser.close()
finally:
    srv.shutdown()

print(f'{sum(checks)}/{len(checks)} checks passed. Artifacts: {OUT}')
sys.exit(0 if all(checks) else 1)
