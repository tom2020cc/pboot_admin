const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const guide = require('../frontend/src/content/deployment-guide.json');
const media = require('../frontend/src/content/deployment-media.json');
const { diagramSvg } = require('./build-tutorial-assets.cjs');
const root = path.resolve(__dirname, '..');
const steps = guide.chapters.flatMap(chapter => chapter.steps);

test('language domain incident separates authorization failures from TLS and preserves existing licenses', async () => {
  const { filterChapters } = await import('../frontend/src/utils/tutorialGuide.mjs');
  const chapter = guide.chapters.find(item => item.id === 'language-domain-access-20260917');
  assert.ok(chapter);
  const text = JSON.stringify(chapter);
  for (const word of ['fr.shanbo-rig.com', 'es.shanbo-rig.com', 'ru.shanbo-rig.com', 'ar.shanbo-rig.com', '验证码', '保留', 'HTTPS', '授权', '尚未']) assert.ok(text.includes(word), word);
  assert.ok(filterChapters(guide.chapters, 'FR 授权').some(item => item.id === chapter.id));
  const diagnosis = chapter.steps.find(item => item.id === 'language-domain-cause-20260917');
  assert.equal(diagnosis.media.length, 2);
  assert.ok(diagnosis.body.join(' ').includes('未更改 Nginx'));
  const commands = chapter.steps.flatMap(item => item.commands || []).map(item => item.code).join('\n');
  assert.ok(!/--insecure|curl\s+-k\b/.test(commands));
});

test('complete guide has stable chapter/step ids, checks and referenced media', () => {
  assert.ok(guide.chapters.length >= 15);
  assert.ok(steps.length >= 45);
  assert.equal(new Set(guide.chapters.map(item => item.id)).size, guide.chapters.length);
  assert.equal(new Set(steps.map(item => item.id)).size, steps.length);
  const used = new Set();
  for (const chapter of guide.chapters) {
    assert.match(chapter.id, /^[a-z0-9-]+$/);
    assert.ok(chapter.intro && chapter.group && chapter.title);
    for (const step of chapter.steps) {
      assert.match(step.id, /^[a-z0-9-]+$/);
      assert.ok(step.title && step.check && step.body.length >= 2);
      for (const id of step.media || []) { assert.ok(media[id], `Unknown media: ${id}`); used.add(id); }
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(media).sort());
});

test('curated assets are complete, screenshots unchanged, coordinates valid', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/tutorial/deployment/manifest.json')));
  assert.equal(manifest.length, Object.keys(media).length);
  for (const [id, item] of Object.entries(media)) {
    assert.equal(path.basename(item.file), item.file);
    const output = fs.readFileSync(path.join(root, 'frontend/public/tutorial/deployment', item.file));
    assert.equal(crypto.createHash('sha256').update(output).digest('hex'), manifest.find(row => row.id === id).sha256);
    if (item.kind === 'screenshot') {
      assert.ok(output.equals(fs.readFileSync(path.join(root, 'docs/tutorial-assets/baota-2026-09-11', item.source || item.file))));
      assert.equal(output.subarray(0, 3).toString('hex'), 'ffd8ff');
      assert.ok(item.file.endsWith('.jpg'));
      assert.ok(item.arrows.length > 0);
      for (const arrow of item.arrows) {
        assert.ok(arrow.label);
        for (const position of [arrow.from, arrow.to]) {
          assert.equal(position.length, 2);
          assert.ok(position.every(value => Number.isFinite(value) && value >= 0 && value <= 100));
        }
      }
    } else {
      assert.equal(output.toString(), diagramSvg(item.diagram));
      for (const node of item.diagram.nodes) {
        assert.ok(node.x >= 0 && node.x + node.w <= 960);
        assert.ok(node.y >= 0 && node.y + node.h + 40 <= 440);
        assert.ok(node.lines.every(line => [...line].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 14 : 7.5), 0) <= node.w - 20));
        assert.ok(50 + (node.lines.length - 1) * 20 <= node.h - 8);
      }
      assert.ok(!/<script|<foreignObject|(?:href|src)=/i.test(output.toString()));
    }
  }
});

