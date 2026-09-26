const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Only the OAuth credential is shared; domains, verification and host IDs stay per site.
function createSharedYandexAccount(file) {
  function read() {
    if (!fs.existsSync(file)) return '';
    try {
      const token = JSON.parse(fs.readFileSync(file, 'utf8')).oauthToken;
      if (typeof token !== 'string' || !token.trim()) throw new Error();
      return token.trim();
    } catch { throw new Error('共享 Yandex Token 配置无效，请重新保存。'); }
  }
  function resolve(raw = {}) {
    const accountSource = raw.accountSource || (raw.oauthToken ? 'site' : 'shared');
    if (!['site', 'shared', 'disabled'].includes(accountSource)) throw new Error('Yandex 账号来源无效。');
    const oauthToken = accountSource === 'disabled' ? '' : accountSource === 'site' ? String(raw.oauthToken || '').trim() : read();
    return { oauthToken, accountSource, configured: Boolean(oauthToken) };
  }
  function configure(raw = {}, body = {}) {
    const cleared = { ...raw, oauthToken: '', userId: '', hostId: '' };
    if (body.clear) return { ...cleared, accountSource: 'disabled' };
    if (body.useShared) {
      if (!read()) throw new Error('请先保存共享 Yandex Token。');
      return { ...cleared, accountSource: 'shared' };
    }
    const oauthToken = String((body.promoteToShared ? raw.oauthToken : body.token) || '').trim();
    if (!oauthToken) throw new Error('请粘贴 Yandex OAuth Token。');
    if (!body.shared && !body.promoteToShared) return { ...cleared, oauthToken, accountSource: 'site' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, oauthToken }) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { ...cleared, accountSource: 'shared' };
  }
  return { resolve, configure, status: () => ({ configured: Boolean(read()) }) };
}
module.exports = { createSharedYandexAccount };
