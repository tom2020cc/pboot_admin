import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type TemplateLanguage = 'cn' | 'en';
export interface TemplateReference {
  file: string; lang: TemplateLanguage; tag: string; attribute: string; scode: string;
  start: number; end: number; line: number;
}
export interface TemplateFile { file: string; text: string; hash: string; references: TemplateReference[]; }
export const templateHash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

export function templatePath(root: string, relative: string) {
  if (!/^(cn|en)\/(?:[^/]+\/)*[^/]+\.html$/i.test(relative) || /[\\:\x00-\x1f]/.test(relative)
    || relative.split('/').some(part => part === '..' || part === '.' || /[. ]$/.test(part))) throw new Error('模板路径不合法');
  let current = path.resolve(root);
  for (const part of ['template', ...relative.split('/')]) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不能修改链接目录或链接模板');
  }
  if (!fs.statSync(current).isFile()) throw new Error('模板文件不存在');
  return current;
}

// Pboot tags are not HTML attributes. Tokenize their quoted/nested values so dynamic expressions stay intact.
export function parseTemplateReferences(text: string, file: string, lang: TemplateLanguage) {
  const references: TemplateReference[] = [];
  const tags = /\{pboot:(\d*)(nav|sort|list|content)\b/gi;
  const comments = [...text.matchAll(/<!--[\s\S]*?-->/g)].map(m => [m.index!, m.index! + m[0].length]);
  for (let tag; (tag = tags.exec(text));) {
    if (comments.some(([start, end]) => tag!.index >= start && tag!.index < end)) continue;
    let cursor = tags.lastIndex;
    const found: TemplateReference[] = [];
    while (cursor < text.length && text[cursor] !== '}') {
      if (/\s/.test(text[cursor])) { cursor++; continue; }
      const key = /^[a-zA-Z_][\w-]*/.exec(text.slice(cursor));
      if (!key) break;
      cursor += key[0].length;
      while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++;
      if (text[cursor++] !== '=') break;
      while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++;
      const quote = ['"', "'"].includes(text[cursor]) ? text[cursor++] : '';
      const start = cursor;
      let depth = 0;
      while (cursor < text.length) {
        const character = text[cursor];
        if (quote) { if (character === quote) break; }
        else {
          if (!depth && (character === '}' || /\s/.test(character))) break;
          if (character === '{') depth++;
          if (character === '}') depth--;
        }
        cursor++;
      }
      const value = text.slice(start, cursor);
      const attribute = key[0].toLowerCase();
      if ((attribute === 'scode' || (attribute === 'parent' && tag[2].toLowerCase() === 'nav'))
        && /^\d+(?:\s*,\s*\d+)*$/.test(value)) {
        for (const code of value.matchAll(/\d+/g)) {
          if (Number(code[0]) === 0) continue;
          const offset = start + code.index!;
          found.push({ file, lang, tag: tag[1] + tag[2], attribute, scode: code[0], start: offset,
            end: offset + code[0].length, line: text.slice(0, offset).split('\n').length });
        }
      }
      if (quote && text[cursor] === quote) cursor++;
    }
    if (text[cursor] === '}') references.push(...found);
    tags.lastIndex = Math.max(tags.lastIndex, cursor + 1);
  }
  return references;
}

export function readBoundTemplates(root: string) {
  const files: TemplateFile[] = [];
  const warnings: string[] = [];
  let bytes = 0;
  let directories = 0;
  const templateRoot = path.join(root, 'template');
  if (!fs.existsSync(templateRoot) || fs.lstatSync(templateRoot).isSymbolicLink()) throw new Error('模板目录不存在或为链接');
  const walk = (relative: string, lang: TemplateLanguage) => {
    if (++directories > 1000 || relative.split('/').length > 32) throw new Error('模板目录超出安全处理上限');
    const directory = path.join(templateRoot, relative);
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`模板目录不能是链接：${relative}`);
    for (const name of fs.readdirSync(directory).sort()) {
      const file = `${relative}/${name}`;
      const absolute = path.join(templateRoot, file);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`模板不能是链接：${file}`);
      if (stat.isDirectory()) { walk(file, lang); continue; }
      if (!/\.html$/i.test(name)) continue;
      if (stat.size > 2 * 1024 * 1024 || (bytes += stat.size) > 16 * 1024 * 1024 || files.length >= 500) throw new Error('模板超出安全处理上限');
      const buffer = fs.readFileSync(templatePath(root, file));
      const text = buffer.toString('utf8');
      if (text.includes('\ufffd') || text.includes('\0')) throw new Error(`模板不是 UTF-8，未开放修改：${file}`);
      files.push({ file, text, hash: templateHash(buffer), references: parseTemplateReferences(text, file, lang) });
    }
  };
  for (const lang of ['cn', 'en'] as const) {
    if (fs.existsSync(path.join(templateRoot, lang))) walk(lang, lang);
    else warnings.push(`${lang} 模板目录不存在，本次不处理该语言`);
  }
  if (!files.length) throw new Error('没有找到 cn/en HTML 模板');
  warnings.push('仅绑定 cn/en 模板中的固定栏目编码；动态标签、共享模板及写死的链接地址保持原样。');
  return { files, warnings, templateVersion: templateHash(JSON.stringify(files.map(f => [f.file, f.hash]))) };
}

export function replaceTemplateReferences(file: TemplateFile, replacements: Map<string, string>) {
  let text = file.text;
  const changes = file.references.flatMap(reference => {
    const target = replacements.get(`${reference.lang}:${reference.scode}`);
    return target && target !== reference.scode ? [{ ...reference, before: reference.scode, after: target }] : [];
  });
  for (const change of [...changes].reverse()) text = text.slice(0, change.start) + change.after + text.slice(change.end);
  return { text, changes };
}
