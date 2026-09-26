const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const root = '/www/wwwroot/pboot_admin_center';
const stage = process.argv[2];
const allowed = [
  'backend/src/product/entities/product.entity.ts',
  'backend/src/product/dto/create-product.dto.ts',
  'backend/src/product/dto/batch-product.dto.ts',
  'backend/src/product/product.controller.ts',
  'backend/src/product/product.service.ts',
  'backend/src/product/product-batch-file.ts',
  'backend/src/product/product-batch.spec.ts',
  'backend/src/common/pboot-content-import.ts',
  'frontend/src/api/products.ts',
  'frontend/src/views/products/ProductsView.vue',
  'frontend/src/views/products/ProductBatchActions.vue',
  'docs/PRODUCT_BATCH_OPERATIONS_ZH.md',
  'docs/tutorial-assets/baota-2026-09-11/198-product-batch-fixture-list.jpg',
  'docs/tutorial-assets/baota-2026-09-11/199-product-batch-sync-scope.jpg',
  'deploy/install-product-batch.cjs',
];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  assert.equal(fs.realpathSync(root), root);
  assert.equal(fs.realpathSync(stage), '/www/backup/pboot-pdf-stage-product-batch-20260914');
  assert.equal(process.getuid(), 0, 'Run the Linux ownership regression as the API user (root)');
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...allowed].sort());
  assert.deepEqual(Object.keys(manifest.expected).sort(), [...allowed].sort());
  for (const file of allowed) {
    assert.equal(hash(fs.readFileSync(path.join(stage, file))), manifest.files[file], 'Upload checksum: ' + file);
    const destination = path.join(root, file);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(destination), 'New file already exists: ' + file);
    else assert.equal(hash(fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Server source changed: ' + file);
  }
  const nextBackend = path.join(root, 'backend/dist-product-batch-next');
  const nextFrontend = path.join(root, 'frontend/dist-product-batch-next');
  assert.ok(!fs.existsSync(nextBackend));
  assert.ok(!fs.existsSync(nextFrontend));
  const deps = createRequire(path.join(root, 'backend/package.json'));
  const env = deps('dotenv').parse(fs.readFileSync(path.join(root, 'backend/.env')));
  assert.ok(!env.DB_TYPE || env.DB_TYPE === 'sqljs', 'This release verifier expects the existing SQL.js deployment');
  const database = path.resolve(root, 'backend', env.DB_SQLJS_LOCATION || 'dev.sqlite');
  assert.equal(fs.realpathSync(database), path.join(root, 'data/pboot-admin.sqlite'));
  const SQL = await deps('sql.js')();
  const snapshot = () => {
    const db = new SQL.Database(fs.readFileSync(database));
    try {
      const tables = ['product', 'product_translations'];
      return tables.map(table => {
        const columns = db.exec(`PRAGMA table_info("${table}")`)[0].values.map(row => row[1])
          .filter(column => !['isTop', 'isRecommend'].includes(column));
        assert.ok(columns.every(column => /^[a-zA-Z0-9_]+$/.test(column)));
        const values = db.exec(`SELECT ${columns.map(column => '"' + column + '"').join(',')} FROM "${table}" ORDER BY id`);
        return hash(JSON.stringify(values));
      });
    } finally { db.close(); }
  };
  for (const file of allowed) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(stage, file), path.join(root, file));
  }
  run('pnpm', ['--dir', 'backend', 'exec', 'jest', '--runInBand']);
  run('pnpm', ['--dir', 'frontend', 'run', 'type-check']);
  run('pnpm', ['--dir', 'backend', 'exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', 'dist-product-batch-next', '--incremental', 'false']);
  run('pnpm', ['--dir', 'frontend', 'run', 'build-only', '--outDir', 'dist-product-batch-next']);
  assert.ok(fs.existsSync(path.join(nextBackend, 'product/product-batch-file.js')));
  assert.ok(fs.existsSync(path.join(nextFrontend, 'index.html')));
  run('chmod', ['-R', 'a+rX', nextFrontend]);
  let stopped = false;
  try {
    run('pm2', ['stop', 'pboot-admin-api']);
    stopped = true;
    // Compare existing product data in memory; do not make a database or code backup.
    const before = snapshot();
    fs.cpSync(nextBackend, path.join(root, 'backend/dist'), { recursive: true });
    run('pm2', ['restart', 'pboot-admin-api']);
    stopped = false;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { ready = (await fetch('http://127.0.0.1:5108/sites', { signal: AbortSignal.timeout(2000) })).status === 401; } catch {}
      if (ready) break;
      await wait(1000);
    }
    assert.ok(ready, 'API readiness failed; frontend has not been published');
    assert.deepEqual(snapshot(), before, 'Product data changed during restart; inspect before publishing frontend');
    const db = new SQL.Database(fs.readFileSync(database));
    try {
      const columns = db.exec('PRAGMA table_info(product)')[0].values.map(row => row[1]);
      assert.ok(columns.includes('isTop') && columns.includes('isRecommend'), 'Product flags were not initialized');
      assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    } finally { db.close(); }
    const credentials = JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
    const base = 'https://admin.shanbo-rig.com/api';
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15000) });
    assert.ok(login.ok, 'Central admin login failed');
    const loginData = await login.json();
    const token = loginData.access_token || loginData.data?.access_token;
    assert.equal(typeof token, 'string');
    const headers = { Authorization: `Bearer ${token}`, 'X-Pboot-Site-Id': '1', 'Content-Type': 'application/json' };
    const list = await fetch(base + '/products?lang=zh-CN', { headers, signal: AbortSignal.timeout(15000) });
    assert.ok(list.ok, 'Product list read failed');
    // Empty IDs must be rejected by validation, without modifying any products.
    const rejected = await fetch(base + '/products/batch', { method: 'POST', headers, body: JSON.stringify({ action: 'show', value: true, ids: [] }), signal: AbortSignal.timeout(15000) });
    assert.equal(rejected.status, 400, 'Batch route validation is unavailable');
    fs.cpSync(nextFrontend, path.join(root, 'frontend/dist'), { recursive: true, filter: source => source !== path.join(nextFrontend, 'index.html') });
    fs.renameSync(path.join(nextFrontend, 'index.html'), path.join(root, 'frontend/dist/index.html'));
    for (const next of [nextBackend, nextFrontend]) {
      assert.equal(fs.realpathSync(next), next);
      fs.rmSync(next, { recursive: true });
    }
    console.log('PRODUCT_BATCH_RELEASE_COMPLETE: tests/build passed; API ready; existing product data unchanged; frontend published.');
    console.log('No business products edited/deleted/copied/synced. No code backup or GitHub push. SEO worker continues through its existing HTTP API.');
  } catch (error) {
    if (stopped) run('pm2', ['restart', 'pboot-admin-api']);
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
