const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache-tutorial-update');
const args = process.argv.slice(2);
const option = key => { const i=args.indexOf(key); return i < 0 ? undefined : args[i+1]; };
const baseline = option('--baseline');
const name = option('--name') || 'pboot-pdf-update-20260912-v2.tgz';
if (!/^[a-z0-9-]+\.tgz$/.test(name)) throw Error('Invalid archive name');
const expected = JSON.parse(fs.readFileSync(baseline ? path.resolve(baseline) : path.join(cache, 'pdf-baseline.json')));
const files = [...new Set([...Object.keys(expected), ...(!baseline ? ['frontend/src/utils/brochure-language.ts', 'frontend/src/utils/brochure-detail.ts',
  'frontend/src/views/brochures/BrochureDetailEditor.vue', 'deploy/brochure-ui.test.cjs', 'deploy/brochure-browser-check.cjs',
  'deploy/install-brochure-update.cjs', 'deploy/package-brochure-update.cjs'] : [])])];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const manifest = { expected, apiOnly: args.includes('--api-only'), frontendOnly: args.includes('--frontend-only'), files: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])) };
fs.writeFileSync(path.join(cache, 'brochure-update-manifest.json'), JSON.stringify(manifest, null, 2));
const archive = path.join(cache, name);
execFileSync('tar', ['-czf', archive, '-C', root, ...files, '-C', cache, 'brochure-update-manifest.json']);
console.log(JSON.stringify({ archive, files: files.length, bytes: fs.statSync(archive).size, sha256: hash(fs.readFileSync(archive)) }, null, 2));
