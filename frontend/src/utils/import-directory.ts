export function describeImportDirectory(value: string, root = '') {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '') || (value.trim() === '/' ? '/' : '');
  const rootPath = root.trim().replace(/\\/g, '/').replace(/\/+$/, '') || (root.trim() === '/' ? '/' : '');
  const windows = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//');
  const compare = (path: string) => windows ? path.toLowerCase() : path;
  const parts = normalized.split('/').filter(Boolean);
  const relative = parts.some(part => part === '.' || part === '..');
  const withinRoot = !!rootPath && !relative && (compare(normalized) === compare(rootPath) || compare(normalized).startsWith(compare(rootPath === '/' ? '/' : rootPath + '/')));
  const rootDepth = withinRoot ? rootPath.split('/').filter(Boolean).length : 0;
  const depth = withinRoot ? parts.length - rootDepth : null;
  return { normalized, parts, rootDepth, withinRoot, relative, depth,
    leaf: parts[parts.length - 1] || normalized,
    scope: !normalized ? '尚未选择目录' : relative ? '含相对层级，待核对' : !rootPath ? '根目录未读取' : !withinRoot ? '网站根目录外' : depth === 0 ? '网站根目录' : `根目录下第 ${depth} 级`,
  };
}

export function describeImportSource(apiBase: string, pageUrl: string) {
  try {
    const url = new URL(apiBase, pageUrl);
    const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
    return { local, label: local ? '本机后台目录' : '服务器目录', host: url.host };
  } catch {
    return { local: false, label: '后台目录（连接待确认）', host: '' };
  }
}
