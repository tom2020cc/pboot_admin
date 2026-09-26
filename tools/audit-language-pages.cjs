// Read-only page audit. Metadata is collected from the target PB database first.
const fs = require('node:fs');
const https = require('node:https');
const vm = require('node:vm');
const { resolveLocalAddress } = require('./ftp_publish_tool/ftp-client');
const langs = ['en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'vi', 'tr'];
const cfg = JSON.parse(fs.readFileSync('tools/ftp_publish_tool/sync.config.json')).project;
const metadata = JSON.parse(fs.readFileSync('.cache-language-audit/remote-metadata.json'));
const label = process.argv[2] || 'online';
const host = lang => lang === 'en' ? 'shanbo-rig.com' : lang + '.shanbo-rig.com';
const entity = s => s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&nbsp;/g, ' ');
const visible = html => entity(html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const get = (lang, route) => new Promise((resolve, reject) => {
  const req = https.get({ hostname: host(lang), path: route, localAddress: resolveLocalAddress(cfg),
    lookup: (_, opts, cb) => cb(null, cfg.host, 4), timeout: 20000,
    headers: { 'User-Agent': 'Shanbo-Language-Audit/1.0' } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString(), location: res.headers.location }));
  });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
});
async function main() {
  const report = [];
  for (const lang of langs) {
    const queue = [...new Set(['/', ...metadata.sorts.filter(s => s.acode === lang && s.filename).map(s => '/' + s.filename + '/')])];
    const known = new Set(queue), rows = [];
    let index = 0;
    async function worker() {
      while (index < queue.length) {
        const route = queue[index++], issues = [];
        try {
          const {status, html, location} = await get(lang, route);
          if (status !== 200) issues.push('HTTP ' + status + (location ? ' → ' + location : ''));
          const actual = html.match(/<html\b[^>]*\blang=["']([^"']+)/i)?.[1];
          if (actual !== lang) issues.push('html language: ' + actual);
          const text = visible(html);
          // The language selector's 中文 label is expected in every language.
          const han = [...new Set(text.replaceAll('中文', '').match(/[\u3400-\u9fff][\u3400-\u9fff\s，。、：；（）！？·-]*/g) || [])];
          if (han.length) issues.push('Chinese: ' + han.slice(0, 15).join(' | '));
          if (/\{(?:pboot:|content:|sort:|include file)|Fatal error|Parse error/.test(html)) issues.push('Unparsed template / PHP error');
          for (const m of html.matchAll(/<script\b([^>]*)>([^]*?)<\/script>/gi)) {
            if (!m[2].trim() || /src\s*=|ld\+json|type=["']module/i.test(m[1])) continue;
            try { new vm.Script(m[2]); } catch(e) { issues.push('Script: ' + e.message); }
          }
          for (const m of html.matchAll(/<dl class="home-product-specs">([^]*?)<\/dl>/g)) {
            // CSS displays the first three rows; later real values/placeholders remain hidden.
            if ((m[1].match(/<dd\b/g)||[]).length < 3) issues.push('Product list has fewer than 3 property rows');
          }
          for (const m of html.matchAll(/href=["']([^"'#]+)["']/g)) {
            let u; try { u = new URL(m[1].replaceAll('&amp;', '&'), 'https://' + host(lang) + route); } catch { continue; }
            if (u.hostname !== host(lang) || u.search || !u.pathname.endsWith('.html')) continue;
            if (!known.has(u.pathname) && known.size < 250) { known.add(u.pathname); queue.push(u.pathname); }
          }
          rows.push({route,status,title:html.match(/<title>([^]*?)<\/title>/i)?.[1],issues});
        } catch(e) { rows.push({route,issues:[e.message]}); }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    report.push({lang,pages:rows.length,rows});
    console.log(JSON.stringify({lang,pages:rows.length,failures:rows.filter(r=>r.issues.length).length,samples:rows.filter(r=>r.issues.length).slice(0,2)}));
  }
  fs.writeFileSync('.cache-language-audit/' + label + '.json', JSON.stringify(report,null,2));
  const failures = report.flatMap(r=>r.rows.filter(p=>p.issues.length));
  console.log(JSON.stringify({pages:report.reduce((n,r)=>n+r.pages,0),failures:failures.length}));
  if (failures.length) process.exitCode = 1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
