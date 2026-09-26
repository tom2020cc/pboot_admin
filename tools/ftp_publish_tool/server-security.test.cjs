const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSite, scopeFor, normalizeSettings, createServerSecurity, publicReport, serverContentRules } = require('./server-security');
async function fixture(run) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'server-security-'));
  const root = path.join(temp, 'site'), directory = path.join(temp, 'managed');
  fs.mkdirSync(root); fs.mkdirSync(directory);
  const site = { id: 1, rootPath: root, directory, name: 'Fixture' };
  const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
  try { await run({ temp, root, directory, site, write }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
test('read-only scan detects webshell rule, disguised script and static PHP without exposing content', () => fixture(async ({ site, root, write }) => {
  const malicious = '<?php eval(base64_decode($_POST["x"]));';
  // Exercise payload rules in memory; host antivirus may remove executable fixtures on disk.
  assert(serverContentRules(Buffer.from(malicious), 'test.php').some(rule => rule.severity === 'high'));
  const harmless = '<?php echo "fixture";';
  write('static/upload/photo.jpg.php', harmless); write('static/test.jpg', harmless);
  const report = await scanSite(site);
  assert(report.high >= 3, JSON.stringify(report)); assert.equal(report.canAdopt, false);
  assert.equal(fs.readFileSync(path.join(root, 'static/upload/photo.jpg.php'), 'utf8'), harmless);
  assert(!JSON.stringify(publicReport(report)).includes(malicious));
  assert(!JSON.stringify(publicReport(report)).includes('"files":'));
}));
test('baseline detects new, modified and missing files and rejects other site fingerprint', () => fixture(async ({ site, root, write }) => {
  write('a.txt', 'a'); write('b.txt', 'b');
  const first = await scanSite(site); assert.equal(first.canAdopt, true);
  const baseline = { fingerprint: first.fingerprint, files: first.files };
  write('a.txt', 'new'); write('new.txt', 'new'); fs.unlinkSync(path.join(root, 'b.txt'));
  const second = await scanSite(site, undefined, baseline);
  assert.equal(second.newFiles, 1); assert.equal(second.changedFiles, 1); assert.equal(second.missingFiles, 1);
  const third = await scanSite(site, undefined, { ...baseline, fingerprint: 'another-site' });
  assert.equal(third.changedFiles, 0); assert.equal(third.newFiles, 0);
}));
test('symlink escape is skipped and report cannot be adopted', () => fixture(async ({ site, temp, root, write }) => {
  write('safe.txt', 'safe'); const outside = path.join(temp, 'private'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'PRIVATE');
  fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await scanSite(site); assert.equal(result.complete, false); assert.equal(result.scanned, 1); assert.equal(result.canAdopt, false);
  assert(!JSON.stringify(result).includes('PRIVATE')); assert(!result.files['link/secret.txt']);
}));
test('hard links and oversized files are not read or trusted', () => fixture(async ({ site, root, write }) => {
  write('source.txt', 'safe'); fs.linkSync(path.join(root, 'source.txt'), path.join(root, 'link.txt'));
  write('large.bin', Buffer.alloc(1024 * 1024 + 1));
  const r = await scanSite(site, { maxFileMB: 1 }); assert.equal(r.complete, false); assert.equal(r.skipped, 3);
}));
test('cancelled scan and limits are incomplete, never clean', () => fixture(async ({ site, write }) => {
  write('a.txt', 'a'); const signal = AbortSignal.abort();
  const r = await scanSite(site, undefined, null, { signal }); assert(r.cancelled); assert(!r.complete); assert(!r.canAdopt);
  for (let i = 0; i < 101; i++) write(`${i}.txt`, 'x');
  assert.equal((await scanSite(site, { maxFiles: 100 })).complete, false);
}));
test('scope rejects system roots, relative roots and report storage under public root', () => fixture(async ({ site, root }) => {
  assert.throws(() => scopeFor({ ...site, rootPath: path.parse(root).root }));
  assert.throws(() => scopeFor({ ...site, rootPath: '../' }));
  assert.throws(() => scopeFor({ ...site, directory: root }));
}));
test('manager defaults off, persists per-site settings and refuses overlapping jobs', () => fixture(async ({ site, write }) => {
  write('a.txt', 'a'); const manager = createServerSecurity({ listSites: () => [site] });
  assert.equal(manager.status(site).settings.enabled, false);
  manager.configure(site, { enabled: false, intervalMinutes: 30, maxFiles: 100, maxFileMB: 1 });
  const job = manager.start(site); assert.throws(() => manager.start(site), /已有/);
  await job.promise;
  const state = manager.status(site); assert(state.report.complete);
  assert.throws(() => manager.adopt(site, 'wrong-id'));
  manager.adopt(site, state.report.id); assert.equal(manager.status(site).baseline.count, 1);
  assert.equal(createServerSecurity().status(site).settings.intervalMinutes, 30);
}));
test('high-risk and incomplete results cannot become baselines', () => fixture(async ({ site, write }) => {
  write('static/eval.php', '<?php eval($_POST["code"]);');
  const manager = createServerSecurity(), job = manager.start(site); await job.promise;
  assert.throws(() => manager.adopt(site, manager.status(site).report.id), /无高/);
}));
test('server settings reject nonfinite and out of range input', () => {
  for (const intervalMinutes of [0, NaN, Infinity, 'x', -3]) assert.throws(() => normalizeSettings({ intervalMinutes }));
  assert.throws(() => normalizeSettings({ maxFiles: 1000000 }));
});
test('random JPEG bytes are not PHP code, while readable injected code remains detected', () => {
  const random = Buffer.from('ffd83c3f3d1fedc6b3f444cbcadccebde8799ee481f8e2', 'hex');
  assert.equal(serverContentRules(random, 'static/a.jpg').length, 0);
  for (const payload of ['<?php echo "中文";?>', '<?= $a; ?>', '<?php system($_GET["x"]);']) {
    assert(serverContentRules(Buffer.concat([random, Buffer.from(payload)]), 'static/a.jpg').some(r => r.id === 'php-in-static-file'));
  }
});
