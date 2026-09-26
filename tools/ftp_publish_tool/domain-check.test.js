const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('../site-runtime');
const { gzipSync } = require('node:zlib');
const { createDomainCheck } = require('./domain-check');

test('site-bound diagnostics persist reports, reject concurrent and changed-site requests, and mark stale configuration', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-check-test-'));
  try {
    const SQL = await require('../../backend/node_modules/sql.js')();
    const db = new SQL.Database(); db.run("CREATE TABLE ay_area(acode TEXT,domain TEXT,pcode TEXT,id INTEGER); INSERT INTO ay_area VALUES('ar','ar.example.com','0',1)");
    const dbPath = path.join(folder, 'site.db'); fs.writeFileSync(dbPath, db.export()); db.close();
    fs.mkdirSync(path.join(folder, 'state'));
    const file = path.join(folder, 'state/system-license.json');
    fs.writeFileSync(file, JSON.stringify({ siteId: 7, profiles: { baota: { domains: ['ar.example.com'] } } }));
    const site = { id:7, code:'fixture', name:'Fixture', environment:'phpstudy', dbPath, directory:folder };
    const project = { host:'43.160.236.132', serverProjectRoot:'/www/wwwroot/fixture', btPanel:{url:'http://example.com/panel',user:'fixture',password:'fixture'} };
    let release; let captured;
    const checker = createDomainCheck({ engine:{ readSyncConfig:()=>({project}) }, remote:async (_panel, _root, options) => {
      captured = JSON.parse(Buffer.from(options.command.match(/'([A-Za-z0-9+/=]+)'$/)[1], 'base64'));
      await new Promise(resolve=>{release=resolve});
      const report={siteCode:'fixture',rows:[{language:'ar',domain:'ar.example.com',checks:{}}],checkedAt:new Date().toISOString()};
      return { log:'PBOOT_DOMAIN_RESULT_Z='+gzipSync(Buffer.from(JSON.stringify(report))).toString('base64')+'\nPBOOT_BUILD_DONE' };
    } });
    await runtime.runForSite(site, async () => {
      assert.throws(()=>checker.start({siteId:8}), /当前本地网站/);
      checker.start({siteId:7}); assert.equal(checker.status().running, true);
      assert.throws(()=>checker.start({siteId:7}), /正在运行/);
      for(let i=0;i<100&&!release;i++) await new Promise(r=>setTimeout(r,10));
      assert.deepEqual(captured.items,[{language:'ar',domain:'ar.example.com'}]);
      assert.equal(JSON.stringify(captured).includes('password'),false);
      release();
      for(let i=0;i<100&&checker.isRunning();i++) await new Promise(r=>setTimeout(r,10));
      assert.equal(checker.status().result.rows.length,1);
      assert.equal(checker.status().stale,false);
      project.host='43.160.236.133'; assert.equal(checker.status().stale,true);
      const reopened=createDomainCheck({engine:{readSyncConfig:()=>({project})}});
      assert.equal(reopened.status().result.rows.length,1);
    });
    runtime.runForSite({...site,id:8,code:'other',directory:path.join(folder,'other')},()=>assert.equal(checker.status().result,null));
  } finally {
    assert.equal(path.dirname(folder),os.tmpdir()); assert.ok(path.basename(folder).startsWith('domain-check-test-'));
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
