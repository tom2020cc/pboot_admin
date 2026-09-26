const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {updateEnv}=require('./configure-public-urls.cjs');
const root='/www/wwwroot/pboot_admin_center',base='/www/server/pboot-pdf-browser';
async function main(){
  assert.equal(process.getuid(),0);assert.equal(fs.realpathSync(root),root);
  const {chromium}=require(path.join(root,'backend/node_modules/playwright'));
  const source=fs.realpathSync(chromium.executablePath());
  assert.match(source,/^\/root\/\.cache\/ms-playwright\/chromium-\d+\/chrome-linux64\/chrome$/);
  const sourceDir=path.dirname(path.dirname(source)),destination=path.join(base,path.basename(sourceDir));
  fs.mkdirSync(base,{recursive:true,mode:0o755});assert.equal(fs.realpathSync(base),base);
  if(!fs.existsSync(destination))fs.cpSync(sourceDir,destination,{recursive:true});
  assert.equal(fs.realpathSync(destination),destination);
  try{execFileSync('id',['pbootpdf'],{stdio:'ignore'});}catch{execFileSync('useradd',['--system','--user-group','--home-dir',base+'/home','--shell','/sbin/nologin','pbootpdf']);}
  fs.mkdirSync(base+'/home',{recursive:true,mode:0o700});
  execFileSync('chown',['pbootpdf:pbootpdf',base+'/home']);
  const current=base+'/current';
  if(fs.existsSync(current))assert.equal(fs.realpathSync(current),destination,'Existing browser version differs; review before switching');
  else fs.symlinkSync(destination,current);
  const wrapper=root+'/deploy/chromium-pdf-sandbox.sh';fs.chmodSync(wrapper,0o755);
  // Probe the real sandboxed executable before updating any API configuration.
  let browser;
  try{
    browser=await chromium.launch({executablePath:wrapper,chromiumSandbox:true,headless:true});
    const page=await browser.newPage();await page.setContent('<p>Chromium sandbox ready</p>');
    const pdf=await page.pdf({format:'A4'});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  }catch(error){console.error(String(error.message).slice(0,2400));throw Error('Sandbox probe failed; API configuration not changed');}
  finally{await browser?.close();}
  const file=root+'/backend/.env',text=fs.readFileSync(file,'utf8');
  const backup='/www/backup/pboot-pdf-env-'+Date.now()+'.bak';fs.writeFileSync(backup,text,{mode:0o600});
  const next=updateEnv(text,{BROCHURE_PDF_EXECUTABLE_PATH:wrapper});
  fs.writeFileSync(file,next,{mode:0o600});
  console.log('SANDBOX_PROBE_PASS; API env updated; backup='+backup);
  console.log('Restart only pboot-admin-api, then verify real PDF export.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
