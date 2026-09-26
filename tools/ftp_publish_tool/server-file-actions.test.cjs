const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServerSecurity, scopeFor } = require('./server-security');
const { relativePath, parentHandle } = require('./server-file-actions');

async function fixture(run) {
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'file-actions-')));
  const root = path.join(temp, 'site'), directory = path.join(temp, 'managed');
  fs.mkdirSync(root); fs.mkdirSync(directory);
  const site = { id: 1, rootPath: root, directory, name: 'Test only' }, manager = createServerSecurity();
  const write = (name, data) => { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
  write('static/test.php', '<?php echo "fixture"; // <img src=x onerror=alert(1)>');
  const scan = async () => { await manager.start(site).promise; return manager.status(site).report; };
  const body = () => ({ path: 'static/test.php', reportId: manager.status(site).report.id });
  try { await scan(); await run({ temp, root, site, manager, write, scan, body }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test('read is bounded plaintext; report never includes source or a receipt', () => fixture(({ manager, site, body }) => {
  const p = manager.inspect(site, body(), 'user-a');
  assert.match(p.content, /<img/); assert.match(p.hash, /^[a-f0-9]{64}$/); assert.match(p.receipt, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(manager.status(site)).includes(p.receipt));
  assert(!JSON.stringify(manager.status(site)).includes('onerror=alert'));
}));

test('requires current finding, matching site and report, safe paths, and complete scan hash', () => fixture(({ manager, site, body, root }) => {
  for (const p of ['../secret', '/etc/passwd', 'C:/secret', 'a\\b', 'a/../b', 'a//b', 'x\0y', '.', '__proto__']) {
    assert.throws(() => manager.inspect(site, { ...body(), path: p }));
  }
  assert.throws(() => manager.inspect(site, { ...body(), reportId: 'old' }));
  assert.throws(() => manager.inspect({ ...site, id: 2 }, body()));
  fs.writeFileSync(path.join(root, 'safe.txt'), 'not a finding');
  assert.throws(() => manager.inspect(site, { ...body(), path: 'safe.txt' }));
  const reportFile = path.join(scopeFor(site).directory, 'latest.json'), report = JSON.parse(fs.readFileSync(reportFile));
  delete report.files['static/test.php']; fs.writeFileSync(reportFile, JSON.stringify(report));
  assert.throws(() => manager.inspect(site, body()), /指纹/);
}));

test('trust requires read, confirmation, reason, same actor and same hash; can be revoked', () => fixture(({ manager, site, body, root }) => {
  const p = manager.inspect(site, body(), 'user-a');
  const b = { ...body(), receipt: p.receipt, confirm: true, reason: 'Verified vendor file' };
  assert.throws(() => manager.fileAction(site, 'trust', { ...b, confirm: false }, 'user-a'));
  assert.throws(() => manager.fileAction(site, 'trust', { ...b, reason: '' }, 'user-a'));
  assert.throws(() => manager.fileAction(site, 'trust', b, 'user-b'));
  assert.throws(() => manager.fileAction(site, 'trust', { ...b, receipt: 'wrong' }, 'user-a'));
  manager.fileAction(site, 'trust', b, 'user-a');
  let s = createServerSecurity().status(site);
  assert.equal(s.trusted.length, 1); assert.equal(s.report.high, 0); assert(s.report.findings.every(f => f.trusted));
  assert.equal(s.report.canAdopt, false); assert(fs.existsSync(path.join(root, b.path)));
  assert.throws(() => manager.fileAction(site, 'trust', b, 'user-a'));
  assert.throws(() => manager.fileAction({ ...site, id: 2 }, 'untrust', { id: s.trusted[0].id, confirm: true }));
  manager.fileAction(site, 'untrust', { id: s.trusted[0].id, confirm: true }, 'user-a');
  s = manager.status(site); assert.equal(s.trusted.length, 0); assert(s.report.high > 0); assert.equal(s.audit.length, 2);
}));

test('changed files reject old previews; new scan alerts again even after trust', () => fixture(async ({ manager, site, write, scan, body }) => {
  const p = manager.inspect(site, body());
  manager.fileAction(site, 'trust', { ...body(), receipt: p.receipt, reason: 'Known version', confirm: true });
  const second = manager.inspect(site, body());
  write(body().path, '<?php echo "changed fixture";');
  for (const kind of ['trust', 'quarantine']) assert.throws(() => manager.fileAction(site, kind, { ...body(), receipt: second.receipt, reason: 'x', confirm: true }), /变化/);
  assert.throws(() => manager.inspect(site, body()), /变化/);
  await scan(); assert(manager.status(site).report.high > 0); assert(manager.status(site).report.findings.every(f => !f.trusted));
}));

test('quarantine moves outside webroot; restore is exact and does not overwrite', () => fixture(({ manager, site, root, body }) => {
  const original = fs.readFileSync(path.join(root, body().path));
  const p = manager.inspect(site, body(), 'a');
  manager.fileAction(site, 'quarantine', { ...body(), receipt: p.receipt, confirm: true }, 'a');
  assert(!fs.existsSync(path.join(root, body().path)));
  let s = manager.status(site), q = s.quarantine[0];
  assert.equal(q.status, 'quarantined'); assert(s.report.findings.every(f => f.quarantined));
  const isolated = path.join(scopeFor(site).directory, 'quarantine', `${q.id}.bin`);
  assert.deepEqual(fs.readFileSync(isolated), original);
  fs.writeFileSync(path.join(root, q.path), 'new file');
  assert.throws(() => manager.fileAction(site, 'restore', { id: q.id, confirm: true }), /不能覆盖/);
  assert.equal(fs.readFileSync(path.join(root, q.path), 'utf8'), 'new file');
  fs.unlinkSync(path.join(root, q.path));
  manager.fileAction(site, 'restore', { id: q.id, confirm: true }, 'a');
  assert.deepEqual(fs.readFileSync(path.join(root, q.path)), original); assert(!fs.existsSync(isolated));
  assert.equal(manager.status(site).quarantine[0].status, 'restored');
  assert.throws(() => manager.fileAction(site, 'restore', { id: q.id, confirm: true }));
}));

test('hardlinks, swapped ancestor links and changed quarantine blobs fail closed', () => fixture(({ manager, site, root, temp, body }) => {
  const p = manager.inspect(site, body());
  fs.linkSync(path.join(root, body().path), path.join(temp, 'alias.php'));
  assert.throws(() => manager.fileAction(site, 'quarantine', { ...body(), receipt: p.receipt, confirm: true }), /普通文件/);
  fs.unlinkSync(path.join(temp, 'alias.php'));
  fs.renameSync(path.join(root, 'static'), path.join(temp, 'outside'));
  fs.symlinkSync(path.join(temp, 'outside'), path.join(root, 'static'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => manager.inspect(site, body()), /链接/);
  fs.unlinkSync(path.join(root, 'static'));
  fs.renameSync(path.join(temp, 'outside'), path.join(root, 'static'));
  manager.fileAction(site, 'quarantine', { ...body(), receipt: p.receipt, confirm: true });
  const q = manager.status(site).quarantine[0], isolated = path.join(scopeFor(site).directory, 'quarantine', `${q.id}.bin`);
  fs.writeFileSync(isolated, 'tampered');
  assert.throws(() => manager.fileAction(site, 'restore', { id: q.id, confirm: true }), /变化/);
  assert(!fs.existsSync(path.join(root, q.path)));
}));

test('sensitive and binary findings only show metadata; large text preview is truncated', () => fixture(async ({ manager, site, write, scan }) => {
  write('static/private.key', '<?php echo "private fixture";');
  write('static/binary.php', Buffer.from([0, 1, 2, 255]));
  write('static/long.php', '<?php echo "fixture";' + 'a'.repeat(150000)); await scan();
  const reportId = manager.status(site).report.id;
  assert(manager.inspect(site, { path: 'static/private.key', reportId }).sensitive);
  assert(manager.inspect(site, { path: 'static/binary.php', reportId }).binary);
  const long = manager.inspect(site, { path: 'static/long.php', reportId });
  assert(long.truncated); assert.equal(long.content.length, 128 * 1024);
}));

test('busy scans and publishing block file reads and actions; no automatic dispositions', () => fixture(async ({ site, manager, body }) => {
  const blocked = createServerSecurity({ busy: () => true });
  assert.throws(() => blocked.inspect(site, body()), /正在执行/);
  assert.throws(() => blocked.fileAction(site, 'trust', { ...body(), confirm: true }), /正在执行/);
  const job = manager.start(site);
  assert.throws(() => manager.inspect(site, body()), /正在执行/); await job.promise;
  assert.deepEqual(manager.status(site).trusted, []); assert.deepEqual(manager.status(site).quarantine, []);
}));

test('path normalization is restrictive and parent handles cannot escape', () => fixture(({ root }) => {
  for (const p of ['/absolute', '../up', 'a\\b', 'a:b', 'a//b']) assert.throws(() => relativePath(p));
  const parent = parentHandle(root, 'static/test.php');
  try { assert(fs.readFileSync(parent.file, 'utf8').includes('<?php')); } finally { parent.close(); }
}));

test('browser source uses textContent for code and explicit confirmation for destructive actions', () => {
  const js = fs.readFileSync(path.join(__dirname, 'public/server-security.js'), 'utf8');
  assert.match(js, /\$\('fileContent'\)\.textContent = result.content/);
  assert(!/fileContent[^\n]*innerHTML/.test(js));
  assert.match(js, /receipt: preview.receipt/); assert.match(js, /if \(!confirm\(message\)\) return/);
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(server, /Cache-Control', 'no-store/); assert.match(server, /req.method === 'POST'.*server-security\/read/);
});
