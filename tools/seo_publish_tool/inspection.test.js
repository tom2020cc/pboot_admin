const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const initSqlJs = require('sql.js');
const siteRuntime = require('../site-runtime');
const { inspectSite, findLocalEditorRecord, buildVueEditorUrl, calculateSeoHealth, addCategorySeoIssues } = require('./server');
const ai = require('./ai-seo')._test;

const meta = { recordKind: 'menu', recordId: '15', acode: 'cn', editUrl: 'http://localhost:5278/?siteId=2#/menus/edit/595' };
test('category checks cover all three native SEO fields and retain record links', () => {
  const issues = [];
  addCategorySeoIssues(issues, { name: '水井钻机', title: ' ', keywords: '', description: '' }, 'https://example.test/rigs/', meta);
  assert.deepEqual(issues.map(item => item.code), ['category-seo-title-missing', 'category-seo-description-missing', 'category-seo-keywords-missing']);
  assert(issues.every(item => item.url && item.editUrl === meta.editUrl && item.recordId === '15'));
  assert.equal(issues.find(item => item.code === 'category-seo-keywords-missing').severity, 'low');
});
test('complete category SEO passes and length recommendations are non-blocking', () => {
  const issues = [], sort = { name: '水井钻机', title: '水井钻机产品', keywords: '水井钻机,产品', description: '产品资料'.repeat(20) };
  addCategorySeoIssues(issues, sort, '', meta); assert.equal(issues.length, 0);
  addCategorySeoIssues(issues, { ...sort, title: '标题'.repeat(40), description: '简短描述' }, '', meta);
  assert.equal(issues.length, 2); assert(issues.every(item => item.severity === 'low'));
});
test('foreign category issues direct maintenance back to Chinese', () => {
  const issues = [];
  addCategorySeoIssues(issues, { name: 'Rigs' }, '', { ...meta, acode: 'en' });
  assert(issues.every(item => item.detail.includes('中文')));
});
test('empty inspection does not invent a clean record or score', () => {
  assert.deepEqual(calculateSeoHealth({ menus: 0, contents: 0 }, []), { score: null, affectedRecords: 0, cleanRecords: 0, totalRecords: 0 });
});
test('AI repair no longer offers or applies image ALT completion', () => {
  const row = { id: 1, mcode: '3', title: 'Rig', subtitle: 'Core Rig', filename: 'cn-rig', keywords: 'rig', description: 'Core rig', content: '<img src="/static/rig.jpg">' };
  assert(!ai.contentProblems(row).includes('image-alt'));
  const result = ai.prepareUpdates([{ row, problems: ['image-alt'] }], [], [{ id: 1, imageAlts: [{ src: '/static/rig.jpg', alt: 'generated alt' }] }], [], 'cn');
  assert.equal(result.contentUpdates[0].content, row.content);
});
test('translation does not fill missing ALT from AI suggestions', () => {
  const content = '<img src="/static/rig.jpg">';
  const result = ai.prepareTranslationUpdates([{ source: { mcode: '3' }, target: { id: 2, acode: 'en', filename: 'en-rig', content }, translateContent: true }], [], [{ targetId: 2, title: 'Rig', contentHtml: content, imageAlts: [{ src: '/static/rig.jpg', alt: 'generated alt' }] }], []);
  assert.equal(result.contentUpdates[0].content, content);
});
test('duplicate issues count every affected record once and exclude unchecked totals', () => {
  const other = { ...meta, recordId: '16' };
  const health = calculateSeoHealth({ menus: 10, contents: 10, checkedRecords: 3 }, [{ ...meta, severity: 'high', affectedRecords: [meta, other] }, { ...meta, severity: 'medium' }]);
  assert.equal(health.affectedRecords, 2); assert.equal(health.cleanRecords, 1); assert.equal(health.totalRecords, 3);
});

