const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const root='/www/wwwroot/pboot_admin_center',stage='/www/backup/pboot-stage-quotation-layout-20260914';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const run=(command,args)=>execFileSync(command,args,{cwd:root,stdio:'inherit'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  assert.equal(fs.realpathSync(root),root);assert.equal(fs.realpathSync(stage),stage);
  const manifest=JSON.parse(fs.readFileSync(path.join(stage,'quotation-layout-manifest.json')));
  for(const [file,checksum] of Object.entries(manifest.files)){
    assert.match(file,/^(frontend\/src\/(utils\/quotation[\w.-]*|api\/quotations\.ts|components\/Quotation[\w.-]*|views\/quotations\/QuotationBuilder\.vue)|backend\/src\/quotation\/[\w/.-]+|deploy\/(quotation[\w.-]+|install-quotation-layout\.cjs))$/);
    assert.ok(!file.includes('..'));
    assert.equal(hash(fs.readFileSync(path.join(stage,file))),checksum,'Upload checksum: '+file);
    const dest=path.join(root,file),old=manifest.expected[file];
    if(fs.existsSync(dest))assert.ok([checksum,old].includes(hash(fs.readFileSync(dest))),'Server file changed: '+file);
    else assert.equal(old,null,'Missing file: '+file);
  }
  const untouched=['frontend/src/utils/brochure.ts','frontend/src/utils/brochure-page.css','frontend/src/utils/brochure-pagination.ts','frontend/src/components/PaginatedDocumentPreview.vue','backend/src/brochure/brochure-pdf.service.ts'];
  const before=untouched.map(file=>hash(fs.readFileSync(path.join(root,file))));
  for(const file of Object.keys(manifest.files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(stage,file),path.join(root,file));}
  run(process.execPath,['--test','deploy/quotation-ui.test.cjs','deploy/brochure-ui.test.cjs']);
  run('pnpm',['--dir','frontend','run','type-check']);
  run('pnpm',['--dir','backend','exec','jest','--runInBand']);
  run(process.execPath,['deploy/quotation-browser-check.cjs']);
  const nextBack=path.join(root,'backend/dist-quotation-layout-next'),nextFront=path.join(root,'frontend/dist-quotation-layout-next');
  run('pnpm',['--dir','backend','exec','tsc','-p','tsconfig.build.json','--outDir',nextBack,'--incremental','false']);
  run('pnpm',['--dir','frontend','run','build-only','--outDir',nextFront]);
  assert.ok(fs.existsSync(path.join(nextBack,'quotation/quotation-pdf.service.js')));assert.ok(fs.existsSync(path.join(nextFront,'index.html')));
  const deps=createRequire(path.join(root,'backend/package.json')),dotenv=deps('dotenv');
  const envPath=path.join(root,'backend/.env'),envText=fs.readFileSync(envPath,'utf8'),env=dotenv.parse(envText);
  const wrapper=env.QUOTATION_PDF_EXECUTABLE_PATH||env.BROCHURE_PDF_EXECUTABLE_PATH;
  assert.ok(wrapper&&fs.existsSync(wrapper),'Existing sandbox wrapper required');
  if(!env.QUOTATION_PDF_EXECUTABLE_PATH){
    const {updateEnv}=require(path.join(root,'deploy/configure-public-urls.cjs'));
    fs.writeFileSync(envPath,updateEnv(envText,{QUOTATION_PDF_EXECUTABLE_PATH:wrapper}),{mode:0o600});
  }
  let stopped=false;
  try{
    run('pm2',['stop','pboot-admin-api']);stopped=true;
    const sql=await deps('sql.js')(),dbPath=path.resolve(root,'backend',env.DB_SQLJS_LOCATION||'dev.sqlite');
    const snapshot=()=>{const db=new sql.Database(fs.readFileSync(dbPath));try{return ['quotations','product','product_translations'].map(table=>hash(JSON.stringify(db.exec(`SELECT * FROM "${table}" ORDER BY id`))));}finally{db.close();}};
    const dataBefore=snapshot();fs.cpSync(nextBack,path.join(root,'backend/dist'),{recursive:true});
    run('pm2',['restart','pboot-admin-api']);stopped=false;
    let ready=false;for(let i=0;i<40;i++){try{ready=(await fetch('http://127.0.0.1:5108/sites',{signal:AbortSignal.timeout(2000)})).status===401;}catch{}if(ready)break;await wait(1000);}assert.ok(ready,'API not ready');
    assert.deepEqual(snapshot(),dataBefore,'Business data changed');
    const base='https://admin.shanbo-rig.com/api';
    const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:fs.readFileSync('/root/pboot-admin-initial-login.json','utf8'),signal:AbortSignal.timeout(15000)});
    assert.ok(login.ok,'Login failed');const body=await login.json(),token=body.access_token||body.data?.access_token;assert.equal(typeof token,'string');
    for(const [file,width,height] of [['quotation-en.html',210,297],['quotation-custom.html',250,400]]){
      const form=new FormData();form.append('document',new Blob([fs.readFileSync(path.join(root,'.cache-tutorial-update/quotation-check',file))],{type:'text/html'}),'quotation.html');form.append('widthMm',String(width));form.append('heightMm',String(height));
      const response=await fetch(base+'/quotations/export-pdf',{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Pboot-Site-Id':'1'},body:form,signal:AbortSignal.timeout(180000)});
      if(!response.ok)throw Error('Quotation PDF '+response.status+': '+(await response.text()).slice(0,300));
      const pdf=Buffer.from(await response.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
      fs.writeFileSync(path.join(root,'.cache-tutorial-update/quotation-check',file.replace('.html','-server.pdf')),pdf);
      console.log('QUOTATION_PDF_VERIFIED',width,height,pdf.length);
    }
    assert.deepEqual(untouched.map(file=>hash(fs.readFileSync(path.join(root,file)))),before,'Brochure feature changed');
    run('chmod',['-R','a+rX',nextFront]);
    fs.cpSync(nextFront,path.join(root,'frontend/dist'),{recursive:true,filter:file=>file!==path.join(nextFront,'index.html')});
    fs.renameSync(path.join(nextFront,'index.html'),path.join(root,'frontend/dist/index.html'));
    console.log('QUOTATION_LAYOUT_RELEASE_COMPLETE: independent settings/preview/API, custom paper verified, business data and brochure code unchanged.');
  }finally{if(stopped)run('pm2',['restart','pboot-admin-api']);}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
