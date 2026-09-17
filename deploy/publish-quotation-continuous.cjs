const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const root='/www/wwwroot/pboot_admin_center',out=path.join(root,'.cache-tutorial-update/quotation-check');
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,stdio:'inherit'});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function main(){
  assert.equal(fs.realpathSync(root),root);
  const untouched=['frontend/src/utils/brochure.ts','frontend/src/utils/brochure-page.css','frontend/src/utils/brochure-pagination.ts','backend/src/brochure/brochure-pdf.service.ts'];
  const original=untouched.map(p=>hash(fs.readFileSync(path.join(root,p))));
  run(process.execPath,['--test','deploy/quotation-ui.test.cjs','deploy/brochure-ui.test.cjs']);
  run('pnpm',['--dir','frontend','run','type-check']);
  run('pnpm',['--dir','backend','exec','jest','src/quotation/quotation-pdf.spec.ts','--runInBand']);
  run(process.execPath,['deploy/quotation-browser-check.cjs']);
  run(process.execPath,['deploy/quotation-continuous-check.cjs']);
  const front=path.join(root,'frontend/dist-quotation-continuous-next'),back=path.join(root,'backend/dist-quotation-continuous-next');
  run('pnpm',['--dir','frontend','run','build-only','--outDir',front]);
  run('pnpm',['--dir','backend','exec','tsc','-p','tsconfig.build.json','--outDir',back,'--incremental','false']);
  const deps=createRequire(path.join(root,'backend/package.json'));
  const env=deps('dotenv').parse(fs.readFileSync(path.join(root,'backend/.env')));
  const wrapper=env.QUOTATION_PDF_EXECUTABLE_PATH;
  assert.ok(wrapper&&fs.existsSync(wrapper),'Existing sandbox PDF wrapper is required');
  process.env.QUOTATION_PDF_EXECUTABLE_PATH=wrapper;
  const {QuotationPdfService}=require(path.join(back,'quotation/quotation-pdf.service.js'));
  const service=new QuotationPdfService();
  const samples=[['quotation-continuous-en.html',297,0],['quotation-continuous-zh-CN.html',297,0],['quotation-continuous-ar.html',297,0],['quotation-en.html',210,297],['quotation-custom.html',250,400]];
  for(const [file,w,h] of samples){
    const pdf=await service.render(fs.readFileSync(path.join(out,file),'utf8'),w,h);
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    fs.writeFileSync(path.join(out,file.replace('.html','-server.pdf')),pdf);
    console.log('STAGED_PDF_VERIFIED',file,w,h,pdf.length);
  }
  let stopped=false;
  try{
    run('pm2',['stop','pboot-admin-api']);stopped=true;
    const SQL=await deps('sql.js')(),dbPath=path.resolve(root,'backend',env.DB_SQLJS_LOCATION||'dev.sqlite');
    const snapshot=()=>{const db=new SQL.Database(fs.readFileSync(dbPath));try{return ['quotations','product','product_translations'].map(table=>hash(JSON.stringify(db.exec(`SELECT * FROM "${table}" ORDER BY id`))));}finally{db.close()}};
    const before=snapshot();
    for(const file of ['quotation/quotation-pdf.service.js','quotation/dto/export-quotation-pdf.dto.js']){
      fs.copyFileSync(path.join(back,file),path.join(root,'backend/dist',file));
    }
    run('pm2',['restart','pboot-admin-api']);stopped=false;
    let ready=false;
    for(let i=0;i<40;i++){
      try{ready=(await fetch('http://127.0.0.1:5108/sites',{signal:AbortSignal.timeout(2000)})).status===401}catch{}
      if(ready)break;await new Promise(r=>setTimeout(r,1000));
    }
    assert.ok(ready,'API did not restart');assert.deepEqual(snapshot(),before,'Business data changed');
    const base='https://admin.shanbo-rig.com/api';
    const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:fs.readFileSync('/root/pboot-admin-initial-login.json','utf8'),signal:AbortSignal.timeout(15000)});
    assert.ok(login.ok,'Login failed');const auth=await login.json(),token=auth.access_token||auth.data?.access_token;assert.equal(typeof token,'string');
    for(const [file,w,h] of [samples[0],samples[3]]){
      const form=new FormData();form.append('document',new Blob([fs.readFileSync(path.join(out,file))],{type:'text/html'}),'quotation.html');form.append('widthMm',String(w));form.append('heightMm',String(h));
      const res=await fetch(base+'/quotations/export-pdf',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Pboot-Site-Id':'1'},body:form,signal:AbortSignal.timeout(180000)});
      if(!res.ok)throw Error('PDF route '+res.status+': '+(await res.text()).slice(0,300));
      const pdf=Buffer.from(await res.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
      fs.writeFileSync(path.join(out,file.replace('.html','-live.pdf')),pdf);console.log('LIVE_PDF_VERIFIED',file,pdf.length);
    }
    assert.deepEqual(untouched.map(p=>hash(fs.readFileSync(path.join(root,p)))),original,'Product brochure code changed');
    run('chmod',['-R','a+rX',front]);
    fs.cpSync(front,path.join(root,'frontend/dist'),{recursive:true,filter:p=>p!==path.join(front,'index.html')});
    fs.renameSync(path.join(front,'index.html'),path.join(root,'frontend/dist/index.html'));
    console.log('QUOTATION_CONTINUOUS_RELEASE_COMPLETE');
  }finally{if(stopped)run('pm2',['restart','pboot-admin-api'])}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
