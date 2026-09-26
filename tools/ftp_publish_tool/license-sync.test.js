const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeTask, syncLicense } = require('./license-sync');
const php = process.env.PHP_BINARY || 'php';
const available = spawnSync(php, ['-v']).status === 0;
const profile = { domains: ['example.com'], codes: 'ONLINE_TEST', phone: '12345' };
test('task contains encrypted values and expires in three minutes', () => {
  const job = makeTask(profile);
  assert.equal(job.source.includes(profile.codes), false);
  assert.equal(job.source.includes(job.key.toString('base64')), false);
  const decrypt = crypto.createDecipheriv('aes-256-gcm', job.key, Buffer.from(job.task.iv, 'base64'));
  decrypt.setAuthTag(Buffer.from(job.task.tag, 'base64'));
  assert.deepEqual(JSON.parse(Buffer.concat([decrypt.update(Buffer.from(job.task.cipher, 'base64')), decrypt.final()])), profile);
  assert.ok(job.task.expires <= Date.now() / 1000 + 180);
});
test('rejects unencrypted FTP and unsafe remote roots before connecting', async () => {
  await assert.rejects(syncLicense({}, profile), /FTPS/);
  await assert.rejects(syncLicense({ host: '127.0.0.1', user: 'fixture', password: 'fixture', secure: true, remoteRoot: '../data' }, profile), /目录/);
});
test('PHP updates only three fields, rejects bad keys/domains and rolls back incomplete schemas', { skip: !available }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'license-sync-test-'));
  const run = (code, env = {}) => {
    const result = spawnSync(php, ['-r', code], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  try {
    fs.mkdirSync(path.join(root, 'config')); fs.mkdirSync(path.join(root, 'data')); fs.mkdirSync(path.join(root, 'runtime/config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/database.php'), "<?php return ['database'=>['type'=>'sqlite','dbname'=>'/data/test.db']];");
    run('$d=new PDO("sqlite:data/test.db");$d->exec("CREATE TABLE ay_config(name TEXT,value TEXT); INSERT INTO ay_config VALUES (\'sn\',\'old\'),(\'sn_user\',\'\'),(\'licensecode\',\'old\'),(\'other\',\'keep\'); CREATE TABLE business(value TEXT); INSERT INTO business VALUES (\'untouched\')");');
    const dump = () => run('$d=new PDO("sqlite:data/test.db");echo json_encode([$d->query("SELECT * FROM ay_config ORDER BY name")->fetchAll(PDO::FETCH_ASSOC),$d->query("SELECT * FROM business")->fetchAll(PDO::FETCH_ASSOC)]);');
    const execute = (job, key, host = 'example.com') => {
      fs.writeFileSync(path.join(root, 'task.php'), job.source.replace("file_get_contents('php://input')", "getenv('TEST_KEY')"));
      return run('$_SERVER["REQUEST_METHOD"]="POST";$_SERVER["HTTP_HOST"]=getenv("TEST_HOST");include "task.php";', { TEST_KEY: key, TEST_HOST: host });
    };
    const initial = dump(), job = makeTask(profile);
    assert.equal(execute(job, 'invalid'), ''); assert.equal(dump(), initial);
    const mismatch = JSON.parse(execute(job, job.key.toString('base64'), 'wrong.example'));
    assert.equal(JSON.parse(mismatch.body).ok, false); assert.equal(dump(), initial);
    fs.writeFileSync(path.join(root, 'runtime/config/test.php'), 'cache');
    fs.writeFileSync(path.join(root, 'runtime/config/keep.txt'), 'keep');
    const response = JSON.parse(execute(job, job.key.toString('base64')));
    assert.equal(response.signature, crypto.createHmac('sha256', job.key).update(response.body).digest('hex'));
    assert.equal(JSON.parse(response.body).digest, job.digest);
    const [rows, business] = JSON.parse(dump()); const values = Object.fromEntries(rows.map(r => [r.name, r.value]));
    assert.deepEqual(values, { sn: profile.codes, sn_user: profile.phone, licensecode: Buffer.from(profile.codes + '/' + profile.phone).toString('base64') + 'N', other: 'keep' });
    assert.deepEqual(business, [{ value: 'untouched' }]);
    assert.equal(fs.existsSync(path.join(root, 'task.php')), false);
    assert.equal(fs.existsSync(path.join(root, 'runtime/config/test.php')), false);
    assert.equal(fs.existsSync(path.join(root, 'runtime/config/keep.txt')), true);
    run('$d=new PDO("sqlite:data/test.db");$d->exec("DELETE FROM ay_config WHERE name=\'licensecode\'");');
    const before = dump(), next = makeTask({ ...profile, codes: 'CHANGED' });
    assert.equal(JSON.parse(JSON.parse(execute(next, next.key.toString('base64'))).body).ok, false);
    assert.equal(dump(), before);
  } finally {
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) && path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error('Unsafe fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
