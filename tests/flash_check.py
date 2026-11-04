#!/usr/bin/env python3
"""Measure flicker on the rendered page with the WCAG 2.2 general flash definition.

A flash is a pair of opposing changes of at least 10% of maximum relative luminance, where the darker
image is below 0.80. The limit is three in any one second over no more than 25% of a 10 degree field.
At 1024 by 768 that field is about 341 by 256 pixels, so each third of the screen stands in for one here.
The grid is a true area average, so a few moving sparks do not read as a flashing region.
A strict screen, not a certificate: it has no red-flash test, and only a person can judge comfort.
"""
import http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else f'http://127.0.0.1:{srv.server_port}'
W, H = 64, 36

def rel(v):
    c = v / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def flashes_per_second(series, times):
    """Worst one-second count of opposing 10% pairs in one cell's luminance series."""
    turns, ref, direction = [], series[0], 0
    for v, t in zip(series, times):
        if direction >= 0 and v - ref >= 0.1 and min(v, ref) < 0.8:
            if direction == 0 or direction < 0: pass
            turns.append(t); direction = -1; ref = v
        elif direction <= 0 and ref - v >= 0.1 and min(v, ref) < 0.8:
            turns.append(t); direction = 1; ref = v
        else:
            ref = max(ref, v) if direction == -1 else min(ref, v) if direction == 1 else ref
    best = 0
    for i, t in enumerate(turns):
        n = sum(1 for x in turns[i:] if x < t + 1000)
        best = max(best, n // 2)                # two opposing changes make one flash
    return best

def analyze(frames):
    times = [f['t'] for f in frames]
    grids = [[rel(v) for v in f['grid']] for f in frames]
    worst_region, worst_cells = 0.0, 0
    per_cell = [flashes_per_second([g[c] for g in grids], times) for c in range(W * H)]
    for ry in range(3):
        for rx in range(3):
            cells = [x + y * W for y in range(ry * H // 3, (ry + 1) * H // 3) for x in range(rx * W // 3, (rx + 1) * W // 3)]
            over = sum(1 for c in cells if per_cell[c] > 3) / len(cells)
            worst_region = max(worst_region, over)
    means = [sum(g) / len(g) for g in grids]
    mean_pct = [v * 100 for v in means]
    return {'frames': len(frames), 'fps': round(len(frames) / ((times[-1] - times[0]) / 1000), 1), 'worstRegionOver3PerSec': round(worst_region, 3), 'worstCell': max(per_cell),
            'wholeFrame': flashes_per_second(means, times), 'meanLuminancePct': [round(min(mean_pct), 1), round(max(mean_pct), 1)]}

bad = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl'])
    # the hardest honest case: crash, kick and snare together on every eighth note at 140 BPM, all at full velocity
    HARD = "window.__hard=setInterval(()=>{const k=__app.kit;k.feedMidi([0x99,36,127]);k.feedMidi([0x99,38,127]);k.feedMidi([0x99,49,127])},214)"
    # Chimera adds its own worst case: the sub held near 180 degrees so the measured cancellation shatters the
    # creature in red, full chaos, and per-note branches so every hit also lights a bud
    HARDER = {'chimera.html': "(()=>{const s=document.getElementById('k-phase');s.value=180;s.dispatchEvent(new Event('input'));const c=document.getElementById('ch-chaos');c.value=100;c.dispatchEvent(new Event('input'));__app.GARDEN.perNote=true})()"}
    # Analog has no demo and no kit, so its first case is plain playing. Its hardest is switching engines and flipping A and B
    # while playing. A switch faster than processing never reaches the screen, so it runs at three speeds and counts the
    # results shown; Floor against SBR is the largest change the lower spectrogram can make.
    ANALOG_HARD = {f'switching every {ms} ms': f"(()=>{{let i=0;const M={m};window.__hard=setInterval(()=>{{__app.setMode(M[i++%M.length]);__app.flip()}},{ms})}})()"
                   for ms, m in ((110, "['floor','exciter','transient','sbr']"), (250, "['sbr','floor']"), (400, "['sbr','floor']"))}
    for page in (os.environ.get('FLASH_PAGES') or 'nebula.html chimera.html analog.html enter.html enter.html?world=picture enter.html?world=print').split():
        for motion in ('no-preference', 'reduce'):
            pg = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, reduced_motion=motion).new_page()
            pg.goto(f'{BASE}/{page}'); pg.wait_for_timeout(1500)
            if page == 'analog.html':
                pg.wait_for_function('window.__app && __app.result && !__app.busy', timeout=60000)
                pg.click('#start-listen'); pg.wait_for_timeout(1500)
                cases = [('playing', analyze(pg.evaluate('__app.recordLuma(9000)')))]
                for name, js in ANALOG_HARD.items():
                    n0 = pg.evaluate('__app.runs'); pg.evaluate(js)
                    x = analyze(pg.evaluate('__app.recordLuma(6000)'))
                    pg.evaluate('clearInterval(window.__hard)'); x['resultsShown'] = pg.evaluate('__app.runs') - n0
                    cases.append((name, x)); pg.wait_for_timeout(900)
            else:
                drums = pg.query_selector('#demo-button') is not None     # a page with no demo (Enter) gets the rest-and-drift case only
                if drums: pg.click('#demo-button'); pg.wait_for_timeout(1500)
                r = analyze(pg.evaluate('__app.recordLuma(9000)'))
                if drums: pg.evaluate(HARD)
                if page in HARDER: pg.evaluate(HARDER[page])
                cases = [('demo', r), ('hardest', analyze(pg.evaluate('__app.recordLuma(6000)')))]
            for name, x in cases:
                print(page, motion, name, json.dumps(x))
                if x['worstRegionOver3PerSec'] > 0.25: bad.append(f'{page} {motion} {name}: {x["worstRegionOver3PerSec"]:.0%} of a region flashes more than 3 times a second')
                if x['wholeFrame'] > 3: bad.append(f'{page} {motion} {name}: the whole frame flashes {x["wholeFrame"]} times in a second')
    b.close()
srv.shutdown()
print('\n'.join(bad) or 'flicker check passed')
sys.exit(1 if bad else 0)
