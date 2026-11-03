#!/usr/bin/env python3
"""Open a page in a real Chrome and save screenshots. usage: shot.py page.html outdir [--demo] [--wait ms] [--w W --h H] [--js code]"""
import argparse, functools, http.server, json, os, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser()
ap.add_argument('page'); ap.add_argument('out'); ap.add_argument('--demo', action='store_true')
ap.add_argument('--wait', type=int, default=2500); ap.add_argument('--w', type=int, default=1440); ap.add_argument('--h', type=int, default=900)
ap.add_argument('--js', default=''); ap.add_argument('--seq', default=''); ap.add_argument('--name', default='shot'); ap.add_argument('--headed', action='store_true')
a = ap.parse_args()
root = Path(__file__).resolve().parent.parent
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *x, **k): super().__init__(*x, directory=str(root), **k)
    def log_message(self, *x): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_port}/{a.page}'
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=not a.headed, args=['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl'])
    c = b.new_context(viewport={'width': a.w, 'height': a.h}, device_scale_factor=1)
    pg = c.new_page(); logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text[:300]}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'pageerror: {str(e)[:400]}'))
    pg.goto(url); pg.wait_for_timeout(1200)
    if a.demo: pg.click('#demo-button')
    pg.wait_for_timeout(a.wait)
    if a.js:
        print('js =>', json.dumps(pg.evaluate(a.js))[:900])
        pg.wait_for_timeout(600)
    os.makedirs(a.out, exist_ok=True)
    if a.seq:
        for name, js, wait in json.loads(a.seq):
            if js: pg.evaluate(js)
            pg.wait_for_timeout(wait)
            pg.screenshot(path=f'{a.out}/{name}.png')
    pg.screenshot(path=f'{a.out}/{a.name}.png')
    info = pg.evaluate("""() => { const g=document.createElement('canvas').getContext('webgl2'); const d=g&&g.getExtension('WEBGL_debug_renderer_info');
       return {gpu:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null, state:document.getElementById('source-label')?.textContent, canvas:[document.getElementById('stage')?.width,document.getElementById('stage')?.height]}; }""")
    print(info); print('\n'.join(logs[:12]) or 'no console errors')
    b.close()
srv.shutdown()
