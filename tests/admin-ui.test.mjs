import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function runtime(){
 const elements={importSunBtn:{hidden:false},sessionIdentity:{hidden:true,textContent:''},searchInput:{value:''},deviceBody:{innerHTML:''},resultCount:{textContent:''},pageSizeSelect:{value:'20'},paginationInfo:{textContent:''},prevPageBtn:{},nextPageBtn:{},pageInfo:{},colToggles:null};
 const ths=Array.from({length:17},()=>({dataset:{},hidden:false}));ths.push({dataset:{},hidden:true,hasAttribute:name=>name==='data-admin-column'});
 const context=vm.createContext({console,localStorage:{getItem:()=>null},document:{addEventListener:()=>{},getElementById:id=>elements[id]||null,querySelectorAll:selector=>selector.includes('thead th')?ths:[]},location:{},AbortSignal,Response,fetch:async()=>Response.json({authenticated:true,user:{email:'viewer@example.com',role:'user'}})});
 vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);
 if(fs.existsSync('js/admin.js'))vm.runInContext(fs.readFileSync('js/admin.js','utf8'),context);
 vm.runInContext(fs.readFileSync('js/app.js','utf8'),context);
 return {context,elements,ths};
}
test('ordinary session hides import and management controls without changing device rows',async()=>{
 const {context,elements,ths}=runtime();await vm.runInContext('requireSession()',context);
 assert.equal(vm.runInContext('typeof syncAdminControls',context),'function','administrator controls must exist');
 vm.runInContext('syncAdminControls();allDevices=[{serial_number:"A",computer_name:"PC",has_agent:1,record_refs:[{source:"agent",serial_number:"A",computer_name:"PC"}]}];updateSortIndicators=()=>{};renderPagination=()=>{};render()',context);
 assert.equal(elements.importSunBtn.hidden,true);assert.equal(ths.at(-1).hidden,true);assert.doesNotMatch(elements.deviceBody.innerHTML,/data-record-action/);assert.match(elements.deviceBody.innerHTML,/PC/);
});
test('administrator gets row actions and exact source refs, failure to resolve identity stays read-only',async()=>{
 const {context,elements,ths}=runtime();context.fetch=async()=>Response.json({authenticated:true,user:{email:'th2006464@gmail.com',role:'admin'}});await vm.runInContext('requireSession()',context);
 assert.equal(vm.runInContext('typeof syncAdminControls',context),'function');
 vm.runInContext('syncAdminControls();allDevices=[{serial_number:"A",computer_name:"PC",has_agent:1,record_refs:[{source:"agent",serial_number:"A",computer_name:"PC"}]}];updateSortIndicators=()=>{};renderPagination=()=>{};render()',context);
 assert.equal(elements.importSunBtn.hidden,false);assert.equal(ths.at(-1).hidden,false);assert.match(elements.deviceBody.innerHTML,/data-record-action="edit"/);assert.match(elements.deviceBody.innerHTML,/data-record-action="delete"/);
 context.fetch=async()=>{throw new Error('offline');};await vm.runInContext('requireSession()',context);vm.runInContext('syncAdminControls()',context);assert.equal(elements.importSunBtn.hidden,true);
});
test('administrator import confirms count then submits without password or key header',async()=>{
 const {context}=runtime();context.fetch=async()=>Response.json({authenticated:true,user:{email:'th2006464@gmail.com',role:'admin'}});await vm.runInContext('requireSession()',context);
 context.modalCalls=[];context.importCalls=[];
 vm.runInContext(`parseSunlogin=()=>({rows:[]});readFileText=async()=>'';toImportRecords=()=>({records:[{serial_number:'A'}],total:1,skipped:[]});showSunError=()=>{};openModal=async opts=>{modalCalls.push(opts);return true;};postImport=async(...args)=>{importCalls.push(args);};`,context);
 await vm.runInContext("importSunFile({name:'sun.csv'})",context);
 assert.equal(context.modalCalls.length,1,'no password modal');assert.equal(context.importCalls[0].length,3,'only records, total and skipped are passed');
});
test('saving one field preserves untouched blank and multiline source values',()=>{
 const {context}=runtime();
 context.records=[{source:'asset',serial_number:'A',fields:{asset_note:'line one\nline two',asset_group:'',device_name:'old'}}];
 context.inputs=[{dataset:{sourceIndex:'0',field:'asset_note'},value:'line oneline two'},{dataset:{sourceIndex:'0',field:'asset_group'},value:''},{dataset:{sourceIndex:'0',field:'device_name'},value:'new'}];
 context.originals=new Map([[context.inputs[0],'line oneline two'],[context.inputs[1],''],[context.inputs[2],'old']]);
 assert.equal(vm.runInContext('typeof collectRecordChanges',context),'function');
 const result=vm.runInContext('collectRecordChanges(records,inputs,originals)',context);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[{source:'asset',serial_number:'A',fields:{device_name:'new'}}]);
});
