import * as path from 'path';

export function siteRuntimeDefaults(platform: NodeJS.Platform, siteRoot = '') {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const root = String(siteRoot || '').trim();
  return {
    environment: windows ? 'phpstudy' : 'baota',
    parentPath: root && paths.isAbsolute(root)
      ? paths.dirname(root).replace(/\\/g, '/')
      : windows ? 'E:/phpstudy_pro/WWW' : '/www/wwwroot',
  };
}
