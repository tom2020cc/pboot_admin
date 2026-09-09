import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type ResourceStatus = 'candidate' | 'referenced' | 'review' | 'protected';
export interface ResourceEntry {
  path: string;
  kind: 'image' | 'directory' | 'other';
  size: number;
  modifiedAt: string;
  status: ResourceStatus;
  reason: string;
  fingerprint: string;
}
export interface ReferenceText { source: string; text: string; }
const IMAGE = /\.(?:jpe?g|png|gif|webp|avif|bmp|ico|svg)$/i;
const TEXT = /(?:\.(?:html?|css|js|mjs|json|xml|svg|txt|php|inc|ini|conf)|\.htaccess)$/i;
const MAX_FILES = 30000;
const MAX_TEXT = 80 * 1024 * 1024;
export const RESOURCE_GRACE_MS = 7 * 86400000;

export function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Check every component, not just the leaf: Windows junctions can escape a lexical root.
export function safeResourcePath(root: string, relative: string, allowMissing = false) {
  if (!relative || /[\\:\x00-\x1f]/.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))) {
    throw new Error('资源路径不合法');
  }
  const parts = relative.split('/');
  if (parts[0] !== 'static' || parts.length < 2) throw new Error('只能操作 static 下的资源');
  let current = root;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('网站根目录不能是链接');
  const realRoot = fs.realpathSync(root);
  for (const part of parts) {
    current = path.join(current, part);
    if (!inside(root, current)) throw new Error('资源越出网站目录');
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) {
      if (allowMissing) continue;
      throw new Error('资源已不存在，请重新扫描');
    }
    if (stat.isSymbolicLink() || !inside(realRoot, fs.realpathSync(current))) throw new Error('链接目录或文件不能清理');
  }
  return current;
}

