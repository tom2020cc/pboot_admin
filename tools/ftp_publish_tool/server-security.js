const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { contentRulesFor, isExecutablePath, isUploadLikePath, hasDoubleExecutableExtension } = require('./security-monitor');
const runtime = require('../site-runtime');
const EXCLUDED = new Set(['.git', '.svn', 'node_modules']);
const DEFAULTS = { enabled: false, intervalMinutes: 360, maxFiles: 30000, maxFileMB: 8 };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

function serverContentRules(data, relative) {
  // JPEG binary data can randomly contain the three bytes "<?="; require a readable PHP statement.
  const phpStatement = /<\?(?:php\s+|=)[^\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]{3,1024}?(?:;|\?>)/i;
  return contentRulesFor(data, relative).filter(rule => rule.id !== 'php-in-static-file' || phpStatement.test(data.toString('utf8')));
}

function scopeFor(site) {
  if (!site?.id || !site.rootPath || !path.isAbsolute(site.rootPath)) throw new Error('当前网站尚未配置服务器绝对根目录。');
  const configured = path.resolve(site.rootPath);
  if (configured === path.parse(configured).root || ['/www', '/www/wwwroot', '/root', '/etc', '/usr', '/home'].includes(configured)) {
    throw new Error('不能扫描系统根目录或网站集合目录。');
  }
  const rootStat = fs.lstatSync(configured);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('网站根目录必须是真实目录，不能是符号链接。');
  const root = fs.realpathSync.native(configured);
  const storage = fs.realpathSync.native(site.directory);
  if (inside(root, storage)) throw new Error('巡检报告存储目录必须位于公开网站目录之外。');
  const directory = path.join(storage, 'server-security');
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('巡检存储目录不能是符号链接。');
  return { siteId: String(site.id), root, directory, fingerprint: hash([site.id, root, rootStat.dev, rootStat.ino].join('|')) };
}

