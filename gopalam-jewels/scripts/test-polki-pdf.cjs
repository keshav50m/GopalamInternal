// Node smoke test: adapt jsPDF ESM interop for Node; browser bundles use its default export.
const fs=require('fs'),path=require('path'),ts=require(process.cwd()+'/node_modules/typescript');
const base=fs.mkdtempSync(require('os').tmpdir()+'/polki-pdf-smoke-');
try{fs.symlinkSync(process.cwd()+'/node_modules',base+'/node_modules','dir')}catch{}
const done=new Set();
function compile(file){
 if(done.has(file))return;done.add(file);
 let source=fs.readFileSync(file,'utf8').replaceAll('{ default: jsPDF }', '{ jsPDF }');
 source=source.replace(/(["'])@\/([^"']+)\1/g,(_,q,rel)=>{
   const dep=path.resolve('src',rel+'.ts');compile(dep);
   return q+path.join(base,path.relative(path.resolve('src'),dep)).replace(/\.ts$/,'.mjs')+q;
 });
 const dest=path.join(base,path.relative(path.resolve('src'),file)).replace(/\.ts$/,'.mjs');
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
(async()=>{
 const fields={image:false,barcode:true,item:true,stone:true,gross:true,stoneWt:true,dai:true,price:true,usd:true,size:true,labour:true,labourPuwai:true};
 const rows=Array.from({length:12},(_,i)=>({barcode:'B'+i,data:{ITEM:'P'+i,'LOT NO.':'LOT7',PUWAI:'12','NET WT.':'4.25','GROSSWT.':'5.5',TAG:'T1','LABOUR PER GRM':'20','LABOUR + PUWAI':'32',SILVER:'90',FINAL:'122'}}));
 const modules=['generatePDF','generatePDFVersion2','generatePDFVersion3','generatePDFVersion4','generatePDFVersion5'];
 for(const name of modules)compile(path.resolve('src/utils/polki',name+'.ts'));
 process.chdir(base);
 for(const name of modules){
  const mod=await import(base+'/utils/polki/'+name+'.mjs');
  const args=name.endsWith('4')||name.endsWith('5')?[rows,'Polki QA',{rows:3,columns:2},()=>{}]:[rows,fields,'Polki QA',()=>{}];
  await mod[name](...args);
 }
 const files=fs.readdirSync(base).filter(f=>f.endsWith('.pdf'));
 if(files.length!==5)throw new Error('Expected five PDF layouts, got '+files.length);
 console.log(files.map(f=>({file:f,bytes:fs.statSync(base+'/'+f).size})));
})().catch(e=>{console.error(e);process.exit(1)});
