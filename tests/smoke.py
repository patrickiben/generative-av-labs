#!/usr/bin/env python3
"""A short check for CI: each page boots, says it is ambient, runs the demo, and the demo really produces hits, or cadence on the road.
Chimera is a synth, so its demo is checked by the riff steps it really played instead of drum hits.
Displacer takes files, not a kit, so it is checked by the blend and the cloud it really built instead."""
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
    for page in ('nebula.html', 'endless-cockpit.html', 'chimera.html', 'displacer.html'):
        # a browser of its own for each page: under software rendering, a page left running starves the next one,
        # and on Linux closing one page's GL context stalled the next page's
        b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page(); errors = []
        pg.set_default_timeout(120000)            # software rendering on the CI runner can hold a frame for many seconds
        pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
        pg.goto(f'http://127.0.0.1:{srv.server_port}/{page}', timeout=120000); pg.wait_for_timeout(2500)
        if page == 'displacer.html':
            pg.wait_for_function('window.__app && __app.spaceN > 0', timeout=120000)
            n = pg.evaluate('__app.spaceN')
            if pg.is_visible('#demo-button'): bad.append(f'{page}: shows a drum demo')
            if errors: bad.append(f'{page}: {errors[0]}')
            print(f'{page}: {n} points in the cloud, {len(errors)} page errors')
            b.close()
            continue
        if pg.get_attribute('#source-badge', 'data-source') != 'ambient': bad.append(f'{page}: not ambient at load')
        pg.click('#demo-button'); pg.wait_for_timeout(4000)
        if pg.get_attribute('#source-badge', 'data-source') != 'demo': bad.append(f'{page}: demo is not labeled')
        hits = pg.evaluate('seqStep' if page == 'chimera.html' else 'Math.round(__app.S.rpm)' if page == 'endless-cockpit.html' else '__app.kit.hits')
        if hits < 3: bad.append(f'{page}: the demo produced {hits} ' + ('rpm' if page == 'endless-cockpit.html' else 'hits'))
        if errors: bad.append(f'{page}: {errors[0]}')
        print(f'{page}: {hits} hits, {len(errors)} page errors')
        b.close()
    # Enter takes a picture or a sound and no live input: it boots, names its world, and carries no kit
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(); pg.set_default_timeout(120000); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.goto(f'http://127.0.0.1:{srv.server_port}/enter.html', timeout=120000); pg.wait_for_timeout(2500)
    if 'SYNESTHETIC MAP' not in pg.inner_text('#world-badge').upper(): bad.append('enter.html: the world badge is missing')
    if pg.evaluate("typeof createKit") != 'undefined' or pg.query_selector('#connect-button'): bad.append('enter.html: drum input is on the page')
    if errors: bad.append(f'enter.html: {errors[0]}')
    print(f'enter.html: {len(errors)} page errors')
    b.close()
srv.shutdown()
print('\n'.join(bad) or 'smoke passed')
sys.exit(1 if bad else 0)
