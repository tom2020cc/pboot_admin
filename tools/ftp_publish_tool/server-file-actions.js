const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const MAX_READ = 64 * 1024 * 1024;
const PREVIEW_BYTES = 128 * 1024;
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\:\x00-\x1f]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('文件路径不合法。');
  return value;
}

// On Linux, keep the parent directory open so later operations cannot follow a swapped ancestor.
function parentHandle(root, relative) {
  relativePath(relative);
  const parts = relative.split('/'), leaf = parts.pop(), handles = [];
  let current = root;
  try {
    for (const part of [null, ...parts]) {
      if (part !== null) current = path.join(current, part);
      const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('目录包含链接或不是普通目录。');
      if (process.platform === 'linux') {
        const fd = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        handles.push(fd);
        if (!same(st, fs.fstatSync(fd))) throw new Error('目录发生变化，请重试。');
        current = `/proc/self/fd/${fd}`;
      } else if (fs.realpathSync.native(current) !== path.resolve(current)) throw new Error('目录路径发生变化。');
    }
    return { file: path.join(current, leaf), close: () => handles.reverse().forEach(fd => fs.closeSync(fd)) };
  } catch (e) { handles.reverse().forEach(fd => fs.closeSync(fd)); throw e; }
}

function readVerified(file, expected) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('仅允许处理普通文件；链接和特殊文件不可操作。');
  if (before.size > MAX_READ) throw new Error('文件超过 64 MB，不能在线处理。');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const start = fs.fstatSync(fd);
    if (!same(before, start) || !start.isFile() || start.nlink !== 1) throw new Error('文件已变化，请重新扫描。');
    const chunks = []; let length = 0;
    while (true) {
      const chunk = Buffer.alloc(64 * 1024), n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      length += n; if (length > MAX_READ) throw new Error('文件在读取期间超出限制。');
      chunks.push(chunk.subarray(0, n));
    }
    const end = fs.fstatSync(fd), current = fs.lstatSync(file), data = Buffer.concat(chunks), hash = digest(data);
    if (!same(end, current) || current.isSymbolicLink() || end.nlink !== 1 || start.size !== end.size ||
      start.mtimeMs !== end.mtimeMs || start.ctimeMs !== end.ctimeMs || length !== end.size || (expected && hash !== expected)) {
      throw new Error('文件内容已变化，请重新扫描、读取后再操作。');
    }
    return { data, hash, stat: end };
  } finally { fs.closeSync(fd); }
}

