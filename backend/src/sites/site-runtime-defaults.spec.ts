import { siteRuntimeDefaults } from './site-runtime-defaults';

describe('site runtime defaults', () => {
  it('uses BaoTa paths on a fresh Linux server', () => {
    expect(siteRuntimeDefaults('linux')).toEqual({ environment: 'baota', parentPath: '/www/wwwroot' });
  });

  it('preserves phpStudy defaults on Windows', () => {
    expect(siteRuntimeDefaults('win32')).toEqual({ environment: 'phpstudy', parentPath: 'E:/phpstudy_pro/WWW' });
  });

  it('uses the configured root parent with the server path convention', () => {
    expect(siteRuntimeDefaults('linux', '/srv/sites/rig.com').parentPath).toBe('/srv/sites');
    expect(siteRuntimeDefaults('win32', 'D:\\sites\\rig.com').parentPath).toBe('D:/sites');
  });

  it('ignores a Windows root left over on a Linux server', () => {
    expect(siteRuntimeDefaults('linux', 'E:/phpstudy_pro/WWW/rig.com').parentPath).toBe('/www/wwwroot');
  });
});
