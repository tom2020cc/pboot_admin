const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ftp = require('basic-ftp');
const { completeTemplateBundle } = require('./template-dependencies');
const { createFtpClient } = require('./ftp-client');

// Match the existing publisher: remoteRoot is relative to the FTP login directory.
function remoteRootPath(config) {
  const value = String(config.remoteRoot || '').trim().replace(/^\/+|\/+$/g, '');
  return relativePath(value === '.' ? '' : value);
}

function relativePath(value = '') {
  if (typeof value !== 'string' || value.length > 2000 || /[\\\x00-\x1f:]/.test(value) || value.startsWith('/')) throw new Error('目录路径无效');
  const parts = value.split('/');
  if (parts.some(part => part === '..' || part === '.')) throw new Error('目录不能越过站点根目录');
  return parts.filter(Boolean).join('/');
}
function localFile(root, relative) {
  const base = fs.realpathSync(root);
  let current = base;
  for (const part of relativePath(relative).split('/').filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`不支持符号链接：${relative}`);
  }
  const stat = fs.statSync(current);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('只支持普通文件与目录');
  return { localPath: current, stat };
}
function protectedReason(relative, includeEnvironment = false) {
  const parts = relative.toLowerCase().split('/');
  if (parts.some(p => ['.git', '.claude', 'node_modules', 'managed-sites', 'runtime', 'cache', 'backups', 'logs'].includes(p) || p.startsWith('pboot_admin') || p === '.env' || p.startsWith('.env.'))) return '不上传缓存、管理项目或私密配置';
  if (/\.(bak|zip|rar|7z|key|pem)$/.test(relative.toLowerCase())) return '不上传备份、压缩包或私钥';
  if (!includeEnvironment && (['data', 'config'].includes(parts[0]) || /\.(db|sqlite|sqlite3)$/.test(relative.toLowerCase()))) return '数据库与环境配置默认保留';
  return '';
}
function listLocal(site, relative = '', includeEnvironment = false) {
  relative = relativePath(relative);
  const { localPath, stat } = localFile(site.rootPath, relative);
  if (!stat.isDirectory()) throw new Error('请选择目录');
  const entries = fs.readdirSync(localPath, { withFileTypes: true });
  if (entries.length > 10000) throw new Error('目录项目过多，请拆分目录后操作');
  const items = entries.map(entry => {
    const itemPath = [relative, entry.name].filter(Boolean).join('/');
    const info = fs.lstatSync(path.join(localPath, entry.name));
    return { name: entry.name, path: itemPath, directory: info.isDirectory(), size: info.size, modified: info.mtime.toISOString(), blocked: info.isSymbolicLink() ? '不支持符号链接' : protectedReason(itemPath, includeEnvironment) };
  }).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { siteId: Number(site.id), root: fs.realpathSync(site.rootPath), path: relative, items };
}
function selection(site, paths, includeEnvironment) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 1000) throw new Error('请选择 1 至 1000 个文件或目录');
  const files = new Map(), skipped = new Set(); let visited = 0;
  function walk(relative) {
    if (++visited > 50000) throw new Error('所选目录超过 50000 项，请分批上传');
    const reason = protectedReason(relative, includeEnvironment);
    if (reason) { skipped.add(`${relative}：${reason}`); return; }
    const { localPath, stat } = localFile(site.rootPath, relative);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(localPath)) walk([relative, name].filter(Boolean).join('/'));
    } else {
      files.set(relative, { localPath, relativePath: relative, size: stat.size, stamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}` });
    }
  }
  for (const entry of new Set(paths.map(relativePath))) { if (!entry) throw new Error('请勾选根目录内的具体文件或目录'); walk(entry); }
  return { ...completeTemplateBundle(site.rootPath, [...files.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)), relative => protectedReason(relative, includeEnvironment)), skipped: [...skipped] };
}
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function identity(site, config) {
  return fingerprint([site.id, site.rootPath, config.host, config.port, config.user, config.password, config.secure, config.remoteRoot, config.networkInterface]);
}
function retryableConnectionError(error) {
  return /server sent fin|connection closed|client is closed|econnreset|econnrefused|etimedout|timeout|timed out|\b421\b|\b425\b|\b426\b/i.test(String(error?.message || error));
}
async function connection(config, callback, factory = () => createFtpClient(config)) {
  if (!config.host || !config.user || !config.password) throw new Error('请先保存当前站点的 FTP 连接配置');
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = factory();
    let stage = '连接或登录 FTP';
    try {
      await client.access({ host: config.host, port: Number(config.port || 21), user: config.user, password: config.password, secure: Boolean(config.secure), ...(config.secure ? { secureOptions: { rejectUnauthorized: false } } : {}) });
      stage = '读取远程目录';
      await descend(client, remoteRootPath(config));
      return await callback(client);
    } catch (error) {
      if (!retryableConnectionError(error)) {
        if (Number(error.code) === 530 || /^530\b/.test(error.message || '')) throw new Error('FTP 登录被拒绝，请核对已保存的用户名、密码及账号访问限制。');
        throw error;
      }
      if (attempt === attempts) {
        const beforeGreeting = stage === '连接或登录 FTP' && client.ftp?.socket?.bytesRead === 0;
        throw new Error(`${stage}失败（已自动重试 ${attempts - 1} 次）。${beforeGreeting ? '服务器在返回欢迎信息前就关闭了连接。' : '服务器断开连接或响应超时。'}请检查 FTP 服务、端口和连接数/IP 限制后重新读取；没有上传任何文件。`);
      }
    } finally { client.close(); }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(config.browserRetryDelayMs ?? 800)) * attempt));
  }
}
async function descend(client, relative, allowMissing = false) {
  for (const part of relativePath(relative).split('/').filter(Boolean)) {
    const item = (await client.list()).find(item => item.name === part);
    if (!item && allowMissing) return false;
    if (!item || item.type !== 2) throw new Error(`远程目录不存在或是链接：${part}`);
    await client.cd(part);
  }
  return true;
}
async function listRemote(config, relative = '', factory) {
  relative = relativePath(relative);
  return connection(config, async client => {
    await descend(client, relative);
    const items = (await client.list()).map(item => ({ name: item.name, path: [relative, item.name].filter(Boolean).join('/'), directory: item.type === 2, blocked: item.type !== 1 && item.type !== 2 ? '不支持链接' : '', size: item.size, modified: item.modifiedAt?.toISOString() || '' }));
    items.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { root: config.remoteRoot || '/', path: relative, currentDirectory: await client.pwd(), items };
  }, factory);
}
function createFileBrowser() {
  const plans = new Map();
  function prepare(site, config, body) {
    remoteRootPath(config);
    if (Number(body.siteId) !== Number(site.id)) throw new Error('站点已切换，请刷新文件列表');
    const includeEnvironment = body.includeEnvironment === true;
    const result = selection(site, body.paths, includeEnvironment);
    if (!result.files.length) throw new Error('所选范围没有可上传文件');
    for (const [key, value] of plans) if (value.expires < Date.now()) plans.delete(key);
    if (plans.size > 100) throw new Error('待确认计划过多，请稍后重试');
    const token = crypto.randomUUID();
    plans.set(token, { siteId: site.id, identity: identity(site, config), paths: body.paths, includeEnvironment, signature: fingerprint(result), expires: Date.now() + 10 * 60000 });
    return { templateDependencyVersion: 1, token, siteId: Number(site.id), siteName: site.name, localRoot: fs.realpathSync(site.rootPath), target: `${config.host || '未配置'}:${Number(config.port || 21)}${config.remoteRoot || '/'}`, remoteRoot: config.remoteRoot || '/', total: result.files.length, totalSize: result.files.reduce((sum, file) => sum + file.size, 0), files: result.files.map(({ relativePath, size, dependency }) => ({ relativePath, size, dependency })), dependencies: result.dependencies, skipped: result.skipped, includeEnvironment };
  }
  function consume(site, config, body) {
    const plan = plans.get(body.token);
    if (!plan || plan.expires < Date.now() || Number(body.siteId) !== Number(site.id) || plan.siteId !== site.id || plan.identity !== identity(site, config)) throw new Error('计划已失效或站点/FTP 配置已变化，请重新预览');
    const result = selection(site, plan.paths, plan.includeEnvironment);
    if (fingerprint(result) !== plan.signature) throw new Error('本地文件已变化，请重新预览');
    plans.delete(body.token);
    return { config: { ...config, localRoot: site.rootPath, uploadScope: 'selected', skipSameSizeAssets: false, backupBeforeOverwrite: false }, files: result.files,
      beforeFile: async (file, client, baseDir) => {
        const { stat } = localFile(site.rootPath, file.relativePath);
        if (`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}` !== file.stamp) throw new Error(`文件已变化，请重新预览：${file.relativePath}`);
        if (baseDir) await client.cd(baseDir);
        await descend(client, remoteRootPath(config));
        const parent = path.posix.dirname(file.relativePath);
        if (await descend(client, parent === '.' ? '' : parent, true)) {
          const target = (await client.list()).find(item => item.name === path.posix.basename(file.relativePath));
          if (target && target.type !== 1) throw new Error(`远端同名项目不是普通文件：${file.relativePath}`);
        }
      } };
  }
  return { prepare, consume };
}
module.exports = { relativePath, localFile, protectedReason, listLocal, listRemote, selection, createFileBrowser };
