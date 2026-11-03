#!/usr/bin/env python3
"""Endless Cockpit's states, on the rendered page. Speed comes from cadence only.

  pedal, steady, demo, replay : real clicks and keys
  Bluetooth                   : STUBBED. A browser test cannot pair a real sensor, so `navigator.bluetooth`
                                is replaced: missing, a closed chooser, a sensor that sends nothing, a live
                                CSC sensor at a known cadence, and one that disconnects.
Exit 1 if any check fails.
"""
import http.server, json, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()); OUT.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_port}/endless-cockpit.html'
GPU = ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl']
results = []
def check(name, ok, detail=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

# A fake CSC sensor: crank revolutions at a set cadence, in the real CSC Measurement byte layout.
SENSOR = """(mode) => {
  const listeners = {}, dev = { name: 'Test Cadence', addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    gatt: { connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => ch }) }) } };
  let revs = 0, t1024 = 0;
  const ch = { addEventListener: (ev, fn) => { ch.fn = fn; }, startNotifications: async () => {
    if (mode !== 'live') return;
    window.__tick = setInterval(() => { revs += 1; t1024 = (t1024 + Math.round(1024 * 60 / 80)) % 65536;
      const b = new DataView(new ArrayBuffer(5)); b.setUint8(0, 0x02); b.setUint16(1, revs % 65536, true); b.setUint16(3, t1024, true);
      ch.fn && ch.fn({ target: { value: b } }); }, 750); } };
  window.__dropSensor = () => { clearInterval(window.__tick); (listeners.gattserverdisconnected || []).forEach((fn) => fn()); };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => {
    if (mode === 'cancel') throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
    return dev; } } });
}"""
READ = """() => ({ src: document.getElementById('source-label').textContent, kind: document.getElementById('source-badge').dataset.source,
  chip: document.getElementById('chip-sensor-text').textContent, bt: __app.S.bt, rpm: Math.round(__app.S.rpm), speed: __app.S.speed, dist: __app.S.dist,
  drumWords: /drum|kick|snare|hi-hat|cymbal|MIDI|tempo/i.test(document.body.innerText) })"""

with sync_playwright() as p:
    def page(init=None, motion='no-preference', settle=1500):
        b = p.chromium.launch(channel='chrome', headless=True, args=GPU)
        c = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, reduced_motion=motion)
        if init: c.add_init_script(init)
        pg = c.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        pg.goto(URL); pg.wait_for_timeout(settle)
        return b, pg, errs

    b, pg, errs = page()
    r = pg.evaluate(READ)
    check('fresh visit reads as ambient with no sensor', r['kind'] == 'ambient' and r['chip'] == 'Sensor · not connected', r['src'])
    check('the visible page says nothing about drums, MIDI or tempo', not r['drumWords'])
    pg.keyboard.down('Space'); pg.wait_for_timeout(2500)
    r = pg.evaluate(READ)
    check('holding Space pedals', r['kind'] == 'live' and r['src'] == 'Pedaling by hand' and r['rpm'] > 60 and r['speed'] > 2, f"{r['src']} {r['rpm']} rpm")
    pg.keyboard.up('Space'); pg.wait_for_timeout(3500)
    r = pg.evaluate(READ)
    check('letting go slows to a stop', r['rpm'] < 10, f"{r['rpm']} rpm")
    d0 = pg.evaluate('__app.S.dist'); pg.wait_for_timeout(1500)
    check('distance does not grow at rest', abs(pg.evaluate('__app.S.dist') - d0) < 0.5)
    pg.click('#connect-button'); pg.wait_for_timeout(300)
    pg.fill('#steady', '90'); pg.wait_for_timeout(2500)
    r = pg.evaluate(READ)
    check('a steady cadence moves the road', r['src'] == 'Steady cadence · 90 rpm' and r['rpm'] > 70, r['src'])
    pg.fill('#steady', '0'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.click('#demo-button'); pg.wait_for_timeout(3000)
    r = pg.evaluate(READ)
    check('the demo is labeled as a synthetic ride', r['kind'] == 'demo' and 'synthetic' in r['src'] and r['rpm'] > 20, r['src'])
    pg.screenshot(path=str(OUT / 'endless-demo.png'))
    pg.click('#demo-button', force=True); pg.wait_for_timeout(300)
    check('ending the demo goes back to ambient', pg.evaluate(READ)['kind'] == 'ambient')
    pg.evaluate("__app.kit.startRecording('endless-cockpit')"); pg.keyboard.down('Space'); pg.wait_for_timeout(2000); pg.keyboard.up('Space'); pg.wait_for_timeout(500)
    sess = pg.evaluate("(()=>{const s=__app.kit.stopRecording();window.__s=s;return {rpm:(s.lanes.rpm||[]).length,ms:s.durationMs}})()")
    check('a ride recording holds the cadence', sess['rpm'] > 10, json.dumps(sess))
    pg.evaluate('__app.kit.startReplay(window.__s)'); pg.wait_for_timeout(1500)
    r = pg.evaluate(READ)
    check('a replay is labeled and moves the road', r['kind'] == 'replay' and r['rpm'] > 20, f"{r['src']} {r['rpm']} rpm")
    check('no page errors', not errs, '; '.join(errs[:2]))
    b.close()

    b, pg, errs = page("delete Navigator.prototype.bluetooth; delete navigator.bluetooth;")
    r = pg.evaluate(READ)
    check('a browser with no Web Bluetooth says so before any click (stubbed)', r['bt'] == 'unsupported' and 'no Bluetooth' in r['chip'], r['chip'])
    b.close()

    for mode, want, text in (('cancel', 'no-choice', 'none chosen'), ('silent', 'connected', 'no cadence yet')):
        # Connect soon after load: a sensor that answers in the page's first seconds must not read as live.
        b, pg, errs = page(f"({SENSOR})('{mode}')", settle=300)
        pg.click('#connect-button'); pg.wait_for_timeout(200); pg.click('#ble-connect'); pg.wait_for_timeout(1200)
        r = pg.evaluate(READ)
        check(f'a sensor that is {mode} reads as {text} (stubbed)', r['bt'] == want and text in r['chip'] and r['rpm'] < 5, f"{r['chip']} / {r['src']}")
        pg.screenshot(path=str(OUT / f'endless-sensor-{mode}.png'))
        b.close()

    b, pg, errs = page(f"({SENSOR})('live')")
    pg.click('#connect-button'); pg.wait_for_timeout(200); pg.click('#ble-connect'); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.wait_for_timeout(5000)
    r = pg.evaluate(READ)
    check('a live sensor at 80 rpm drives the ride (stubbed)', r['kind'] == 'live' and r['src'].startswith('Live · ') and 74 <= r['rpm'] <= 86 and r['speed'] > 2, f"{r['src']} {r['rpm']} rpm")
    pg.screenshot(path=str(OUT / 'endless-sensor-live.png'))
    pg.evaluate('__dropSensor()'); pg.wait_for_timeout(1500)
    r = pg.evaluate(READ)
    check('a sensor that drops reads as disconnected (stubbed)', r['bt'] == 'lost' and 'disconnected' in r['chip'] and r['kind'] == 'ambient', r['chip'])
    check('no page errors with a sensor', not errs, '; '.join(errs[:2]))
    b.close()
srv.shutdown()
print(f'\n{sum(results)} of {len(results)} checks passed. Screenshots in {OUT}')
sys.exit(0 if all(results) else 1)
