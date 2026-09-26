const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = '/www/wwwroot/pboot_admin_center';
const stage = '/www/backup/pboot-site-information-20260918';
const added = [
  ...['service.ts', 'service.spec.ts', 'module.ts', 'fields.ts', 'entity.ts', 'dto.ts', 'controller.ts'].map(name => `backend/src/site-information/site-information.${name}`),
  'backend/src/site-information/site-information-translator.service.ts',
  'frontend/src/api/site-information.ts', 'frontend/src/views/sites/SiteInformationView.vue',
  'deploy/template-bindings-removed.test.cjs',
];
const removed = [
  'frontend/src/views/sites/TemplateBindingsView.vue', 'frontend/src/api/templateBindings.ts',
  ...['.controller.ts', '.service.ts', '.ts', '.spec.ts'].map(suffix => `backend/src/sites/template-bindings${suffix}`),
  'tools/verify-template-bindings.cjs',
];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const edits = new Map();
const originals = new Map();
function edit(file, change) {
  const original = fs.readFileSync(path.join(root, file));
  const text = original.toString('utf8').replace(/\r\n/g, '\n');
  const next = change(text);
  assert.notEqual(next, text, `No changes: ${file}`);
  originals.set(file, original); edits.set(file, Buffer.from(next));
}
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, `Expected one source anchor: ${before}`);
  return text.replace(before, after);
}
async function main() {
  assert.equal(fs.realpathSync(root), root); assert.equal(fs.realpathSync(stage), stage);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json')));
  assert.deepEqual(Object.keys(manifest).sort(), added.slice().sort());
  for (const file of added) {
    const content = fs.readFileSync(path.join(stage, file));
    assert.equal(hash(content), manifest[file], `Upload checksum: ${file}`);
    assert.ok(!fs.existsSync(path.join(root, file)), `New feature file already exists: ${file}`);
    originals.set(file, null); edits.set(file, content);
  }
  edit('backend/src/app.module.ts', text => replaceOnce(replaceOnce(text,
    "import { SitesModule } from './sites/sites.module';", "import { SitesModule } from './sites/sites.module';\nimport { SiteInformationModule } from './site-information/site-information.module';"),
    '    SitesModule,', '    SitesModule,\n    SiteInformationModule,'));
  edit('backend/src/common/pboot-uploaded-images.ts', text => replaceOnce(text,
    "kind: 'news' | 'products' | 'pages' | 'menus')", "kind: 'news' | 'products' | 'pages' | 'menus' | 'site-information')"));
  edit('backend/src/sites/sites.module.ts', text => {
    for (const name of ['Controller', 'Service']) {
      text = replaceOnce(text, `import { TemplateBindings${name} } from './template-bindings.${name.toLowerCase()}';\n`, '');
      text = replaceOnce(text, `, TemplateBindings${name}`, '');
    }
    return text;
  });
  edit('frontend/src/router/index.ts', text => {
    const lines = text.split('\n');
    const index = lines.findIndex(line => line.includes('path: "template-bindings"'));
    assert.ok(index >= 0);
    lines[index] = '        { path: "site-information", name: "siteInformation", component: () => import("@/views/sites/SiteInformationView.vue"), meta: { title: "站点与公司信息" } },';
    return lines.join('\n');
  });
  edit('frontend/src/components/layout/AppAside.vue', text => replaceOnce(replaceOnce(text,
    '          <el-menu-item index="/template-bindings">\n            <el-icon><Connection /></el-icon>\n            <span>模板栏目绑定</span>\n          </el-menu-item>',
    '          <el-menu-item index="/site-information">\n            <el-icon><Document /></el-icon>\n            <span>站点与公司信息</span>\n          </el-menu-item>'), 'Calendar, Connection,', 'Calendar,'));
  edit('frontend/src/views/sites/SitesView.vue', text => replaceOnce(text,
    '        <el-button @click="$router.push(\'/template-bindings\')">模板栏目绑定</el-button>\n', ''));
  for (const file of removed) {
    const target = path.join(root, file);
    if (fs.existsSync(target)) { originals.set(file, fs.readFileSync(target)); edits.set(file, null); }
  }
  const deps = createRequire(path.join(root, 'backend/package.json'));
  const envFile = path.join(root, 'backend/.env');
  const envHash = hash(fs.readFileSync(envFile));
  const env = deps('dotenv').parse(fs.readFileSync(envFile));
  assert.ok(!env.DB_TYPE || env.DB_TYPE === 'sqljs');
  const database = path.resolve(root, 'backend', env.DB_SQLJS_LOCATION || 'dev.sqlite');
  assert.equal(fs.realpathSync(database), path.join(root, 'data/pboot-admin.sqlite'));
  const SQL = await deps('sql.js')();
  const snapshot = () => {
    const db = new SQL.Database(fs.readFileSync(database));
    try {
      assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='site_information_draft' ORDER BY name")[0].values.flat();
      return Object.fromEntries(tables.map(name => {
        assert.match(name, /^[A-Za-z0-9_]+$/);
        return [name, hash(JSON.stringify(db.exec(`SELECT * FROM "${name}" ORDER BY rowid`)))];
      }));
    } finally { db.close(); }
  };
  const nextBackend = path.join(root, 'backend/dist-site-information-next');
  const nextFrontend = path.join(root, 'frontend/dist-site-information-next');
  assert.ok(!fs.existsSync(nextBackend) && !fs.existsSync(nextFrontend));
  let activated = false;
  let stopped = false;
  try {
    for (const [file, data] of edits) {
      const target = path.join(root, file);
      assert.ok(target.startsWith(root + '/')); assert.ok(!fs.existsSync(target) || !fs.lstatSync(target).isSymbolicLink());
      if (data === null) fs.unlinkSync(target);
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); }
    }
    run('pnpm', ['exec', 'jest', '--runInBand', 'site-information'], path.join(root, 'backend'));
    run('node', ['--test', 'deploy/template-bindings-removed.test.cjs']);
    run('pnpm', ['run', 'type-check'], path.join(root, 'frontend'));
    run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', 'dist-site-information-next', '--incremental', 'false'], path.join(root, 'backend'));
    run('pnpm', ['run', 'build-only', '--outDir', 'dist-site-information-next'], path.join(root, 'frontend'));
    run('chmod', ['-R', 'a+rX', nextFrontend]);
    run('pm2', ['stop', 'pboot-admin-api']); stopped = true;
    const before = snapshot();
    fs.cpSync(nextBackend, path.join(root, 'backend/dist'), { recursive: true });
    for (const base of ['template-bindings', 'template-bindings.controller', 'template-bindings.service']) {
      for (const ext of ['.js', '.js.map', '.d.ts']) {
        const target = path.join(root, 'backend/dist/sites', base + ext);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
    }
    activated = true;
    run('pm2', ['restart', 'pboot-admin-api']); stopped = false;
    let ready = false;
    for (let count = 0; count < 40; count++) {
      try { ready = (await fetch('http://127.0.0.1:5108/sites', { signal: AbortSignal.timeout(2000) })).status === 401; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'API did not become ready');
    assert.deepEqual(snapshot(), before, 'Existing management data changed during deployment');
    assert.equal(hash(fs.readFileSync(envFile)), envHash, 'Environment file changed');
    fs.cpSync(nextFrontend, path.join(root, 'frontend/dist'), { recursive: true, filter: source => source !== path.join(nextFrontend, 'index.html') });
    fs.renameSync(path.join(nextFrontend, 'index.html'), path.join(root, 'frontend/dist/index.html'));
    const assets = path.join(root, 'frontend/dist/assets');
    for (const file of fs.readdirSync(assets)) if (/^TemplateBindingsView-[\w-]+\.(?:js|css)(?:\.map)?$/.test(file)) fs.unlinkSync(path.join(assets, file));
    console.log('SITE_INFORMATION_RELEASE_COMPLETE: tests/build passed; retired feature removed; API ready; existing management data and environment preserved; no PB writes.');
  } catch (error) {
    if (!activated) for (const [file, data] of originals) {
      const target = path.join(root, file);
      if (data === null) { if (fs.existsSync(target)) fs.unlinkSync(target); }
      else fs.writeFileSync(target, data);
    }
    throw error;
  } finally { if (stopped) run('pm2', ['restart', 'pboot-admin-api']); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
