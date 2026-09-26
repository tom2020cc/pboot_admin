import { AreaProgramService } from './area-program.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const repair = require('../../../tools/pboot-domain-repair.js');

describe('AreaProgramService', () => {
  let root: string, service: AreaProgramService, site: any, previous: string | undefined;
  beforeEach(() => {
    previous = process.env.APP_ENVIRONMENT;
    process.env.APP_ENVIRONMENT = 'local';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'area-program-service-'));
    fs.mkdirSync(path.join(root, 'apps/common'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ftp'));
    fs.writeFileSync(path.join(root, repair.FILE), `<?php namespace app\\common; class HomeController extends Controller { function __construct() { ${repair.ORIGINAL} } }`);
    site = { id: 1, name: '测试网站', rootPath: root, environment: 'phpstudy' };
    service = new AreaProgramService({ getCurrentSite: () => site, getCurrentSiteStorageDir: () => path.join(root, 'ftp') } as any);
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = previous;
    jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
  });
  it('blocks production and changed site, without changing code', () => {
    expect(() => service.preview(2)).toThrow('网站已切换');
    process.env.APP_ENVIRONMENT = 'baota';
    expect(() => service.preview(1)).toThrow('只能在本地');
    process.env.APP_ENVIRONMENT = 'local'; site.environment = 'baota';
    expect(() => service.preview(1)).toThrow('只能在本地');
    expect(fs.readFileSync(path.join(root, repair.FILE), 'utf8')).toContain(repair.ORIGINAL);
  });
  it('requires unchanged preview and rejects missing FTP before local changes', async () => {
    const p = service.preview(1);
    await expect(service.apply({ siteId: 1, revision: p.revision, syncRemote: true })).rejects.toThrow('FTPS');
    fs.appendFileSync(path.join(root, repair.FILE), '// edit');
    await expect(service.apply({ siteId: 1, revision: p.revision, syncRemote: false })).rejects.toThrow('已变化');
  });
  it('repairs only local unless online was explicitly selected', async () => {
    const remote = jest.spyOn(repair, 'syncRemote');
    const result = await service.apply({ siteId: 1, revision: service.preview(1).revision, syncRemote: false });
    expect(result.localChanged).toBe(true); expect(remote).not.toHaveBeenCalled();
    expect(service.preview(1).needsRepair).toBe(false);
  });
  it('reports partial success when online fails, and protects updated FTP configuration', async () => {
    const config = path.join(root, 'ftp/ftp.config.json');
    fs.writeFileSync(config, JSON.stringify({ host: 'fixture.invalid', user: 'a', password: 'b', secure: true }));
    const p = service.preview(1);
    fs.writeFileSync(config, JSON.stringify({ host: 'changed.invalid', user: 'a', password: 'b', secure: true }));
    await expect(service.apply({ siteId: 1, revision: p.revision, syncRemote: true })).rejects.toThrow('已变化');
    jest.spyOn(repair, 'syncRemote').mockRejectedValue(new Error('upload failed'));
    const result = await service.apply({ siteId: 1, revision: service.preview(1).revision, syncRemote: true });
    expect(result.localChanged).toBe(true); expect(result.online?.ok).toBe(false);
    expect(service.preview(1).needsRepair).toBe(false);
  });
});