test('search is case-insensitive, multi-keyword and includes commands', async () => {
  const { filterChapters } = await import('../frontend/src/utils/tutorialGuide.mjs');
  assert.equal(filterChapters(guide.chapters, '').length, guide.chapters.length);
  assert.ok(filterChapters(guide.chapters, 'BASIC 401').some(chapter => chapter.id === 'tool-access'));
  assert.ok(filterChapters(guide.chapters, 'pm2-root').some(chapter => chapter.id === 'processes'));
  assert.deepEqual(filterChapters(guide.chapters, 'no-such-chapter-97513'), []);
});

test('language rewrite tutorial records the verified fix without claiming a URL migration', async () => {
  const { filterChapters } = await import('../frontend/src/utils/tutorialGuide.mjs');
  const chapter = guide.chapters.find(item => item.id === 'nginx-language');
  assert.equal(chapter.steps.length, 8);
  assert.ok(filterChapters(guide.chapters, 'Nginx 伪静态').some(item => item.id === chapter.id));
  const rewrite = chapter.steps.find(item => item.id === 'language-nginx-rewrite').commands[0].code;
  const snippet = fs.readFileSync(path.join(root, 'deploy/nginx/pboot-rewrite.conf'), 'utf8');
  assert.equal(snippet.replace(/^#.*\r?\n/gm, '').trim(), rewrite);
  assert.ok(!snippet.includes('index.html'));
  const mode = chapter.steps.find(item => item.id === 'language-url-mode').body.join(' ');
  assert.ok(mode.includes('未切换全站 URL 模式'));
  assert.ok(chapter.steps.find(item => item.id === 'language-license-resolution').body.join(' ').includes('亲自补充'));
  assert.ok(chapter.steps.find(item => item.id === 'language-nginx-verify').media.includes('cn-nginx-verification'));
  assert.ok(!JSON.stringify(guide).includes('中文子域名官方授权仍待补充'));
});

test('progress ignores corrupt storage, unknown ids and duplicates', async () => {
  const { parseProgress } = await import('../frontend/src/utils/tutorialGuide.mjs');
  const ids = steps.map(item => item.id);
  assert.deepEqual(parseProgress('invalid', ids), []);
  assert.deepEqual(parseProgress('{}', ids), []);
  assert.deepEqual(parseProgress('["scope","scope",null,1,"unknown"]', ids), ['scope']);
});

test('tool access tutorial describes guarded migration and real browser form acceptance', async () => {
  const { filterChapters } = await import('../frontend/src/utils/tutorialGuide.mjs');
  const chapter = guide.chapters.find(item => item.id === 'tool-access');
  const text = JSON.stringify(chapter);
  assert.ok(chapter.steps.length >= 9);
  for (const word of ['NODE_ENV=production', 'PbootTools', 'SameSite=Lax', 'strict-origin-when-cross-origin', 'Origin', '回退']) assert.ok(text.includes(word), word);
  assert.ok(filterChapters(guide.chapters, 'Origin Referrer-Policy').some(item => item.id === chapter.id));
  const deployment = chapter.steps.find(item => item.id === 'tool-login-deploy');
  assert.ok(deployment.warning.includes('匿名 API 必须 401'));
  const acceptance = chapter.steps.find(item => item.id === 'tool-browser-acceptance');
  for (const id of ['seo-browser-ready', 'ftp-browser-ready', 'models-browser-ready', 'model-config-browser-ready', 'tools-final-check']) assert.ok(acceptance.media.includes(id));
  assert.ok(acceptance.body.join(' ').includes('本次未保存模型 Key'));
  assert.ok(!JSON.stringify(guide).includes('/root/tools-check.json'));
  assert.ok(guide.references.some(item => item.url.includes('Referrer-Policy')));
});

test('PDF tutorial covers full fields, exact translations and sandbox recovery', () => {
  const chapter = guide.chapters.find(item => item.id === 'pdf');
  const text = JSON.stringify(chapter);
  for (const phrase of ['不额外生成参数表', '完整 content', 'sourceMenuId', 'SANDBOX_PROBE_PASS', 'pbootpdf', 'google-noto-emoji-color-fonts', '12 页 A4', '不回写产品库']) assert.ok(text.includes(phrase), phrase);
  assert.ok(chapter.steps.find(s => s.id === 'pdf-root-sandbox').media.includes('pdf-sandbox-ready'));
  assert.ok(chapter.steps.find(s => s.id === 'pdf-language-import').media.includes('pdf-language-selected'));
});

test('typography tutorial distinguishes line spacing from fixed height and preserves source tables', () => {
  const chapter=guide.chapters.find(c=>c.id==='pdf');
  const settings=chapter.steps.find(s=>s.id==='pdf-typography-settings');
  for(const phrase of ['1.6', '14 页', '不删除正文', '无需数据库迁移']) assert.ok(JSON.stringify(settings).includes(phrase),phrase);
  assert.ok(settings.media.includes('pdf-typography-controls'));
  const tables=chapter.steps.find(s=>s.id==='pdf-table-styles');
  for(const phrase of ['网页浅蓝','简洁横线','清晰网格','THEAD','合并单元格']) assert.ok(JSON.stringify(tables).includes(phrase),phrase);
});

test('download contains all chapters, commands, captions, checkboxes and sources', async () => {
  const { guideMarkdown } = await import('../frontend/src/utils/tutorialGuide.mjs');
  const output = guideMarkdown(guide, media, 'https://admin.example.com/tutorial/deployment/');
  for (const chapter of guide.chapters) assert.ok(output.includes(chapter.title));
  assert.equal((output.match(/- \[ \]/g) || []).length, steps.length);
  assert.ok(output.includes('https://admin.example.com/tutorial/deployment/01-domain-reverse-proxy.jpg'));
  assert.ok(output.includes('PM2：Startup Script'));
  assert.ok(!output.includes('undefined'));
});

test('gallery tutorial describes defaults without rewriting old documents', () => {
  const step=guide.chapters.find(c=>c.id==='pdf').steps.find(s=>s.id==='pdf-gallery-layout');
  for(const phrase of ['0.jpg','2+1','2+2','旧的已保存资料','自动重试一次','备份']) assert.ok(JSON.stringify(step).includes(phrase),phrase);
  assert.ok(step.media.includes('pdf-gallery-single'));
  assert.ok(step.media.includes('pdf-gallery-mobile'));
});

test('same-release tutorial backup only includes changed existing files', () => {
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(root,'deploy/install-tutorial-update.sh'),'utf8');
  const block=source.match(/node - "\$ROOT" "\$STAGE" "\$BACKUP" <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)[1];
  let call;
  const mockFs={existsSync:name=>name!=='/root/new.txt',readFileSync:name=>name.endsWith('manifest.json')?JSON.stringify({files:{'same.txt':'','changed.txt':'','new.txt':''}}):Buffer.from(name.includes('same.txt')?'same':name)};
  vm.runInNewContext(block,{process:{argv:['node','-','/root','/stage','/backup/files.tgz']},require:name=>name==='fs'?mockFs:name==='path'?path.posix:{execFileSync:(...args)=>{call=args;}}});
  assert.equal(call[0],'tar');assert.equal(call[2].input,'changed.txt\0');
  assert.ok(source.includes('test -f "$RELEASE_BACKUP/source-static.tgz"'));
  assert.ok(source.includes('test ! -e "$BACKUP"'));
});

test('folder directory tutorial documents current-site paths and preservation of existing thumbnails', () => {
  const step = steps.find(item => item.id === 'folder-server-directory');
  for (const phrase of ['rootPath', '800 × 600', '0.JPG', '64 至 4096', '只读', '不上传 GitHub']) assert.ok(JSON.stringify(step).includes(phrase), phrase);
  assert.ok(step.media.includes('folder-hierarchy'));
  assert.ok(step.media.includes('folder-variants-release'));
  for (const phrase of ['浏览中，未选用', '根目录下第 3 级', '本机后台目录']) assert.ok(JSON.stringify(step).includes(phrase), phrase);
  const parameters = steps.find(item => item.id === 'folder-three-parameters');
  for (const phrase of ['按型号资料', '22 T', '同单位', '不换算 T/kN']) assert.ok(JSON.stringify(parameters).includes(phrase), phrase);
  assert.ok(parameters.media.includes('folder-unit-variant'));
  assert.ok(guide.scope.includes('不自动备份代码'));
});

test('deployment defaults to no code backup and publishes the HTML entry point last', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'deploy/install-tutorial-update.sh'), 'utf8');
  const block = source.match(/else\r?\n  node <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)[1];
  const calls = [];
  vm.runInNewContext(block, {require: () => ({
    cpSync: (...args) => calls.push(['copy', ...args]),
    renameSync: (...args) => calls.push(['rename', ...args]),
    rmSync: (...args) => calls.push(['remove', ...args]),
  })});
  assert.deepEqual(calls.map(row=>row[0]), ['copy','rename','remove']);
  assert.equal(calls[0][3].filter('/www/wwwroot/pboot_admin_center/frontend/dist-tutorial-next/index.html'), false);
  assert.ok(calls[1][1].endsWith('/dist-tutorial-next/index.html'));
  assert.ok(calls[1][2].endsWith('/dist/index.html'));
  assert.ok(calls[2][1].endsWith('/dist-tutorial-next'));
  assert.ok(source.includes('if [ "$RELEASE_BACKUP" = --backup ]; then'));
  assert.ok(source.includes('${BACKUP:-disabled}'));
  const installer = fs.readFileSync(path.join(root, 'deploy/install-brochure-update.cjs'), 'utf8');
  assert.ok(installer.includes("backupRequested = process.argv.includes('--backup')"));
  assert.ok(installer.includes("backup=backupRequested ?"));
});

