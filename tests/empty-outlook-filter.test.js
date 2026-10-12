const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const searchInput={value:''};
const context=vm.createContext({localStorage:{getItem:()=>null},document:{addEventListener:()=>{},getElementById:id=>id==='searchInput'?searchInput:null}});
vm.runInContext(fs.readFileSync('js/common.js','utf8'),context);
vm.runInContext(fs.readFileSync('js/app.js','utf8'),context);
context.rows=[
 {serial_number:'A',has_agent:1,outlook_account:'user@garchina.com'},
 {serial_number:'B',has_agent:1,outlook_account:''},
 {serial_number:'C',has_agent:1,outlook_account:'  '},
 {serial_number:'D',has_agent:1,outlook_account:null},
 {serial_number:'E',has_agent:0,has_asset:1,outlook_account:''}
];
vm.runInContext('allDevices=rows',context);
const ids=()=>Array.from(vm.runInContext('getFilteredSorted()',context),d=>d.serial_number).sort();
assert.deepEqual(ids(),['A','B','C','D'],'默认不影响列表');
vm.runInContext('emptyOutlookOnly=true',context);
assert.deepEqual(ids(),['B','C','D'],'筛选空值、空格和 null');
vm.runInContext('showUnreportedOnly=true',context);
assert.deepEqual(ids(),['E'],'可叠加未上报视图');
console.log('empty Outlook filter tests passed');
