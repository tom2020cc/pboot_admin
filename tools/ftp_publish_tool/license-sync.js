const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { Readable } = require('stream');
const { createFtpClient, resolveLocalAddress } = require('./ftp-client');
const { relativePath } = require('./file-browser');

function makeTask(profile, kind = 'license') {
  if (!['license', 'site-information'].includes(kind)) throw new Error('Unsupported fixed task');
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const plain = JSON.stringify(profile);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const task = { expires: Math.floor(Date.now() / 1000) + 180, proof: crypto.randomBytes(32).toString('hex'),
    keyHash: crypto.createHash('sha256').update(key).digest('hex'), iv: iv.toString('base64'),
    cipher: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  return { key, task, digest: crypto.createHash('sha256').update(plain).digest('hex'),
    source: fs.readFileSync(path.join(__dirname, `${kind}-sync.php`), 'utf8').replace('__TASK__', Buffer.from(JSON.stringify(task)).toString('base64')) };
}
function request(domain, address, localAddress, name, body) {
  return new Promise((resolve, reject) => {
    // Connect to the configured FTP host, while validating the website's HTTPS certificate.
    // Never follow redirects or send the task key to an unrelated server.
    const req = https.request({ hostname: domain, port: 443, path: '/' + name,
      lookup: (_host, _options, cb) => cb(null, address, 4), localAddress,
      method: body ? 'POST' : 'GET', timeout: 15000,
      headers: { 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; if (text.length > 16384) req.destroy(new Error('线上响应过大')); });
      res.on('error', reject);
      res.on('end', () => { try { if (res.statusCode !== 200) throw new Error(); resolve(JSON.parse(text)); } catch { reject(new Error('线上同步未返回有效结果，请检查网站 HTTPS 和 PHP 配置')); } });
    });
    req.on('error', () => reject(new Error('无法连接线上 HTTPS，请检查域名证书和连接网卡配置')));
    req.on('timeout', () => req.destroy());
    req.end(body);
  });
}
async function syncTask(config, profile, kind, assets = []) {
  if (!config.host || !config.user || !config.password || !config.secure) throw new Error('请先在网站发布中保存当前网站的 FTPS 连接（启用加密）');
  if (!profile.domains?.length || profile.domains.some(d => !/^[a-z0-9.-]+$/.test(d))) throw new Error('请在站点管理填写线上域名');
  const root = relativePath(String(config.remoteRoot || '').replace(/^\/+|\/+$/g, ''));
  const address = net.isIP(config.host) === 4 ? config.host : (await dns.lookup(config.host, { family: 4 })).address;
  const client = createFtpClient(config, 15000);
  const name = `pboot-${kind}-` + crypto.randomBytes(20).toString('hex') + '.php';
  const job = makeTask(profile, kind);
  let uploaded = false, result, failure, base;
  try {
    await client.access({ host: config.host, port: Number(config.port || 21), user: config.user, password: config.password,
      secure: true, secureOptions: { rejectUnauthorized: false } });
    for (const segment of root.split('/').filter(Boolean)) {
      const entry = (await client.list()).find(e => e.name === segment);
      if (!entry || !entry.isDirectory || entry.isSymbolicLink) throw new Error('FTP 站点根目录无效');
      await client.cd(segment);
    }
    const entries = await client.list();
    if (!['config', 'data', 'apps'].every(name => entries.some(e => e.name === name && e.isDirectory && !e.isSymbolicLink))) throw new Error('FTP 目录不是 PB 网站根目录，请检查当前网站的连接配置');
    base = await client.pwd();
    uploaded = true;
    await client.uploadFrom(Readable.from([job.source]), name);
    const domain = profile.domains[0];
    const localAddress = resolveLocalAddress(config);
    const proof = await request(domain, address, localAddress, name);
    if (proof.proof !== job.task.proof) throw new Error('线上域名与 FTP 根目录不对应，未写入资料');
    for (const asset of assets) {
      if (!/^static\/codex\/site-information-online\/[a-f0-9]{64}\.(?:jpg|jpeg|png|gif|webp|avif|bmp|ico|svg)$/.test(asset.path)) throw new Error('同步图片路径无效');
      await client.cd(base);
      for (const part of path.posix.dirname(asset.path).split('/')) {
        let entry = (await client.list()).find(e => e.name === part);
        if (!entry) { await client.send('MKD ' + part); entry = (await client.list()).find(e => e.name === part); }
        if (!entry?.isDirectory || entry.isSymbolicLink) throw new Error('线上图片目录不是普通目录');
        await client.cd(part);
      }
      const filename = path.posix.basename(asset.path);
      const existing = (await client.list()).find(e => e.name === filename);
      if (existing && (!existing.isFile || existing.isSymbolicLink)) throw new Error('线上图片目标不是普通文件');
      await client.uploadFrom(Readable.from([asset.bytes]), filename);
    }
    await client.cd(base);
    const response = await request(domain, address, localAddress, name, job.key.toString('base64'));
    const signature = crypto.createHmac('sha256', job.key).update(String(response.body)).digest('hex');
    if (typeof response.signature !== 'string' || !/^[a-f0-9]{64}$/.test(response.signature) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(response.signature))) throw new Error('线上同步响应校验失败');
    result = JSON.parse(response.body);
    if (!result.ok || result.digest !== job.digest) throw new Error(result.error || '线上资料回读不一致');
  } catch (error) { failure = error; }
  finally {
    if (uploaded) {
      try {
        // PHP may already have removed itself. Re-list to distinguish absent from deletion failure.
        await client.cd(base);
        if ((await client.list()).some(e => e.name === name)) await client.remove(name);
        if ((await client.list()).some(e => e.name === name)) throw new Error();
      } catch { failure = new Error(`临时同步任务清理未确认，请在网站根目录删除 ${name} 后重试（任务 3 分钟后失效）`); }
    }
    client.close();
  }
  if (failure) throw failure;
  return { warnings: result.warnings || [] };
}
async function syncLicense(config, profile) {
  if (!profile.codes) throw new Error('请填写官方授权码');
  return syncTask(config, profile, 'license');
}
async function syncSiteInformation(config, profile, assets) {
  return syncTask(config, profile, 'site-information', assets);
}
module.exports = { syncLicense, syncSiteInformation, makeTask };
