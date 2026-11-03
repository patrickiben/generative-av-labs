#!/usr/bin/env python3
"""Enter's own paths, on the rendered page in real Chrome: the real depth model, its failures, the fallback, the cast and the STL.
It downloads the model from Hugging Face and the runtime from jsDelivr, so run it by hand, not in CI. usage: run_enter.py [picture]"""
import hashlib, http.server, json, os, struct, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
PIC = sys.argv[1] if len(sys.argv) > 1 else None
ARGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = os.environ.get('ENTER_URL') or f'http://127.0.0.1:{srv.server_port}/enter.html'   # ENTER_URL checks a deployed copy
res = []
def check(name, ok, note=''):
    res.append(bool(ok)); print(('ok  ' if ok else 'FAIL') + f' {name}' + (f' · {note}' if note != '' else ''), flush=True)
def fresh(b, init=None, viewport=(1440, 900)):
    c = b.new_context(viewport={'width': viewport[0], 'height': viewport[1]}, accept_downloads=True)
    if init: c.add_init_script(init)
    pg = c.new_page(); pg._errs = []; pg._reqs = []
    pg.on('pageerror', lambda e: pg._errs.append(str(e)[:200]))
    c.on('request', lambda r: pg._reqs.append((r.method, r.url)))
    return c, pg
def go_picture(pg):
    pg.goto(URL); pg.wait_for_timeout(1500); pg.click('[data-mode=picture]'); pg.wait_for_timeout(1200)
def world_sheet(pg):
    if not pg.evaluate("document.getElementById('world-sheet').open"): pg.click('#world-button')
