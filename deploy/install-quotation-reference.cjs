const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root='/www/wwwroot/pboot_admin_center',stage='/www/backup/pboot-stage-quotation-reference-20260914';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,stdio:'inherit'});
async function main(){
  assert.equal(fs.realpathSync(root),root);assert.equal(fs.realpathSync(stage),stage);
  const manifest=JSON.parse(fs.readFileSync(path.join(stage,'quotation-reference-manifest.json')));
  for(const [file,checksum] of Object.entries(manifest.files)){
    assert.match(file,/^(frontend\/src\/(utils\/quotation[\w.-]*|components\/Quotation[\w.-]*|views\/quotations\/QuotationBuilder\.vue)|deploy\/(quotation[\w.-]+|install-quotation-reference\.cjs))$/);
    assert.ok(!file.includes('..'));assert.equal(hash(fs.readFileSync(path.join(stage,file))),checksum);
    const dest=path.join(root,file),old=manifest.expected[file];
    if(fs.existsSync(dest))assert.ok([checksum,old].includes(hash(fs.readFileSync(dest))),'Server file changed: '+file);
    else assert.equal(old,null);
  }
  const untouched=['frontend/src/utils/brochure.ts','frontend/src/utils/brochure-page.css','frontend/src/utils/brochure-pagination.ts','backend/src/quotation/quotation-pdf.service.ts'];
  const before=untouched.map(file=>hash(fs.readFileSync(path.join(root,file))));
  for(const file of Object.keys(manifest.files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(stage,file),path.join(root,file));}
  run(process.execPath,['--test','deploy/quotation-ui.test.cjs','deploy/brochure-ui.test.cjs']);
  run('pnpm',['--dir','frontend','run','type-check']);
  run(process.execPath,['deploy/quotation-browser-check.cjs']);
  const next=path.join(root,'frontend/dist-quotation-reference-next');
  run('pnpm',['--dir','frontend','run','build-only','--outDir',next]);
  assert.ok(fs.existsSync(path.join(next,'index.html')));
  const base='https://admin.shanbo-rig.com/api';
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:fs.readFileSync('/root/pboot-admin-initial-login.json','utf8'),signal:AbortSignal.timeout(15000)});
  assert.ok(login.ok);const body=await login.json(),token=body.access_token||body.data?.access_token;assert.equal(typeof token,'string');
  for(const [file,width,height] of [['quotation-en.html',210,297],['quotation-custom.html',250,400]]){
    const form=new FormData();form.append('document',new Blob([fs.readFileSync(path.join(root,'.cache-tutorial-update/quotation-check',file))],{type:'text/html'}),'quotation.html');form.append('widthMm',String(width));form.append('heightMm',String(height));
    const response=await fetch(base+'/quotations/export-pdf',{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Pboot-Site-Id':'1'},body:form,signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error('PDF failed '+response.status+': '+(await response.text()).slice(0,300));
    const pdf=Buffer.from(await response.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    fs.writeFileSync(path.join(root,'.cache-tutorial-update/quotation-check',file.replace('.html','-reference-server.pdf')),pdf);
    console.log('QUOTATION_REFERENCE_PDF_VERIFIED',width,height,pdf.length);
  }
  assert.deepEqual(untouched.map(file=>hash(fs.readFileSync(path.join(root,file)))),before);
  run('chmod',['-R','a+rX',next]);
  fs.cpSync(next,path.join(root,'frontend/dist'),{recursive:true,filter:file=>file!==path.join(next,'index.html')});
  fs.renameSync(path.join(next,'index.html'),path.join(root,'frontend/dist/index.html'));
  console.log('QUOTATION_REFERENCE_RELEASE_COMPLETE: classic HTML restored, PDF continuation columns verified, no database writes or backend restart.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
