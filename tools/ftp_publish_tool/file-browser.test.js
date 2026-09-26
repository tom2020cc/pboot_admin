const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listLocal, listRemote, selection, createFileBrowser, relativePath } = require('./file-browser');
const { uploadFiles, collectFiles } = require('./upload-to-ftp');
const { PRODUCT_SPECS_FILES } = require('./template-dependencies');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-browser-test-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('file-browser-test-')) throw Error('Unsafe fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('template/cn/index.html', 'new-template'); write('static/photo.jpg', 'new-image'); write('data/site.db', 'db'); write('config/config.php', 'config'); write('.env', 'secret');
  return { site: { id: 1, name: 'Fixture', rootPath: root }, config: { host: 'mock.invalid', user: 'fixture', password: 'test', remoteRoot: '/htdocs', maxRetries: 1 }, write };
}
test('lists current-site root and protects environment configuration by default', t => {
  const { site } = fixture(t); const result = listLocal(site);
  assert.equal(result.root, fs.realpathSync(site.rootPath));
  assert.ok(result.items.find(item => item.name === 'data').blocked);
  assert.ok(!result.items.find(item => item.name === 'template').blocked);
  const normal = selection(site, ['template', 'data', 'config', '.env'], false);
  assert.deepEqual(normal.files.map(file => file.relativePath), ['template/cn/index.html']); assert.equal(normal.skipped.length, 3);
  const explicit = selection(site, ['data', 'config', '.env'], true);
  assert.equal(explicit.files.length, 2); assert.equal(explicit.skipped.length, 1);
});
test('rejects traversal, absolute paths and links outside site root', t => {
  const { site } = fixture(t);
  for (const bad of ['../other', '/etc', 'C:/secret', 'template/../../secret', 'a\\b']) assert.throws(() => relativePath(bad));
  fs.symlinkSync(os.tmpdir(), path.join(site.rootPath, 'outside'), 'junction');
  assert.throws(() => listLocal(site, 'outside'), /链接/);
});
test('deduplicates selected directories and rejects changed target, site or files', t => {
  const { site, config, write } = fixture(t); const manager = createFileBrowser();
  const plan = manager.prepare(site, config, { siteId: 1, paths: ['template', 'template/cn/index.html'] });
  assert.equal(plan.total, 1);
  assert.throws(() => manager.consume({ ...site, id: 2 }, config, { siteId: 2, token: plan.token }), /失效/);
  assert.throws(() => manager.consume(site, { ...config, remoteRoot: '/other' }, { siteId: 1, token: plan.token }), /变化/);
  write('template/cn/index.html', 'changed-content');
  assert.throws(() => manager.consume(site, config, { siteId: 1, token: plan.token }), /文件已变化/);
});
function mockClient(remote, links = new Set()) {
  let current = '/';
  return { ftp: {}, access: async () => {}, pwd: async () => current,
    cd: async value => { current = path.posix.resolve(current, value); },
    list: async () => {
      const prefix = current.replace(/\/$/, '') + '/'; const entries = new Map();
      for (const file of [...Object.keys(remote), ...links]) if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length), name = rest.split('/')[0];
        entries.set(name, { name, type: links.has(prefix + name) ? 3 : rest.includes('/') ? 2 : 1, size: rest.includes('/') ? 0 : Buffer.byteLength(remote[file] || '') });
      }
      return [...entries.values()];
    },
    ensureDir: async value => { current = path.posix.resolve(current, value); },
    uploadFrom: async (local, name) => { remote[path.posix.resolve(current, name)] = fs.readFileSync(local, 'utf8'); },
    downloadTo: async (target, name) => { const data = remote[path.posix.resolve(current, name)]; if (data === undefined) throw Error('550 missing'); await new Promise((resolve, reject) => { target.on('error', reject); target.end(Buffer.from(data), resolve); }); }, close() {},
  };
}
test('reconnects after FIN and retries directory reads with fresh clients', async () => {
  let created = 0, closed = 0;
  const result = await listRemote({ host: 'fixture', user: 'test', password: 'test', remoteRoot: '/', browserRetryDelayMs: 0 }, '', () => {
    const attempt = ++created;
    return { access: async () => { if (attempt === 1) throw Error('Server sent FIN packet unexpectedly, closing connection.'); },
      list: async () => { if (attempt === 2) throw Error('ECONNRESET'); return [{ name: 'index.php', type: 1, size: 12 }]; },
      pwd: async () => '/', close: () => { closed++; } };
  });
  assert.equal(created, 3); assert.equal(closed, 3); assert.equal(result.items[0].name, 'index.php');
});
test('explains repeated early disconnect without changing connection security', async () => {
  let attempts = 0;
  await assert.rejects(listRemote({ host: 'fixture', user: 'test', password: 'test', secure: true, browserRetryDelayMs: 0 }, '', () => ({
    ftp: { socket: { bytesRead: 0 } }, access: async options => { attempts++; assert.equal(options.secure, true); throw Error('Server sent FIN packet unexpectedly, closing connection.'); }, close() {},
  })), /已自动重试 2 次.*欢迎信息前/);
  assert.equal(attempts, 3);
});
test('does not retry incorrect login credentials', async () => {
  let attempts = 0;
  await assert.rejects(listRemote({ host: 'fixture', user: 'test', password: 'test', browserRetryDelayMs: 0 }, '', () => ({
    access: async () => { attempts++; throw Object.assign(Error('530 Login incorrect'), { code: 530 }); }, close() {},
  })), /登录被拒绝/);
  assert.equal(attempts, 1);
});
test('uploads exact paths, overwrites same-size binary files and keeps unrelated files', async t => {
  const { site, config } = fixture(t), manager = createFileBrowser();
  const plan = manager.prepare(site, config, { siteId: 1, paths: ['template', 'static/photo.jpg'] });
  const selected = manager.consume(site, config, { siteId: 1, token: plan.token });
  const remote = { '/htdocs/template/cn/index.html': 'old-template', '/htdocs/static/photo.jpg': 'old-image', '/htdocs/keep.txt': 'keep' };
  const result = await uploadFiles(selected.config, selected.files, { beforeFile: selected.beforeFile, clientFactory: () => mockClient(remote) });
  assert.equal(result.uploaded, 2); assert.equal(result.skipped, 0); assert.equal(result.backedUp, 0);
  assert.equal(remote['/htdocs/template/cn/index.html'], 'new-template'); assert.equal(remote['/htdocs/static/photo.jpg'], 'new-image'); assert.equal(remote['/htdocs/keep.txt'], 'keep');
  assert.throws(() => manager.consume(site, config, { siteId: 1, token: plan.token }), /失效/);
});
test('remote browsing and upload reject linked directories', async t => {
  const { site, config } = fixture(t), manager = createFileBrowser(), remote = {}, links = new Set(['/htdocs/template']);
  await assert.rejects(listRemote(config, 'template', () => mockClient(remote, links)), /链接/);
  const plan = manager.prepare(site, config, { siteId: 1, paths: ['template'] });
  const selected = manager.consume(site, config, { siteId: 1, token: plan.token });
  await assert.rejects(uploadFiles(selected.config, selected.files, { beforeFile: selected.beforeFile, clientFactory: () => mockClient(remote, links) }), /链接/);
  assert.equal(Object.keys(remote).length, 0);
});

