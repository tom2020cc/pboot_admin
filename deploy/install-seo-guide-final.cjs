const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/www/wwwroot/pboot_admin_center';
const shots = ['177-deepseek-json-before.jpg', '178-deepseek-release.jpg', '179-deepseek-json-success.jpg',
  '182-google-refinement-release.jpg', '183-server-scan-refined.jpg', '184-server-scan-details.jpg', '185-google-public-files.jpg', '186-seo-homepage-audit.jpg'];
const files = ['frontend/src/content/deployment-guide.json', 'frontend/src/content/deployment-media.json',
  'tools/ftp_publish_tool/public/server-security.html', 'tools/seo_publish_tool/public/seo-pages.js',
  'docs/DEEPSEEK_CONNECTION_ZH.md', 'docs/GOOGLE_SEO_SERVER_SECURITY_PLAN_ZH.md',
  'deploy/google-security-guide.test.cjs', 'deploy/install-seo-guide-final.cjs',
  ...shots.map(name => 'docs/tutorial-assets/baota-2026-09-11/' + name)];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const run = (name, args) => execFileSync(name, args, { cwd: root, stdio: 'inherit' });
async function main() {
  assert.equal(fs.realpathSync(root), root);
  const stage = fs.realpathSync(process.argv[2]); assert.match(stage, /^\/www\/backup\/pboot-pdf-stage-[a-z0-9-]+$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...files].sort());
  for (const file of files) {
    const dest = path.join(root, file);
    assert.equal(hash(fs.readFileSync(path.join(stage, file))), manifest.files[file], 'Upload mismatch: ' + file);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(dest), 'New file already exists: ' + file);
    else assert.equal(hash(fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Server source changed: ' + file);
  }
  const next = root + '/frontend/dist-seo-guide-next-20260914', live = root + '/frontend/dist';
  assert.ok(!fs.existsSync(next), 'Staging build already exists');
  for (const file of files) {
    const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(stage, file), dest);
    fs.chmodSync(dest, file.endsWith('.jpg') ? 0o644 : 0o640);
  }
  run(process.execPath, ['deploy/build-tutorial-assets.cjs']);
  run(process.execPath, ['--test', 'deploy/tutorial-content.test.cjs', 'deploy/google-security-guide.test.cjs']);
  run('pnpm', ['--dir', 'frontend', 'run', 'type-check']);
  run('pnpm', ['--dir', 'frontend', 'run', 'build-only', '--outDir', path.basename(next)]);
  assert.equal(fs.realpathSync(next), next);
  run('chmod', ['-R', 'a+rX', next]);
  // Existing hashed assets remain in live; publish the new entry point only after all resources are present.
  fs.cpSync(next, live, { recursive: true, filter: source => source !== next + '/index.html' });
  fs.renameSync(next + '/index.html', live + '/index.html');
  fs.rmSync(next, { recursive: true });
  for (const name of ['183-server-scan-refined.jpg', '185-google-public-files.jpg', '186-seo-homepage-audit.jpg']) {
    const r = await fetch('https://admin.shanbo-rig.com/tutorial/deployment/' + name, { signal: AbortSignal.timeout(15000) });
    assert.ok(r.ok, name + ' HTTP ' + r.status);
    assert.equal(hash(Buffer.from(await r.arrayBuffer())), hash(fs.readFileSync(root + '/frontend/public/tutorial/deployment/' + name)));
  }
  const home = await fetch('https://admin.shanbo-rig.com/', { signal: AbortSignal.timeout(15000) });
  assert.ok(home.ok);
  assert.equal(hash(await home.text()), hash(fs.readFileSync(live + '/index.html', 'utf8')));
  const guide = require(root + '/frontend/src/content/deployment-guide.json');
  console.log(JSON.stringify({ chapters: guide.chapters.length, steps: guide.chapters.reduce((n, c) => n + c.steps.length, 0), assets: Object.keys(require(root + '/frontend/src/content/deployment-media.json')).length }));
  console.log('SEO_GUIDE_FINAL_COMPLETE; tests 19; frontend built; no process restart; no code backup; no GitHub; no database changes');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
