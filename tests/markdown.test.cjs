const test=require('node:test'),assert=require('node:assert/strict');
const markdown=require('../src/ui/markdown.js');
const {render}=markdown;
test('local attachment images render and fenced code is highlighted safely',()=>{const html=render('![图](plan-image://local/'+'a'.repeat(64)+'.png)\n\n```js\nconst value = "<script>";\n```');assert.match(html,/<img/);assert.match(html,/hljs-keyword/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(render('![](file:///C:/secret.png)'),/<img/);assert.match(render('```unknown\n<tag>\n```'),/&lt;tag&gt;/);});
test('Markdown renders structure, table and escaped code',()=>{const html=render('# 标题\n\n**重点**\n\n- 条目\n\n> 引用\n\n```js\nconst x = "<tag>";\n```\n\n| 项目 | 内容 |\n| --- | --- |\n| A | B |');for(const pattern of [/<h1\b[^>]*>标题/,/<strong>重点/,/<li>条目/,/<blockquote>/,/<pre><code/,/&lt;tag&gt;/,/md-table-scroll/,/<table>/])assert.match(html,pattern);});
test('Markdown cannot execute raw HTML, dangerous links or remote image requests',()=>{const html=render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![图片](https://example.com/tracker.png)');assert.doesNotMatch(html,/<script|<img|href="javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/图片/);});

test('document outline uses real Markdown headings and ignores code and escaped hashes',()=>{
 assert.equal(typeof markdown.renderDocument,'function');
 const source='# 中文 **核心**\n\n### 使用 `code` 与 [链接](https://example.com)\n\n下划线标题\n---\n\n```md\n# 代码里的标题\n```\n\n    # 缩进代码\n\n\\# 普通文字\n\n###### 六级';
 const doc=markdown.renderDocument(source);
 assert.deepEqual(doc.headings.map(h=>[h.level,h.text]),[[1,'中文 核心'],[3,'使用 code 与 链接'],[2,'下划线标题'],[6,'六级']]);
 assert.equal(doc.html,render(source));
 for(const h of doc.headings)assert.ok(doc.html.includes(`id="${h.id}"`));
 assert.match(doc.html,/hljs/);
});
test('outline assigns unique safe anchors for duplicate, empty and hostile titles',()=>{
 assert.equal(typeof markdown.renderDocument,'function');
 const doc=markdown.renderDocument('# A\n\n# A\n\n# A-2\n\n# A\n\n#\n\n# 😀\n\n# <img src=x onerror=alert(1)>\n\n# ![图说明](https://example.com/x.png)');
 const ids=doc.headings.map(h=>h.id);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ids)assert.match(id,/^memory-heading-[\p{L}\p{N}\p{M}_-]+$/u);
 assert.equal(doc.headings[4].text,'未命名标题');
 assert.equal(doc.headings.at(-1).text,'图说明');
 assert.doesNotMatch(doc.html,/<img|<script/);
 assert.deepEqual(markdown.renderDocument('普通正文').headings,[]);
 assert.deepEqual(markdown.renderDocument('# A').headings,markdown.renderDocument('# A').headings);
});
