const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../site-runtime');
const { readConfig, findDatabase } = require('./server');

test('managed site database survives rename and environment moves without rewriting private SEO configuration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-site-database-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'seo.json');
  const dbPath = path.join(root, 'current.db');
  const original = JSON.stringify({ localRoot: '/old/site', databasePath: '/old/site/local.db', outputSitemap: 'custom.xml' });
  fs.writeFileSync(configPath, original); fs.writeFileSync(dbPath, 'fixture');
  let site = { id: 1, rootPath: root, dbPath };
  t.mock.method(runtime, 'currentSite', () => site);
  t.mock.method(runtime, 'siteFile', () => configPath);
  assert.equal(findDatabase(readConfig()), dbPath);
  assert.equal(readConfig().outputSitemap, 'custom.xml');
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  site = { ...site, dbPath: path.join(root, 'missing.db') };
  assert.throws(() => findDatabase(readConfig()), /Configured database not found/);
  site = null;
  assert.equal(readConfig().databasePath, '/old/site/local.db');
});
