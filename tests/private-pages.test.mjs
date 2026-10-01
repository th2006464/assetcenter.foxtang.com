import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
test('anonymous private deep links are guarded before static assets',async()=>{for(const path of ['/devices','/devices.html','/dashboard','/dashboard.html','/compare','/compare.html']){let reached=false;const response=await onRequest({request:new Request('https://assetcenter.foxtang.com'+path),env:{},next:()=>{reached=true;return new Response('private');}});assert.equal(reached,false);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/?login=1');assert.equal(response.headers.get('cache-control'),'no-store');}});
test('public login remains reachable without business identity',async()=>{const response=await onRequest({request:new Request('https://assetcenter.foxtang.com/?login=1'),env:{},next:()=>new Response('manual login')});assert.equal(await response.text(),'manual login');});
