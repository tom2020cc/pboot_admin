import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { SiteLicenseService, normalizeLicenseProfile } from './site-license.service';

describe('site license environment isolation', () => {
  const originalEnvironment = process.env.APP_ENVIRONMENT;
  let root: string, state: string, database: string, SQL: any, site: any, service: SiteLicenseService;
  beforeEach(async () => {
    process.env.APP_ENVIRONMENT = 'local';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-license-test-'));
    state = path.join(root, 'state'); fs.mkdirSync(state); fs.mkdirSync(path.join(root, 'data'));
    fs.mkdirSync(path.join(root, 'runtime', 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'runtime', 'config', 'fixture.php'), 'cache');
    database = path.join(root, 'data', 'fixture.db');
    SQL = await initSqlJs(); const db = new SQL.Database();
    db.run('CREATE TABLE ay_config (name TEXT, value TEXT); CREATE TABLE ay_area (domain TEXT)');
    for (const [key, value] of Object.entries({ sn: 'LOCAL_FIXTURE', sn_user: '', licensecode: 'fixture', untouched: 'keep' })) db.run('INSERT INTO ay_config VALUES (?, ?)', [key, value]);
    db.run("INSERT INTO ay_area VALUES ('example.com')");
    fs.writeFileSync(database, Buffer.from(db.export())); db.close();
    site = { id: 1, name: 'Fixture', rootPath: root, dbPath: database, environment: 'phpstudy', publicBaseUrl: 'http://example.local' };
    service = new SiteLicenseService({ getCurrentSite: () => site, getCurrentSiteId: () => site.id, getCurrentSiteStorageDir: () => state } as any);
  });
  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = originalEnvironment;
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('site-license-test-')) throw new Error('Unexpected fixture path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const payload = (revision: string, environment: 'phpstudy' | 'baota', apply = false) => ({ siteId: 1, environment, apply, domains: [environment === 'phpstudy' ? 'example.local' : 'example.com'], codes: environment === 'phpstudy' ? 'LOCAL_NEW' : 'ONLINE_FIXTURE', phone: '', revision });
  it('reads local PB and saves online settings without changing local PB', async () => {
    const initial = await service.read(); const original = fs.readFileSync(database);
    expect(initial.live.codes).toBe('LOCAL_FIXTURE');
    expect(initial.profiles.baota.codes).toBe('');
    expect(initial.profiles.baota.domains).toEqual(['example.com']);
    const saved = await service.save(payload(initial.revision, 'baota'));
    expect(saved.profiles.baota.codes).toBe('ONLINE_FIXTURE');
    expect(fs.readFileSync(database)).toEqual(original);
    await expect(service.save(payload(saved.revision, 'baota', true))).rejects.toThrow('不能跨环境');
  });
  it('writes only selected live license values, retains other settings and clears PB cache', async () => {
    const initial = await service.read(); const result = await service.save(payload(initial.revision, 'phpstudy', true));
    expect(result.live.codes).toBe('LOCAL_NEW');
    const db = new SQL.Database(fs.readFileSync(database));
    try {
      expect(db.exec("SELECT value FROM ay_config WHERE name='licensecode'")[0].values[0][0]).toBe(Buffer.from('LOCAL_NEW/').toString('base64') + 'O');
      expect(db.exec("SELECT value FROM ay_config WHERE name='untouched'")[0].values[0][0]).toBe('keep');
    } finally { db.close(); }
    expect(fs.existsSync(path.join(root, 'runtime', 'config', 'fixture.php'))).toBe(false);
    await expect(service.save(payload(initial.revision, 'phpstudy'))).rejects.toThrow('已变化');
  });
  it('reads Baota from its own PB and rejects local writes there', async () => {
    site.environment = 'baota'; site.publicBaseUrl = 'https://example.com';
    const db = new SQL.Database(fs.readFileSync(database)); db.run("UPDATE ay_config SET value='SERVER_FIXTURE' WHERE name='sn'"); fs.writeFileSync(database, Buffer.from(db.export())); db.close();
    const result = await service.read();
    expect(result.profiles.baota.codes).toBe('SERVER_FIXTURE');
    expect(result.profiles.phpstudy.codes).toBe('');
    await expect(service.save(payload(result.revision, 'phpstudy', true))).rejects.toThrow('不能跨环境');
  });
  it('rejects changed site and mismatched domain without writing', async () => {
    const result = await service.read();
    await expect(service.save({ ...payload(result.revision, 'phpstudy', true), siteId: 2 })).rejects.toThrow('站点已切换');
    await expect(service.save({ ...payload(result.revision, 'phpstudy', true), domains: ['wrong.example'] })).rejects.toThrow('必须包含');
    expect((await service.read()).live.codes).toBe('LOCAL_FIXTURE');
  });
  it('normalizes domains and code separators without inventing licenses', () => {
    expect(normalizeLicenseProfile(['https://EXAMPLE.com/'], 'ABC，DEF ABC', '')).toEqual({ domains: ['example.com'], codes: 'ABC,DEF', phone: '' });
    expect(() => normalizeLicenseProfile(['https://example.com/path'], '', '')).toThrow();
  });
  it('reports remote failure without changing local PB and returns a usable saved revision', async () => {
    const original = fs.readFileSync(database), initial = await service.read();
    const result = await service.save({ ...payload(initial.revision, 'baota'), syncRemote: true });
    expect(result.onlineSync.ok).toBe(false);
    expect(result.onlineSync.message).toContain('FTPS');
    expect(result.profiles.baota.codes).toBe('ONLINE_FIXTURE');
    expect(fs.readFileSync(database)).toEqual(original);
    await expect(service.save(payload(result.revision, 'baota'))).resolves.toBeDefined();
  });
  it('rejects combined local writes and remote sync', async () => {
    const initial = await service.read();
    await expect(service.save({ ...payload(initial.revision, 'phpstudy', true), syncRemote: true })).rejects.toThrow('线上同步仅用于');
    expect((await service.read()).live.codes).toBe('LOCAL_FIXTURE');
  });
  it('hides and blocks remote license sync when the backend runs on Baota', async () => {
    process.env.APP_ENVIRONMENT = 'baota';
    const initial = await service.read();
    expect(initial.canSyncRemote).toBe(false);
    await expect(service.save({ ...payload(initial.revision, 'baota'), syncRemote: true })).rejects.toThrow('仅用于从本地');
  });
});
