const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {spawnSync,spawn}=require('node:child_process');
const {inspect,validate,fingerprint}=require('../ops/schema');const database=require('../ops/database');
const contract=require('../ops/schema-contract.json');
function reference(){return {version:'11.4.13-MariaDB',columns:structuredClone(contract.columns),indexes:structuredClone(contract.indexes),tables:[...new Set(contract.columns.map(c=>c.TABLE_NAME))].sort().map(TABLE_NAME=>({TABLE_NAME,TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB',TABLE_COLLATION:'utf8mb4_unicode_ci'})),triggers:[],checks:[],charset:'utf8mb4',events:[],foreign:[],applied:['001_base.js','002_v8.js'],locked:false};}
test('schema gate rejects unsafe existing schemas without attempting repair',()=>{
 assert.equal(validate(reference(),true).ok,true);
 for(const mutate of [
  s=>s.columns=s.columns.filter(c=>!(c.TABLE_NAME==='crm_activity_details'&&c.COLUMN_NAME==='purpose')),
  s=>s.indexes=s.indexes.filter(c=>!(c.TABLE_NAME==='crm_email_outbox'&&c.COLUMN_NAME==='activity_id')),
  s=>s.columns.find(c=>c.TABLE_NAME==='crm_activities'&&c.COLUMN_NAME==='owner_user_id').COLUMN_TYPE='bigint',
  s=>s.tables[0].ENGINE='MyISAM',
  s=>s.triggers.push({EVENT_OBJECT_TABLE:'crm_clients'}),
  s=>s.events.push({EVENT_NAME:'unexpected_event'}),
  s=>s.checks.push({TABLE_NAME:'users',CHECK_CLAUSE:'length(name) < 10'}),
  s=>s.foreign.push({TABLE_NAME:'crm_clients',COLUMN_NAME:'google_id'}),
  s=>s.charset='latin1',
  s=>s.applied.push('unknown.js'),s=>s.locked=true,
  s=>s.columns.push({TABLE_NAME:'crm_clients',COLUMN_NAME:'required_external',COLUMN_TYPE:'varchar(10)',IS_NULLABLE:'NO',COLUMN_DEFAULT:null,EXTRA:''})
 ]){const snapshot=reference();mutate(snapshot);assert.equal(validate(snapshot).ok,false);}
 const wide=reference();wide.applied=[];wide.tables=wide.tables.filter(t=>!t.TABLE_NAME.startsWith('knex_'));wide.columns.find(c=>c.TABLE_NAME==='users'&&c.COLUMN_NAME==='name').COLUMN_TYPE='varchar(300)';assert.equal(validate(wide).ok,false);
 const mysql=reference();mysql.version='8.4.0';Object.assign(mysql.columns.find(c=>c.TABLE_NAME==='user_sessions'&&c.COLUMN_NAME==='sess'),{COLUMN_TYPE:'json',CHARACTER_SET_NAME:null});assert.equal(validate(mysql,true).ok,true);
});
const enabled=!!process.env.DEPLOY_TEST_ENV;
let config,db,root,old,envFile,restoredEnv,options,backup,revision;
const source=path.resolve(__dirname,'..');
async function command(cmd,args,env=process.env){
 return new Promise(resolve=>{const child=spawn(cmd,args,{cwd:source,env,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',e=>resolve({status:1,out,err:e.code}));child.on('close',status=>resolve({status,out,err}));});
}
function sync(cmd,args,opts={}){const r=spawnSync(cmd,args,{cwd:source,encoding:'utf8',...opts});assert.equal(r.status,0,r.stderr);return r.stdout;}
async function cli(action,more=[],target=options){
 return command(process.execPath,['ops/deploy.js',action,'--env',target.envPath,'--host',target.env.DB_HOST,'--database',target.env.DB_NAME,'--root',root,'--control',path.join(source,'ops/test-control.js'),'--revision',revision,'--dump-command',path.resolve(process.env.DEPLOY_DUMP_COMMAND),'--client-command',path.resolve(process.env.DEPLOY_CLIENT_COMMAND),'--offline',...more]);
}
async function reset(target){
 const snapshot=await inspect(target);for(const t of snapshot.tables)await target.schema.dropTable(t.TABLE_NAME);
}
before(async()=>{
 if(!enabled)return;
 const initial=require('dotenv').parse(fs.readFileSync(process.env.DEPLOY_TEST_ENV));
 if(initial.DB_HOST!=='127.0.0.1'||initial.DB_NAME!=='ellington_test_deploy'||initial.DB_PORT!=='3308')throw Error('Deployment rehearsal requires isolated loopback ellington_test_deploy:3308');
 const fixture=fs.mkdtempSync(path.join(source,'work/deployment/rehearsal-'));fs.chmodSync(fixture,0o700);
 root=path.join(fixture,'deploy');old=path.join(fixture,'legacy');fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(old,{mode:0o700});
 const archive=path.join(fixture,'old.tar');sync('git',['archive','--format=tar','--output='+archive,'main']);sync('tar',['-xf',archive,'-C',old]);
 fs.symlinkSync(path.join(source,'node_modules'),path.join(old,'node_modules'));fs.symlinkSync(old,path.join(root,'current'));
 initial.ELLINGTON_TEST_PID=path.join(fixture,'app.pid');
 envFile=path.join(old,'.env');fs.writeFileSync(envFile,Object.entries(initial).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});
 options=database.settings(envFile,initial.DB_HOST,initial.DB_NAME);db=database.connect(options);await reset(db);
 const restoreEnv={...initial,DB_NAME:'ellington_test_restore'};restoredEnv=path.join(fixture,'restored.env');fs.writeFileSync(restoredEnv,Object.entries(restoreEnv).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});
 const restoreDb=database.connect(database.settings(restoredEnv,initial.DB_HOST,restoreEnv.DB_NAME));try{await reset(restoreDb);}finally{await restoreDb.destroy();}
 await require('../database/migrations/001_base').up(db);
 const [user]=await db('users').insert({name:'Synthetic deployment user',email:'deployment@example.invalid',password_hash:'synthetic-non-login-hash',role:'admin'});
 const [client]=await db('crm_clients').insert({name:'Synthetic deployment client',owner_user_id:user,notes:'DO NOT OVERWRITE'});
 await db('crm_activity_history').insert({activity_id:1,user_id:user,event_type:'synthetic_preservation_marker',details:'preserve history'});
 fs.mkdirSync(path.join(old,'uploads'));fs.writeFileSync(path.join(old,'uploads','sentinel.txt'),'preserve runtime file');
 revision=sync('git',['rev-parse','HEAD']).trim();
 const r=await command(process.execPath,['ops/test-control.js','start',old],{...process.env,...initial});assert.equal(r.status,0,r.err);
});
after(async()=>{
 if(!enabled)return;
 try{const live=fs.realpathSync(path.join(root,'current'));await command(process.execPath,['ops/test-control.js','stop',live],{...process.env,...options.env});}finally{await db.destroy();}
});
test('read-only preflight inventories the tracked release and preserves schema and rows',{skip:!enabled},async()=>{
 const before=fingerprint(await inspect(db)),envHash=require('../ops/schema').sha(fs.readFileSync(envFile));
 const r=await cli('preflight');assert.equal(r.status,0,r.err);const plan=JSON.parse(r.out);assert.equal(plan.ok,true);assert.deepEqual(plan.pending,['001_base.js','002_v8.js']);assert.ok(plan.source.requiredFiles>20);
 assert.equal(fingerprint(await inspect(db)),before);assert.equal(require('../ops/schema').sha(fs.readFileSync(envFile)),envHash);
 assert.equal((await db('crm_clients').first()).notes,'DO NOT OVERWRITE');
});
test('incompatible width and partial v8 tables block deployment without schema repair',{skip:!enabled},async()=>{
 await db.schema.alterTable('crm_templates',t=>t.string('subject',700).alter());
 let before=fingerprint(await inspect(db));let r=await cli('preflight');assert.equal(r.status,1);assert.equal(JSON.parse(r.out).ok,false);assert.equal(fingerprint(await inspect(db)),before);
 await db.schema.alterTable('crm_templates',t=>t.string('subject',255).alter());
 await db.schema.createTable('crm_activity_details',t=>t.bigInteger('activity_id').unsigned().primary());before=fingerprint(await inspect(db));
 r=await cli('apply',['--maintenance-confirmed']);assert.equal(r.status,1);assert.equal(fingerprint(await inspect(db)),before);
 assert.equal(fs.realpathSync(path.join(root,'current')),old);
 await db.schema.dropTable('crm_activity_details');
});
test('failed dump never starts migrations and restarts the unchanged old application',{skip:!enabled},async()=>{
 const before=fingerprint(await inspect(db)),envHash=require('../ops/schema').sha(fs.readFileSync(envFile));
 const r=await cli('apply',['--maintenance-confirmed','--dump-command','/bin/false']);
 // Duplicate arguments must also fail closed; test actual failing dump with one argument.
 assert.equal(r.status,1);
 const args=['ops/deploy.js','apply','--env',envFile,'--host','127.0.0.1','--database','ellington_test_deploy','--root',root,'--control',path.join(source,'ops/test-control.js'),'--revision',revision,'--dump-command','/bin/false','--maintenance-confirmed','--offline'];
 const failed=await command(process.execPath,args);assert.equal(failed.status,1,failed.out);
 assert.equal(fingerprint(await inspect(db)),before);assert.equal(require('../ops/schema').sha(fs.readFileSync(envFile)),envHash);
 assert.equal(fs.realpathSync(path.join(root,'current')),old);
 assert.equal((await fetch('http://127.0.0.1:3101/health')).status,200);
});
test('full isolated apply backs up before migrating and preserves records, env and shared files',{skip:!enabled},async()=>{
 const original=fs.readFileSync(envFile);const originalUser=await db('users').first();const history=await db('crm_activity_history').first();
 const r=await cli('apply',['--maintenance-confirmed']);assert.equal(r.status,0,r.err);const result=JSON.parse(r.out);backup=result.backup;
 const dir=path.join(root,'backups',backup),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 assert.equal(manifest.phase,'healthy');assert.equal(manifest.backupComplete,true);assert.equal(manifest.migrationStarted,true);
 assert.ok(fs.statSync(path.join(dir,'database.sql')).size>0);assert.equal(fs.statSync(dir).mode&0o077,0);assert.equal(fs.statSync(path.join(dir,'database.sql')).mode&0o077,0);
 assert.deepEqual(fs.readFileSync(envFile),original);assert.equal(fs.realpathSync(path.join(result.release,'.env')),envFile);
 assert.equal((await db('crm_clients').first()).notes,'DO NOT OVERWRITE');assert.deepEqual(await db('users').first(),originalUser);assert.deepEqual(await db('crm_activity_history').first(),history);
 assert.equal(fs.readFileSync(path.join(result.release,'uploads','sentinel.txt'),'utf8'),'preserve runtime file');
 assert.equal(validate(await inspect(db),true).ok,true);
 const health=await (await fetch('http://127.0.0.1:3101/health')).json();assert.equal(health.release,revision);
});
test('one-way migration rollback is blocked until verified restore; damaged backups are rejected',{skip:!enabled},async()=>{
 const before=fingerprint(await inspect(db));let r=await cli('rollback',['--backup',backup,'--maintenance-confirmed']);assert.equal(r.status,1);assert.match(r.err,/Ühesuunalised/);assert.equal(fingerprint(await inspect(db)),before);
 const file=path.join(root,'backups',backup,'database.sql'),original=fs.readFileSync(file);fs.appendFileSync(file,'\n-- tampered test\n');
 try{r=await cli('restore-empty',['--backup',backup],database.settings(restoredEnv,'127.0.0.1','ellington_test_restore'));assert.equal(r.status,1);assert.match(r.err,/kontrollsumma/);}finally{fs.writeFileSync(file,original);}
});
test('SQL restore goes only to an empty alternate DB, then restores old code without touching original env',{skip:!enabled},async()=>{
 const target=database.settings(restoredEnv,'127.0.0.1','ellington_test_restore');const originalEnv=fs.readFileSync(envFile);
 let r=await cli('restore-empty',['--backup',backup],target);assert.equal(r.status,0,r.err);
 r=await cli('restore-empty',['--backup',backup],target);assert.equal(r.status,1);assert.match(r.err,/täiesti tühi/);
 r=await cli('rollback',['--backup',backup,'--maintenance-confirmed','--restored'],target);assert.equal(r.status,0,r.err);
 const restoreDb=database.connect(target);try{
  assert.equal((await restoreDb('crm_clients').first()).notes,'DO NOT OVERWRITE');assert.equal((await inspect(restoreDb)).applied.length,0);
 }finally{await restoreDb.destroy();}
 assert.deepEqual(fs.readFileSync(envFile),originalEnv);const live=fs.realpathSync(path.join(root,'current'));assert.equal(fs.realpathSync(path.join(live,'.env')),restoredEnv);
 assert.equal(validate(await inspect(db),true).ok,true);assert.equal((await fetch('http://127.0.0.1:3101/health')).status,200);
});
test('startup failure rolls back code only without migrations, and leaves app stopped after migration start',{skip:!enabled},async()=>{
 const parent=fs.mkdtempSync(path.join(source,'work/deployment/failure-'));fs.chmodSync(parent,0o700);
 const failRoot=path.join(parent,'deploy'),legacy=path.join(parent,'legacy');fs.mkdirSync(failRoot,{mode:0o700});fs.mkdirSync(legacy,{mode:0o700});
 const archive=path.join(parent,'old.tar');sync('git',['archive','--format=tar','--output='+archive,'main']);sync('tar',['-xf',archive,'-C',legacy]);
 fs.symlinkSync(path.join(source,'node_modules'),path.join(legacy,'node_modules'));fs.symlinkSync(legacy,path.join(failRoot,'current'));
 const env={...options.env,PORT:'3102',ELLINGTON_TEST_PID:path.join(parent,'app.pid')};
 const file=path.join(legacy,'.env');fs.writeFileSync(file,Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});
 const failControl=path.join(parent,'fail-start.js');fs.writeFileSync(failControl,"if(process.argv[2]==='start'&&process.argv[3].includes('/releases/'))process.exit(1);require("+JSON.stringify(path.join(source,'ops/test-control.js'))+");\n");
 let r=await command(process.execPath,['ops/test-control.js','start',legacy],{...process.env,...env});assert.equal(r.status,0,r.err);
 async function invoke(action,control,more=[]){return command(process.execPath,['ops/deploy.js',action,'--env',file,'--host','127.0.0.1','--database',env.DB_NAME,'--root',failRoot,'--control',control,'--revision',revision,'--dump-command',path.resolve(process.env.DEPLOY_DUMP_COMMAND),'--offline','--maintenance-confirmed',...more]);}
 try{
  const before=fingerprint(await inspect(db));
  r=await invoke('apply',failControl);assert.equal(r.status,1);assert.equal(fs.realpathSync(path.join(failRoot,'current')),legacy);
  assert.equal(fingerprint(await inspect(db)),before);assert.equal((await fetch('http://127.0.0.1:3102/health')).status,200);
  const first=fs.readdirSync(path.join(failRoot,'backups'))[0],journal=JSON.parse(fs.readFileSync(path.join(failRoot,'backups',first,'manifest.json')));
  assert.equal(journal.migrationStarted,false);assert.equal(journal.phase,'old-code-restarted');
  r=await invoke('rollback',path.join(source,'ops/test-control.js'),['--backup',first]);assert.equal(r.status,0,r.err);
  assert.match(fs.realpathSync(path.join(failRoot,'current')),/-rollback$/);
  // Simulate a known, restartable pending v8 migration on the synthetic schema.
  await db('knex_migrations').where({name:'002_v8.js'}).delete();
  r=await invoke('apply',failControl);assert.equal(r.status,1);
  const last=fs.readdirSync(path.join(failRoot,'backups')).sort().at(-1),failed=JSON.parse(fs.readFileSync(path.join(failRoot,'backups',last,'manifest.json')));
  assert.equal(failed.migrationStarted,true);assert.equal(failed.phase,'failed');
  assert.equal(validate(await inspect(db),true).ok,true);
  await assert.rejects(fetch('http://127.0.0.1:3102/health',{signal:AbortSignal.timeout(2000)}));
  r=await invoke('rollback',path.join(source,'ops/test-control.js'),['--backup',last]);assert.equal(r.status,1);assert.match(r.err,/Ühesuunalised/);
 }finally{await command(process.execPath,['ops/test-control.js','stop',fs.realpathSync(path.join(failRoot,'current'))],{...process.env,...env});}
});
