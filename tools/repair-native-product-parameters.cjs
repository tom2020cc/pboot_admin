// One-time rollback for the retired helper fields. Dry-run unless --apply is supplied.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('../backend/node_modules/sql.js');
const retiredFields = ['ext_spec_type', 'ext_shared_specs', 'ext_shared_data'];
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const columns = (db) => db.exec('pragma table_info(ay_content_ext)')[0]?.values.map((row) => String(row[1])) || [];

function rollback(db, baseline) {
  const before = columns(db);
  const removed = retiredFields.filter((name) => before.includes(name));
  let migratedImages = 0;
  const nativeImage = before.find((name) => name.toLowerCase() === 'ext_cp_bigpic');
  // Only retire the shadow image column when a pre-feature backup proves it was added later.
  if (baseline && !columns(baseline).includes('ext_bigpic') && before.includes('ext_bigpic') && nativeImage) {
    db.run(`update ay_content_ext set ${quote(nativeImage)}=ext_bigpic where coalesce(${quote(nativeImage)},'')='' and coalesce(ext_bigpic,'')<>''`);
    migratedImages = db.getRowsModified();
    removed.push('ext_bigpic');
  }
  db.run(`delete from ay_extfield where name in (${retiredFields.map(() => '?').join(',')})`, retiredFields);
  for (const name of removed) db.run(`alter table ay_content_ext drop column ${quote(name)}`);
  if (db.exec('pragma integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('Database integrity check failed');
  return { removed, migratedImages };
}

async function main() {
  const [siteFile, ...args] = process.argv.slice(2);
  if (!siteFile) throw new Error('Usage: node tools/repair-native-product-parameters.cjs <site.json> [--baseline=<old.db>] [--apply]');
  const site = JSON.parse(fs.readFileSync(path.resolve(siteFile), 'utf8')).site;
  const dbPath = path.resolve(site.dbPath);
  const rootPath = path.resolve(site.rootPath);
  const relative = path.relative(rootPath, dbPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Database must be inside the configured site root');
  const original = fs.readFileSync(dbPath);
  const originalHash = hash(original);
  const SQL = await initSqlJs();
  // sql.js can mutate its input buffer; keep backup bytes detached from the working DB.
  const db = new SQL.Database(Uint8Array.from(original));
  const baselinePath = args.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length);
  const baseline = baselinePath ? new SQL.Database(fs.readFileSync(path.resolve(baselinePath))) : null;
  try {
    const tables = db.exec("select name from sqlite_master where type='table' and name not in ('ay_content_ext','ay_extfield','sqlite_sequence')")[0]?.values.map(([name]) => String(name)) || [];
    const fingerprint = () => JSON.stringify(tables.map((name) => [name, db.exec(`select * from ${quote(name)}`)]));
    const dataBefore = fingerprint();
    const schemaBefore = db.exec("select type,name,sql from sqlite_master where name<>'ay_content_ext' and tbl_name<>'ay_content_ext' order by type,name");
    const result = rollback(db, baseline);
    if (fingerprint() !== dataBefore) throw new Error('Unrelated table data changed');
    if (JSON.stringify(schemaBefore) !== JSON.stringify(db.exec("select type,name,sql from sqlite_master where name<>'ay_content_ext' and tbl_name<>'ay_content_ext' order by type,name"))) throw new Error('Unrelated schema changed');
    if (!args.includes('--apply')) {
      console.log(JSON.stringify({ mode: 'dry-run', siteId: site.id, ...result, integrity: 'ok', unrelatedTablesUnchanged: true }));
      return;
    }
    const projectRoot = path.resolve(__dirname, '..');
    const backupDir = path.join(projectRoot, 'backups', `native-parameters-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}-site-${site.id}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, 'pboot-before.db');
    fs.writeFileSync(backupPath, original, { flag: 'wx' });
    fs.copyFileSync(path.join(projectRoot, 'backend', 'dev.sqlite'), path.join(backupDir, 'management-before.sqlite'));
    if (hash(fs.readFileSync(backupPath)) !== originalHash) throw new Error('Backup verification failed');
    const output = Buffer.from(db.export());
    const staged = `${dbPath}.native-parameters-${process.pid}.tmp`;
    fs.writeFileSync(staged, output, { flag: 'wx' });
    if (hash(fs.readFileSync(dbPath)) !== originalHash) throw new Error('Site database changed during rollback; no live data replaced. Retry after website writes stop.');
    fs.renameSync(staged, dbPath);
    console.log(JSON.stringify({ mode: 'applied', siteId: site.id, ...result, backupPath, integrity: 'ok', unrelatedTablesUnchanged: true }));
  } finally {
    baseline?.close();
    db.close();
  }
}

module.exports = { rollback };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
