#!/usr/bin/env node
'use strict';
// No application imports: preflight/backup never start mail workers or write sessions.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inspect,validate,fingerprint,sha}=require('./schema');
const database=require('./database');
process.umask(0o077);
const source=path.resolve(__dirname,'..');
const required=['package.json','package-lock.json','public/index.html','private/dashboard.html','private/v8/prototuup_v8.html','server/index.js','server/app.js','server/db.js','server/session.js','server/auth.js','server/work-mode.js',
 'server/routes/login.js','server/routes/account.js','server/routes/crm.js','server/routes/crm_v8_extension.js','server/routes/crm_budget_extension.js','server/routes/crm_mail_extension.js','server/routes/crm_imap_extension.js','server/services/activity-workflow.js',
 'database/001_users.sql','database/002_sessions.sql','database/migrations/001_base.js','database/migrations/002_v8.js','ops/schema-contract.json','ops/schema.js','ops/database.js','ops/deploy.js','ops/pm2-control.js'];
const flags=new Set(['env','host','database','root','control','revision','backup','dump-command','client-command','maintenance-confirmed','offline','restored']);
function args(argv){
 const [command,...rest]=argv, out={command};
 for(let i=0;i<rest.length;i++){
  const key=rest[i].replace(/^--/,'');
  if(rest[i]!==('--'+key)||!flags.has(key)||Object.hasOwn(out,key))throw Error('Vigane või korduv argument.');
  out[key]=['maintenance-confirmed','offline','restored'].includes(key)?true:rest[++i];
  if(out[key]===undefined||String(out[key]).startsWith('--'))throw Error('Argumendi väärtus puudub.');
 }
 if(!['preflight','apply','rollback','restore-empty'].includes(command))throw Error('Käsk: preflight | apply | rollback | restore-empty.');
 for(const k of ['env','host','database'])if(!out[k])throw Error('Nõutud on --env, --host ja --database.');
 return out;
}
function run(cmd,argv,options={}){
 const result=spawnSync(cmd,argv,{cwd:source,encoding:'utf8',maxBuffer:16*1024*1024,...options});
 if(result.error||result.status!==0)throw Error(path.basename(cmd)+' käsk ebaõnnestus. Salajasi väljundeid ei kuvata.');
 return result.stdout;
}
function inventory(revision){
 const head=run('git',['rev-parse','HEAD']).trim();
 if(revision!==head||!/^[a-f0-9]{40}$/.test(revision))throw Error('--revision peab võrduma checkout HEAD täieliku commit SHA-ga.');
 if(run('git',['status','--porcelain','--untracked-files=no']).trim())throw Error('Checkout sisaldab commit’imata muudatusi.');
 const files=new Set(run('git',['ls-tree','-r','--name-only',head]).trim().split('\n'));
 const missing=required.filter(f=>!files.has(f)||!fs.existsSync(path.join(source,f)));
 if(missing.length)throw Error('Väljalaskest puuduvad failid: '+missing.join(', '));
 return {revision:head,trackedFiles:files.size,requiredFiles:required.length};
}
function syncPath(file){const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function privateDir(dir){
 if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true,mode:0o700});syncPath(dir);syncPath(path.dirname(dir));}
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||(process.getuid&&st.uid!==process.getuid()))throw Error('Paigaldus- ja varukoopiakaust peab kuuluma käivitajale ning olema 700: '+dir);
 return fs.realpathSync(dir);
}
function writeJSON(file,value){
 const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
 const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);syncPath(path.dirname(file));
}
function fileHash(file){const h=crypto.createHash('sha256');const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
function checkPlan(snapshot,final=false){const plan=validate(snapshot,final);if(!plan.ok)throw Error('Skeemi eelkontroll peatas töö: '+plan.errors.join(' '));return plan;}
function unchangedEnv(config){if(fileHash(config.envPath)!==config.hash)throw Error('.env muutus paigalduse ajal; töö peatatud.');}
function current(root){const link=path.join(root,'current');if(!fs.lstatSync(link).isSymbolicLink())throw Error('root/current peab olema sümbollink olemasolevale rakendusele.');return fs.realpathSync(link);}
function switchTo(root,dir){const tmp=path.join(root,'.current-'+crypto.randomBytes(4).toString('hex'));fs.symlinkSync(dir,tmp);fs.renameSync(tmp,path.join(root,'current'));syncPath(root);}
function control(options,action,release,config,revision){
 if(!options.control||!path.isAbsolute(options.control))throw Error('Nõutud on absoluutne --control Node.js fail.');
 const env={...process.env};for(const key of Object.keys(env))if(/^(DB_|CRM_|SESSION_)/.test(key))delete env[key];
 Object.assign(env,config.env,{CRM_RELEASE_SHA:revision||''});
 const result=spawnSync(process.execPath,[options.control,action,release],{cwd:release,env,encoding:'utf8',maxBuffer:1024*1024});
 if(result.error)throw Error('Protsessijuhtimise käivitamine ebaõnnestus.');
 return result.status;
}
function start(options,dir,config,revision){if(control(options,'start',dir,config,revision)!==0||control(options,'status',dir,config,revision)!==0)throw Error('Rakenduse käivitamine ebaõnnestus.');}
function stop(options,dir,config){
 const status=control(options,'status',dir,config);
 if(status!==0&&status!==3)throw Error('Rakenduse olekut ei saanud turvaliselt kinnitada.');
 if(control(options,'stop',dir,config)!==0)throw Error('Rakenduse peatamine ebaõnnestus.');
 if(control(options,'status',dir,config)!==3)throw Error('Rakendus ei ole kinnitatult peatatud.');
}
async function smoke(config,revision){
 const port=Number(config.env.PORT||3000);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Vigane rakenduseport.');
 let ok=false;
 for(let i=0;i<20;i++){
  try{const response=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(2000)});const data=await response.json();if(response.status===200&&data.status==='ok'&&(!revision||data.release===revision)){ok=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ok)throw Error('Uue väljalaske tervisekontroll ebaõnnestus.');
 for(const [url,status] of [['/api/me',401],['/prototype-preview',302]]){
  const response=await fetch('http://127.0.0.1:'+port+url,{redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(response.status!==status)throw Error('Anonüümse ligipääsu kontroll ebaõnnestus.');
 }
}
function linkRuntime(release,old,config){
 const file=path.join(release,'.env');
 try{if(fs.lstatSync(file).isDirectory())throw Error('Väljalaske .env ei tohi olla kaust.');fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 fs.symlinkSync(config.envPath,file);
 for(const relative of ['uploads','private/uploads']){
  const prior=path.join(old,relative);if(!fs.existsSync(prior))continue;
  if(!fs.statSync(prior).isDirectory())throw Error('Jagatud runtime-tee pole kaust.');
  const dest=path.join(release,relative);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
  if(fs.existsSync(dest))fs.rmSync(dest,{recursive:true});
  fs.symlinkSync(fs.realpathSync(prior),dest);
 }
}
function install(release,options){run('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund',...(options.offline?['--offline']:[])],{cwd:release});}
function verifyBackup(dir,manifest){
 if(!manifest.backupComplete)throw Error('Varukoopia pole märgitud terviklikuks.');
 for(const [name,hash]of Object.entries(manifest.checksums))if(fileHash(path.join(dir,name))!==hash)throw Error('Varukoopia kontrollsumma ei klapi: '+name);
 run('tar',['-tzf',path.join(dir,'code.tar.gz')],{stdio:'ignore'});
}
function loadBackup(root,id){
 if(!/^[0-9TZ]+-[a-f0-9]{8}$/.test(id||''))throw Error('Vigane --backup ID.');
 const dir=privateDir(path.join(root,'backups',id));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.root!==root||manifest.id!==id)throw Error('Varukoopia kuulub teisele paigaldusele.');
 verifyBackup(dir,manifest);return {dir,manifest};
}
async function apply(options,config,db,root){
 if(!options['maintenance-confirmed'])throw Error('Kinnita kõigi teiste kirjutajate ja cron-tööde hoolduspaus: --maintenance-confirmed.');
 const releaseInfo=inventory(options.revision);
 const old=current(root);
 if(root===old||root.startsWith(old+path.sep))throw Error('Paigalduskaust ei tohi asuda varundatava rakenduse sees.');
 if(fs.realpathSync(path.join(old,'.env'))!==config.envPath)throw Error('--env ei vasta praeguse rakenduse .env failile.');
 const initial=await inspect(db);checkPlan(initial);
 const id=new Date().toISOString().replace(/[-:.]/g,'')+'-'+crypto.randomBytes(4).toString('hex');
 const dir=privateDir(path.join(root,'backups',id)),release=path.join(root,'releases',id);
 const manifest={id,root,old,release,revision:releaseInfo.revision,envPath:config.envPath,envHash:config.hash,phase:'prepared',backupComplete:false,migrationStarted:false};
 const save=()=>writeJSON(path.join(dir,'manifest.json'),manifest);
 save();let stopped=false;
 try{
  stop(options,old,config);stopped=true;
  const before=await inspect(db),plan=checkPlan(before);
  if(fingerprint(initial)!==fingerprint(before))throw Error('Skeem muutus eelkontrolli ja hoolduspausi vahel.');
  manifest.before=before;manifest.pending=plan.pending;manifest.counts=await database.counts(db,before);manifest.phase='backing-up';save();
  unchangedEnv(config);
  run('tar',['-czf',path.join(dir,'code.tar.gz'),'--exclude=node_modules','--exclude=.git','-C',old,'.']);
  fs.copyFileSync(config.envPath,path.join(dir,'env.snapshot'));fs.chmodSync(path.join(dir,'env.snapshot'),0o600);
  database.dump(config,dir,options['dump-command']);
  const sql=path.join(dir,'database.sql'),fd=fs.openSync(sql,'r'),size=fs.statSync(sql).size,tail=Buffer.alloc(Math.min(8192,size));
  try{fs.readSync(fd,tail,0,tail.length,size-tail.length);}finally{fs.closeSync(fd);}
  if(!tail.toString().includes('-- Dump completed on'))throw Error('SQL varukoopial puudub lõpetamise märge.');
  manifest.checksums={};for(const name of ['code.tar.gz','database.sql','env.snapshot']){syncPath(path.join(dir,name));manifest.checksums[name]=fileHash(path.join(dir,name));}
  manifest.backupComplete=true;manifest.phase='backed-up';save();verifyBackup(dir,manifest);
  privateDir(release);
  const archive=path.join(dir,'release.tar');run('git',['archive','--format=tar','--output='+archive,options.revision]);run('tar',['-xf',archive,'-C',release]);fs.unlinkSync(archive);
  install(release,options);linkRuntime(release,old,config);unchangedEnv(config);
  if(plan.pending.length){
   manifest.migrationStarted=true;manifest.phase='migrating';save();
   await db.migrate.latest({directory:path.join(release,'database/migrations')});
  }
  const after=await inspect(db);checkPlan(after,true);
  const afterCounts=await database.counts(db,after);
  for(const [table,count]of Object.entries(manifest.counts))if(!['knex_migrations','knex_migrations_lock','crm_v8_stop_reasons'].includes(table)&&afterCounts[table]!==count)throw Error('Olemasoleva tabeli kirjete arv muutus ootamatult: '+table);
  manifest.afterSchemaHash=fingerprint(after);manifest.phase='migrated';save();
  unchangedEnv(config);switchTo(root,release);manifest.phase='switched';save();
  start(options,release,config,options.revision);await smoke(config,options.revision);
  manifest.phase='healthy';save();console.log(JSON.stringify({ok:true,backup:id,revision:options.revision,release}));
 }catch(error){
  manifest.phase='failed';manifest.failure=error.message;save();
  if(stopped&&!manifest.migrationStarted){
   const live=current(root);if(live!==old)stop(options,live,config);
   switchTo(root,old);start(options,old,config);manifest.phase='old-code-restarted';save();
  }else if(stopped){
   // DDL may have committed even when migration.latest rejected. Never auto-run old code.
   try{const live=current(root);stop(options,live,config);}catch{}
  }
  throw Error(error.message+' Varukoopia ID: '+id+(manifest.migrationStarted?' Ühesuunaline migratsioon võis rakenduda; rakendust ei taastata automaatselt.':''));
 }
}
async function restoreEmpty(options,config,db,root){
 const {dir,manifest}=loadBackup(root,options.backup);
 const original=require('dotenv').parse(fs.readFileSync(path.join(dir,'env.snapshot')));
 if(original.DB_HOST===config.env.DB_HOST&&String(original.DB_PORT||3306)===String(config.env.DB_PORT||3306)&&original.DB_NAME===config.env.DB_NAME)throw Error('Taastamise siht peab erinema algandmebaasist.');
 if((await inspect(db)).tables.length)throw Error('Taastamiseks on nõutud täiesti tühi eraldi andmebaas.');
 for(const [key,value] of Object.entries(original))if(!/^DB_/.test(key)&&config.env[key]!==value)throw Error('Taastamise konfiguratsioon peab säilitama algse rakenduse muud seaded.');
 database.importDump(config,dir,path.join(dir,'database.sql'),options['client-command']);
 const restored=await inspect(db),counts=await database.counts(db,restored);
 if(fingerprint(restored)!==fingerprint(manifest.before)||JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw Error('Taastatud skeemi või kirjete arv ei vasta varukoopiale.');
 const receipt={backup:manifest.id,envHash:config.hash,schemaHash:fingerprint(restored),database:config.env.DB_NAME,host:config.env.DB_HOST,port:config.env.DB_PORT||'3306'};
 writeJSON(path.join(dir,'restore-'+sha(config.envPath)+'.json'),receipt);
 console.log(JSON.stringify({ok:true,restoredTo:config.env.DB_NAME,backup:manifest.id,originalDatabaseUnchanged:true}));
}
async function rollback(options,config,db,root){
 if(!options['maintenance-confirmed'])throw Error('Taastamine nõuab hoolduspausi kinnitamist.');
 const {dir,manifest}=loadBackup(root,options.backup);
 const schema=await inspect(db);
 if(manifest.migrationStarted){
  if(!options.restored)throw Error('Ühesuunalised migratsioonid: taasta SQL esmalt eraldi tühja andmebaasi ja kasuta --restored.');
  const receipt=JSON.parse(fs.readFileSync(path.join(dir,'restore-'+sha(config.envPath)+'.json'),'utf8'));
  if(receipt.backup!==manifest.id||receipt.envHash!==config.hash||receipt.schemaHash!==fingerprint(schema)||fingerprint(schema)!==fingerprint(manifest.before))throw Error('Taastamise kinnitus või skeem ei klapi.');
 }else if(config.hash!==manifest.envHash||fingerprint(schema)!==fingerprint(manifest.before))throw Error('Ainult koodi taastamine pole selle konfiguratsiooni/skeemiga ohutu.');
 const live=current(root);if(![manifest.old,manifest.release].includes(live))throw Error('Vahepeal on paigaldatud muu väljalase; automaatne taastamine peatatud.');
 const restored=path.join(root,'releases',manifest.id+'-rollback');if(fs.existsSync(restored))throw Error('Taastamiskaust on juba olemas.');
 privateDir(restored);run('tar',['-xzf',path.join(dir,'code.tar.gz'),'-C',restored]);
 install(restored,options);linkRuntime(restored,live,config);unchangedEnv(config);
 stop(options,live,config);switchTo(root,restored);
 try{start(options,restored,config);await smoke(config);}
 catch(e){try{stop(options,restored,config);}catch{}throw Error('Taastatud koodi tervisekontroll ebaõnnestus; rakendus jäeti peatatud olekusse.');}
 writeJSON(path.join(dir,'rollback.json'),{backup:manifest.id,release:restored,envPath:config.envPath,restoredDatabase:!!options.restored});
 console.log(JSON.stringify({ok:true,release:restored,databaseRestored:!!options.restored}));
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<22)throw Error('Nõutud on Node.js 22 või uuem.');
 const options=args(process.argv.slice(2)),config=database.settings(options.env,options.host,options.database),db=database.connect(config);
 let lock;
 try{
  if(options.command==='preflight'){
   const snapshot=await inspect(db),plan=validate(snapshot);const files=inventory(options.revision);
   console.log(JSON.stringify({...plan,source:files},null,2));if(!plan.ok)process.exitCode=1;return;
  }
  if(!options.root||!path.isAbsolute(options.root))throw Error('Nõutud on absoluutne --root.');
  const root=privateDir(options.root);privateDir(path.join(root,'backups'));privateDir(path.join(root,'releases'));
  lock=path.join(root,'.deploy-lock');try{fs.mkdirSync(lock,{mode:0o700});}catch{lock=null;throw Error('Paigalduslukk on olemas; kontrolli eelmist protsessi enne käsitsi eemaldamist.');}
  if(options.command==='apply')await apply(options,config,db,root);
  else if(options.command==='restore-empty')await restoreEmpty(options,config,db,root);
  else await rollback(options,config,db,root);
 }finally{await db.destroy();if(lock)fs.rmdirSync(lock);}
}
if(require.main===module)main().catch(error=>{console.error(error.message?.startsWith('Skeemi')?error.message:(error.code?'Operatsioon ebaõnnestus ('+error.code+'); paroole ja SQL-i ei kuvata.':error.message));process.exitCode=1;});
module.exports={inventory,args};
