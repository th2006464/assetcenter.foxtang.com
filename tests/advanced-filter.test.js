const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const block = html.match(/<details\b([^>]*)\bid="advancedFilter"([^>]*)>([\s\S]*?)<\/details>/);
assert.ok(block, '高级筛选应使用原生折叠控件');
assert.doesNotMatch(block[1] + block[2], /\bopen\b/, '首次打开页面时应收起');
assert.match(block[3], /<summary\b[^>]*>\s*高级筛选\s*<\/summary>/);
for (const id of ['colToggles', 'showAllColsBtn', 'showAgentBtn', 'showAssetBtn', 'importSunBtn', 'manageFilterWrap']) {
  assert.match(block[3], new RegExp(`\\bid="${id}"`), `${id} 应位于折叠区域内`);
}
console.log('advanced filter tests passed');
