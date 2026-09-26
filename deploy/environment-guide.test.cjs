const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { checkEnvironment, isPublicHttps } = require('./check-environment.cjs');
const guide = require('../frontend/src/content/environment-guide.json');

test('guide covers the actual data boundaries and deployment risks', async () => {
  const { environmentGuideMarkdown } = await import('../frontend/src/utils/environmentGuide.mjs');
  const text = environmentGuideMarkdown(guide);
  for (const value of ['backend/dev.sqlite', 'data/pboot-admin.sqlite', 'managed_sites', 'synchronize', 'VITE_API_BASE_URL=/api', 'APP_ENVIRONMENT=baota', '不自动备份', '不自动双向同步']) assert.ok(text.includes(value), value);
  assert.ok(guide.comparisons.length >= 12);
  assert.ok(guide.sections.length >= 6);
});

test('preflight flags a local configuration when targeting BaoTa without modifying files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-env-test-'));
  const backend = path.join(root, 'backend');
  const frontend = path.join(root, 'frontend');
  fs.mkdirSync(backend); fs.mkdirSync(frontend);
  const env = 'APP_ENVIRONMENT=local\nNODE_ENV=development\nDB_TYPE=sqljs\nDB_SQLJS_LOCATION=dev.sqlite\nBACKEND_HOST=127.0.0.1\nBACKEND_PORT=5108\nJWT_SECRET=secret-not-to-be-printed\n';
  fs.writeFileSync(path.join(backend, '.env'), env);
  fs.writeFileSync(path.join(backend, 'dev.sqlite'), 'test-database');
  fs.writeFileSync(path.join(frontend, '.env.local'), 'VITE_API_BASE_URL=http://localhost:5108\n');
  try {
    const results = checkEnvironment({ root, target: 'baota', runtimeEnv: {}, platform: 'win32', nodeVersion: '22.12.0' });
    const errors = results.filter(row => row.level === 'error').map(row => row.name);
    for (const name of ['Environment label', 'Target operating system', 'Production mode', 'Production database path', 'Production JWT secret', 'Production frontend API', 'No local frontend override on server']) assert.ok(errors.includes(name), name);
    assert.ok(!JSON.stringify(results).includes('secret-not-to-be-printed'));
    assert.equal(fs.readFileSync(path.join(backend, '.env'), 'utf8'), env);
    assert.equal(fs.readFileSync(path.join(backend, 'dev.sqlite'), 'utf8'), 'test-database');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('pboot-env-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preflight rejects ambiguous targets and unsafe public origins', () => {
  assert.throws(() => checkEnvironment({target: 'production'}));
  assert.ok(isPublicHttps('https://admin.shanbo-rig.com'));
  for (const value of ['http://example.com', 'https://localhost', 'https://x:y@example.com', 'https://example.com/api']) assert.equal(isPublicHttps(value), false);
});
