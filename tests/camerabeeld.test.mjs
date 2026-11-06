import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function setup() {
  const pending = []; const timers = new Map(); let seq = 0;
  class Image {
    hidden = false; dataset = {}; textContent = ''; src = ''; alt = '';
    constructor() { pending.push(this); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const code = ts.transpileModule(readFileSync(new URL('../web/src/camerabeeld.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const context = { exports:{}, Image, Date, setTimeout:(fn)=>{timers.set(++seq,fn);return seq;}, clearTimeout:(id)=>timers.delete(id) };
  vm.runInNewContext(code,context);
  const image = new Image(); const status = new Image(); const empty = new Image(); pending.length = 0;
  const loader = context.exports.maakCamerabeeld(image,status,empty);
  return { image,status,empty,pending,loader,timers };
}
const a = {id:'camera.a',naam:'Voordeur'}; const b = {id:'camera.b',naam:'Tuin'};
test('switching cameras clears the old image and ignores a late response',()=>{
  const f=setup(); f.loader.zet(a); const first=f.pending[0]; const late=first.onload;
  f.loader.zet(b);
  assert.equal(f.image.hidden,true); assert.equal(f.image.src,'');
  late(); assert.equal(f.image.src,'');
  f.pending[1].onload(); assert.match(f.image.src,/camera.b/); assert.match(f.image.alt,/Tuin/);
});
test('refresh failure preserves only the last image from the same camera',()=>{
  const f=setup(); f.loader.zet(a); f.pending[0].onload(); const source=f.image.src;
  f.loader.ververs(); f.pending[1].onerror();
  assert.equal(f.image.src,source); assert.equal(f.image.hidden,false);
  assert.equal(f.status.dataset.status,'fout'); assert.match(f.status.textContent,/laatste beeld/);
  f.loader.ververs(); f.pending[2].onload(); assert.equal(f.status.dataset.status,'klaar');
});
test('a stalled request times out and can recover on the next refresh',()=>{
  const f=setup(); f.loader.zet(a); [...f.timers.values()][0]();
  assert.equal(f.status.dataset.status,'fout'); assert.equal(f.image.hidden,true);
  f.loader.ververs(); f.pending[1].onload(); assert.equal(f.image.hidden,false);
});
test('refreshes do not overlap and clearing a camera invalidates pending work',()=>{
  const f=setup(); f.loader.zet(a); const late=f.pending[0].onload;
  f.loader.ververs(); f.loader.ververs(); assert.equal(f.pending.length,1);
  f.loader.zet(null); late(); assert.equal(f.image.src,''); assert.equal(f.image.hidden,true);
  assert.equal(f.timers.size,0);
});

test('renaming a camera updates its label without restarting an in-flight image',()=>{
  const f=setup(); f.loader.zet(a); f.loader.zet({...a,naam:'Ingang'});
  assert.match(f.image.alt,/Ingang/); assert.equal(f.pending.length,1);
  f.pending[0].onload(); assert.match(f.image.alt,/Ingang/);
});
