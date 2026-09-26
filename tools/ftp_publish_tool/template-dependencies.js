const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

// Install providers before the parser and templates that call them.
const PRODUCT_SPECS_FILES = [
  'apps/home/controller/product-spec-labels.json',
  'apps/home/controller/ProductSpecsRenderer.php',
  'apps/home/model/ParserModel.php',
  'apps/home/controller/ParserController.php',
];

function checkedFile(root, relativePath) {
  let localPath = fs.realpathSync(root);
  for (const part of relativePath.split('/')) {
    localPath = path.join(localPath, part);
    if (fs.lstatSync(localPath).isSymbolicLink()) throw Error(`模板依赖不支持符号链接：${relativePath}`);
  }
  const stat = fs.statSync(localPath);
  if (!stat.isFile()) throw Error(`模板依赖不是普通文件：${relativePath}`);
  return { localPath, relativePath, size: stat.size, mtimeMs: stat.mtimeMs,
    stamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}` };
}

function completeTemplateBundle(root, files, isBlocked = () => false) {
  const messageNeeded = files.some(file => /^template\/.*\.(html?|php)$/i.test(file.relativePath)
    && /\{pboot:msgaction\}|comm\/message\.html/i.test(fs.readFileSync(checkedFile(root, file.relativePath).localPath, 'utf8')));
  const messagePath = 'apps/home/controller/MessageController.php';
  const messageDependencies = [];
  if (messageNeeded) {
    if (isBlocked(messagePath)) throw Error(`表单模板需要 ${messagePath}，但它被排除；请调整范围后重新预览。`);
    let file;
    try { file = checkedFile(root, messagePath); }
    catch (error) { throw Error(`表单模板依赖不完整：${messagePath}。${error.message}`); }
    const source = fs.readFileSync(file.localPath);
    if (!/class\s+MessageController\b/.test(source.toString())) throw Error('表单处理程序不匹配，请先检查本地 MessageController.php');
    messageDependencies.push({ ...file, dependency: '留言表单提交处理（字段配置另用 PB 数据库同步）',
      verifyHash: crypto.createHash('sha256').update(source).digest('hex') });
  }
  const needed = files.some(file => {
    if (!/^template\/.*\.(html?|php)$/i.test(file.relativePath)
      && file.relativePath !== 'apps/home/controller/ParserController.php') return false;
    const source = fs.readFileSync(checkedFile(root, file.relativePath).localPath, 'utf8');
    return /\[list:product_specs\]|home_product_specs\.html|ProductSpecsRenderer::render/i.test(source);
  });
  const dependencies = [...messageDependencies, ...(needed ? PRODUCT_SPECS_FILES : []).map(relativePath => {
    if (isBlocked(relativePath)) throw Error(`模板需要 ${relativePath}，但它被排除；请调整范围后重新预览。`);
    let file;
    try { file = checkedFile(root, relativePath); }
    catch (error) { throw Error(`产品属性模板依赖不完整：${relativePath}。${error.message}`); }
    const source = fs.readFileSync(file.localPath, 'utf8');
    const valid = relativePath.endsWith('.json') ? (() => { try { return !!JSON.parse(source); } catch (_) { return false; } })()
      : relativePath.endsWith('/ParserController.php') ? /case\s+['"]product_specs['"]\s*:/.test(source) && source.includes('ProductSpecsRenderer::render')
      : relativePath.endsWith('/ParserModel.php') ? /function\s+getProductSpecFields\s*\(/.test(source)
      : /class\s+ProductSpecsRenderer\b/.test(source);
    if (!valid) throw Error(`产品属性模板依赖版本不匹配：${relativePath}，请先修正本地功能代码。`);
    return { ...file, dependency: '产品属性标签解析', verifyHash: crypto.createHash('sha256').update(fs.readFileSync(file.localPath)).digest('hex') };
  })];
  const paths = new Set(dependencies.map(file => file.relativePath));
  return { files: [...dependencies, ...files.filter(file => !paths.has(file.relativePath))],
    dependencies: dependencies.map(file => ({ relativePath: file.relativePath, reason: file.dependency })) };
}

async function verifyTemplateDependency(client, file, remoteName) {
  if (!file.verifyHash) return;
  const hash = crypto.createHash('sha256');
  await client.downloadTo(new Writable({ write(chunk, _encoding, done) { hash.update(chunk); done(); } }), remoteName);
  if (hash.digest('hex') !== file.verifyHash) throw Error(`线上模板依赖校验失败：${file.relativePath}；已停止上传，请重新预览并重试。`);
}

module.exports = { completeTemplateBundle, verifyTemplateDependency, PRODUCT_SPECS_FILES };
