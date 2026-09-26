const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const siteRuntime = require('../site-runtime');
const { createBtPanel, runRemoteBuild, shellQuote } = require('./bt-panel');
const ROOT = path.resolve(__dirname, '../..');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function host(value) {
  try {
    const u = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    if (u.username || u.password || u.port || !['', '/'].includes(u.pathname) || u.search || u.hash) return '';
    return u.hostname.toLowerCase();
  } catch { return ''; }
}

function createDomainCheck({ engine, busy = () => false, remote = runRemoteBuild }) {
  let running = null;
  const states = new Map();
  function target(siteId) {
    const site = siteRuntime.currentSite();
    if (!site || Number(site.id) !== Number(siteId) || site.environment !== 'phpstudy') throw new Error('请选择当前本地网站再检测');
    const project = engine.readSyncConfig().project;
    if (!project.btPanel?.url || !project.btPanel.user || !project.btPanel.password) throw new Error('请先在代码与配置同步的连接设置中保存宝塔面板账号');
    if (!net.isIP(project.host)) throw new Error('请在连接设置中填写宝塔服务器公网 IP');
    if (!project.serverProjectRoot?.startsWith('/') || project.serverProjectRoot.split('/').includes('..')) throw new Error('线上管理项目目录无效');
    let license;
    try { license = JSON.parse(fs.readFileSync(path.join(site.directory, 'state/system-license.json'), 'utf8')); }
    catch { throw new Error('请先在系统授权码设置中填写此站点的线上域名列表'); }
    const domains = license.profiles?.baota?.domains;
    if (Number(license.siteId) !== Number(site.id) || !Array.isArray(domains) || !domains.length || domains.some(d => !/^[a-z0-9.-]+$/.test(d))) throw new Error('当前站点的线上域名列表无效');
    const stat = fs.statSync(site.dbPath);
    return { site, project, domains, revision: digest([site.code, site.dbPath, stat.size, stat.mtimeMs, project, domains]) };
  }
  async function execute(t) {
    const SQL = await require(path.join(ROOT, 'backend/node_modules/sql.js'))();
    const db = new SQL.Database(fs.readFileSync(t.site.dbPath));
    let items;
    try {
      const result = db.exec("SELECT acode,domain FROM ay_area WHERE coalesce(pcode,'0')='0' ORDER BY id")[0];
      items = (result?.values || []).map(([language, domain]) => ({ language: String(language), domain: host(String(domain || '')) }));
    } finally { db.close(); }
    if (!items.length || items.length > 30) throw new Error('当前 PB 网站语言数量应为 1 到 30 个');
    const request = { projectRoot: t.project.serverProjectRoot, siteCode: t.site.code, expectedIp: t.project.host, domains: t.domains, items };
    const source = fs.readFileSync(path.join(ROOT, 'deploy/check-language-domains.py'), 'utf8');
    const command = `timeout 180s python3 -B -c ${shellQuote(source)} ${shellQuote(Buffer.from(JSON.stringify(request)).toString('base64'))}`;
    const response = await remote(createBtPanel({ ...t.project.btPanel, networkInterface: t.project.networkInterface }), t.project.serverProjectRoot, { command, attempts: 70 });
    const match = response.log.match(/^PBOOT_DOMAIN_RESULT_Z=([A-Za-z0-9+/=]+)\s*$/m);
    if (!match) throw new Error('未收到完整检测结果，请检查线上项目已包含数据库管理脚本');
    const report = JSON.parse(gunzipSync(Buffer.from(match[1], 'base64'), { maxOutputLength: 1024 * 1024 }).toString('utf8'));
    if (report.siteCode !== t.site.code || report.rows?.length !== items.length || report.rows.some((row, i) => row.language !== items[i].language || row.domain !== items[i].domain)) throw new Error('检测结果站点或语言不匹配');
    return { ...report, revision: t.revision, siteId: t.site.id, siteName: t.site.name };
  }
  function start(body) {
    if (running || busy()) throw new Error('发布、维护或检测正在运行，请完成后重试');
    const t = target(body.siteId);
    running = t.site.code;
    states.set(t.site.code, { error: '', result: null });
    execute(t).then(result => {
      const folder = path.join(t.site.directory, 'state'); fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'domain-check.json'), JSON.stringify(result));
      states.set(t.site.code, { error: '', result });
    }).catch(error => {
      // Do not expose panel responses, credentials or shell source in a UI error.
      const message = String(error.message || '检测失败');
      const remoteError = message.match(/PBOOT_DOMAIN_ERROR=([^\r\n]+)/);
      states.set(t.site.code, { error: remoteError ? remoteError[1] : message.includes('PBOOT_BUILD_FAILED') ? '服务器检测执行失败，请检查线上项目配置' : message.slice(0, 250), result: null });
    }).finally(() => { running = null; });
    return { started: true };
  }
  function status() {
    const site = siteRuntime.currentSite();
    if (!site) return { running: false, error: '未选择站点', result: null };
    let state = states.get(site.code);
    if (!state) {
      try { state = { error: '', result: JSON.parse(fs.readFileSync(path.join(site.directory, 'state/domain-check.json'), 'utf8')) }; }
      catch { state = { error: '', result: null }; }
    }
    let stale = false;
    if (state.result) {
      try { stale = state.result.revision !== target(site.id).revision; } catch { stale = true; }
    }
    return { ...state, stale, running: running === site.code, busy: Boolean(running), siteId: site.id };
  }
  return { start, status, isRunning: () => Boolean(running) };
}
module.exports = { createDomainCheck, host };
