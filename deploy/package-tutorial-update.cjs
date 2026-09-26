const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const media = require('../frontend/src/content/deployment-media.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const existing = {
  'frontend/src/components/layout/AppLayout.vue': read('frontend/src/components/layout/AppLayout.vue').replace(/<ToolNav :active-id=[^>]+\/>/, '<ToolNav />').replace('import { useRoute } from "vue-router";\n', '').replace('const route = useRoute();\n', ''),
  'frontend/src/components/layout/ToolNav.vue': read('frontend/src/components/layout/ToolNav.vue').replace('Monitor, Reading, Search', 'Monitor, Search').replace(/^.*id: "tutorial".*\n/m, '').replace(' || id === "tutorial"', ''),
  'frontend/src/router/index.ts': read('frontend/src/router/index.ts').replace(/^.*path: "deployment-tutorial".*\n/m, ''),
  'tools/public-navigation.js': read('tools/public-navigation.js').replace(/^.*\['tutorial'.*\n/m, ''),
};
const contentOnly = process.argv.includes('--content-only');
const pdfCompletion = process.argv.includes('--pdf-completion');
const baselineIndex = process.argv.indexOf('--baseline');
const nameIndex = process.argv.indexOf('--name');
const archiveName = nameIndex >= 0 ? process.argv[nameIndex + 1] : (contentOnly ? 'pboot-tutorial-cn-nginx-20260912.tgz' : 'pboot-tutorial-update-20260912.tgz');
if (!archiveName || !/^[a-z0-9-]+\.tgz$/.test(archiveName)) throw new Error('Archive name must be a plain lowercase .tgz filename.');
if (contentOnly && (baselineIndex < 0 || !process.argv[baselineIndex + 1])) {
  throw new Error('Content updates require --baseline with saved pre-edit source fingerprints.');
}
const files = [...(contentOnly ? [] : Object.keys(existing)),
  'frontend/src/content/deployment-guide.json', 'frontend/src/content/deployment-media.json',
  ...(contentOnly ? [] : [
    'frontend/src/views/tutorials/types.ts', 'frontend/src/views/tutorials/TutorialFigure.vue', 'frontend/src/views/tutorials/DeploymentTutorial.vue',
    'frontend/src/utils/tutorialGuide.mjs', 'frontend/src/utils/tutorialGuide.d.mts',
    'deploy/build-tutorial-assets.cjs', 'deploy/tutorial-browser-check.cjs',
  ]),
  'deploy/tutorial-content.test.cjs',
  'deploy/package-tutorial-update.cjs', 'deploy/install-tutorial-update.sh',
  'deploy/nginx/pboot-rewrite.conf',
  'docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md', 'docs/deployment.md',
  ...(pdfCompletion ? [
    'frontend/src/utils/brochure.ts', 'frontend/src/views/brochures/BrochureTool.vue',
    'deploy/brochure-browser-check.cjs',
    'docs/PRODUCT_BROCHURES_ZH.md', 'docs/tutorial-assets/baota-2026-09-11/README.md',
  ] : []),
  ...Object.values(media).map(item => `frontend/public/tutorial/deployment/${item.file}`),
  'frontend/public/tutorial/deployment/manifest.json',
  ...Object.values(media).filter(item => item.kind === 'screenshot').map(item => `docs/tutorial-assets/baota-2026-09-11/${item.source || item.file}`),
];
const cache = path.join(root, '.cache-tutorial-update');
fs.mkdirSync(cache, { recursive: true });
const manifest = {
  version: '2026-09-12',
  kind: contentOnly ? 'content-only' : 'full',
  expected: contentOnly
    ? JSON.parse(fs.readFileSync(path.resolve(process.argv[baselineIndex + 1]), 'utf8'))
    : Object.fromEntries(Object.entries(existing).map(([name, text]) => [name, hash(text)])),
  files: Object.fromEntries(files.map(name => [name, hash(fs.readFileSync(path.join(root, name)))])),
};
if (pdfCompletion) for (const name of ['frontend/src/utils/brochure.ts', 'frontend/src/views/brochures/BrochureTool.vue', 'deploy/brochure-browser-check.cjs']) {
  if (!manifest.expected[name]) throw new Error(`PDF completion requires baseline for ${name}`);
}
fs.writeFileSync(path.join(cache, 'tutorial-update-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const archive = path.join(cache, archiveName);
execFileSync('tar', ['-czf', archive, '-C', root, ...files, '-C', cache, 'tutorial-update-manifest.json']);
console.log(JSON.stringify({ archive, files: files.length, bytes: fs.statSync(archive).size, sha256: hash(fs.readFileSync(archive)) }, null, 2));