def outside(pg):
    own = '/'.join(URL.split('/')[:3])                     # the page's own site, local or deployed
    return [(m, u) for m, u in pg._reqs if not u.startswith((own, 'http://127.0.0.1', 'data:', 'blob:', 'file:'))]
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=ARGS)
    # 1. the page alone asks the network for nothing
    c, pg = fresh(b); pg.goto(URL); pg.wait_for_timeout(1500)
    pg.click('[data-mode=picture]'); pg.wait_for_timeout(1500); pg.click('[data-mode=print]'); pg.wait_for_timeout(4000); pg.click('[data-mode=sound]'); pg.wait_for_timeout(1500)
    check('no outside request until a picture is chosen', not outside(pg), str(outside(pg)[:2]))
    check('no page errors in three worlds', not pg._errs, str(pg._errs[:2])); c.close()
    # 2. the real model on WebGPU, with consent first
    c, pg = fresh(b); go_picture(pg); world_sheet(pg)
    pic = PIC or str(ROOT / 'docs' / 'nebula.jpg')
    pg.set_input_files('#pic-file', pic); pg.wait_for_selector('#model-go:not([hidden])', timeout=8000)
    txt = pg.inner_text('#model-state') + ' | ' + pg.inner_text('#model-why')
    check('asks before downloading, with size and hosts', 'MB' in txt and 'Hugging Face' in txt and 'jsDelivr' in txt and not outside(pg), txt[:150])
    states = []; t0 = time.time(); pg.click('#model-go')
    while time.time() - t0 < 120:
        s = pg.inner_text('#model-state')
        if not states or states[-1] != s: states.append(s)
        if s.startswith('Ready') or pg.get_attribute('#model-card', 'data-tone') == 'bad': break
        pg.wait_for_timeout(120)
    dl = [s for s in states if s.startswith('Downloading')]
    check('shows byte progress', len(dl) > 3, f'{len(dl)} steps, last {dl[-1] if dl else None}')
    check('reaches ready', pg.inner_text('#model-state').startswith('Ready'), pg.inner_text('#model-state') + f' after {time.time()-t0:.1f}s')
    P = pg.evaluate("({kind:__app.P.kind,w:__app.P.w,h:__app.P.h,mw:__app.P.modelW,mh:__app.P.modelH,ms:__app.P.ms,path:__app.depth.path.key,min:Math.min(...__app.P.depth.slice(0,20000)),spread:new Set(Array.from(__app.P.depth.slice(0,20000)).map(v=>Math.round(v*50))).size})")
    check('the relief is estimated, on the graphics path', P['kind'] == 'estimated' and P['path'] == 'gpu' and P['spread'] > 10, json.dumps(P))
    check('the badge says estimated depth and relief', 'ESTIMATED DEPTH' in pg.inner_text('#world-badge').upper() and 'NOT A RECONSTRUCTED SCENE' in pg.inner_text('#world-badge').upper())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(1200); pg.screenshot(path=str(ROOT / '_review' / 'enter-estimated.png'))
    posts = [(m, u) for m, u in outside(pg) if m != 'GET']
    hosts = sorted({u.split('/')[2] for _, u in outside(pg)})
    check('only GETs reach outside, to declared hosts', not posts and all(h.endswith(('huggingface.co', 'hf.co', 'jsdelivr.net')) for h in hosts), str(hosts))
    long_q = [u for _, u in outside(pg) if len(u) > 1500]
    check('no request carries a long payload in its URL', not long_q)
    # 3. the sample against known depth, then the stored model: no consent and no download
    n0 = len(outside(pg)); world_sheet(pg); pg.click('#pic-sample'); pg.wait_for_function("__app.P.truth!=null", timeout=30000)
    print('    painted truth r =', pg.evaluate('__app.P.truth'))
    check('a second picture downloads nothing', all('.onnx' not in u and '.wasm' not in u for _, u in outside(pg)[n0:]))
    pg.reload(); pg.wait_for_timeout(1200); pg.click('[data-mode=picture]'); pg.wait_for_timeout(800); world_sheet(pg); n1 = len(outside(pg))
    pg.set_input_files('#pic-file', pic); pg.wait_for_function("__app.P&&__app.P.kind==='estimated'", timeout=30000)
    check('after a reload the stored model needs no download or consent', all('.onnx' not in u and '.wasm' not in u for _, u in outside(pg)[n1:]), pg.inner_text('#model-why')[:80])
    pg.click('#model-clear'); pg.wait_for_timeout(600)
    check('the stored model can be removed', 'Removed' in pg.inner_text('#model-state') and pg.evaluate("caches.has('enter-depth-v1')") is False); c.close()
    # 4. no WebGPU: the fallback path, real, in the same browser
    c, pg = fresh(b, init="Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined,configurable:true})"); go_picture(pg); world_sheet(pg)
    pg.set_input_files('#pic-file', pic); pg.wait_for_selector('#model-go:not([hidden])', timeout=8000)
    w = pg.inner_text('#model-why'); check('the fallback says why and what it costs', 'no WebGPU' in w and 'slower' in w, w[:140])
    t0 = time.time(); pg.click('#model-go'); pg.wait_for_function("__app.P.kind==='estimated'||document.getElementById('model-card').dataset.tone==='bad'", timeout=150000)
    Q2 = pg.evaluate("({kind:__app.P.kind,ms:__app.P.ms,path:__app.depth.path.key,mw:__app.P.modelW,mh:__app.P.modelH})")
    check('the processor path estimates depth', Q2['kind'] == 'estimated' and Q2['path'] == 'cpu', json.dumps(Q2) + f' total {time.time()-t0:.1f}s'); check('no page errors on the fallback', not pg._errs, str(pg._errs[:2])); c.close()
    # 5. the host blocked: an honest failure, a world that keeps working, and the stated rule
    c, pg = fresh(b); c.route('**/*', lambda r: r.abort() if ('huggingface' in r.request.url or 'hf.co' in r.request.url) else r.continue_()); go_picture(pg); world_sheet(pg)
    before = pg.evaluate('__app.P.kind'); pg.set_input_files('#pic-file', pic); pg.wait_for_selector('#model-go:not([hidden])', timeout=8000); pg.click('#model-go')
    pg.wait_for_function("document.getElementById('model-card').dataset.tone==='bad'", timeout=40000)
    check('a blocked model reads as a failure', 'could not be reached' in pg.inner_text('#model-why') and pg.evaluate('__app.P.kind') == before, pg.inner_text('#model-state'))
    pg.click('#model-rule'); pg.wait_for_timeout(700)
    check('the stated rule works offline and says it is a rule', pg.evaluate('__app.P.kind') == 'brightness' and 'BRIGHTNESS RELIEF' in pg.inner_text('#world-badge').upper()); c.close()
    # 6. the cast: same sound, same shape; watertight; a well-formed STL
    c, pg = fresh(b); pg.goto(URL); pg.wait_for_timeout(1200); pg.click('[data-mode=print]'); pg.wait_for_function('__app.M!=null', timeout=60000)
    M = pg.evaluate("({faces:__app.M.count/3,w:__app.M.watertight,open:__app.M.openEdges,bodies:__app.M.bodies,atoms:__app.M.atoms,ms:__app.M.ms})")
    check('the sculpture is watertight, by its own edge check', M['w'], json.dumps(M))
    h1 = pg.evaluate("crypto.subtle.digest('SHA-256',__app.M.pos.buffer).then(b=>Array.from(new Uint8Array(b)).join(','))")
    world_sheet(pg); pg.click('#cast-go'); pg.wait_for_function("!document.getElementById('cast-go').disabled&&__app.M.pos.length>0", timeout=60000); pg.wait_for_timeout(1500)
    h2 = pg.evaluate("crypto.subtle.digest('SHA-256',__app.M.pos.buffer).then(b=>Array.from(new Uint8Array(b)).join(','))")
    check('same sound, same shape', h1 == h2)
    with pg.expect_download() as d: pg.click('#cast-stl')
    f = d.value.path(); raw = Path(f).read_bytes(); n = struct.unpack('<I', raw[80:84])[0]
    check('the STL is well formed', len(raw) == 84 + n * 50 and n == M['faces'], f'{n} triangles, {len(raw)/1e6:.1f} MB')
    # a bounds and edge check on the file itself
    edges = {}; tris = [struct.unpack('<9f', raw[84 + i * 50 + 12:84 + i * 50 + 48]) for i in range(n)]
    key = lambda x, y, z: struct.pack('<3f', x, y, z)
    for t in tris:
        v = [key(*t[0:3]), key(*t[3:6]), key(*t[6:9])]
        for a, bb in ((0, 1), (1, 2), (2, 0)): edges[(v[a], v[bb])] = edges.get((v[a], v[bb]), 0) + 1
    bad = sum(1 for (a, bb), k in edges.items() if a != bb and (k != 1 or edges.get((bb, a)) != 1))
    print(f'    edges in the file not paired exactly once: {bad} of {len(edges)}'); check('the file itself is closed, edge by edge', bad == 0, f'{bad}'); c.close()
    # 7. the sound world reads a real file and a known tone lands at its pitch
    c, pg = fresh(b); pg.goto(URL); pg.wait_for_timeout(1200)
    tone = pg.evaluate("""async()=>{const r=44100,n=r*3,d=new Int16Array(n);for(let i=0;i<n;i++)d[i]=Math.sin(2*Math.PI*440*i/r)*20000*(1+Math.sin(i/9000))*.5;
      const h=new DataView(new ArrayBuffer(44));const w=(o,s)=>[...s].forEach((c,i)=>h.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');h.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,1,true);h.setUint32(24,r,true);h.setUint32(28,r*2,true);h.setUint16(32,2,true);h.setUint16(34,16,true);w(36,'data');h.setUint32(40,n*2,true);
      const f=new File([h.buffer,d.buffer],'tone440.wav',{type:'audio/wav'});const dt=new DataTransfer();dt.items.add(f);const i=document.getElementById('snd-file');i.files=dt.files;i.dispatchEvent(new Event('change'));
      for(let k=0;k<200&&!__app.Sound.fromFile;k++)await new Promise(q=>setTimeout(q,100));const a=__app.Sound.atoms;const top=a.slice().sort((p,q)=>q.amp-p.amp).slice(0,20);return{n:a.length,f:top.reduce((s,x)=>s+x.f,0)/top.length,label:__app.Sound.label}}""")
    check('a 440 Hz tone lifts to atoms near 440 Hz', abs(tone['f'] - 440) < 25, json.dumps(tone)); check('the file field is named', 'tone440' in pg.inner_text('#world-source')); c.close()
    # 8. no live input: nothing asks for a microphone or MIDI in any world, and no kit control is on the page
    c, pg = fresh(b, init="window.__asks=0;const g=navigator.mediaDevices&&navigator.mediaDevices.getUserMedia;if(g)navigator.mediaDevices.getUserMedia=function(){window.__asks++;return g.apply(this,arguments)};if(navigator.requestMIDIAccess){const m=navigator.requestMIDIAccess.bind(navigator);navigator.requestMIDIAccess=function(){window.__asks++;return m.apply(null,arguments)}}")
    pg.goto(URL); pg.wait_for_timeout(1500)
    for world in ('picture', 'print', 'sound'):
        pg.click(f'[data-mode={world}]'); pg.wait_for_timeout(4000 if world == 'print' else 1500)
    for k in 'jklupn': pg.keyboard.press(k)
    pg.wait_for_timeout(500)
    q = pg.evaluate("({asks: window.__asks, kit: typeof createKit, controls: ['connect-button','demo-button','chip-audio','chip-midi','hit-strip'].filter(i=>document.getElementById(i))})")
    check('no live input anywhere: no microphone or MIDI request, no kit controls', q['asks'] == 0 and q['kit'] == 'undefined' and not q['controls'], json.dumps(q))
    c.close()
    # 9. a phone sees how to open its own file at once, and both kinds land in the right world
    import math, tempfile, wave
    wav = Path(tempfile.mkdtemp()) / 'tone330.wav'
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        w.writeframes(b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * 330 * i / 22050))) for i in range(22050 * 2)))
    phone = p.devices['iPhone 13']
    c = b.new_context(**phone); pg = c.new_page(); pg._errs = []; pg.on('pageerror', lambda e: pg._errs.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_timeout(2000)
    lab = pg.evaluate("(() => { const e = document.getElementById('open-label'), r = e.getBoundingClientRect(); return { text: e.innerText.trim(), seen: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && !e.closest('dialog') }; })()")
    check('a phone sees an open-file button on the first screen', lab['seen'] and lab['text'] == 'Open a file', json.dumps(lab))
    pg.set_input_files('#open-file', pic); pg.wait_for_selector('#model-go:not([hidden])', timeout=10000)
    check('a picture from that button goes to the picture world and asks before the model', pg.evaluate("__app.S.world") == 'picture')
    pg.keyboard.press('Escape'); pg.click('[data-mode=print]'); pg.wait_for_function('__app.M!=null', timeout=60000)
    pg.set_input_files('#open-file', str(wav)); pg.wait_for_function("__app.M && /tone330/.test(__app.M.label)", timeout=60000)
    check('a sound from that button, in the print world, is cast', pg.evaluate("__app.Sound.fromFile && __app.M.watertight"), pg.evaluate("__app.M.label"))
    check('no page errors on the phone', not pg._errs, str(pg._errs[:2])); c.close()
    # 10. full screen works where the browser offers it, and the button is absent where it does not (iPhone)
    c, pg = fresh(b); pg.goto(URL); pg.wait_for_timeout(1200); pg.click('#fs-button'); pg.wait_for_timeout(600)
    check('full screen opens on a desktop browser', pg.evaluate('!!document.fullscreenElement'))
    c.close()
    c, pg = fresh(b, init="delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;"); pg.goto(URL); pg.wait_for_timeout(1200)
    check('with no full-screen API, there is no full-screen button', pg.evaluate("getComputedStyle(document.getElementById('fs-button')).display==='none'"))
    c.close(); b.close()
srv.shutdown()
print(f'{sum(res)} of {len(res)} checks passed'); sys.exit(0 if all(res) else 1)
