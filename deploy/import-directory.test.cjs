const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test');
const ts = require('../frontend/node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/utils/import-directory.ts'), 'utf8');
const context = { exports: {}, URL };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { describeImportDirectory: directory, describeImportSource: environment } = context.exports;

test('server hierarchy highlights the exact leaf and site-relative depth', () => {
  const result = directory('/www/wwwroot/site/static/Rigs/RC Drilling Rigs/', '/www/wwwroot/site');
  assert.equal(result.leaf, 'RC Drilling Rigs');
  assert.equal(result.depth, 3);
  assert.equal(result.rootDepth, 3);
  assert.equal(directory('/www/wwwroot/site', '/www/wwwroot/site').scope, '网站根目录');
  assert.equal(directory('/', '/').depth, 0);
});
test('outside roots and unresolved paths are visibly distinguished', () => {
  assert.equal(directory('/www/site-other/static', '/www/site').withinRoot, false);
  assert.equal(directory('/www/site/../private', '/www/site').relative, true);
  assert.equal(directory('/www/SITE/static', '/www/site').withinRoot, false);
  assert.equal(directory('E:\\WWW\\Site\\产品', 'e:/www/site/').depth, 1);
  assert.equal(directory('\\\\nas\\share\\products', '//nas/share').depth, 1);
  assert.equal(directory('', '/www/site').scope, '尚未选择目录');
});
test('the connection target distinguishes server from local, not path syntax', () => {
  assert.equal(environment('/api', 'https://admin.shanbo-rig.com').label, '服务器目录');
  assert.equal(environment('http://localhost:5108', 'http://localhost:5278').label, '本机后台目录');
  assert.equal(environment('http://127.0.0.1:5108', 'https://admin.example.com').local, true);
  assert.equal(environment('http://[::1]:5108', 'http://localhost').local, true);
  assert.equal(environment('https://api.example.com', 'http://localhost:5278').local, false);
  assert.equal(environment('http://192.168.1.10:5108', 'http://localhost').local, false);
});
