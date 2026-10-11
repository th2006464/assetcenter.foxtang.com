import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import ams from '../backend/ams.js';
import {onRequest as proxy} from '../functions/api/[[path]].js';
import {onRequest as session} from '../functions/session.js';
import {testDatabase} from './support/d1.mjs';
const env={ACCESS_TEAM_DOMAIN:'admin-test.cloudflareaccess.com',ACCESS_AUD:'asset-aud',ADMIN_EMAILS:'th2006464@gmail.com',API_KEY:'agent-key',IMPORT_KEY:'machine-import-key'};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'admin-tests',alg:'RS256'});
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>Response.json({keys:[jwk]});
test.after(()=>{globalThis.fetch=originalFetch;});
async function token(email){return new SignJWT({email,type:'app'}).setProtectedHeader({alg:'RS256',kid:'admin-tests'}).setSubject(email).setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);}
async function request(path,email,body,method='POST',extra={}) {
 return new Request('https://assetcenter.foxtang.com'+path,{method,headers:{Origin:'https://assetcenter.foxtang.com','Cf-Access-Jwt-Assertion':await token(email),'Content-Type':'application/json',...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
test('session identifies only configured verified administrator and retains ordinary identity',async()=>{
 for(const [email,role] of [['th2006464@gmail.com','admin'],['viewer@example.com','user']]){
  const r=await session({request:await request('/session',email,undefined,'GET'),env});
  const value=await r.json();assert.equal(value.authenticated,true);assert.ok(value.user,'session must expose verified identity');assert.equal(value.user.email,email);assert.equal(value.user.role,role);
 }
});
test('ordinary user cannot import through Pages even with machine import key',async()=>{
 let called=false;
 const r=await proxy({request:await request('/api/import-assets','viewer@example.com',{devices:[]},'POST',{'X-Import-Key':env.IMPORT_KEY}),env:{...env,AMS:{fetch:()=>{called=true;return Response.json({});}}}});
 assert.equal(r.status,403);assert.equal(called,false);
});
test('AMS independently denies ordinary-user import with correct machine key',async()=>{
 const {DB,sqlite}=testDatabase();
 const r=await ams.fetch(await request('/import-assets','viewer@example.com',{devices:[{serial_number:'blocked'}]},'POST',{'X-Import-Key':env.IMPORT_KEY}),{...env,DB});
 assert.equal(r.status,403);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,0);
});
test('administrator imports without password and operation is audited',async()=>{
 const {DB,sqlite}=testDatabase();
 const r=await ams.fetch(await request('/import-assets','th2006464@gmail.com',{devices:[{serial_number:'A',computer_name:'PC-A',device_name:'Asset A'}]}),{...env,DB});
 assert.equal(r.status,200);assert.equal(sqlite.prepare('SELECT device_name FROM asset_inventory WHERE serial_number=?').get('A').device_name,'Asset A');
 assert.equal(sqlite.prepare('SELECT actor_email FROM admin_audit').get().actor_email,'th2006464@gmail.com');
});
test('administrator proxy supports passwordless import, PATCH and DELETE with origin enforcement',async()=>{
 for(const [path,method] of [['/api/import-assets','POST'],['/api/admin/records','PATCH'],['/api/admin/records','DELETE'],['/api/admin/records/detail','POST']]){
  let upstream;
  const binding={fetch:r=>{upstream=r;return Response.json({success:true});}};
  const r=await proxy({request:await request(path,'th2006464@gmail.com',{},method),env:{...env,AMS:binding}});
  assert.equal(r.status,200);assert.equal(upstream.method,method);assert.equal(upstream.headers.get('X-Import-Key'),null);
  const denied=await proxy({request:await request(path,'th2006464@gmail.com',{},method,{Origin:'https://evil.example'}),env:{...env,AMS:binding}});
  assert.equal(denied.status,403);
 }
});
test('live Agent ingestion writes VPN version and retains prior VPN values on empty later report',async()=>{
 const {DB,sqlite}=testDatabase();
 const send=data=>ams.fetch(new Request('https://ams.foxtang.com/report',{method:'POST',headers:{'X-Api-Key':env.API_KEY,'Content-Type':'application/json'},body:JSON.stringify(data)}),{...env,DB});
 const payload={SerialNumber:'LIVE',ComputerName:'LIVE-PC',WindowsUser:'alice',OutlookAccount:'alice@example.com',Manufacturer:'Dell',Model:'Model',OSName:'Windows 11',ReportTime:'2026-10-11T00:00:00Z',ScriptVersion:'1.3-auto',FortiClientVersion:'7.4',FortiClientUser:'alice-vpn',FortiClientLastSeen:'2026-10-11T00:00:00Z',CDriveTotalGB:200,CDriveFreeGB:80};
 assert.equal((await send(payload)).status,200);
 assert.equal(sqlite.prepare('SELECT forticlient_version FROM devices').get().forticlient_version,'7.4');
 assert.equal((await send({...payload,FortiClientVersion:'',FortiClientUser:'',CDriveFreeGB:null})).status,200);
 const row=sqlite.prepare('SELECT * FROM devices').get();assert.equal(row.forticlient_version,'7.4');assert.equal(row.forticlient_user,'alice-vpn');assert.equal(row.c_drive_free_gb,80);
});
test('large import reads existing snapshots in bounded queries and commits one batch',async()=>{
 const {DB,sqlite}=testDatabase();let reads=0,batches=0;
 const prepare=DB.prepare;DB.prepare=sql=>{if(sql.startsWith('SELECT'))reads++;return prepare(sql);};
 const batch=DB.batch;DB.batch=async statements=>{batches++;return batch(statements);};
 const records=Array.from({length:449},(_,index)=>({serial_number:'BULK-'+index,computer_name:'PC-'+index}));
 const r=await ams.fetch(await request('/import-assets','th2006464@gmail.com',{devices:records}),{...env,DB});
 assert.equal(r.status,200);assert.ok(reads<=5,'449 rows must not make 449 sequential snapshot queries');assert.equal(batches,1);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,449);
});
test('repeat import splits audit snapshots below D1 row byte limit',async()=>{
 const {DB,sqlite}=testDatabase();
 sqlite.exec(`CREATE TRIGGER audit_size BEFORE INSERT ON admin_audit WHEN length(CAST(NEW.before_json AS BLOB))+length(CAST(NEW.after_json AS BLOB))+length(CAST(NEW.records_json AS BLOB)) > 2000000 BEGIN SELECT RAISE(ABORT,'D1 row limit'); END;`);
 const records=Array.from({length:120},(_,index)=>({serial_number:'NOTE-'+index,computer_name:'PC-'+index,asset_note:'n'.repeat(9000)}));
 assert.equal((await ams.fetch(await request('/import-assets','th2006464@gmail.com',{devices:records}),{...env,DB})).status,200);
 const r=await ams.fetch(await request('/import-assets','th2006464@gmail.com',{devices:records}),{...env,DB});
 assert.equal(r.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,120);
 assert.ok(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n>=3);
});
test('concurrent asset change before import commit returns conflict instead of logging stale data',async()=>{
 const {DB,sqlite}=testDatabase();sqlite.exec("INSERT INTO asset_inventory (serial_number,asset_note) VALUES ('CAS','initial')");
 const batch=DB.batch;DB.batch=async statements=>{sqlite.exec("UPDATE asset_inventory SET asset_note='concurrent' WHERE serial_number='CAS'");return batch(statements);};
 const r=await ams.fetch(await request('/import-assets','th2006464@gmail.com',{devices:[{serial_number:'CAS',asset_note:'imported'}]}),{...env,DB});
 assert.equal(r.status,409);assert.equal(sqlite.prepare("SELECT asset_note FROM asset_inventory WHERE serial_number='CAS'").get().asset_note,'concurrent');assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n,0);
});
