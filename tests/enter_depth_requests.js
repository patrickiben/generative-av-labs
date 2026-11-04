#!/usr/bin/env node
'use strict';
// Exercise the real depth-client request routing with an intentionally out-of-order fake worker.
// No model, network or GPU is needed. A single overwriteable onmessage callback fails this test.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
let run = 0, hang = false;
class FakeWorker {
  postMessage(m) {
    if (m.type === 'load') return setTimeout(() => this.onmessage({data:{id:m.id,type:'ready',ms:1,threads:1}}), 0);
    if (hang) return;
    const which = ++run, values = which === 1 ? [0,1,2,3] : [3,2,1,0];
    setTimeout(() => this.onmessage({data:{id:m.id,type:'depth',ms:1,dims:[1,1,2,2],data:Float32Array.from(values)}}), which === 1 ? 30 : 3);
  }
  terminate() {}
}
const browser = {caches:{open:async()=>({match:async()=>({arrayBuffer:async()=>new ArrayBuffer(8)})}), delete:async()=>true}};
const context = {window:browser,navigator:{},Worker:FakeWorker,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},AbortController,setTimeout,Map,Uint8Array,Float32Array,
  document:{createElement:()=>({width:0,height:0,getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)})};}})}};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/enter-workers.js'),'utf8'),context);
context.KitDepth=browser.KitDepth;
(async()=>{
 const depth=browser.EnterDepth.create(()=>{});await depth.load();
 const bounded=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('Request did not settle')),200))]);
 const [first,second]=await bounded(Promise.all([depth.estimate({width:20,height:20},2,2),depth.estimate({width:20,height:20},2,2)]));
 assert(first.depth[0]<first.depth[3]);assert(second.depth[0]>second.depth[3]);
 console.log('PASS overlapping estimates resolve to their own image even when replies arrive out of order');
 hang=true;const stopped=depth.estimate({width:20,height:20},2,2).then(()=>{throw Error('A removed worker should reject');},e=>e.message);
 await depth.clear();assert.match(await bounded(stopped),/removed/);assert.equal(depth.ready,false);
 console.log('PASS removing the model rejects pending estimates rather than leaving them hung');
})().catch(e=>{console.error(e);process.exitCode=1});