test('route is authenticated, navigation includes tutorial, no embedded credentials', () => {
  const router = fs.readFileSync(path.join(root, 'frontend/src/router/index.ts'), 'utf8');
  assert.ok(router.indexOf('path: "deployment-tutorial"') > router.indexOf('meta: { requiresAuth: true }'));
  assert.ok(router.includes('to.matched.some((route) => route.meta?.requiresAuth)'));
  assert.ok(fs.readFileSync(path.join(root, 'frontend/src/components/layout/ToolNav.vue'), 'utf8').includes('label: "部署教程"'));
  const allText = JSON.stringify(guide) + JSON.stringify(media);
  assert.ok(!/https?:\/\/[^/\s"]+:[^/\s"]+@/.test(allText));
  assert.ok(!/sk-[a-zA-Z0-9]{16,}|BEGIN (?:RSA |EC )?PRIVATE KEY/.test(allText));
});

test('release preserves old chunks without replacing newly built chunks', () => {
  const os = require('node:os'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'deploy/install-tutorial-update.sh'), 'utf8');
  const block = source.match(/node <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)[1];
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-tutorial-chunks-'));
  const old = path.join(base, 'old'), next = path.join(base, 'next');
  try {
    fs.mkdirSync(path.join(old, 'nested'), { recursive: true });
    fs.mkdirSync(next);
    fs.writeFileSync(path.join(old, 'shared.js'), 'old');
    fs.writeFileSync(path.join(old, 'nested', 'old.js'), 'retained');
    fs.writeFileSync(path.join(next, 'shared.js'), 'new');
    const executable = block.replace("preserveChunks('frontend/dist/assets', 'frontend/dist-tutorial-next/assets');", 'preserveChunks(old, next);');
    vm.runInNewContext(executable, { require, old, next });
    assert.equal(fs.readFileSync(path.join(next, 'shared.js'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(next, 'nested', 'old.js'), 'utf8'), 'retained');
    vm.runInNewContext(executable, { require, old, next });
    assert.equal(fs.readFileSync(path.join(next, 'shared.js'), 'utf8'), 'new');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
