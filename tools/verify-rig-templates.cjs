const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const initSqlJs = require('../backend/node_modules/sql.js');
const root = 'E:/phpstudy_pro/WWW/shanbo-rig.c';
const source = 'E:/phpstudy_pro/WWW/shanbo.c';
const backup = path.join(__dirname, '../backups/cn-en-shared-template-20260905-133343');
const read = p => fs.readFileSync(p, 'utf8');
const files = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e =>
  e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
function rows(db, sql) {
  const result = db.exec(sql)[0];
  return result ? result.values.map(values => Object.fromEntries(result.columns.map((key,i)=>[key,values[i]]))) : [];
}
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(path.join(root,'data/1412def6361bfd54fd4f519f81ba2d22.db')));
  const previous = new SQL.Database(fs.readFileSync(path.join(backup,'before-settings.db')));
  const central = new SQL.Database(fs.readFileSync(path.join(__dirname,'../backend/dev.sqlite')));
  const oldSchema = rows(previous,"SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name");
  check(JSON.stringify(oldSchema) === JSON.stringify(rows(db,"SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")), 'PB table schema changed');
  const productSql = "SELECT a.*,b.* FROM ay_content a LEFT JOIN ay_content_ext b ON a.id=b.contentid WHERE a.scode IN (SELECT scode FROM ay_content_sort WHERE mcode='3') ORDER BY a.id";
  const productSnapshot = database => rows(database,productSql).map(({visits, ...product}) => product);
  check(JSON.stringify(productSnapshot(db)) === JSON.stringify(productSnapshot(previous)), 'Existing product data changed');
  const sorts = rows(db,"SELECT acode,scode,filename FROM ay_content_sort WHERE acode IN ('cn','en')");
  const local = rows(central,"SELECT code,href,urlName FROM menu WHERE siteId=2");
  for (const s of sorts.filter(s=>s.acode==='en')) {
    check(!sorts.some(o=>o.acode==='cn'&&o.filename===s.filename),'CN/EN URL collision '+s.scode);
    const m=local.find(m=>m.code==='pboot:en:'+s.scode);
    check(m && m.urlName===s.filename && m.href==='/'+s.filename,'Local menu URL mismatch '+s.scode);
  }
  for (const lg of ['cn','en']) {
    const base=path.join(root,'template',lg,'html');
    const original=path.join(source,'template',lg,'html');
    const relative=dir=>files(dir).map(f=>path.relative(dir,f).replaceAll('\\','/')).sort();
    check(JSON.stringify(relative(base))===JSON.stringify(relative(original)),lg+' directory differs from original organization');
    for (const f of files(base)) {
      const text=read(f);
      check(!/static\/cn-template|file=shared\//.test(text),'Obsolete resource path '+f);
      for (const match of text.matchAll(/\{include file=([^}]+)\}/g)) {
        const included = match[1].startsWith('/') ? path.join(root,match[1]) : path.join(base,match[1]);
        check(fs.existsSync(included),'Missing include '+included);
      }
      for (const match of text.matchAll(/\b(?:scode|parent)=(\d+)/g)) {
        if(match[1]==='0') continue;
        check(sorts.some(s=>s.acode===lg&&s.scode===match[1]),'Wrong language category '+lg+':'+match[1]+' '+f);
      }
    }
  }
  const common=files(path.join(root,'template/comm')).map(f=>path.basename(f)).sort();
  check(JSON.stringify(common)===JSON.stringify(['about.html','language.html','m_language.html','page.html','videos.html']),'Shared file organization differs');
  const routes=[];
  for(const lg of ['cn','en']) {
    routes.push({lg,url:'http://shanbo-rig.c/'});
    for(const s of sorts.filter(s=>s.acode===lg))
      routes.push({lg,url:'http://shanbo-rig.c/?'+s.filename+'/'});
    for(const p of rows(db,"SELECT acode,scode,filename FROM ay_content WHERE acode='"+lg+"' AND filename<>''")) {
      const s=sorts.find(s=>s.acode===lg&&s.scode===p.scode);
      if(s)routes.push({lg,url:'http://shanbo-rig.c/?'+s.filename+'/'+p.filename+'.html'});
    }
  }
  let scriptCount=0;
  const missingAssets=new Set();
  for (const {lg,url} of routes) {
    const response=await fetch(url,{headers:{Cookie:'lg='+lg},signal:AbortSignal.timeout(20000)});
    const html=await response.text();
    check(response.ok,'HTTP '+response.status+' '+url);
    check(!/您访问的内容不存在|模板文件不存在|Fatal error|Parse error|\{(?:include|pboot|content|sort):/.test(html),'Render failure '+url);
    check(html.includes(lg==='cn'?'<html lang="zh-CN"':'<html lang="en"'),'Wrong language theme '+url);
    for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if(!m[2].trim() || /src\s*=|ld\+json/i.test(m[1]))continue;
      try {new vm.Script(m[2]);scriptCount++;} catch(error) {failures.push('JavaScript '+url+': '+error.message);}
    }
    for(const m of html.matchAll(/\b(?:src|href)\s*=\s*["'](\/static\/[^"'?#]+)(?:[^"']*)["']/gi)){
      const file=path.join(root,decodeURIComponent(m[1]).replaceAll('&amp;','&'));
      if(!fs.existsSync(file))missingAssets.add(m[1]);
    }
  }
  for(const asset of missingAssets)failures.push('Missing asset '+asset);
  console.log(JSON.stringify({pages:routes.length,inlineScripts:scriptCount,failures},null,2));
  if(failures.length) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
