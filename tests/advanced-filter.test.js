const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('devices.html', 'utf8');
const block = html.match(/<details\b([^>]*)\bid="advancedFilter"([^>]*)>([\s\S]*?)<\/details>/);
assert.ok(block, '隐藏列选项应使用原生折叠控件');
assert.doesNotMatch(block[1] + block[2], /\bopen\b/, '首次打开页面时应收起');
assert.match(block[3], /<summary\b[^>]*>\s*隐藏列选项\s*<\/summary>/);
for (const id of ['colToggles', 'showAllColsBtn']) {
  assert.ok(block[3].includes('id="' + id + '"'), id + ' 应位于隐藏列折叠区域内');
}
for (const id of ['showAgentBtn', 'showAssetBtn', 'showUnreportedBtn', 'showDuplicateNamesBtn', 'showEmptyOutlookBtn', 'importSunBtn']) {
  assert.ok(!block[3].includes('id="' + id + '"'), id + ' 不应位于隐藏列折叠区域内');
  assert.ok(html.includes('id="' + id + '"'), id + ' 应保留在页面中');
}
assert.match(html, /<span class="colbar-title">高级筛选<\/span>/);
console.log('advanced filter tests passed');
