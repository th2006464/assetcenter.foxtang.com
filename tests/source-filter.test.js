const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = {searchInput:{value:''}};
const context = vm.createContext({
  localStorage:{getItem:()=>null},
  document:{addEventListener:()=>{},getElementById:id=>elements[id]||null}
});
vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);
vm.runInContext(fs.readFileSync('js/app.js','utf8'),context);
context.sample = [
  {serial_number:'A',computer_name:'ALPHA',has_agent:1,has_asset:0},
  {serial_number:'B',computer_name:'BETA',has_agent:0,has_asset:1},
  {serial_number:'C',computer_name:'GAMMA',has_agent:1,has_asset:1}
];
vm.runInContext('allDevices=sample; render=()=>{}',context);
const ids=()=>Array.from(vm.runInContext('getFilteredSorted()',context),d=>d.serial_number).sort();
assert.deepEqual(ids(),['A','C'],'默认列表仅显示 Agent 记录');
vm.runInContext("setSourceFilter('agent')",context);
assert.deepEqual(ids(),['A','C'],'上传视图应包含已合并设备');
vm.runInContext("setSourceFilter('asset')",context);
assert.deepEqual(ids(),['C'],'默认向日葵来源筛选显示已上报且匹配资产的设备');
vm.runInContext("setSourceFilter('asset')",context);
assert.deepEqual(ids(),['A','C'],'重复点击恢复默认 Agent 列表');
vm.runInContext("setSourceFilter('agent')",context);
elements.searchInput.value='GAMMA';
assert.deepEqual(ids(),['C'],'来源筛选和搜索应同时生效');
elements.searchInput.value='';vm.runInContext("sourceFilter='';showUnreportedOnly=true",context);assert.deepEqual(ids(),['B'],'未上报设备独立视图');
console.log('source filter tests passed');
