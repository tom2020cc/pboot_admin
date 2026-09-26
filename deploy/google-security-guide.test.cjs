const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
test('Google guide separates public checks, account permission and index state', () => {
  const guide = JSON.parse(read('frontend/src/content/deployment-guide.json'));
  const chapter = guide.chapters.find(c => c.id === 'google-seo-20260914');
  const text = JSON.stringify(chapter);
  for (const phrase of ['尚未配置 Google 服务账号', '44', '435', '66', '76', 'Sitemap', 'Indexing API', '不等于', '不上传']) {
    assert.ok(text.includes(phrase), phrase);
  }
  assert.ok(chapter.steps.find(s => s.id === 'google-robots-sitemap').media.includes('google-public-verified'));
});
test('security guide preserves incomplete and heuristic boundaries', () => {
  const guide = JSON.parse(read('frontend/src/content/deployment-guide.json'));
  const text = JSON.stringify(guide.chapters.find(c => c.id === 'server-security-20260914'));
  for (const phrase of ['1191', 'Kernel.php', '8MB', '不解压', '默认关闭', '不删除', '不是代码备份', 'ClamAV']) assert.ok(text.includes(phrase), phrase);
});
test('Google page no longer tells normal product sites to enable both APIs', () => {
  const html = read('tools/seo_publish_tool/public/index.html');
  assert.ok(!html.includes('启用两个 API'));
  assert.ok(!html.includes('/tutorials/google-cloud-project-api.svg'));
  assert.ok(html.includes('/tutorials/google-sitemap-workflow.svg'));
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('security filters keep a usable search column on desktop and mobile', () => {
  const html = read('tools/ftp_publish_tool/public/server-security.html');
  assert.ok(html.includes('grid-template-columns:180px minmax(0,1fr)'));
  assert.ok(html.includes('.filter-row{grid-template-columns:1fr}'));
});
