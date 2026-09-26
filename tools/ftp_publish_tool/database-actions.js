const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const siteRuntime = require('../site-runtime');
const { createBtPanel, runRemoteBuild, shellQuote } = require('./bt-panel');
const { createFtpClient } = require('./ftp-client');
const { databasePathFromEnvText } = require('./sync-engine');
const ROOT = path.resolve(__dirname, '../..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

function createDatabaseActions({ engine, busy = () => false, runRemote = runRemoteBuild }) {
  const previews = new Map();
  const state = { running: false, action: '', scope: '', error: '', result: null, logs: [], finishedAt: '' };
  function target(scope, siteId) {
    const site = siteRuntime.currentSite();
    if (!['manager', 'site'].includes(scope)) throw new Error('未知数据库类型');
    if (scope === 'site' && (!site || Number(site.id) !== Number(siteId))) throw new Error('当前站点已切换，请重新读取数据库');
    if (scope === 'site' && site.environment !== 'phpstudy') throw new Error('网站数据库同步只能从本地 phpStudy 站点发起');
    const project = engine.readSyncConfig().project;
    if (!project.btPanel?.url || !project.btPanel.user || !project.btPanel.password) throw new Error('请先在连接设置保存宝塔面板账号');
    const source = scope === 'site' ? site.dbPath : databasePathFromEnvText(fs.readFileSync(path.join(ROOT, 'backend/.env'), 'utf8'), path.join(ROOT, 'backend'));
    const sourceRoot = path.resolve(scope === 'site' ? site.rootPath : ROOT);
    const relative = path.relative(sourceRoot, path.resolve(source));
    if (relative.startsWith('..') || path.isAbsolute(relative) || fs.realpathSync(source) !== path.resolve(source)) throw new Error('源数据库必须位于所选项目或网站目录内，不能是链接');
    return { project, site, source, revision: hash(JSON.stringify({ project, siteId: site?.id, siteCode: site?.code, source })) };
  }
  async function remote(t, request, onLog = () => {}) {
    const args = Buffer.from(JSON.stringify(request)).toString('base64');
    const script = path.posix.join(t.project.serverProjectRoot, 'deploy/database-actions.py');
    const panel = createBtPanel({ ...t.project.btPanel, networkInterface: t.project.networkInterface });
    // Area sync ships its runner in memory; it does not require deploying or
    // overwriting management-project files before this standalone operation.
    let command = `python3 ${shellQuote(script)} ${shellQuote(args)}`;
    if (['inspect-areas', 'sync-areas'].includes(request.action)) {
      const source = fs.readFileSync(path.join(ROOT, 'deploy/database-actions.py')).toString('base64');
      const runner = `import base64;exec(compile(base64.b64decode('${source}'),${JSON.stringify(script)},'exec'),{'__name__':'__main__','__file__':${JSON.stringify(script)}})`;
      command = `python3 -c ${shellQuote(runner)} ${shellQuote(args)}`;
    }
    const result = await runRemote(panel, t.project.serverProjectRoot, { onLog, command });
    const match = result.log.match(/^PBOOT_DATABASE_RESULT=(.+)$/m);
    if (!match) throw new Error('未读取到数据库操作结果，请检查宝塔日志');
    return JSON.parse(match[1]);
  }
  async function inspect(body) {
    if (busy() || state.running) throw new Error('发布或维护正在执行，请稍后读取');
    const t = target(body.scope, body.siteId);
    const areasOnly = body.areasOnly === true;
    if (areasOnly && body.scope !== 'site') throw new Error('区域配置只能用于当前 PB 网站');
    Object.assign(state, { running: true, action: 'inspect', scope: body.scope, error: '', result: null, logs: [], finishedAt: '' });
    try {
      const areas = areasOnly ? await readAreas(t.source) : undefined;
      const result = await remote(t, { action: areasOnly ? 'inspect-areas' : 'inspect', scope: body.scope, siteCode: t.site?.code });
      const token = crypto.randomBytes(24).toString('hex');
      for (const [key, p] of previews) if (p.expires < Date.now()) previews.delete(key);
      if (previews.size > 30) previews.clear();
      previews.set(token, { scope: body.scope, siteId: body.siteId, revision: t.revision, remote: result, areas, expires: Date.now() + 600000 });
      return { token, source: t.source, siteName: body.scope === 'site' ? t.site.name : '管理后台', online: result, areas };
    } finally { state.running = false; }
  }
  async function snapshot(source) {
    const st = fs.lstatSync(source);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 128 * 1024 * 1024) throw new Error('源库不是普通 SQLite 文件或超过 128 MB');
    if (fs.existsSync(source + '-wal') && fs.statSync(source + '-wal').size) throw new Error('本地数据库正在使用 WAL，请先停止写入并完成检查点');
    const buffer = fs.readFileSync(source);
    const end = fs.statSync(source);
    if (st.mtimeMs !== end.mtimeMs || st.size !== end.size || buffer.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('本地数据库正在变化或格式错误，请稍后重试');
    const SQL = await require(path.join(ROOT, 'backend/node_modules/sql.js'))();
    const db = new SQL.Database(buffer);
    try {
      if (db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('本地数据库完整性检查未通过');
    } finally { db.close(); }
    return buffer;
  }
  async function readAreas(source) {
    const data = await snapshot(source);
    const SQL = await require(path.join(ROOT, 'backend/node_modules/sql.js'))();
    const db = new SQL.Database(data);
    try {
      const result = db.exec("SELECT acode,name,coalesce(domain,'') AS domain,CAST(is_default AS INTEGER) AS is_default FROM ay_area WHERE coalesce(pcode,'0')='0' ORDER BY acode")[0];
      const areas = (result?.values || []).map(row => Object.fromEntries(result.columns.map((key, index) => [key, row[index]])));
      if (!areas.length || areas.length > 500 || areas.filter(row => row.is_default === 1).length !== 1) throw new Error('本地区域为空、超过 500 个或未设置唯一默认语言');
      return areas;
    } finally { db.close(); }
  }
  async function execute(t, p, body) {
    const request = { action: body.action, scope: p.scope, siteCode: t.site?.code, revision: p.remote.revision, name: body.name, allowPhpPause: body.allowPhpPause === true };
    let client; let temp; let remotePath;
    try {
      if (body.action === 'sync-areas') {
        const areas = await readAreas(t.source);
        if (JSON.stringify(areas) !== JSON.stringify(p.areas)) throw new Error('本地区域已修改，请重新预览后同步');
        request.areas = areas;
        request.areaRevision = p.remote.areaRevision;
        state.logs.push(`正在同步 ${areas.length} 个语言区域，保留线上其他数据…`);
      }
      if (body.action === 'sync') {
        if (!t.project.secure) throw new Error('数据库同步需要使用已配置的 FTPS 加密连接');
        state.logs.push('正在校验本地数据库并生成上传快照…');
        const data = await snapshot(t.source);
        state.logs.push(`正在上传数据库快照（${(data.length / 1024 / 1024).toFixed(2)} MB），请等待…`);
        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-db-upload-'));
        const file = path.join(temp, 'snapshot.sqlite'); fs.writeFileSync(file, data);
        const name = crypto.randomBytes(20).toString('hex') + '.sqlite';
        client = createFtpClient(t.project, 45000);
        await client.access({ host: t.project.host, port: t.project.port || 21, user: t.project.user, password: t.project.password, secure: true, secureOptions: { rejectUnauthorized: false } });
        await client.cd(t.project.remoteRoot || '/');
        await client.ensureDir('data/sync-staging');
        remotePath = path.posix.join(await client.pwd(), name);
        await client.uploadFrom(file, name);
        request.source = name; request.sha256 = hash(data);
        state.logs.push('快照已上传，正在校验并写入线上数据库…');
      }
      return await remote(t, request, line => { state.logs.push(line); if (state.logs.length > 50) state.logs.shift(); });
    } finally {
      if (client) {
        try { if (remotePath) await client.remove(remotePath); }
        catch (_) { state.logs.push('上传暂存库未清理，请在宝塔检查 data/sync-staging/' + request.source); }
        client.close();
      }
      if (temp && path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith('pboot-db-upload-')) fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  function start(body) {
    if (busy() || state.running) throw new Error('发布或维护正在执行，请稍后操作');
    if (body.confirm !== true || !['rename', 'sync', 'sync-areas'].includes(body.action)) throw new Error('请确认数据库操作');
    const p = previews.get(body.token);
    if (!p || p.expires < Date.now()) throw new Error('读取结果已过期，请重新读取线上数据库');
    if (Boolean(p.areas) !== (body.action === 'sync-areas')) throw new Error('预览类型不匹配，请重新预览对应操作');
    const t = target(p.scope, p.siteId);
    if (t.revision !== p.revision) throw new Error('连接配置已变化，请重新读取');
    if (body.action === 'rename' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.(db|sqlite|sqlite3)$/.test(body.name || '')) throw new Error('请输入合法的数据库文件名（.db / .sqlite / .sqlite3）');
    if (body.action === 'rename' && body.name === p.remote.name) throw new Error('名称未变化，无需改名');
    previews.delete(body.token);
    Object.assign(state, { running: true, action: body.action, scope: p.scope, siteId: p.siteId, error: '', result: null, logs: [], finishedAt: '' });
    execute(t, p, body).then(result => { state.result = result; }).catch(error => { state.error = error.message; }).finally(() => { state.running = false; state.finishedAt = new Date().toISOString(); });
    return { started: true };
  }
  return { inspect, start, status: () => ({ ...state, areaSyncSupported: true }), isRunning: () => state.running };
}
module.exports = { createDatabaseActions };