function save(scope, name, value) {
  fs.mkdirSync(scope.directory, { recursive: true, mode: 0o700 });
  const file = path.join(scope.directory, name);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

function normalizeSettings(input) {
  const result = { enabled: input.enabled === true };
  for (const [key, min, max] of [['intervalMinutes', 15, 10080], ['maxFiles', 100, 100000], ['maxFileMB', 1, 64]]) {
    const value = input[key] === undefined ? DEFAULTS[key] : Number(input[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 必须是 ${min} 到 ${max} 之间的整数。`);
    result[key] = value;
  }
  return result;
}

async function scanSite(site, settings = DEFAULTS, baseline = null, options = {}) {
  const scope = scopeFor(site), start = Date.now();
  settings = normalizeSettings({ ...DEFAULTS, ...settings });
  const report = { id: crypto.randomUUID(), ...scope, directory: undefined, startedAt: new Date().toISOString(),
    finishedAt: '', complete: false, cancelled: false, engine: 'heuristic-v1', files: {}, findings: [], warnings: [],
    excludedDirectories: [], scanned: 0, skipped: 0, bytes: 0, newFiles: 0, changedFiles: 0, missingFiles: 0 };
  const previous = baseline?.fingerprint === scope.fingerprint ? baseline.files : null;
  const seen = new Set(); let entries = 0; let truncated = false;
  const finding = (relative, severity, title) => {
    if (report.findings.length >= 2000) { truncated = true; return; }
    report.findings.push({ path: relative, severity, title });
  };
  const warn = (relative, message) => { report.skipped++; if (report.warnings.length < 100) report.warnings.push(`${relative}: ${message}`); };
  function checkLimits() {
    if (options.signal?.aborted) throw new Error('SCAN_CANCELLED');
    if (Date.now() - start > 10 * 60 * 1000 || report.bytes > 512 * 1024 * 1024) throw new Error('达到本次扫描时间或 512 MB 总读取上限。');
  }
  async function visit(directory, depth) {
    checkLimits();
    if (depth > 40) throw new Error('目录层级超过 40 层。');
    if (!inside(scope.root, await fsp.realpath(directory)) || (await fsp.lstat(directory)).isSymbolicLink()) throw new Error('目录在扫描过程中变化或跳出网站范围。');
    const dir = await fsp.opendir(directory);
    for await (const entry of dir) {
      checkLimits();
      if (++entries > settings.maxFiles) throw new Error('达到扫描条目上限，请调整限制后重新扫描。');
      const full = path.join(directory, entry.name), relative = path.relative(scope.root, full).split(path.sep).join('/');
      seen.add(relative);
      if (entry.isSymbolicLink()) { warn(relative, '跳过符号链接'); continue; }
      if (entry.isDirectory()) {
        if (EXCLUDED.has(entry.name)) { if (report.excludedDirectories.length < 100) report.excludedDirectories.push(relative); continue; }
        try { await visit(full, depth + 1); } catch (error) {
          if (error.message === 'SCAN_CANCELLED' || /上限|层级|跳出/.test(error.message)) throw error;
          warn(relative, '目录不可读取');
        }
        continue;
      }
      if (!entry.isFile()) { warn(relative, '跳过特殊文件'); continue; }
      if (hasDoubleExecutableExtension(relative)) finding(relative, 'high', '双扩展名伪装脚本');
      if (isExecutablePath(relative) && isUploadLikePath(relative)) finding(relative, 'high', '上传/静态目录存在可执行脚本');
      let file;
      try {
        const before = await fsp.lstat(full);
        if (before.isSymbolicLink() || !before.isFile() || before.nlink > 1 || !inside(scope.root, await fsp.realpath(full))) throw new Error('UNSAFE');
        if (before.size > settings.maxFileMB * 1024 * 1024) { warn(relative, `超过 ${settings.maxFileMB} MB，未读取内容`); continue; }
        file = await fsp.open(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
        const actual = await file.stat();
        if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev || actual.nlink > 1) throw new Error('UNSAFE');
        const chunks = []; let size = 0;
        while (true) {
          checkLimits();
          const buffer = Buffer.alloc(64 * 1024), { bytesRead } = await file.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          size += bytesRead; report.bytes += bytesRead;
          if (size > settings.maxFileMB * 1024 * 1024) throw new Error('CHANGED');
          chunks.push(buffer.subarray(0, bytesRead));
        }
        const after = await file.stat();
        if (after.size !== actual.size || after.mtimeMs !== actual.mtimeMs || size !== after.size) throw new Error('CHANGED');
        const data = Buffer.concat(chunks), digest = hash(data);
        report.files[relative] = { hash: digest, size, mtimeMs: after.mtimeMs };
        report.scanned++;
        for (const rule of serverContentRules(data, relative)) finding(relative, rule.severity, rule.label);
        if (previous && !previous[relative]) { report.newFiles++; finding(relative, 'low', '基线后新增文件'); }
        else if (previous?.[relative]?.hash !== undefined && previous[relative].hash !== digest) {
          report.changedFiles++; finding(relative, isExecutablePath(relative) ? 'medium' : 'low', '文件内容与基线不同');
        }
      } catch (error) {
        if (error.message === 'SCAN_CANCELLED' || /上限/.test(error.message)) throw error;
        warn(relative, '不可读、链接异常或扫描时发生变化');
      } finally { await file?.close(); }
      if (entries % 20 === 0) { options.onProgress?.({ scanned: report.scanned, skipped: report.skipped, currentPath: relative }); await delay(10); }
    }
  }
  try {
    await visit(scope.root, 0);
    if (scopeFor(site).fingerprint !== scope.fingerprint) throw new Error('网站根目录已变化。');
    report.complete = report.skipped === 0 && !truncated;
    if (previous && report.complete) for (const relative of Object.keys(previous)) if (!seen.has(relative)) {
      report.missingFiles++; finding(relative, 'medium', '基线文件已消失');
    }
  } catch (error) {
    report.cancelled = error.message === 'SCAN_CANCELLED';
    report.warnings.push(report.cancelled ? '用户停止扫描；当前结果不完整。' : error.message);
  }
  if (truncated) { report.complete = false; report.warnings.push('异常数量超过报告上限，请先处理现有异常。'); }
  report.finishedAt = new Date().toISOString();
  report.high = report.findings.filter(f => f.severity === 'high').length;
  report.medium = report.findings.filter(f => f.severity === 'medium').length;
  report.canAdopt = report.complete && report.scanned > 0 && report.high === 0 && report.medium === 0;
  return report;
}

function publicReport(report) { if (!report) return null; const { files, ...rest } = report; return rest; }
function createServerSecurity({ busy = () => false, listSites = runtime.readManagedSites } = {}) {
  const jobs = new Map(); let active = null;
  const fileActions = require('./server-file-actions').createFileActions({ scopeFor, save, busy: () => !!active || busy() });
  function settings(scope) { return normalizeSettings({ ...DEFAULTS, ...read(path.join(scope.directory, 'settings.json'), {}) }); }
  function status(site) {
    const scope = scopeFor(site), job = jobs.get(String(site.id));
    const report = read(path.join(scope.directory, 'latest.json'), null);
    const baseline = read(path.join(scope.directory, 'baseline.json'), null);
    const dispositions = fileActions.view(site, report);
    return { site: { id: site.id, name: site.name, publicBaseUrl: site.publicBaseUrl, root: scope.root }, settings: settings(scope),
      running: job?.running === true, progress: job?.progress || {}, error: job?.error || '',
      report: report?.fingerprint === scope.fingerprint ? publicReport(dispositions.report) : null,
      trusted: dispositions.trusted, quarantine: dispositions.quarantine, audit: dispositions.audit,
      baseline: baseline?.fingerprint === scope.fingerprint ? { createdAt: baseline.createdAt, count: Object.keys(baseline.files).length } : null,
      history: read(path.join(scope.directory, 'history.json'), []).filter(r => r.fingerprint === scope.fingerprint),
      nextRunAt: job?.nextRunAt || null };
  }
  function start(site) {
    if (active || busy()) throw new Error('已有发布或巡检任务正在执行，请稍后重试。');
    const scope = scopeFor(site), opts = settings(scope), controller = new AbortController();
    const old = jobs.get(String(site.id));
    const job = { running: true, controller, progress: {}, nextRunAt: old?.nextRunAt || null, error: '' };
    jobs.set(String(site.id), job); active = job;
    job.promise = scanSite(site, opts, read(path.join(scope.directory, 'baseline.json'), null), {
      signal: controller.signal, onProgress: progress => { job.progress = progress; },
    }).then(report => {
      save(scope, 'latest.json', report);
      const { findings, warnings, ...summary } = publicReport(report);
      save(scope, 'history.json', [summary, ...read(path.join(scope.directory, 'history.json'), [])].slice(0, 20));
    }).catch(error => { job.error = error.message; }).finally(() => {
      job.running = false; active = null;
      const next = settings(scope);
      job.nextRunAt = next.enabled ? new Date(Date.now() + next.intervalMinutes * 60000).toISOString() : null;
    });
    return job;
  }
  function stop(site) { jobs.get(String(site.id))?.controller?.abort(); }
  function configure(site, input) {
    const scope = scopeFor(site), next = normalizeSettings(input);
    save(scope, 'settings.json', next);
    const job = jobs.get(String(site.id)) || {};
    job.nextRunAt = next.enabled ? new Date(Date.now() + next.intervalMinutes * 60000).toISOString() : null;
    jobs.set(String(site.id), job);
    if (!next.enabled) stop(site);
    return next;
  }
  function adopt(site, reportId) {
    if (active || busy()) throw new Error('请等待当前操作完成。');
    const scope = scopeFor(site), report = read(path.join(scope.directory, 'latest.json'), null);
    if (!report?.canAdopt || report.id !== reportId || report.fingerprint !== scope.fingerprint) throw new Error('仅允许采用本网站最近一次完整且无高/中风险的报告。');
    if (Date.now() - Date.parse(report.finishedAt) > 30 * 60000) throw new Error('报告已超过 30 分钟，请重新扫描。');
    save(scope, 'baseline.json', { fingerprint: scope.fingerprint, createdAt: report.finishedAt, files: report.files });
  }
  function tick() {
    for (const site of listSites()) {
      try {
        const scope = scopeFor(site), opts = settings(scope);
        if (!opts.enabled) continue;
        const job = jobs.get(String(site.id)) || {};
        if (!job.nextRunAt) {
          const last = read(path.join(scope.directory, 'latest.json'), null);
          job.nextRunAt = new Date((Date.parse(last?.finishedAt) || Date.now()) + opts.intervalMinutes * 60000).toISOString();
          jobs.set(String(site.id), job);
        }
        if (!active && !busy() && Date.now() >= Date.parse(job.nextRunAt)) start(site);
      } catch (error) { const id = String(site.id); jobs.set(id, { ...jobs.get(id), error: error.message }); }
    }
  }
  return { status, start, stop, configure, adopt, tick, inspect: fileActions.inspect, fileAction: fileActions.mutate, isRunning: () => !!active };
}
module.exports = { scanSite, scopeFor, normalizeSettings, createServerSecurity, publicReport, serverContentRules };
