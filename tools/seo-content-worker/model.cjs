const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const providers = {
  openai: ['https://api.openai.com/v1/chat/completions', 'OPENAI_API_KEY', 'openaiApiKey'],
  deepseek: ['https://api.deepseek.com/chat/completions', 'DEEPSEEK_API_KEY', 'deepseekApiKey'],
  qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'DASHSCOPE_API_KEY', 'dashscopeApiKey'],
  zhipu: ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'ZHIPU_API_KEY', 'zhipuApiKey'],
};
function readModelKey(provider) {
  const definition = providers[provider];
  if (!definition) throw new Error('MODEL_PROVIDER_NOT_SUPPORTED');
  if (process.env[definition[1]]?.trim()) return process.env[definition[1]].trim();
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'tools/seo_publish_tool/ai.config.json'), 'utf8'))[definition[2]] || '').trim(); }
  catch { return ''; }
}
async function modelRequest(endpoint, body, key, signal, prefix = 'MODEL', fetcher = fetch) {
  if (!key) throw new Error('MODEL_KEY_NOT_CONFIGURED');
  signal.throwIfAborted();
  const response = await fetcher(endpoint, { method: 'POST', signal, redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`${prefix}_HTTP_${response.status}`); }
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) throw new Error(`${prefix}_OUTPUT_TOO_LARGE`);
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error(`${prefix}_JSON_INVALID`); }
  } finally { await reader.cancel().catch(() => {}); }
}
function parseModelJson(text) {
  const { extractTranslationJson } = require(path.join(root, 'backend/dist/common/ai-json.js'));
  return extractTranslationJson(text);
}
const outputLimit = snapshot => Math.min(8000, Math.max(1000, Number(snapshot.maxOutputTokens) || 6000));
const skillText = (snapshot, ids) => (snapshot.editorial?.rules || []).filter(r => ids.includes(r.id)).map(r => r.text).join('\n\n');
module.exports = { providers, readModelKey, modelRequest, parseModelJson, outputLimit, skillText };
