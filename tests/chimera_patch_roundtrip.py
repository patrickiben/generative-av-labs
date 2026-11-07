#!/usr/bin/env python3
"""Real patch-file/share-link round trips for Garden, legacy Morph and Unicode labels."""
import base64, functools, http.server, json, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{srv.server_port}/chimera.html'
with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True,args=['--use-angle=swiftshader'])
    ctx=b.new_context(accept_downloads=True)
    pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e: errors.append(str(e)))
    pg.goto(url);pg.wait_for_function('window.__app')
    original=pg.evaluate("""()=>{const g=Float32Array.from({length:GN},(_,i)=>(i+1)/(GN+2));plantSeed(g,true);__app.setMode('garden');return {g:Array.from(GARDEN.seed),sound:JSON.stringify(morphedPatch())};}""")
    pg.click('#patch-button')
    with pg.expect_download() as dl:pg.click('#patch-save')
    saved=Path(dl.value.path()).read_bytes();payload=json.loads(saved)
    assert payload['mode']=='garden' and payload['garden']['genome']==original['g']
    pg.evaluate("plantSeed(Float32Array.from({length:GN},()=>.05),true);__app.setMode('morph')")
    pg.set_input_files('#patch-file',{'name':'garden.patch.json','mimeType':'application/json','buffer':saved})
    pg.wait_for_function("__app.mode==='garden'")
    assert pg.evaluate('Array.from(GARDEN.seed)')==original['g']
    assert pg.evaluate('JSON.stringify(morphedPatch())')==original['sound']
    print('PASS downloaded Garden patch restores all 20 genes and decoded sound, and switches back to Garden')
    pg.click('#patch-link');link=pg.url
    # Explicitly conflict with the saved preference: the link's mode must win on a fresh page.
    pg.evaluate("localStorage.setItem('chimera.mode',JSON.stringify('morph'))")
    fresh=ctx.new_page();fresh.goto(link);fresh.wait_for_function('window.__app')
    assert fresh.evaluate('__app.mode')=='garden'
    assert fresh.evaluate('Array.from(GARDEN.seed)')==original['g']
    assert fresh.evaluate('JSON.stringify(morphedPatch())')==original['sound']
    print('PASS fresh share link restores the audible Garden seed even when stored mode is Morph')
    legacy=payload.copy();legacy.pop('garden',None);legacy.pop('mode',None);legacy['v']=2
    fresh.evaluate('(p)=>applyPatch(p)',legacy)
    assert fresh.evaluate('__app.mode')=='morph'
    print('PASS version 2 patches still restore as animal Morph patches')
    legacy_link=url+'#p='+base64.b64encode(json.dumps(legacy).encode('ascii')).decode('ascii')
    fresh.goto(legacy_link);fresh.wait_for_function('window.__app');fresh.wait_for_timeout(100)
    assert fresh.evaluate('__app.mode')=='morph'
    assert fresh.evaluate('ST.A')==legacy['A'] and fresh.evaluate('ST.B')==legacy['B']
    print('PASS original base64 version 2 share links remain compatible')
    assert fresh.evaluate("""()=>{const finite=v=>typeof v==='number'?Number.isFinite(v):v&&typeof v==='object'?Object.values(v).every(finite):true;for(let i=0;i<ANIMALS.length;i++){ST.A=i;ST.B=(i+1)%ANIMALS.length;const p=serializePatch();if(!finite(p)||!applyPatch(p)||!finite(morphedPatch()))return false;}return true;}""")
    print('PASS every built-in animal preset exports and restores finite patch and voice parameters')
    literal='éclat <svg onload=1>'
    patch=legacy.copy();patch['sampleAnimal']={'nm':literal,'F':[[600,7,1],[1500,8,.6]]};patch['Akey']='sample'
    assert fresh.evaluate('(p)=>applyPatch(p)',patch)
    assert fresh.locator('#animals .nm').last.text_content()==literal
    assert fresh.locator('#animals .anim svg').count()==0
    roundtrip=fresh.evaluate('(p)=>patchFromBase64(patchToBase64(p))',patch)
    assert roundtrip['sampleAnimal']['nm']==literal
    print('PASS Unicode patch names survive links and markup-like names remain literal text')
    malformed=payload.copy();malformed['garden']={'genome':[.5]}
    before=fresh.evaluate('JSON.stringify(serializePatch())')
    assert not fresh.evaluate('(p)=>applyPatch(p)',malformed)
    assert fresh.evaluate('JSON.stringify(serializePatch())')==before
    print('PASS malformed genomes are rejected before changing the live patch')
    missing=legacy.copy();missing['sampleRequired']=True
    fresh.evaluate("ST.sampleMode='osc';ST.sampleBuf={sentinel:true}")
    fresh.evaluate('(p)=>applyPatch(p)',missing)
    assert fresh.evaluate('ST.sampleMode')=='off' and fresh.evaluate('ST.sampleBuf') is None
    assert 'raw sample' in fresh.locator('#samp-status').text_content()
    print('PASS raw sample references request their original audio rather than reusing an unrelated open sample')
    bundle_ok=fresh.evaluate("""()=>{
        ST.importMode='osc';
        applySampleBuffer(synthTestSample('bell'), 'Bell strike');
        const b=serializeBundle();
        ST.sampleMode='off'; ST.sampleBuf=null;
        applyPatch(b);
        return ST.sampleMode==='osc' && !!ST.sampleBuf && ST.sampleBuf.length>1000 && document.getElementById('samp-status').textContent.includes('restored from bundle');
    }""")
    assert bundle_ok
    print('PASS portable sample bundle embeds PCM16 audio and restores the raw sample oscillator on load')
    assert not errors,errors
    b.close()
srv.shutdown()
