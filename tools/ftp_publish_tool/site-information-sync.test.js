const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeTask } = require('./license-sync');
const php = process.env.PHP_BINARY || 'php';
const fields = { site: ['title','subtitle','domain','theme','logo','keywords','description','icp','copyright'], company: ['name','address','postcode','contact','mobile','phone','fax','email','qq','weixin','blicense','other'] };
test('remote PHP writes selected languages atomically, preserves environment/business rows and verifies images', { skip: spawnSync(php, ['-v']).status !== 0 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'information-sync-test-'));
  const run = (code, env = {}) => {
    const result = spawnSync(php, ['-r', code], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  const payload = { domains: ['example.com', 'en.example.com'], assets: [], items: ['cn', 'en'].map(language => ({ language, data: Object.fromEntries(Object.entries(fields).map(([section, keys]) => [section, Object.fromEntries(keys.map(key => [key, `${language}-${key}`]))])) })) };
  for (const item of payload.items) { item.data.site.domain = item.language === 'cn' ? 'https://example.com/' : 'en.example.com'; item.data.site.theme = item.language; }
  try {
    for (const dir of ['data', 'config', 'static', 'runtime/config', 'runtime/cache', 'runtime/complile', 'template/cn/html', 'template/en/html']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const lang of ['cn', 'en']) fs.writeFileSync(path.join(root, 'template', lang, 'html/index.html'), '<h1>Fixture</h1>');
    fs.writeFileSync(path.join(root, 'config/database.php'), "<?php return ['database'=>['type'=>'sqlite','dbname'=>'/data/test.db']];");
    run('$fields=json_decode(getenv("FIELDS"),true);$d=new PDO("sqlite:data/test.db");$d->exec("CREATE TABLE ay_area(acode TEXT,domain TEXT); INSERT INTO ay_area VALUES (\'cn\',\'example.com,www.example.com\'),(\'en\',\'old-en.example.com\'); CREATE TABLE ay_config(name TEXT,value TEXT);INSERT INTO ay_config VALUES(\'sn\',\'ONLINE_LICENSE\');CREATE TABLE ay_content(title TEXT);INSERT INTO ay_content VALUES(\'KEEP_PRODUCT\')");foreach($fields as $section=>$keys){$extra=$section==="site"?",statistical TEXT DEFAULT \'keep-stats\'":"";$d->exec("CREATE TABLE ay_".$section."(id INTEGER PRIMARY KEY,acode TEXT,".implode(" TEXT,",$keys)." TEXT".$extra.")");foreach(["cn","en"] as $lang){$s=$d->prepare("INSERT INTO ay_".$section."(acode,".implode(",",$keys).") VALUES(".implode(",",array_fill(0,count($keys)+1,"?")).")");$s->execute(array_merge([$lang],array_fill(0,count($keys),"old")));}}', { FIELDS: JSON.stringify(fields) });
    const dump = () => JSON.parse(run('$d=new PDO("sqlite:data/test.db");$out=[];foreach(["ay_site","ay_company","ay_config","ay_content","ay_area"] as $t)$out[$t]=$d->query("SELECT * FROM ".$t)->fetchAll(PDO::FETCH_ASSOC);echo json_encode($out);'));
    const execute = data => {
      const job = makeTask(data, 'site-information');
      fs.writeFileSync(path.join(root, 'task.php'), job.source.replace("file_get_contents('php://input')", "getenv('TEST_KEY')"));
      const response = JSON.parse(run('$_SERVER["REQUEST_METHOD"]="POST";$_SERVER["HTTP_HOST"]="example.com";include "task.php";', { TEST_KEY: job.key.toString('base64') }));
      assert.equal(response.signature, crypto.createHmac('sha256', job.key).update(response.body).digest('hex'));
      const result = JSON.parse(response.body); if (result.ok) assert.equal(result.digest, job.digest); return result;
    };
    const initial = dump();
    const invalid = JSON.parse(JSON.stringify(payload)); invalid.items[1].language = 'unknown';
    assert.equal(execute(invalid).ok, false); assert.deepEqual(dump(), initial);
    const forbidden = JSON.parse(JSON.stringify(payload)); forbidden.items[0].data.site.domain = 'local.invalid';
    assert.equal(execute(forbidden).ok, false); assert.deepEqual(dump(), initial);
    const badTemplate = JSON.parse(JSON.stringify(payload)); badTemplate.items[1].data.site.theme = 'missing';
    assert.match(execute(badTemplate).error, /线上模板不存在/); assert.deepEqual(dump(), initial);
    badTemplate.items[1].data.site.theme = '../cn';
    assert.equal(execute(badTemplate).ok, false); assert.deepEqual(dump(), initial);
    const badImage = JSON.parse(JSON.stringify(payload)); badImage.assets = [{ path: 'static/codex/site-information-online/' + 'a'.repeat(64) + '.jpg', hash: 'a'.repeat(64) }];
    assert.equal(execute(badImage).ok, false); assert.deepEqual(dump(), initial);
    const bytes = Buffer.from('fixture-image'), digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const relative = `static/codex/site-information-online/${digest}.jpg`;
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), bytes);
    payload.assets = [{ path: relative, hash: digest }]; payload.items[0].data.site.logo = '/' + relative;
    fs.writeFileSync(path.join(root, 'runtime/cache/test.php'), 'cache');
    assert.equal(execute({ ...payload, items: [payload.items[0]] }).ok, true);
    const currentOnly = dump(); assert.deepEqual(currentOnly.ay_site[1], initial.ay_site[1]); assert.deepEqual(currentOnly.ay_company[1], initial.ay_company[1]);
    assert.equal(execute(payload).ok, true);
    const after = dump();
    assert.equal(after.ay_area[0].domain, 'example.com,www.example.com');
    assert.equal(after.ay_area[1].domain, 'en.example.com');
    const conflict = JSON.parse(JSON.stringify(payload)); conflict.items[1].data.site.domain = 'example.com';
    assert.match(execute(conflict).error, /域名已绑定/); assert.deepEqual(dump(), after);
    assert.deepEqual(after.ay_config, initial.ay_config); assert.deepEqual(after.ay_content, initial.ay_content);
    for (const [index, item] of payload.items.entries()) {
      for (const section of ['site','company']) for (const key of fields[section]) assert.equal(after['ay_' + section][index][key], item.data[section][key]);
      for (const key of ['statistical']) assert.equal(after.ay_site[index][key], initial.ay_site[index][key]);
    }
    assert.equal(fs.existsSync(path.join(root, 'runtime/cache/test.php')), false);
    assert.equal(fs.existsSync(path.join(root, 'task.php')), false);
    assert.equal(fs.existsSync(path.join(root, relative)), true);
    // Explicit blanks clear existing values, and an absent company record is created even if all fields are blank.
    run('$d=new PDO("sqlite:data/test.db");$d->exec("DELETE FROM ay_company WHERE acode=\'en\'");');
    const blank = JSON.parse(JSON.stringify(payload)); blank.assets = [];
    for (const item of blank.items) for (const section of ['site','company']) for (const key of fields[section]) item.data[section][key] = '';
    assert.equal(execute(blank).ok, true);
    const cleared = dump();
    assert.ok(cleared.ay_area.every(row => row.domain === ''));
    for (const section of ['site','company']) {
      assert.equal(cleared['ay_' + section].length, 2);
      for (const row of cleared['ay_' + section]) for (const key of fields[section]) assert.equal(row[key], '');
    }
    for (const row of cleared.ay_site) {
      assert.equal(row.domain, ''); assert.equal(row.theme, ''); assert.equal(row.statistical, 'keep-stats');
    }
    assert.deepEqual(cleared.ay_config, initial.ay_config); assert.deepEqual(cleared.ay_content, initial.ay_content);
    // Also create both missing records for an existing language, without inheriting another language's values.
    run('$d=new PDO("sqlite:data/test.db");$d->exec("INSERT INTO ay_area VALUES(\'es\',\'\')");');
    const newLanguage = { ...payload, items: [{ ...payload.items[1], language: 'es' }] };
    assert.equal(execute(newLanguage).ok, true);
    const newSite = dump().ay_site.find(r => r.acode === 'es');
    assert.equal(newSite.domain, 'en.example.com'); assert.equal(newSite.theme, 'en');
    const missing = { ...blank, items: [{ ...blank.items[0], language: 'es' }] };
    assert.equal(execute(missing).ok, true);
    const created = dump();
    for (const section of ['site','company']) {
      const row = created['ay_' + section].find(r => r.acode === 'es');
      for (const key of fields[section]) assert.equal(row[key], '');
    }
    for (const key of ['domain','theme','statistical']) assert.equal(created.ay_site.find(r => r.acode === 'es')[key], '');
    assert.equal(execute(missing).ok, true);
    assert.equal(dump().ay_company.filter(r => r.acode === 'es').length, 1);
    // Duplicate rows still stop the entire batch instead of selecting an arbitrary record.
    run('$d=new PDO("sqlite:data/test.db");$d->exec("INSERT INTO ay_company(acode) VALUES(\'es\')");');
    const duplicateBefore = dump();
    assert.equal(execute({ ...payload, items: [payload.items[0], missing.items[0]] }).ok, false);
    assert.deepEqual(dump(), duplicateBefore);
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('information-sync-test-')) throw new Error('Unsafe test path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
