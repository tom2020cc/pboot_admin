const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'tmp/site-information-release-20260918');
const files = [
  ...['service.ts', 'service.spec.ts', 'module.ts', 'fields.ts', 'entity.ts', 'dto.ts', 'controller.ts'].map(name => `backend/src/site-information/site-information.${name}`),
  'backend/src/site-information/site-information-translator.service.ts',
  'frontend/src/api/site-information.ts', 'frontend/src/views/sites/SiteInformationView.vue',
  'deploy/template-bindings-removed.test.cjs',
];
const manifest = {};
for (const file of files) {
  const data = fs.readFileSync(path.join(root, file));
  const target = path.join(stage, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  manifest[file] = crypto.createHash('sha256').update(data).digest('hex');
}
fs.copyFileSync(path.join(root, 'deploy/install-site-information.cjs'), path.join(stage, 'install.cjs'));
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
const archive = path.join(root, 'tmp/pboot-site-information-20260918-v2.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, 'manifest.json', 'install.cjs', ...files]);
console.log(JSON.stringify({ archive, files: files.length, sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }));
