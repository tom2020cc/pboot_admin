const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const FILE = 'apps/common/HomeController.php';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const compact = value => value.replace(/\s+/g, '');
const ORIGINAL = `$lgs = Config::get('lgs');
        if (count($lgs) > 1) {
            $domain = get_http_host();
            foreach ($lgs as $value) {
                if ($value['domain'] == $domain) {
                    cookie('lg', $value['acode']);
                    break;
                }
            }
        }`;
const FIXED = `$lgs = Config::get('lgs');
        // Pboot admin: match each bound hostname before using the old language cookie.
        $domain = strtolower(rtrim(get_http_host(), '.'));
        foreach ((array) $lgs as $value) {
            $boundDomains = array_map(function ($host) {
                return strtolower(rtrim(trim($host), '.'));
            }, explode(',', (string) ($value['domain'] ?? '')));
            if ($domain !== '' && in_array($domain, $boundDomains, true)) {
                cookie('lg', $value['acode']);
                break;
            }
        }`;
// Recognize the equivalent one-file repair made before the reusable button existed.
const PREVIOUS_CALL = `$lgs = Config::get('lgs');
        $boundLanguage = self::resolveDomainLanguage($lgs, get_http_host());
        if ($boundLanguage !== null) {
            // A bound host takes precedence over a previously selected language.
            cookie('lg', $boundLanguage);
        }`;
const PREVIOUS_METHOD = `public static function resolveDomainLanguage($languages, $host)
    {
        $host = strtolower(rtrim(trim((string) $host), '.'));
        if ($host === '') { return null; }
        foreach ((array) $languages as $language) {
            foreach (explode(',', (string) ($language['domain'] ?? '')) as $domain) {
                $domain = strtolower(rtrim(trim($domain), '.'));
                if ($domain !== '' && $domain === $host) { return $language['acode']; }
            }
        }
        return null;
    }`;

function transform(source) {
  if (Buffer.byteLength(source) > 256 * 1024 || !source.includes('namespace app\\common;') || !/class\s+HomeController\s+extends\s+Controller\b/.test(source)) throw Error('不是支持的 PB HomeController 文件，未修改');
  const normalized = compact(source);
  if (normalized.includes(compact(FIXED)) || (normalized.includes(compact(PREVIOUS_CALL)) && normalized.includes(compact(PREVIOUS_METHOD)))) return { source, changed: false };
  const pattern = new RegExp(ORIGINAL.split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || /resolveDomainLanguage\s*\(/.test(source)) throw Error('当前 PB 的语言识别代码经过改动或版本不兼容，已停止自动修复，请人工核对');
  const match = matches[0];
  const replacement = source.includes('\r\n') ? FIXED.replace(/\n/g, '\r\n') : FIXED;
  return { source: source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length), changed: true };
}

function readLocal(root) {
  const base = path.resolve(root);
  if (fs.realpathSync(base).toLowerCase() !== base.toLowerCase() || fs.lstatSync(base).isSymbolicLink()) throw Error('网站根目录不能是链接');
  let file = base;
  for (const part of FILE.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('PB 程序路径不能包含链接');
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024) throw Error('PB 程序不是受支持的普通文件');
  const bytes = fs.readFileSync(file);
  return { file, bytes, hash: digest(bytes), mode: stat.mode, ...transform(bytes.toString('utf8')) };
}

function repairLocal(root, expectedHash) {
  const plan = readLocal(root);
  if (plan.hash !== expectedHash) throw Error('本地 PB 程序已经变化，请重新打开修复窗口');
  if (!plan.changed) return { changed: false, hash: plan.hash };
  const temp = path.join(path.dirname(plan.file), '.domain-repair-' + crypto.randomBytes(12).toString('hex') + '.php');
  try {
    fs.writeFileSync(temp, plan.source, { flag: 'wx', mode: plan.mode });
    if (readLocal(root).hash !== expectedHash) throw Error('本地 PB 程序正在被修改，已停止写入');
    fs.renameSync(temp, plan.file);
    const result = readLocal(root);
    if (result.hash !== digest(plan.source) || result.changed) throw Error('本地修复回读校验失败');
    return { changed: true, hash: result.hash };
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

async function syncRemote(config, factory) {
  if (!config.host || !config.user || !config.password || !config.secure) throw Error('请先在网站发布中保存当前网站的 FTPS 加密连接');
  const root = String(config.remoteRoot || '').replace(/^\/+|\/+$/g, '');
  if (root.split('/').some(p => p === '..' || p === '.') || /[\\\x00-\x1f:]/.test(root)) throw Error('FTP 网站目录无效');
  const client = factory ? factory() : require('./ftp_publish_tool/ftp-client').createFtpClient(config, 20000);
  let temporary;
  const download = async name => {
    const chunks = []; let size = 0;
    await client.downloadTo(new Writable({ write(chunk, encoding, done) {
      size += chunk.length;
      if (size > 256 * 1024) return done(Error('线上 PB 程序过大，已停止'));
      chunks.push(chunk); done();
    } }), name);
    return Buffer.concat(chunks);
  };
  try {
    await client.access({ host: config.host, port: config.port || 21, user: config.user, password: config.password, secure: true, secureOptions: { rejectUnauthorized: false } });
    for (const segment of [...root.split('/').filter(Boolean), 'apps', 'common']) {
      const entry = (await client.list()).find(item => item.name === segment);
      if (!entry?.isDirectory || entry.isSymbolicLink) throw Error('线上 PB 程序目录不存在或为链接，请核对当前网站 FTP 目录');
      await client.cd(segment);
    }
    const filename = 'HomeController.php';
    const entry = (await client.list()).find(item => item.name === filename);
    if (!entry?.isFile || entry.isSymbolicLink) throw Error('线上 PB 程序文件无效，未覆盖');
    const before = await download(filename);
    const plan = transform(before.toString('utf8'));
    if (!plan.changed) return { changed: false, verified: true };
    temporary = '.domain-repair-' + crypto.randomBytes(12).toString('hex') + '.php';
    await client.uploadFrom(Readable.from([plan.source]), temporary);
    if (digest(await download(temporary)) !== digest(plan.source)) throw Error('线上临时文件校验失败，原程序未替换');
    if (digest(await download(filename)) !== digest(before)) throw Error('线上程序正在被其他操作修改，请重新读取后重试');
    await client.rename(temporary, filename);
    temporary = null;
    if (digest(await download(filename)) !== digest(plan.source)) throw Error('线上文件回读不一致，请核对发布结果');
    return { changed: true, verified: true };
  } finally {
    try { if (temporary) await client.remove(temporary); }
    finally { client.close(); }
  }
}

module.exports = { FILE, ORIGINAL, FIXED, transform, readLocal, repairLocal, syncRemote, digest };