function createFileActions({ scopeFor, save, busy = () => false, now = Date.now }) {
  const receipts = new Map();
  const empty = () => ({ trusted: [], quarantine: [], audit: [] });
  function load(scope) {
    const file = path.join(scope.directory, 'actions.json');
    if (!exists(file)) return empty();
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('处置记录不能是链接。');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value.trusted) || !Array.isArray(value.quarantine) || !Array.isArray(value.audit)) throw new Error('处置记录损坏，已停止文件操作。');
    return value;
  }
  function stamp(state, scope, action, relative, actor, extra = {}) {
    state.audit.unshift({ id: crypto.randomUUID(), fingerprint: scope.fingerprint, time: new Date(now()).toISOString(),
      action, path: relative, actor: actor ? digest(actor).slice(0, 12) : 'admin', ...extra });
    state.audit = state.audit.slice(0, 500);
  }
  function current(scope, body) {
    const report = JSON.parse(fs.readFileSync(path.join(scope.directory, 'latest.json'), 'utf8'));
    const relative = relativePath(body.path);
    if (report.id !== body.reportId || report.fingerprint !== scope.fingerprint || !report.findings.some(f => f.path === relative)) {
      throw new Error('仅能处理当前网站最近报告中的告警文件，请刷新报告。');
    }
    const entry = Object.hasOwn(report.files, relative) ? report.files[relative] : null;
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new Error('该文件没有完整读取指纹，请重新扫描或在宝塔中人工核查。');
    return { report, relative, entry };
  }
  function view(site, report) {
    const scope = scopeFor(site), state = load(scope);
    const trusted = state.trusted.filter(t => t.fingerprint === scope.fingerprint);
    const quarantine = state.quarantine.filter(t => t.fingerprint === scope.fingerprint);
    let result = report;
    if (report?.fingerprint === scope.fingerprint) {
      result = { ...report, findings: report.findings.map(f => {
        const hash = Object.hasOwn(report.files, f.path) ? report.files[f.path].hash : null;
        const trust = trusted.find(t => t.path === f.path && t.hash === hash);
        const removed = quarantine.find(t => t.path === f.path && t.hash === hash && t.status === 'quarantined');
        return { ...f, trusted: !!trust, quarantined: !!removed, actionable: !!hash && !removed };
      }) };
      result.high = result.findings.filter(f => f.severity === 'high' && !f.trusted && !f.quarantined).length;
      result.medium = result.findings.filter(f => f.severity === 'medium' && !f.trusted && !f.quarantined).length;
      result.trustedCount = new Set(result.findings.filter(f => f.trusted).map(f => f.path)).size;
      // Manual dispositions do not turn an old report into a clean baseline. Rescan first.
      result.canAdopt = report.canAdopt && !result.findings.some(f => f.trusted || f.quarantined);
    }
    return { report: result, trusted, quarantine, audit: state.audit.filter(a => a.fingerprint === scope.fingerprint).slice(0, 50) };
  }
  function inspect(site, body, actor = '') {
    if (busy()) throw new Error('发布或巡检正在执行，请完成后读取文件。');
    const scope = scopeFor(site), { relative, entry, report } = current(scope, body);
    const parent = parentHandle(scope.root, relative);
    try {
      const value = readVerified(parent.file, entry.hash), slice = value.data.subarray(0, PREVIEW_BYTES);
      const binary = slice.includes(0) || /[\x01-\x08\x0e-\x1f]/.test(slice.toString('utf8'));
      const sensitive = /(^|\/)(\.env(?:\..*)?|[^/]+\.(?:db|sqlite3?|pem|key|p12|pfx))$/i.test(relative);
      for (const [token, receipt] of receipts) if (receipt.expires <= now()) receipts.delete(token);
      if (receipts.size >= 100) receipts.delete(receipts.keys().next().value);
      const token = crypto.randomBytes(32).toString('hex');
      receipts.set(token, { fingerprint: scope.fingerprint, path: relative, hash: value.hash, reportId: report.id, actor, expires: now() + 10 * 60000 });
      return { path: relative, hash: value.hash, size: value.stat.size, modifiedAt: new Date(value.stat.mtimeMs).toISOString(),
        binary, sensitive, truncated: value.data.length > PREVIEW_BYTES, previewLimit: PREVIEW_BYTES,
        content: sensitive ? '敏感配置或密钥文件仅显示元数据，请在宝塔中核对。' : binary ? '二进制文件不显示文本内容。' : slice.toString('utf8'),
        receipt: token, expiresAt: new Date(now() + 10 * 60000).toISOString() };
    } finally { parent.close(); }
  }
  function quarantineDirectory(scope) {
    fs.mkdirSync(scope.directory, { recursive: true, mode: 0o700 });
    const dir = path.join(scope.directory, 'quarantine');
    if (!exists(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync.native(dir) !== dir) throw new Error('隔离目录不安全。');
    return dir;
  }
  function mutate(site, kind, body, actor = '') {
    if (busy()) throw new Error('发布或巡检正在执行，请完成后操作文件。');
    if (body.confirm !== true) throw new Error('请先核对文件并确认操作。');
    const scope = scopeFor(site), state = load(scope);
    if (kind === 'untrust') {
      const trust = state.trusted.find(t => t.id === body.id && t.fingerprint === scope.fingerprint);
      if (!trust) throw new Error('信任记录不存在或不属于当前网站。');
      state.trusted = state.trusted.filter(t => t !== trust);
      stamp(state, scope, kind, trust.path, actor); save(scope, 'actions.json', state); return { ok: true };
    }
    if (kind === 'restore') return restore(scope, state, body, actor);
    if (!['trust', 'quarantine'].includes(kind)) throw new Error('未知文件操作。');
    const { relative, entry, report } = current(scope, body), receipt = receipts.get(body.receipt);
    if (!receipt || receipt.fingerprint !== scope.fingerprint || receipt.path !== relative || receipt.hash !== entry.hash ||
      receipt.reportId !== report.id || receipt.actor !== actor || receipt.expires <= now()) throw new Error('读取凭证失效，请重新读取该文件。');
    const parent = parentHandle(scope.root, relative);
    try {
      const value = readVerified(parent.file, entry.hash);
      if (scopeFor(site).fingerprint !== scope.fingerprint) throw new Error('网站根目录变化，已停止操作。');
      if (kind === 'trust') {
        const reason = String(body.reason || '').trim();
        if (!reason || reason.length > 300) throw new Error('请填写 1 到 300 字的信任理由。');
        state.trusted = state.trusted.filter(t => !(t.fingerprint === scope.fingerprint && t.path === relative));
        state.trusted.unshift({ id: crypto.randomUUID(), fingerprint: scope.fingerprint, path: relative, hash: value.hash, reason, time: new Date(now()).toISOString() });
        stamp(state, scope, kind, relative, actor); save(scope, 'actions.json', state);
      } else {
        const dir = quarantineDirectory(scope), id = crypto.randomUUID(), dest = path.join(dir, `${id}.bin`);
        if (fs.statSync(dir).dev !== value.stat.dev) throw new Error('隔离目录和网站不在同一文件系统，已停止移动；请在宝塔中处理。');
        const record = { id, fingerprint: scope.fingerprint, path: relative, hash: value.hash, size: value.stat.size,
          mode: value.stat.mode & 0o777, time: new Date(now()).toISOString(), status: 'pending' };
        state.quarantine.unshift(record);
        stamp(state, scope, 'quarantine-request', relative, actor, { quarantineId: id });
        save(scope, 'actions.json', state);
        // Persist the intent first: even an interrupted move remains visible and recoverable.
        try {
          if (!same(value.stat, fs.lstatSync(parent.file))) throw new Error('文件在移动前发生变化。');
          fs.renameSync(parent.file, dest);
          readVerified(dest, value.hash);
          fs.chmodSync(dest, 0o600);
          record.status = 'quarantined';
          state.trusted = state.trusted.filter(t => !(t.fingerprint === scope.fingerprint && t.path === relative));
          stamp(state, scope, 'quarantine', relative, actor, { quarantineId: id });
          save(scope, 'actions.json', state);
        } catch (e) {
          record.status = exists(dest) ? 'review' : 'failed';
          record.error = '移动未完整确认，请先核对隔离记录与原路径。';
          save(scope, 'actions.json', state);
          throw new Error(record.error + ' ' + e.message);
        }
      }
      receipts.delete(body.receipt);
      return { ok: true };
    } finally { parent.close(); }
  }
  function restore(scope, state, body, actor) {
    const record = state.quarantine.find(t => t.id === body.id && t.fingerprint === scope.fingerprint);
    if (!record || !['pending', 'review', 'quarantined'].includes(record.status) || !/^[a-f0-9-]{36}$/.test(record.id)) throw new Error('此隔离记录不可恢复。');
    const source = path.join(quarantineDirectory(scope), `${record.id}.bin`), parent = parentHandle(scope.root, record.path);
    try {
      if (exists(parent.file)) throw new Error('原路径已经有文件，不能覆盖恢复。');
      const value = readVerified(source, record.hash);
      fs.chmodSync(source, record.mode);
      // link is exclusive (EEXIST), unlike rename which could overwrite a concurrently created file.
      fs.linkSync(source, parent.file);
      if (!same(value.stat, fs.lstatSync(parent.file))) throw new Error('恢复目标已变化，隔离原件仍保留，请在宝塔中核对。');
      fs.unlinkSync(source);
      record.status = 'restored'; record.restoredAt = new Date(now()).toISOString(); delete record.error;
      stamp(state, scope, 'restore', record.path, actor, { quarantineId: record.id });
      save(scope, 'actions.json', state);
      return { ok: true };
    } finally { parent.close(); }
  }
  return { view, inspect, mutate };
}

module.exports = { createFileActions, relativePath, readVerified, parentHandle };
