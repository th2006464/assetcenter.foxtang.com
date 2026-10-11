import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import ams from '../backend/ams.js';
import {testDatabase} from './support/d1.mjs';
const env={ACCESS_TEAM_DOMAIN:'records-test.cloudflareaccess.com',ACCESS_AUD:'asset-aud',ADMIN_EMAILS:'th2006464@gmail.com',API_KEY:'agent-key'};
const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'records-tests',alg:'RS256'});
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[jwk]});test.after(()=>globalThis.fetch=originalFetch);
async function send(DB,path,body,method='PATCH',email='th2006464@gmail.com'){
 const token=await new SignJWT({email,type:'app'}).setProtectedHeader({alg:'RS256',kid:'records-tests'}).setSubject(email).setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
 return ams.fetch(new Request('https://ams.foxtang.com'+path,{method,headers:{'Cf-Access-Jwt-Assertion':token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...env,DB});
}
const refs=[{source:'agent',serial_number:'SN-1',computer_name:'SAME-PC'},{source:'asset',serial_number:'3100-SN-1',computer_name:'SAME-PC'}];
function fixture(){
 const db=testDatabase();db.sqlite.exec(`INSERT INTO devices (serial_number,computer_name,report_time,script_version,windows_user) VALUES ('SN-1','SAME-PC','2026-10-11T00:00:00Z','1.3-auto','old'),('SN-2','SAME-PC','2026-10-11T00:00:00Z','1.3-auto','other'); INSERT INTO asset_inventory (serial_number,computer_name,device_name,asset_note) VALUES ('3100-SN-1','SAME-PC','asset one','old note'),('SN-2','SAME-PC','asset two','keep');`);return db;
}
test('device data retains exact source keys across SQL join and frontend legacy reconciliation',async()=>{
 const {DB}=fixture();const r=await send(DB,'/devices',undefined,'GET');assert.equal(r.status,200);const rows=await r.json();
 assert.ok(rows.every(row=>Array.isArray(row.record_refs)&&row.record_refs.length),'every row has source references');
 const context=vm.createContext({document:{getElementById:()=>null}});vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);context.rows=rows;
 const merged=Array.from(vm.runInContext('reconcileDevices(rows)',context));
 const a=merged.find(row=>row.serial_number==='SN-1');assert.equal(a.has_asset,1);assert.deepEqual(JSON.parse(JSON.stringify(a.record_refs)),refs);
 const b=merged.find(row=>row.serial_number==='SN-2');assert.deepEqual(JSON.parse(JSON.stringify(b.record_refs)),[{source:'agent',serial_number:'SN-2',computer_name:'SAME-PC'},{source:'asset',serial_number:'SN-2',computer_name:'SAME-PC'}]);
});
test('detail returns original editable values for each underlying source',async()=>{
 const {DB}=fixture();const r=await send(DB,'/admin/records/detail',{refs},'POST');assert.equal(r.status,200);const {records}=await r.json();assert.equal(records[0].fields.windows_user,'old');assert.equal(records[1].fields.asset_note,'old note');assert.equal(records[0].fields.serial_number,undefined);assert.equal(records[0].fields.computer_name,undefined);
});
test('ordinary users cannot edit, delete or fetch management details',async()=>{
 const {DB,sqlite}=fixture();for(const [path,method] of [['/admin/records','PATCH'],['/admin/records','DELETE'],['/admin/records/detail','POST']]){const r=await send(DB,path,{refs},method,'viewer@example.com');assert.equal(r.status,403);}assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);
});
test('rejects attempts to edit serial number or computer name, including asset name key',async()=>{
 const {DB,sqlite}=fixture();for(const [key,value] of [['serial_number','SN-NEW'],['computer_name','NEW-PC'],['asset_computer_name','NEW-PC']]){
 const r=await send(DB,'/admin/records',{refs,changes:[{source:'agent',serial_number:'SN-1',fields:{[key]:value}}]});assert.equal(r.status,400);
 }assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n,0);
});
test('updates both sources precisely and records actor, before and after',async()=>{
 const {DB,sqlite}=fixture();const r=await send(DB,'/admin/records',{refs,changes:[{source:'agent',serial_number:'SN-1',fields:{windows_user:'new user',c_drive_free_gb:0}},{source:'asset',serial_number:'3100-SN-1',fields:{asset_note:'new note',device_name:'new label'}}]});assert.equal(r.status,200);
 assert.equal(sqlite.prepare("SELECT windows_user FROM devices WHERE serial_number='SN-1'").get().windows_user,'new user');assert.equal(sqlite.prepare("SELECT windows_user FROM devices WHERE serial_number='SN-2'").get().windows_user,'other');
 const audit=sqlite.prepare('SELECT * FROM admin_audit').get();assert.equal(audit.actor_email,'th2006464@gmail.com');assert.equal(audit.action,'edit');assert.match(audit.before_json,/old note/);assert.match(audit.after_json,/new note/);
});
test('invalid fields, invalid numbers and foreign source targets cause no partial writes',async()=>{
 const {DB,sqlite}=fixture();for(const fields of [{random:'x'},{c_drive_free_gb:-1},{c_drive_total_gb:'garbage'},{report_time:''}]){
 const r=await send(DB,'/admin/records',{refs,changes:[{source:'asset',serial_number:'3100-SN-1',fields:{asset_note:'must not write'}},{source:'agent',serial_number:'SN-1',fields}]});assert.equal(r.status,400);
 }
 const r=await send(DB,'/admin/records',{refs,changes:[{source:'agent',serial_number:'SN-2',fields:{windows_user:'wrong'}}]});assert.equal(r.status,400);assert.equal(sqlite.prepare("SELECT asset_note FROM asset_inventory WHERE serial_number='3100-SN-1'").get().asset_note,'old note');
});
test('deletes merged raw source keys while retaining another same-name device',async()=>{
 const {DB,sqlite}=fixture();const r=await send(DB,'/admin/records',{refs},'DELETE');assert.equal(r.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,1);assert.equal(sqlite.prepare('SELECT action FROM admin_audit').get().action,'delete');
 // No tombstone: machine report recreates the deleted serial.
 const payload={SerialNumber:'SN-1',ComputerName:'SAME-PC',WindowsUser:'fresh',OutlookAccount:'',Manufacturer:'',Model:'',OSName:'Windows',ReportTime:'2026-10-11T00:01:00Z',ScriptVersion:'1.3-auto'};
 const report=await ams.fetch(new Request('https://ams.foxtang.com/report',{method:'POST',headers:{'X-Api-Key':env.API_KEY},body:JSON.stringify(payload)}),{...env,DB});assert.equal(report.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);
 const imported=await send(DB,'/import-assets',{devices:[{serial_number:'3100-SN-1',computer_name:'SAME-PC'}]},'POST');assert.equal(imported.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,2);
});
test('missing or renamed source causes conflict without deleting the other source',async()=>{
 const {DB,sqlite}=fixture();sqlite.exec("UPDATE asset_inventory SET computer_name='RENAMED' WHERE serial_number='3100-SN-1'");const r=await send(DB,'/admin/records',{refs},'DELETE');assert.equal(r.status,409);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n,0);
});
test('audit failure rolls back deletes and imports',async t=>{
 t.mock.method(console,'error',()=>{});
 const {DB,sqlite}=fixture();sqlite.exec('DROP TABLE admin_audit');const r=await send(DB,'/admin/records',{refs},'DELETE');assert.equal(r.status,500);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);
 const imported=await send(DB,'/import-assets',{devices:[{serial_number:'NEW'}]},'POST');assert.equal(imported.status,500);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,2);
});
test('null computer-name reference matches null asset name and SQL-like serial stays literal',async()=>{
 const {DB,sqlite}=fixture();const sn="x' OR 1=1 --";sqlite.prepare('INSERT INTO asset_inventory (serial_number) VALUES (?)').run(sn);const r=await send(DB,'/admin/records',{refs:[{source:'asset',serial_number:sn,computer_name:null}]},'DELETE');assert.equal(r.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,2);
});
test('identity change between lookup and batch makes all deletes a no-op',async()=>{
 const {DB,sqlite}=fixture();const original=DB.batch;DB.batch=async statements=>{sqlite.exec("UPDATE asset_inventory SET computer_name='RACE' WHERE serial_number='3100-SN-1'");return original(statements);};
 const r=await send(DB,'/admin/records',{refs},'DELETE');assert.equal(r.status,409);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM asset_inventory').get().n,2);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n,0);
});
test('concurrent Agent field update before edit commit rejects stale audit',async()=>{
 const {DB,sqlite}=fixture();const original=DB.batch;DB.batch=async statements=>{sqlite.exec("UPDATE devices SET windows_user='fresh report' WHERE serial_number='SN-1'");return original(statements);};
 const r=await send(DB,'/admin/records',{refs,changes:[{source:'agent',serial_number:'SN-1',fields:{windows_user:'edited'}}]});assert.equal(r.status,409);assert.equal(sqlite.prepare("SELECT windows_user FROM devices WHERE serial_number='SN-1'").get().windows_user,'fresh report');assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n,0);
});
