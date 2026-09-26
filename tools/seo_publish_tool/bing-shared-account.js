const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Keep account credentials separate from each website's domain and verification.
function createSharedBingAccount(file) {
  function read() {
    if (!fs.existsSync(file)) return '';
    try {
      const key = JSON.parse(fs.readFileSync(file, 'utf8')).apiKey;
      if (typeof key !== 'string' || !key.trim()) throw new Error();
      return key.trim();
    } catch { throw new Error('共享 Bing API Key 配置无效，请重新保存。'); }
  }
  function resolve(raw = {}) {
    const source = raw.accountSource || (raw.apiKey ? 'site' : 'shared');
    if (!['site', 'shared', 'disabled'].includes(source)) throw new Error('Bing 账号来源无效。');
    const apiKey = source === 'disabled' ? '' : source === 'site' ? String(raw.apiKey || '').trim() : read();
    return { apiKey, accountSource: source, configured: Boolean(apiKey) };
  }
  function configure(raw = {}, body = {}) {
    if (body.clear) return { ...raw, apiKey: '', accountSource: 'disabled' };
    if (body.useShared) {
      if (!read()) throw new Error('请先保存共享 Bing API Key。');
      return { ...raw, apiKey: '', accountSource: 'shared' };
    }
    const apiKey = String((body.promoteToShared ? raw.apiKey : body.apiKey) || '').trim();
    if (!apiKey) throw new Error('请粘贴 Bing Webmaster API Key。');
    if (!body.shared && !body.promoteToShared) return { ...raw, apiKey, accountSource: 'site' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, apiKey }) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { ...raw, apiKey: '', accountSource: 'shared' };
  }
  return { resolve, configure, status: () => ({ configured: Boolean(read()) }) };
}
module.exports = { createSharedBingAccount };
