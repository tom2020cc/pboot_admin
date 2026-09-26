const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function localAccount(raw = {}) {
  return raw.serviceAccount || (raw.clientEmail && raw.privateKey
    ? { client_email: raw.clientEmail, private_key: raw.privateKey } : null);
}
function valid(account) { return Boolean(account?.client_email && account?.private_key); }
function withoutLocalKey(raw, source) {
  const next = { ...raw, accountSource: source, serviceAccount: null, clientEmail: '' };
  delete next.privateKey;
  return next;
}

function createSharedGoogleAccount(file) {
  function read() {
    if (!fs.existsSync(file)) return null;
    try {
      const account = JSON.parse(fs.readFileSync(file, 'utf8')).serviceAccount;
      if (!valid(account)) throw new Error();
      return account;
    } catch { throw new Error('共享 Google 服务账号配置无效，请重新保存 JSON。'); }
  }
  function save(account) {
    if (!valid(account)) throw new Error('请提供完整的 Google 服务账号 JSON。');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, serviceAccount: account }, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function resolve(raw = {}) {
    const own = localAccount(raw);
    const source = raw.accountSource || (valid(own) ? 'site' : 'shared');
    if (!['site', 'shared', 'disabled'].includes(source)) throw new Error('Google 服务账号来源无效。');
    const serviceAccount = source === 'disabled' ? null : source === 'site' ? own : read();
    return { serviceAccount, accountSource: source, enabled: valid(serviceAccount),
      clientEmail: serviceAccount?.client_email || '' };
  }
  function status() {
    const account = read();
    return { configured: valid(account), clientEmail: account?.client_email || '' };
  }
  function configure(raw, body, parse) {
    if (body.clear) return withoutLocalKey(raw, 'disabled');
    if (body.useShared) {
      if (!read()) throw new Error('尚未配置共享 Google 服务账号，请先保存一份共享 JSON。');
      return withoutLocalKey(raw, 'shared');
    }
    const account = parse(body.promoteToShared ? localAccount(raw) : body.serviceAccount);
    if (body.shared || body.promoteToShared) {
      save(account);
      return withoutLocalKey(raw, 'shared');
    }
    return { ...withoutLocalKey(raw, 'site'), serviceAccount: account, clientEmail: account.client_email };
  }
  return { resolve, status, configure };
}

module.exports = { createSharedGoogleAccount };
