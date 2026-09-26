const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/www/wwwroot/pboot_admin_center';
const stage = process.argv[2];
const backupRequested = process.argv.includes('--backup');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function idleTools() {
  const credentials = JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
  for (const [base, endpoints] of [['https://seo-admin.shanbo-rig.com', ['/api/ai/status']], ['https://ftp-admin.shanbo-rig.com', ['/api/upload/status?siteId=1', '/api/security/status?siteId=1']]]) {
    const res = await fetch(base + '/_tool-auth/login', {method:'POST',redirect:'manual',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...credentials,returnTo:'/'})});
    assert.equal(res.status,303,'Tool login failed');
    const cookie = res.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    try { for (const endpoint of endpoints) {
      const response=await fetch(base+endpoint,{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
      assert.ok(response.ok,'Cannot check running jobs'); const data=await response.json();
      assert.notEqual(data.running,true,'Tool is busy; postpone release'); assert.notEqual(data.job?.running,true,'AI is busy; postpone release');
    }} finally { await fetch(base+'/_tool-auth/logout',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:base}}); }
  }
}
async function main() {
  assert.equal(fs.realpathSync(root),root);
  assert.match(fs.realpathSync(stage),/^\/www\/backup\/pboot-pdf-stage-[a-z0-9-]+$/);
  const manifest=JSON.parse(fs.readFileSync(path.join(stage,'brochure-update-manifest.json')));
  for(const [file, expected] of Object.entries(manifest.expected)) {
    assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'));
    if (expected === null) assert.ok(!fs.existsSync(path.join(root,file)), 'New file already exists on server: '+file);
    else assert.equal(hash(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')),expected,'Source changed on server: '+file);
  }
  for(const [file, expected] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'));
    assert.equal(hash(fs.readFileSync(path.join(stage,file))),expected,'Upload mismatch: '+file);
  }
  if (manifest.frontendOnly) assert.ok(Object.keys(manifest.files).every(file=>/^(frontend\/src\/|deploy\/|docs\/)/.test(file)), 'Frontend-only release contains server runtime changes');
  if (!manifest.apiOnly && !manifest.frontendOnly) await idleTools();
  const processes = manifest.frontendOnly ? [] : manifest.apiOnly ? ['pboot-admin-api'] : ['pboot-admin-api','pboot-seo-tool','pboot-ftp-tool'];
  const stamp=new Date().toISOString().replace(/[^0-9]/g,''), backup=backupRequested ? '/www/backup/pboot-pdf-release-'+stamp : null;
  if (backup) {
    fs.mkdirSync(backup,{mode:0o700});
    run('tar',['-czf',backup+'/source-static.tgz','frontend/src','frontend/dist','frontend/package.json','frontend/pnpm-lock.yaml','backend/src/brochure','backend/dist','tools/public-navigation.js',...Object.keys(manifest.files).filter(file=>fs.existsSync(path.join(root,file)))]);
    fs.chmodSync(backup+'/source-static.tgz',0o600);
  }
  console.log('BACKUP='+(backup || 'disabled; explicit --backup required'));
  let swapped=false, stopped=false;
  try {
    for(const file of Object.keys(manifest.files)) { const dest=path.join(root,file); fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(stage,file),dest); }
    run('pnpm',['--dir','frontend','install','--frozen-lockfile','--registry=https://registry.npmjs.org']);
    run(process.execPath,['--test','deploy/brochure-ui.test.cjs','deploy/fresh-install-ui.test.cjs','tools/public-navigation.test.cjs']);
    if (Object.keys(manifest.files).some(file=>file.includes('quotation'))) run(process.execPath,['--test','deploy/quotation-ui.test.cjs']);
    if (Object.keys(manifest.files).includes('frontend/src/utils/import-directory.ts')) run(process.execPath,['--test','deploy/import-directory.test.cjs']);
    if (Object.keys(manifest.files).includes('frontend/src/content/deployment-guide.json')) {
      run(process.execPath,['deploy/build-tutorial-assets.cjs']);
      run(process.execPath,['--test','deploy/tutorial-content.test.cjs']);
    }
    run('pnpm',['--dir','frontend','run','type-check']);
    if (!manifest.frontendOnly) run('pnpm',['--dir','backend','exec','jest','--runInBand','brochure']);
    if (Object.keys(manifest.files).some(file => file.startsWith('backend/src/product/'))) run('pnpm',['--dir','backend','exec','jest','--runInBand','product']);
    if (Object.keys(manifest.files).includes('backend/src/common/content-thumbnail.ts')) run('pnpm',['--dir','backend','exec','jest','--runInBand','news-thumbnail']);
    assert.ok(!fs.existsSync(root+'/frontend/dist-pdf-next')); assert.ok(!fs.existsSync(root+'/backend/dist-pdf-next'));
    run('pnpm',['--dir','frontend','run','build-only','--outDir','dist-pdf-next']);
    if (!manifest.frontendOnly) run('pnpm',['--dir','backend','exec','tsc','-p','tsconfig.build.json','--outDir','dist-pdf-next','--incremental','false']);
    // Keep cached chunks available to users with an older tab open.
    fs.cpSync(root+'/frontend/dist/assets',root+'/frontend/dist-pdf-next/assets',{recursive:true,force:false,errorOnExist:false});
    run('chmod',['-R','a+rX',root+'/frontend/dist-pdf-next']);
    if (!manifest.apiOnly && !manifest.frontendOnly) await idleTools();
    if (backup) {
      if (!manifest.frontendOnly) {
        fs.renameSync(root+'/backend/dist',backup+'/backend-dist');
        fs.renameSync(root+'/backend/dist-pdf-next',root+'/backend/dist');
      }
      fs.renameSync(root+'/frontend/dist',backup+'/frontend-dist');
      fs.renameSync(root+'/frontend/dist-pdf-next',root+'/frontend/dist');
    } else {
      if (!manifest.frontendOnly) {
        run('pm2',['stop',...processes]); stopped=true;
        fs.cpSync(root+'/backend/dist-pdf-next',root+'/backend/dist',{recursive:true});
        fs.rmSync(root+'/backend/dist-pdf-next',{recursive:true});
      }
      // Install assets first and replace the entry point last, without archiving old code.
      fs.cpSync(root+'/frontend/dist-pdf-next',root+'/frontend/dist',{recursive:true,filter:source=>source!==root+'/frontend/dist-pdf-next/index.html'});
      fs.renameSync(root+'/frontend/dist-pdf-next/index.html',root+'/frontend/dist/index.html');
      fs.rmSync(root+'/frontend/dist-pdf-next',{recursive:true});
    }
    swapped=true;
    if (processes.length) run('pm2',['restart',...processes]);
    stopped=false;
    let ready=false;
    for(let i=0;i<30;i++) { try { ready=(await fetch('http://127.0.0.1:5108/sites',{signal:AbortSignal.timeout(2000)})).status===401; } catch {} if(ready)break; await wait(1000); }
    assert.ok(ready,'API readiness failed');
    run(process.execPath,['deploy/verify-production.cjs','https://admin.shanbo-rig.com','https://seo-admin.shanbo-rig.com','https://ftp-admin.shanbo-rig.com','/root/pboot-admin-initial-login.json']);
    if (processes.length) run('pm2',['save']);
    console.log('PDF_RELEASE_COMPLETE; backup='+(backup || 'disabled')+'; no database migration; SEO worker unchanged');
  } catch(error) {
    if (backup) {
      console.error('Release failed; restoring previous source and static build.');
      run('tar',['-xzf',backup+'/source-static.tgz','-C',root]);
      if(swapped && processes.length) run('pm2',['restart',...processes]);
    } else {
      console.error('Release failed; backups disabled, no automatic source rollback.');
      if (stopped) run('pm2',['restart',...processes]);
    }
    throw error;
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
