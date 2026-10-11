import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { verifyAccess, accessToken } from '../backend/access.js';
import ams from '../backend/ams.js';
import { onRequest } from '../functions/api/[[path]].js';
const env = {ACCESS_TEAM_DOMAIN:'teams-9dr-pages.cloudflareaccess.com', ACCESS_AUD:'assetcenter-aud', API_KEY:'test-agent-key', IMPORT_KEY:'test-import-key', ADMIN_EMAILS:'admin@example.com'};
test('identity validates issuer, audience, expiry and user claims', async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const make=(aud,exp='5m')=>new SignJWT({email:'admin@example.com',type:'app'}).setProtectedHeader({alg:'RS256'}).setSubject('u').setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(aud).setExpirationTime(exp).sign(privateKey);
 assert.equal((await verifyAccess(await make(env.ACCESS_AUD),env,publicKey)).email,'admin@example.com');
 assert.equal(await verifyAccess(await make('other'),env,publicKey),null);
 assert.equal(await verifyAccess(await make(env.ACCESS_AUD,'-1s'),env,publicKey),null);
 assert.equal(await verifyAccess('forged',env,publicKey),null);
});
test('anonymous source endpoints deny data, machine credentials remain enforced',async()=>{
 for(const path of ['/devices','/assets']) assert.equal((await ams.fetch(new Request('https://ams.foxtang.com'+path),env)).status,401);
 assert.equal((await ams.fetch(new Request('https://ams.foxtang.com/report'),env)).status,405);
 assert.equal((await ams.fetch(new Request('https://ams.foxtang.com/report',{method:'POST',body:'{}'}),env)).status,401);
 assert.equal((await ams.fetch(new Request('https://ams.foxtang.com/import-assets',{method:'POST',body:'{}'}),env)).status,401);
});
test('authenticated machine report still executes its original database write',async()=>{
 let writes=0;const DB={prepare:()=>({bind:()=>({run:async()=>{writes++;return {success:true}}})})};
 const response=await ams.fetch(new Request('https://ams.foxtang.com/report',{method:'POST',headers:{'X-Api-Key':env.API_KEY,'Content-Type':'application/json'},body:JSON.stringify({serial_number:'test-sn'})}),{...env,DB});
 assert.equal(response.status,200); assert.equal(writes,1);
});
test('alias APIs and anonymous canonical API deny requests',async()=>{
 for(const host of ['asset-center.pages.dev','rmm.foxtang.com','assetcenter.foxtang.com']){
  const r=await onRequest({request:new Request('https://'+host+'/api/devices'),env});assert.ok([401,404].includes(r.status));
 }
});
test('token parser can read Access cookie without trusting email headers',()=>{
 assert.equal(accessToken(new Request('https://assetcenter.foxtang.com/',{headers:{cookie:'x=y; CF_Authorization=abc'}})),'abc');
 assert.equal(accessToken(new Request('https://assetcenter.foxtang.com/',{headers:{'Cf-Access-Authenticated-User-Email':'admin@example.com'}})),'');
});
test('import still requires its independent key and accepts authenticated valid input',async()=>{
 const r=await ams.fetch(new Request('https://ams.foxtang.com/import-assets',{method:'POST',headers:{'X-Import-Key':env.IMPORT_KEY,'Content-Type':'application/json'},body:'{"devices":[]}'}),env);
 assert.equal(r.status,200);
 const incorrect=await ams.fetch(new Request('https://ams.foxtang.com/import-assets',{method:'POST',headers:{'X-Import-Key':env.API_KEY},body:'{"devices":[]}'}),env);
 assert.equal(incorrect.status,401);
});

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('live production Agent implementation remains byte-identical',()=>{
 const source=readFileSync('backend/ams.js','utf8');
 const start=source.indexOf('    if (url.pathname === "/report")');
 const block=source.slice(start,source.indexOf('    // =====================================\n    // POST /import-assets',start)).trimEnd();
 assert.equal(createHash('sha256').update(block).digest('hex'),readFileSync('tests/support/live-report.sha256','utf8').trim());
});

test('verified import proxy forwards independent key and rejects cross-origin writes',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'proxy-test',alg:'RS256'});
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[jwk]});
 try {
  const token=await new SignJWT({email:'admin@example.com',type:'app'}).setProtectedHeader({alg:'RS256',kid:'proxy-test'}).setSubject('u').setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
  let observed;const AMS={fetch:async request=>{observed=request;return Response.json({imported:0});}};
  const headers={Origin:'https://assetcenter.foxtang.com','Cf-Access-Jwt-Assertion':token,'X-Import-Key':'import-test','Content-Type':'application/json'};
  const request=new Request('https://assetcenter.foxtang.com/api/import-assets',{method:'POST',headers,body:'{"devices":[]}'});
  const response=await onRequest({request,env:{...env,AMS}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(new URL(observed.url).pathname,'/import-assets');assert.equal(observed.headers.get('X-Import-Key'),'import-test');assert.equal(observed.headers.get('Cf-Access-Jwt-Assertion'),token);
  const forbidden=await onRequest({request:new Request(request.url,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'}),env:{...env,AMS}});
  assert.equal(forbidden.status,403);
 } finally {globalThis.fetch=originalFetch;}
});