async function withLocalDb(run) {
  const SQL = await initSqlJs(), db = new SQL.Database();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-seo-links-'));
  db.run(`create table menu(id integer, siteId integer, code text);
    insert into menu values(111,1,'pboot:cn:15'),(595,2,'pboot:cn:15');
    create table product(id integer,siteId integer,urlName text,title text);
    insert into product values(1,1,'cn-rig','同名产品'),(2,2,'cn-rig','同名产品');
    create table product_translations(productId integer,lang text,urlName text,title text);
    insert into product_translations values(1,'en','en-rig','Rig'),(2,'en','en-rig','Rig');`);
  try { return await siteRuntime.runForSite({ id: 2, directory: root, isDefault: false }, () => run(db)); }
  finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
test('category editor lookup is scoped to the current site', () => withLocalDb(db => {
  assert.deepEqual(findLocalEditorRecord(db, 'menu', { acode: 'cn', scode: '15' }), { route: 'menus', id: 595 });
  db.run('delete from menu where siteId=2');
  assert.equal(findLocalEditorRecord(db, 'menu', { acode: 'cn', scode: '15' }), null);
}));
test('ambiguous category bindings do not open an arbitrary record', () => withLocalDb(db => {
  db.run("insert into menu values(596,2,'pboot:cn:15')");
  assert.equal(findLocalEditorRecord(db, 'menu', { acode: 'cn', scode: '15' }), null);
}));
test('translation and base-content lookups stay within the current site', () => withLocalDb(db => {
  assert.deepEqual(findLocalEditorRecord(db, 'content', { acode: 'en', mcode: '3', filename: 'en-rig', title: 'Rig' }), { route: 'products', id: 2 });
  assert.deepEqual(findLocalEditorRecord(db, 'content', { acode: 'cn', mcode: '3', filename: 'cn-rig', title: '同名产品' }), { route: 'products', id: 2 });
  db.run('delete from product where siteId=2');
  assert.equal(findLocalEditorRecord(db, 'content', { acode: 'en', mcode: '3', filename: 'en-rig', title: 'Rig' }), null);
}));
test('ambiguous product names do not pick the first record', () => withLocalDb(db => {
  db.run("insert into product values(3,2,'cn-other','同名产品')");
  assert.equal(findLocalEditorRecord(db, 'content', { acode: 'cn', mcode: '3', title: '同名产品' }), null);
}));
test('video pages do not query a nonexistent legacy video table', () => withLocalDb(db => {
  assert.equal(findLocalEditorRecord(db, 'content', { acode: 'cn', mcode: '4', id: 7 }), null);
}));
test('editor links carry site identity', () => withLocalDb(db => {
  const url = new URL(buildVueEditorUrl(db, 'menu', { acode: 'cn', scode: '15' }));
  assert.equal(url.searchParams.get('siteId'), '2'); assert.equal(url.hash, '#/menus/edit/595');
}));

test('database inspection detects category SEO and preserves PB data and video sitemap entries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-seo-inspect-'));
  const SQL = await initSqlJs(), db = new SQL.Database();
  try {
    db.run(`create table ay_config(name text,value text);
      create table ay_model(mcode text,type text,urlname text);
      insert into ay_model values('3','2','products'),('4','2','videos');
      create table ay_area(acode text,name text,is_default text);
      insert into ay_area values('cn','中文','1');
      create table ay_content_sort(id integer,acode text,scode text,pcode text,name text,filename text,mcode text,status text,sorting integer,outlink text,title text,keywords text,description text);
      insert into ay_content_sort values(100,'cn','15','0','水井钻机','rigs','3','1',1,'','','','');
      insert into ay_content_sort values(101,'cn','16','0','视频','videos','4','1',2,'','','','');
      create table ay_content(id integer,acode text,scode text,title text,subtitle text,filename text,ico text,content text,keywords text,description text,date text,create_time text,update_time text,sorting integer,status text,outlink text);
      insert into ay_content values(7,'cn','16','','','','','','','','','','',1,'1','');`);
    const dbPath = path.join(root, 'pboot.db'); fs.writeFileSync(dbPath, Buffer.from(db.export()));
    const before = fs.readFileSync(dbPath);
    fs.mkdirSync(path.join(root, 'seo'));
    fs.writeFileSync(path.join(root, 'seo', 'seo.config.json'), JSON.stringify({ localRoot: root, databasePath: dbPath, siteBaseUrl: 'https://example.test', localTestBaseUrl: 'http://fixture.test', useLanguageSubdomains: false }));
    const report = await siteRuntime.runForSite({ id: 900001, directory: root, isDefault: false }, () => inspectSite());
    assert.equal(report.issues.filter(item => item.code?.startsWith('category-seo-')).length, 3);
    assert.equal(report.issues.filter(item => item.type === '视频').length, 0);
    assert.equal(report.stats.health.totalRecords, 1); assert.equal(report.stats.health.affectedRecords, 1);
    assert.equal(report.urls.length, 3, 'Video URLs remain in sitemap inputs');
    assert(fs.readFileSync(dbPath).equals(before), 'Inspection must not write PB data');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
