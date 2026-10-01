import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
test('API authentication loss uses fixed login target, server failures stay visible',async()=>{let target='';const context=vm.createContext({fetch:async input=>String(input)==='/session'?Response.json({authenticated:false}):new Response('{}',{status:401}),location:{replace:url=>target=url},Response,document:{documentElement:{dataset:{}}},matchMedia:()=>({matches:false})});vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);await assert.rejects(vm.runInContext("authenticatedFetch('/api/devices')",context));assert.equal(target,'/auth/login');target='';context.fetch=async()=>new Response('unavailable',{status:503});assert.equal((await vm.runInContext("authenticatedFetch('/api/devices')",context)).status,503);assert.equal(target,'');});

test('import wrong password 401 does not restart authentication',async()=>{let target='';const context=vm.createContext({fetch:async input=>String(input)==='/session'?Response.json({authenticated:true}):new Response('bad password',{status:401}),location:{replace:url=>target=url},Response});vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);assert.equal((await vm.runInContext("authenticatedFetch('/api/import-assets')",context)).status,401);assert.equal(target,'');});