export function fingerprint(file: string) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('链接不能清理');
  if (stat.isDirectory()) return `dir:${stat.mtimeMs}:${fs.readdirSync(file).length}`;
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('文件类型或体积不支持清理');
  return `${stat.size}:${stat.mtimeMs}:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function normalize(text: string) {
  return text.replace(/\\\//g, '/').replace(/\\u([0-9a-f]{4})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (all, hex, dec) => {
      const code = parseInt(hex || dec, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }).replace(/&(?:quot|apos|amp);/g, value => ({ '&quot;': '"', '&apos;': "'", '&amp;': '&' })[value]!)
    .replace(/(?:%[0-9a-f]{2})+/gi, value => { try { return decodeURIComponent(value); } catch { return value; } })
    .replace(/\\/g, '/').toLowerCase();
}

export function scanSiteResources(root: string, references: ReferenceText[], now = Date.now()) {
  root = path.resolve(root);
  const entries: ResourceEntry[] = [];
  const texts = [...references];
  let textBytes = texts.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
  let visited = 0;
  const addText = (file: string) => {
    const size = fs.statSync(file).size;
    if (size > 8 * 1024 * 1024 || textBytes + size > MAX_TEXT) throw new Error('引用文件过大，本次扫描停止，未开放清理');
    const bytes = fs.readFileSync(file);
    // Unsupported encodings must not silently hide references.
    const text = bytes.toString('utf8');
    if (text.includes('\ufffd') || text.includes('\0')) throw new Error(`引用文件不是 UTF-8 文本，需先确认：${path.relative(root, file)}`);
    texts.push({ source: path.relative(root, file).replace(/\\/g, '/'), text });
    textBytes += size;
  };
  const walk = (directory: string, resources: boolean) => {
    for (const name of fs.readdirSync(directory)) {
      if (++visited > MAX_FILES) throw new Error('文件过多，本次扫描停止，未开放清理');
      const file = path.join(directory, name);
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        // A template or static symlink could contain references into the scanned tree.
        throw new Error(`发现链接目录或文件，需先人工确认：${relative}`);
      }
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(`不支持的文件类型：${relative}`);
      if (stat.isDirectory()) {
        walk(file, resources);
        if (resources && fs.readdirSync(file).length === 0) entries.push({ path: relative, kind: 'directory', size: 0,
          modifiedAt: stat.mtime.toISOString(), status: 'protected', reason: '空目录', fingerprint: '' });
      } else {
        if (TEXT.test(name)) addText(file);
        if (resources) entries.push({ path: relative, kind: IMAGE.test(name) ? 'image' : 'other', size: stat.size,
          modifiedAt: stat.mtime.toISOString(), status: 'protected', reason: '程序、文档及其它文件不开放清理', fingerprint: '' });
      }
    }
  };
  const staticRoot = path.join(root, 'static');
  if (!fs.existsSync(staticRoot) || fs.lstatSync(staticRoot).isSymbolicLink()) throw new Error('static 目录不存在或为链接');
  walk(staticRoot, true);
  const templates = path.join(root, 'template');
  if (!fs.existsSync(templates) || fs.lstatSync(templates).isSymbolicLink()) throw new Error('模板目录不存在或为链接，无法完整检查引用');
  walk(templates, false);
  // Runtime PHP is not executed or de-obfuscated; this is an asset-reference inventory, not a proof of non-use.
  for (const name of ['config']) {
    const directory = path.join(root, name);
    if (!fs.existsSync(directory)) continue;
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`程序引用目录为链接：${name}`);
    if (fs.statSync(directory).isDirectory()) walk(directory, false);
  }
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name);
    if (TEXT.test(name)) {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('网站入口引用文件为链接');
      if (fs.statSync(file).isFile()) addText(file);
    }
  }
  if (textBytes > MAX_TEXT) throw new Error('引用数据过大，本次扫描停止');

  const names = [...new Set(entries.filter(e => e.kind !== 'other').map(e => path.posix.basename(e.path).toLowerCase()))];
  const escaped = names.sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = escaped.length ? new RegExp(escaped.join('|'), 'g') : null;
  const hits = new Map<string, string>();
  const dynamicPrefixes = new Map<string, string>();
  for (const reference of texts) {
    const text = normalize(reference.text);
    if (/["'`]\s*\.(?:jpe?g|png|gif|webp|avif|svg)(?:["'`?])/i.test(text)) {
      dynamicPrefixes.set('static/', reference.source);
    }
    if (matcher) {
      matcher.lastIndex = 0;
      for (let match; (match = matcher.exec(text));) if (!hits.has(match[0])) hits.set(match[0], reference.source);
    }
    // Incomplete path literals (including template/JS interpolations) protect their entire directory.
    const literals = text.matchAll(/["'`(=]\s*([^"'`<>\r\n)]+)/g);
    for (const match of literals) {
      let literal = match[1].trim();
      const index = literal.indexOf('/static/');
      if (index >= 0) literal = literal.slice(index);
      else if (literal.startsWith('static/')) literal = `/${literal}`;
      else if (/^\.{1,2}\//.test(literal)) {
        literal = path.posix.resolve('/', path.posix.dirname(reference.source), literal);
      } else if (/^[a-z0-9_-]+\//.test(literal) && reference.source.startsWith('static/')) {
        literal = path.posix.resolve('/', path.posix.dirname(reference.source), literal);
      } else continue;
      if (!literal.startsWith('/static/')) continue;
      const prefix = literal.split(/[{$*?]/)[0];
      if (/\.[a-z0-9]{1,8}$/i.test(prefix) && prefix === literal) continue;
      const directory = prefix.endsWith('/') ? prefix : prefix.slice(0, prefix.lastIndexOf('/') + 1);
      if (directory) dynamicPrefixes.set(directory.slice(1), reference.source);
    }
  }
  for (const entry of entries) {
    if (entry.kind === 'other') continue;
    const name = path.posix.basename(entry.path).toLowerCase();
    const hit = hits.get(name);
    const dynamic = [...dynamicPrefixes].find(([prefix]) => entry.path.toLowerCase().startsWith(prefix));
    const stat = fs.statSync(path.join(root, entry.path));
    if (hit) { entry.status = 'referenced'; entry.reason = `发现名称引用：${hit}`; }
    else if (dynamic) { entry.status = 'review'; entry.reason = `目录或动态路径引用：${dynamic[1]}`; }
    else if (Math.max(stat.birthtimeMs, stat.mtimeMs, stat.ctimeMs) > now - RESOURCE_GRACE_MS) {
      entry.reason = '最近 7 天创建或变更，暂时保护';
    } else if (entry.size > 100 * 1024 * 1024) { entry.reason = '超过 100 MB，需人工处理'; }
    else {
      entry.status = 'candidate'; entry.reason = entry.kind === 'directory' ? '空目录，未发现引用' : '未发现引用，仍需人工核对';
      entry.fingerprint = fingerprint(safeResourcePath(root, entry.path));
    }
  }
  return { entries, referenceSources: texts.length, graceDays: 7 };
}
