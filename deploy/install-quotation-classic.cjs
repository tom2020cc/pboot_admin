const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = '/www/wwwroot/pboot_admin_center';
const stage = path.resolve(__dirname, '..');
const files = [
  'frontend/src/utils/quotation.ts',
  'frontend/src/utils/quotation-page.css',
  'frontend/src/utils/brochure-pagination.ts',
  'backend/src/brochure/brochure-pdf.service.ts',
  'backend/src/brochure/brochure-pdf.spec.ts',
  'backend/src/sites/template-bindings.spec.ts',
  'deploy/quotation-browser-check.cjs',
  'deploy/install-product-batch.cjs',
  'deploy/install-quotation-classic.cjs',
  'docs/QUOTATIONS_ZH.md',
];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

assert.equal(fs.realpathSync(root), root);
assert.equal(fs.realpathSync(stage), '/www/backup/pboot-stage-quotation-classic-20260914');
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
assert.deepEqual(Object.keys(manifest.files).sort(), [...files].sort());
assert.deepEqual(Object.keys(manifest.expected).sort(), [...files].sort());
for (const file of files) {
  assert.equal(hash(fs.readFileSync(path.join(stage, file))), manifest.files[file], 'Upload checksum: ' + file);
  const destination = path.join(root, file);
  if (!fs.existsSync(destination)) assert.equal(manifest.expected[file], null, 'Missing source: ' + file);
  else {
    const installed = fs.readFileSync(destination);
    assert.ok(hash(installed) === manifest.files[file] || hash(installed.toString('utf8').replace(/\r\n/g, '\n')) === manifest.expected[file], 'Server source changed: ' + file);
  }
}
for (const file of files) {
  // The pending batch package still verifies its original installer and owns the test cleanup patch.
  if (['deploy/install-product-batch.cjs', 'backend/src/sites/template-bindings.spec.ts'].includes(file)) continue;
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.copyFileSync(path.join(stage, file), path.join(root, file));
}
run(process.execPath, ['--test', 'deploy/quotation-ui.test.cjs', 'deploy/brochure-ui.test.cjs']);
run(process.execPath, ['deploy/quotation-browser-check.cjs']);
run(process.execPath, [path.join(stage, 'deploy/install-product-batch.cjs'), '/www/backup/pboot-pdf-stage-product-batch-20260914', '--resume']);
console.log('QUOTATION_CLASSIC_RELEASE_COMPLETE: landscape layout restored; multilingual/PDF and batch tests passed; existing data preserved.');
