const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const searchInput={value:''};
const context=vm.createContext({localStorage:{getItem:()=>null},document:{addEventListener:()=>{},getElementById:id=>id==='searchInput'?searchInput:null}});
vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);
vm.runInContext(fs.readFileSync('js/app.js','utf8'),context);
context.rows=[
  {serial_number:'A',management_status:'managed',has_agent:1,has_asset:1},
  {serial_number:'B',management_status:'agent_missing',has_agent:0,has_asset:1},
  {serial_number:'C',management_status:'asset_missing',has_agent:1,has_asset:0}
];
vm.runInContext('allDevices=rows',context);
const ids=()=>Array.from(vm.runInContext('getFilteredSorted()',context),d=>d.serial_number).sort();
assert.deepEqual(ids(),['A','B','C']);
/* 管理状态列与高级筛选里的「纳管状态」多选都已下线，只剩看板下钻的单状态筛选 */
vm.runInContext("activeFilter={key:'manage',value:'managed'}",context);
assert.deepEqual(ids(),['A'],'看板下钻「正常纳管」应只留 A');
vm.runInContext("sourceFilter='agent'",context);
assert.deepEqual(ids(),['A'],'来源筛选与纳管下钻应叠加');
vm.runInContext("sourceFilter='';activeFilter={key:'manage',value:'asset_missing'}",context);
assert.deepEqual(ids(),['C'],'看板下钻换状态应继续生效');
console.log('manage filter tests passed');
