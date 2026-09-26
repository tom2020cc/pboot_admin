const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabaseActions } = require('./database-actions');
const runtime = require('../site-runtime');

test('area sync keeps the confirmed snapshot, rejects stale/wrong-scope requests, and sends no full database', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'area-sync-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const SQL = await require('../../backend/node_modules/sql.js')();
  const db = new SQL.Database();
  t.after(() => db.close());
  db.run("CREATE TABLE ay_area(acode TEXT,pcode TEXT,name TEXT,domain TEXT,is_default INTEGER); INSERT INTO ay_area VALUES('en','0','英文','example.com',1)");
  const file = path.join(root, 'site.db');
  const save = () => fs.writeFileSync(file, Buffer.from(db.export()));
  save();
  const site = { id: 991, code: 'fixture', name: '测试站点', environment: 'phpstudy', dbPath: file, rootPath: root };
  const project = { btPanel: { url: 'https://example.com', user: 'fixture', password: 'fixture' }, serverProjectRoot: '/fixture' };
  let requests = [];
  const manager = createDatabaseActions({ engine: { readSyncConfig: () => ({ project }) }, runRemote: async (_panel, _root, { command }) => {
    assert.match(command, /^python3 -c /);
    const encoded = command.match(/'([A-Za-z0-9+/=]+)'$/)[1];
    const request = JSON.parse(Buffer.from(encoded, 'base64').toString());
    requests.push(request);
    assert.equal(request.source, undefined);
    assert.equal(request.scope, 'site');
    assert.equal(request.siteCode, 'fixture');
    const result = request.action === 'inspect-areas'
      ? { path: '/fixture/site.db', name: 'site.db', revision: 'configuration-version', areaRevision: 'area-version', areas: [] }
      : { path: '/fixture/site.db', synced: request.areas.length, verified: true };
    return { log: 'PBOOT_DATABASE_RESULT=' + JSON.stringify(result) };
  }});
  const wait = async () => {
    for (let i = 0; i < 100 && manager.isRunning(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(manager.isRunning(), false);
    return manager.status();
  };
  await runtime.runForSite(site, async () => {
    let p = await manager.inspect({ scope: 'site', siteId: site.id, areasOnly: true });
    assert.equal(p.areas[0].domain, 'example.com');
    assert.throws(() => manager.start({ token: p.token, action: 'sync', confirm: true }), /预览类型不匹配/);
    await runtime.runForSite({ ...site, id: 992 }, async () => {
      assert.throws(() => manager.start({ token: p.token, action: 'sync-areas', confirm: true }), /站点已切换/);
    });
    db.run("UPDATE ay_area SET domain='new.example.com'"); save();
    manager.start({ token: p.token, action: 'sync-areas', confirm: true });
    assert.match((await wait()).error, /本地区域已修改/);
    assert.equal(requests.length, 1);
    p = await manager.inspect({ scope: 'site', siteId: site.id, areasOnly: true });
    manager.start({ token: p.token, action: 'sync-areas', confirm: true });
    const state = await wait();
    assert.equal(state.error, '');
    assert.equal(state.result.verified, true);
    assert.equal(requests.at(-1).areas[0].domain, 'new.example.com');
    assert.equal(requests.at(-1).areaRevision, 'area-version');
    assert.throws(() => manager.start({ token: p.token, action: 'sync-areas', confirm: true }), /已过期/);
  });
});
