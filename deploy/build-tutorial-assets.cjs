const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const media = require('../frontend/src/content/deployment-media.json');
const source = path.join(root, 'docs/tutorial-assets/baota-2026-09-11');
const destination = path.join(root, 'frontend/public/tutorial/deployment');
const escapeXml = value => String(value).replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]);

function diagramSvg(diagram) {
  const palettes = { blue: ['#eff6ff', '#1762c4'], green: ['#effaf5', '#21835b'], red: ['#fff4f2', '#b63c32'] };
  const edges = diagram.edges.map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#718096" stroke-width="2" marker-end="url(#arrow)" fill="none"/>`).join('');
  const nodes = diagram.nodes.map(node => {
    const [fill, stroke] = palettes[node.tone];
    const textX = node.x + node.w / 2;
    return `<g><rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="6" fill="${fill}" stroke="${stroke}"/><text x="${textX}" y="${node.y + 27}" font-size="17" font-weight="700" fill="${stroke}" text-anchor="middle">${escapeXml(node.title)}</text>${node.lines.map((line, index) => `<text x="${textX}" y="${node.y + 50 + index * 20}" font-size="14" text-anchor="middle" fill="#334155">${escapeXml(line)}</text>`).join('')}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="440" viewBox="0 0 960 440" role="img" aria-labelledby="title"><title id="title">${escapeXml(diagram.title)}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#718096"/></marker></defs><rect width="960" height="440" fill="#fff"/><text x="30" y="32" font-size="21" font-weight="700" fill="#1d2939" font-family="Arial,Microsoft YaHei,sans-serif">${escapeXml(diagram.title)}</text><g transform="translate(0,40)" font-family="Arial,Microsoft YaHei,sans-serif">${edges}${nodes}</g></svg>\n`;
}

function build() {
  fs.mkdirSync(destination, { recursive: true });
  const manifest = [];
  for (const [id, item] of Object.entries(media)) {
    if (path.basename(item.file) !== item.file) throw new Error(`Unsafe tutorial asset: ${id}`);
    const output = path.join(destination, item.file);
    if (item.kind === 'screenshot') {
      const original = item.source || item.file;
      if (path.basename(original) !== original) throw new Error(`Unsafe source asset: ${id}`);
      fs.copyFileSync(path.join(source, original), output);
    }
    else fs.writeFileSync(output, diagramSvg(item.diagram));
    manifest.push({ id, file: item.file, kind: item.kind, sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') });
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Tutorial assets ready: ${manifest.length}. Originals unchanged; only explicitly selected screenshots copied.`);
}

if (require.main === module) {
  build();
  import('../frontend/src/utils/tutorialGuide.mjs').then(({ guideMarkdown }) => {
    const guide = require('../frontend/src/content/deployment-guide.json');
    const note = '> 本文由 frontend/src/content/deployment-guide.json 生成，与后台“部署教程”同源。截图编号及箭头图例可在网页放大查看。修改源数据后运行 node deploy/build-tutorial-assets.cjs。\n\n';
    fs.writeFileSync(path.join(root, 'docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md'), note + guideMarkdown(guide, media, '../frontend/public/tutorial/deployment/'));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { build, diagramSvg };
