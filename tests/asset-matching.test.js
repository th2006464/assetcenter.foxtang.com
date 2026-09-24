const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ localStorage: { getItem: () => null }, document: { addEventListener: () => {} } });
vm.runInContext(fs.readFileSync('js/common.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), context);

const imported = vm.runInContext("toImportRecords([{note:'3101466-5CD5203BVK',dev:'SH15005035'}]).records[0]", context);
assert.equal(imported.serial_number, '5CD5203BVK', '导入时取备注中的硬件 SN');
assert.equal(imported.asset_note, '3101466-5CD5203BVK', '完整备注仍需保留');

const rows = [
  {serial_number:'5CD5203BVK', computer_name:'SH15005035', has_agent:1, has_asset:0, report_time:'2026-09-24T02:23:06Z', management_status:'asset_missing'},
  {serial_number:'3101466-5CD5203BVK', computer_name:'SH15005035', has_agent:0, has_asset:1, sun_status:'在线', asset_note:'3101466-5CD5203BVK', management_status:'agent_missing'}
];
context.input = rows;
const merged = vm.runInContext('reconcileDevices(input)', context);
assert.equal(merged.length, 1, '已入库的前缀 SN 应合并');
assert.equal(merged[0].serial_number, '5CD5203BVK');
assert.equal(merged[0].sun_status, '在线');
assert.equal(merged[0].management_status, 'managed');
assert.equal(merged[0].has_asset, 1);
assert.equal(merged[0].report_time, '2026-09-24T02:23:06Z');
console.log('asset matching tests passed');
