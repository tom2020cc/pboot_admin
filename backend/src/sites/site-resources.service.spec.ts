import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { SiteResourcesService } from './site-resources.service';

describe('site resource quarantine and restore', () => {
  let parent: string, root: string, dbPath: string, service: SiteResourcesService, sites: any, rows: any[], now: number;
  const asset = (relative = 'static/orphan.jpg') => path.join(root, relative);
  const writePb = async (text: string) => {
    const SQL = await initSqlJs(); const db = new SQL.Database();
    db.run('create table ay_content (acode text, content text)');
    db.run('insert into ay_content values (?, ?)', ['vi', text]);
    db.run('create table ay_slide (pic text)'); db.run("insert into ay_slide values ('/static/slide.jpg')");
    fs.writeFileSync(dbPath, db.export()); db.close();
  };
  beforeEach(async () => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-service-'));
    root = path.join(parent, 'site'); dbPath = path.join(root, 'data/pb.db');
    fs.mkdirSync(path.join(root, 'static'), { recursive: true }); fs.mkdirSync(path.join(root, 'template'));
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(asset(), 'original bytes'); fs.writeFileSync(asset('static/slide.jpg'), 'slide');
    rows = []; now = Date.now() + 8 * 86400000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    sites = { getCurrentSite: () => ({ id: 2, name: 'fixture', enabled: true, rootPath: root, dbPath }), findAll: async () => [{ rootPath: root }] };
    const source: any = { entityMetadatas: [{ target: 'news', tableName: 'news' }], getRepository: () => ({ createQueryBuilder: () => ({ limit: () => ({ getRawMany: async () => rows }) }) }) };
    service = new SiteResourcesService(sites, source);
    jest.spyOn(service as any, 'quarantineRoot').mockReturnValue(path.join(parent, 'quarantine'));
    await writePb('');
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(parent, { recursive: true, force: true }); });

  it('scans without writes, protects all PB languages and project drafts', async () => {
    await writePb('/static/orphan.jpg');
    const original = fs.readFileSync(dbPath);
    expect((await service.scan()).entries.find(e => e.path === 'static/orphan.jpg').status).toBe('referenced');
    await writePb(''); rows.push({ body: '<img src="orphan.jpg">' });
    expect((await service.scan()).entries.find(e => e.path === 'static/orphan.jpg').status).toBe('referenced');
    expect(fs.readFileSync(asset(), 'utf8')).toBe('original bytes');
    expect(original.length).toBeGreaterThan(0);
  });
  it('quarantines selected files only, survives service scan loss, and restores exact bytes', async () => {
    const scan = await service.scan();
    const originalDb = fs.readFileSync(dbPath);
    const result = await service.clean(scan.id, ['static/orphan.jpg']);
    expect(result).toMatchObject({ moved: 1, errors: [] });
    expect(fs.existsSync(asset())).toBe(false);
    expect(fs.existsSync(asset('static/slide.jpg'))).toBe(true);
    (service as any).scans.clear();
    expect((await service.history())[0].entries[0].recoverable).toBe(true);
    expect(await service.restore(result.id)).toEqual({ restored: 1, errors: [] });
    expect(fs.readFileSync(asset(), 'utf8')).toBe('original bytes');
    expect(fs.readFileSync(dbPath).equals(originalDb)).toBe(true);
    expect((await service.history())[0].entries[0].state).toBe('restored');
  });
  it('never overwrites newly created files when restoring', async () => {
    const result = await service.clean((await service.scan()).id, ['static/orphan.jpg']);
    fs.writeFileSync(asset(), 'new user data');
    const restore = await service.restore(result.id);
    expect(restore.restored).toBe(0); expect(restore.errors[0]).toContain('不覆盖');
    expect(fs.readFileSync(asset(), 'utf8')).toBe('new user data');
  });
  it('rejects new PB references discovered after the scan', async () => {
    const scan = await service.scan(); await writePb('/static/orphan.jpg');
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('变化');
    expect(fs.existsSync(asset())).toBe(true);
  });
  it('rejects new unsynced project references after the scan', async () => {
    const scan = await service.scan(); rows.push({ body: 'orphan.jpg' });
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('变化');
  });
  it('rejects changed file contents after the scan', async () => {
    const scan = await service.scan(); fs.writeFileSync(asset(), 'edited');
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('变化');
  });
  it('rejects new template references and dynamically addressed directories', async () => {
    const scan = await service.scan(); fs.writeFileSync(path.join(root, 'template/new.html'), '<img src="/static/{dynamic}">');
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('变化');
  });
  it('rejects cross-site, expired scans and selections not in the candidate list', async () => {
    const scan = await service.scan();
    await expect(service.clean(scan.id, ['static/slide.jpg'])).rejects.toThrow('不可清理');
    await expect(service.clean(scan.id, ['../orphan.jpg'])).rejects.toThrow('不可清理');
    await expect(service.clean(scan.id, [])).rejects.toThrow('1 到 200');
    const get = sites.getCurrentSite; sites.getCurrentSite = () => ({ ...get(), id: 3 });
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('失效');
    sites.getCurrentSite = get; now += 1800001;
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('失效');
  });
  it('does not follow a resource directory replaced by a junction', async () => {
    fs.mkdirSync(asset('static/sub')); fs.writeFileSync(asset('static/sub/a.jpg'), 'old');
    const scan = await service.scan(); fs.unlinkSync(asset('static/sub/a.jpg')); fs.rmdirSync(asset('static/sub'));
    const outside = path.join(parent, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'a.jpg'), 'outside');
    fs.symlinkSync(outside, asset('static/sub'), 'junction');
    await expect(service.clean(scan.id, ['static/sub/a.jpg'])).rejects.toThrow('链接');
    expect(fs.readFileSync(path.join(outside, 'a.jpg'), 'utf8')).toBe('outside');
  });
  it('rejects quarantine placed under an HTTP site root', async () => {
    jest.spyOn(service as any, 'quarantineRoot').mockReturnValue(path.join(root, 'backups'));
    await expect(service.clean((await service.scan()).id, ['static/orphan.jpg'])).rejects.toThrow('网站目录内');
  });
  it('handles partial move failure and keeps a durable recovery record', async () => {
    jest.spyOn(service as any, 'moveFile').mockImplementation((source: string, target: string) => {
      fs.copyFileSync(source, target); fs.unlinkSync(source); throw new Error('模拟中断');
    });
    const result = await service.clean((await service.scan()).id, ['static/orphan.jpg']);
    expect(result.errors[0]).toContain('模拟中断');
    expect((await service.history())[0].entries[0].recoverable).toBe(true);
    expect((await service.restore(result.id)).restored).toBe(1);
    expect(fs.readFileSync(asset(), 'utf8')).toBe('original bytes');
  });
  it('removes only a truly empty directory and can restore it', async () => {
    fs.mkdirSync(asset('static/empty'));
    const scan = await service.scan();
    const result = await service.clean(scan.id, ['static/empty']);
    expect(result.moved).toBe(1); expect(fs.existsSync(asset('static/empty'))).toBe(false);
    expect((await service.restore(result.id)).restored).toBe(1);
    expect(fs.readdirSync(asset('static/empty'))).toEqual([]);
  });
  it('refuses an altered quarantine backup', async () => {
    const result = await service.clean((await service.scan()).id, ['static/orphan.jpg']);
    fs.writeFileSync(path.join(parent, 'quarantine/2', result.id, 'static/orphan.jpg'), 'corrupted');
    const restored = await service.restore(result.id);
    expect(restored.restored).toBe(0); expect(restored.errors[0]).toContain('校验');
    expect(fs.existsSync(asset())).toBe(false);
  });
  it('refuses a PB database belonging to another website', async () => {
    const outside = path.join(parent, 'other.db'); fs.copyFileSync(dbPath, outside);
    const get = sites.getCurrentSite; sites.getCurrentSite = () => ({ ...get(), dbPath: outside });
    await expect(service.scan()).rejects.toThrow('当前网站');
  });
  it.each(['-wal', '-journal'])('does not ignore unmerged SQLite %s references', async suffix => {
    const scan = await service.scan(); fs.writeFileSync(dbPath + suffix, 'active database log');
    await expect(service.clean(scan.id, ['static/orphan.jpg'])).rejects.toThrow('活动日志');
    await expect(service.scan()).rejects.toThrow('活动日志');
    expect(fs.existsSync(asset())).toBe(true);
  });
});
