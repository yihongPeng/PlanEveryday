const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('desktop UI includes local content policy and quick entry', () => {
 const html = fs.readFileSync(path.join(__dirname, '../src/ui/index.html'), 'utf8');
 assert.match(html, /Content-Security-Policy/);
 assert.match(html, /id="quick-title"/);
});
