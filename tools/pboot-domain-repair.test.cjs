const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repair = require('./pboot-domain-repair');
const source = `<?php\nnamespace app\\common;\nuse core\\basic\\Config;\nuse core\\basic\\Controller;\nclass HomeController extends Controller {\npublic function __construct() {\n${repair.ORIGINAL}\n}\n// custom site code stays\npublic function custom() { return 'custom'; }\n}\n`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-domain-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, repair.FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return { root, file };
}

test('minimal local repair preserves custom code and CRLF; repeated clicks are no-ops', t => {
  const { root, file } = fixture(t);
  fs.writeFileSync(file, source.replace(/\n/g, '\r\n'));
  const p = repair.readLocal(root);
  assert.equal(p.changed, true);
  const r = repair.repairLocal(root, p.hash);
  assert.equal(r.changed, true);
  const fixed = fs.readFileSync(file, 'utf8');
  assert.ok(fixed.includes("return 'custom'"));
  assert.ok(fixed.includes('\r\n'));
  assert.equal(repair.repairLocal(root, r.hash).changed, false);
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
});

test('stale files, unrecognized edits, and duplicate matching code refuse replacement', t => {
  const { root, file } = fixture(t);
  const p = repair.readLocal(root);
  fs.appendFileSync(file, '\n// changed');
  assert.throws(() => repair.repairLocal(root, p.hash), /已经变化/);
  assert.throws(() => repair.transform(source.replace("$value['domain'] == $domain", 'custom_check()')), /不兼容/);
  assert.throws(() => repair.transform(source + repair.ORIGINAL), /不兼容/);
});

test('hard-linked local programs are rejected', t => {
  const { root, file } = fixture(t);
  fs.linkSync(file, path.join(root, 'another-site.php'));
  assert.throws(() => repair.readLocal(root), /普通文件/);
});

const config = { host: 'fixture.invalid', user: 'test', password: 'test', secure: true, remoteRoot: '/site' };
function ftpFixture(options = {}) {
  const files = new Map([['HomeController.php', options.source || source]]);
  let renamed = 0, uploaded = 0, reads = 0, closed = false;
  const client = {
    async access() {}, async cd() {},
    async list() { return ['site', 'apps', 'common'].map(name => ({ name, isDirectory: true })).concat([...files.keys()].map(name => ({ name, isFile: true }))); },
    async downloadTo(stream, name) {
      if (name === 'HomeController.php' && ++reads === 2 && options.concurrent) files.set(name, source + '// new edit');
      stream.end(Buffer.from(files.get(name)));
      await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
    },
    async uploadFrom(stream, name) { let data = ''; for await (const chunk of stream) data += chunk; files.set(name, options.corrupt ? data + 'corrupt' : data); uploaded++; },
    async rename(from, to) { renamed++; files.set(to, files.get(from)); files.delete(from); },
    async remove(name) { files.delete(name); }, close() { closed = true; },
  };
  return { client, files, stats: () => ({ renamed, uploaded, closed }) };
}

test('remote repair preserves online customizations and verifies the atomic upload', async () => {
  const f = ftpFixture({ source: source.replace("return 'custom'", "return 'online-only'") });
  const result = await repair.syncRemote(config, () => f.client);
  assert.equal(result.verified, true);
  assert.ok(f.files.get('HomeController.php').includes("return 'online-only'"));
  assert.deepEqual(f.stats(), { renamed: 1, uploaded: 1, closed: true });
  assert.equal(f.files.size, 1);
  assert.equal((await repair.syncRemote(config, () => f.client)).changed, false);
  assert.equal(f.stats().uploaded, 1);
});

test('corrupt upload or concurrent remote change never replaces the existing program', async () => {
  for (const option of [{ corrupt: true }, { concurrent: true }]) {
    const f = ftpFixture(option);
    await assert.rejects(repair.syncRemote(config, () => f.client), /校验失败|其他操作修改/);
    assert.equal(f.stats().renamed, 0);
    assert.equal(f.files.size, 1);
    assert.equal(f.files.get('HomeController.php'), source + (option.concurrent ? '// new edit' : ''));
  }
});

test('unknown online version does not upload any file', async () => {
  const f = ftpFixture({ source: source.replace('count($lgs) > 1', 'count($lgs) > 5') });
  await assert.rejects(repair.syncRemote(config, () => f.client), /不兼容/);
  assert.equal(f.stats().uploaded, 0);
});

test('generated PHP runs: bound domains override stale cookies; unbound local hosts retain language', { skip: !process.env.PB_TEST_PHP }, t => {
  const { root, file } = fixture(t);
  repair.repairLocal(root, repair.readLocal(root).hash);
  const harness = path.join(root, 'test.php');
  fs.writeFileSync(harness, `<?php
namespace core\\basic { class Controller {} class Config { public static function get($n) { return [['acode'=>'en','domain'=>'shanbo-rig.com, www.shanbo-rig.com'],['acode'=>'cn','domain'=>'cn.shanbo-rig.com']]; } } }
namespace app\\common { function get_http_host(){return $GLOBALS['host'];} function cookie($n,$v){$_COOKIE[$n]=$v;} }
namespace { require __DIR__.'/apps/common/HomeController.php';
foreach ([['shanbo-rig.com','cn','en'],['www.shanbo-rig.com','cn','en'],['WWW.SHANBO-RIG.COM.','cn','en'],['cn.shanbo-rig.com','en','cn'],['shanbo-rig.c','cn','cn'],['badshanbo-rig.com','cn','cn']] as $case) {
$GLOBALS['host']=$case[0]; $_COOKIE['lg']=$case[1]; new \\app\\common\\HomeController(); if($_COOKIE['lg']!==$case[2]) throw new \\Exception('wrong language');
} echo '6 PHP behavior checks passed'; }
`);
  const result = spawnSync(process.env.PB_TEST_PHP, [harness], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /6 PHP behavior checks passed/);
});
