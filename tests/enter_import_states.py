#!/usr/bin/env python3
"""Imported names stay literal; stale depth estimates cannot replace a newer picture or the painted scene.
Uses the actual page controls and a deterministic estimate stub, with no model downloads."""
import functools,http.server,io,math,struct,threading,wave
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
image=io.BytesIO();Image.new('RGB',(32,24),(120,180,90)).save(image,format='PNG')
wav=io.BytesIO()
with wave.open(wav,'wb') as out:
    out.setnchannels(1);out.setsampwidth(2);out.setframerate(44100)
    out.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*440*i/44100))) for i in range(22050)))
with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True,args=['--use-angle=swiftshader'])
    pg=b.new_page();errors=[];requests=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('request',lambda r:requests.append(r.url))
    pg.goto(f'http://127.0.0.1:{srv.server_port}/enter.html');pg.wait_for_function('window.__app')
    pg.set_input_files('#snd-file',{'name':'track <em>detail.wav','mimeType':'audio/wav','buffer':wav.getvalue()})
    pg.wait_for_function("__app.Sound.fromFile && __app.Sound.label.includes('<em>')")
    assert pg.locator('#snd-status em').count()==0
    assert '<em>' in pg.locator('#snd-status').text_content()
    print('PASS audio filenames containing markup display literally')
    pg.evaluate("""()=>{window.estimates=[];const d=__app.depth;Object.defineProperty(d,'ready',{get:()=>true});Object.defineProperty(d,'path',{get:()=>({label:'test processor',model:{name:'test'},short:32})});d.estimate=(c,w,h)=>new Promise(resolve=>estimates.push({resolve,w,h}));}""")
    def choose(name):pg.set_input_files('#pic-file',{'name':name,'mimeType':'image/png','buffer':image.getvalue()})
    def resolve(index,value):pg.evaluate("([i,v])=>{const e=estimates[i];e.resolve({depth:new Float32Array(e.w*e.h).fill(v),ms:1,modelW:32,modelH:24})}",[index,value])
    choose('first.png');pg.wait_for_function('estimates.length===1')
    choose('second <em>image.png');pg.wait_for_function('estimates.length===2')
    resolve(1,.6);pg.wait_for_function("__app.P.name==='second <em>image.png'")
    resolve(0,.2);pg.wait_for_timeout(100)
    assert pg.evaluate('__app.P.name')=='second <em>image.png'
    assert pg.locator('#pic-status em').count()==0
    print('PASS newest picture wins when an older estimate finishes afterward; its name remains literal')
    choose('third.png');pg.wait_for_function('estimates.length===3')
    pg.evaluate("document.getElementById('pic-painted').click()")
    resolve(2,.8);pg.wait_for_timeout(100)
    assert pg.evaluate('__app.P.name')=='The painted scene'
    print('PASS choosing the painted scene cancels a pending estimate’s ability to replace it')
    assert not errors,errors
    assert not any('huggingface' in r or 'jsdelivr' in r for r in requests),requests
    b.close()
srv.shutdown()
