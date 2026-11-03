#!/usr/bin/env python3
"""A short check for CI: each page boots, says it is ambient, runs the demo, and the demo really produces hits."""
import http.server, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
bad = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    for page in ('nebula.html', 'endless-cockpit.html'):
        pg = b.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
        pg.goto(f'http://127.0.0.1:{srv.server_port}/{page}'); pg.wait_for_timeout(2500)
        if pg.get_attribute('#source-badge', 'data-source') != 'ambient': bad.append(f'{page}: not ambient at load')
        pg.click('#demo-button'); pg.wait_for_timeout(4000)
        if pg.get_attribute('#source-badge', 'data-source') != 'demo': bad.append(f'{page}: demo is not labeled')
        hits = pg.evaluate('__app.kit.hits')
        if hits < 3: bad.append(f'{page}: the demo produced {hits} hits')
        if errors: bad.append(f'{page}: {errors[0]}')
        print(f'{page}: {hits} hits, {len(errors)} page errors')
    b.close()
srv.shutdown()
print('\n'.join(bad) or 'smoke passed')
sys.exit(1 if bad else 0)