function productSpecsFixture(t) {
  const data = fixture(t);
  data.write('template/cn/index.html', '{include file=comm/home_product_specs.html}');
  data.write('template/cn/comm/home_product_specs.html', '[list:product_specs]');
  data.write(PRODUCT_SPECS_FILES[0], '{"cn":{}}');
  data.write(PRODUCT_SPECS_FILES[1], '<?php class ProductSpecsRenderer {}');
  data.write(PRODUCT_SPECS_FILES[2], '<?php function getProductSpecFields() {}');
  data.write(PRODUCT_SPECS_FILES[3], "<?php switch($x) { case 'product_specs': ProductSpecsRenderer::render(); }");
  return data;
}

test('message templates include the verified submission controller and no visitor database', t => {
  const { site, config, write } = fixture(t), manager = createFileBrowser();
  write('template/en/index.html', '{include file=comm/message.html}');
  write('template/en/comm/message.html', '<form action="{pboot:msgaction}"></form>');
  write('apps/home/controller/MessageController.php', '<?php class MessageController {}');
  const plan = manager.prepare(site, config, { siteId: 1, paths: ['template/en/index.html'] });
  assert.equal(plan.dependencies.length, 1);
  assert.equal(plan.files[0].relativePath, 'apps/home/controller/MessageController.php');
  assert.equal(plan.files.some(f => /^(data|config)\//.test(f.relativePath)), false);
  write('apps/home/controller/MessageController.php', '<?php class MessageController { /* changed */ }');
  assert.throws(() => manager.consume(site, config, { siteId: 1, token: plan.token }), /文件已变化/);
  fs.unlinkSync(path.join(site.rootPath, 'apps/home/controller/MessageController.php'));
  assert.throws(() => selection(site, ['template/en/comm/message.html'], false), /依赖不完整/);
});

test('template-only plans include all four providers before templates, without environment data', t => {
  const { site, config } = productSpecsFixture(t), manager = createFileBrowser();
  const plan = manager.prepare(site, config, { siteId: 1, paths: ['template'] });
  assert.equal(plan.dependencies.length, 4);
  assert.deepEqual(plan.files.slice(0, 4).map(f => f.relativePath), PRODUCT_SPECS_FILES);
  assert.equal(plan.files.some(f => /^(data|config)\//.test(f.relativePath)), false);
  const partial = selection(site, ['template/cn/index.html'], false);
  assert.equal(partial.dependencies.length, 4, 'include references also need providers');
  assert.equal(selection(site, ['static/photo.jpg'], false).dependencies.length, 0);
});

test('missing or outdated template dependencies block preview; changed dependencies invalidate it', t => {
  const { site, config, write } = productSpecsFixture(t), manager = createFileBrowser();
  const plan = manager.prepare(site, config, { siteId: 1, paths: ['template'] });
  write(PRODUCT_SPECS_FILES[0], '{"cn":{"changed":true}}');
  assert.throws(() => manager.consume(site, config, { siteId: 1, token: plan.token }), /文件已变化/);
  write(PRODUCT_SPECS_FILES[3], '<?php // outdated parser');
  assert.throws(() => selection(site, ['template'], false), /版本不匹配/);
  fs.unlinkSync(path.join(site.rootPath, PRODUCT_SPECS_FILES[0]));
  assert.throws(() => selection(site, ['template'], false), /依赖不完整/);
});

test('legacy extra-path upload also includes providers and respects explicit exclusions', t => {
  const { site } = productSpecsFixture(t);
  const config = { localRoot: site.rootPath, uploadScope: 'site', uploadMode: 'quick', uploadDatabase: false,
    uploadImages: false, extraPaths: ['template'], exclude: [] };
  assert.deepEqual(collectFiles(config).slice(0, 4).map(f => f.relativePath), PRODUCT_SPECS_FILES);
  assert.throws(() => collectFiles({ ...config, exclude: ['apps/**'] }), /被排除/);
});

test('template providers are uploaded and read back before templates; corruption stops publication', async t => {
  const { site, config } = productSpecsFixture(t), manager = createFileBrowser();
  const prepare = () => manager.consume(site, config, { siteId: 1,
    token: manager.prepare(site, config, { siteId: 1, paths: ['template'] }).token });
  const selected = prepare();
  const remote = { '/htdocs/keep.txt': 'keep', '/htdocs/data/site.db': 'online-data', '/htdocs/config/config.php': 'online-config' };
  const result = await uploadFiles(selected.config, selected.files, { beforeFile: selected.beforeFile, clientFactory: () => mockClient(remote) });
  assert.equal(result.uploaded, 6);
  assert.equal(remote['/htdocs/data/site.db'], 'online-data'); assert.equal(remote['/htdocs/config/config.php'], 'online-config');
  const broken = prepare(), corrupted = { '/htdocs/keep.txt': 'keep' };
  await assert.rejects(uploadFiles(broken.config, broken.files, { beforeFile: broken.beforeFile, clientFactory: () => {
    const client = mockClient(corrupted), upload = client.uploadFrom;
    client.uploadFrom = async (local, name) => { await upload(local, name); corrupted['/htdocs/' + PRODUCT_SPECS_FILES[0]] = '{}'; };
    return client;
  } }), /校验失败/);
  assert.equal(corrupted['/htdocs/template/cn/index.html'], undefined);
});
