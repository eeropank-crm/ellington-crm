const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {inspect,validate,fingerprint}=require('../ops/schema');
const transition=require('../ops/legacy-transition');const audit=require('../ops/data-audit');
const database=require('../ops/database');const profile=require('../ops/legacy-v8-profile.json');
const {describe}=require('../ops/schema-values');
const enabled=!!process.env.DEPLOY_TEST_ENV;let db,initial,fixture,activity;
const privateComment="synthetic private ' quote \\ and õ\nline";
const source=path.resolve(__dirname,'..');
async function rawSource(){
 const snapshot=await inspect(db);for(const t of snapshot.tables)await db.schema.dropTable(t.TABLE_NAME);
 for(const file of ['001_base','002_v8','003_v8_lookup_indexes'])await require('../database/migrations/'+file).up(db);
 for(const item of profile.columns){
  const a=item.actual;let sql=a.type+(a.charset?' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci':'')+(a.nullable==='YES'?' NULL':' NOT NULL');
  const d=a.default;
  if(d.kind==='null')sql+=' DEFAULT NULL';
  else if(d.kind==='number')sql+=' DEFAULT '+d.value;
  else if(d.kind==='current_timestamp')sql+=' DEFAULT CURRENT_TIMESTAMP';
  else if(d.kind==='string')sql+=" DEFAULT '"+(d.length===4?'SYN1':'fixture')+"'";
  if(a.extra)sql+=' '+a.extra;
  await db.raw('ALTER TABLE ?? MODIFY COLUMN ?? '+sql,[item.table,item.column]);
 }
 for(const lookup of require('../database/migrations/003_v8_lookup_indexes').lookups){
  const rows=await db('information_schema.statistics').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:lookup.table}).select('INDEX_NAME','COLUMN_NAME');
  const name=rows.find(i=>i.COLUMN_NAME===lookup.columns[0]).INDEX_NAME;
  await db.schema.alterTable(lookup.table,t=>t.dropIndex([],name));
 }
 await db.raw("ALTER TABLE crm_clients MODIFY COLUMN client_type varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'SYN1' COMMENT ?",[privateComment]);
}
before(async()=>{
 if(!enabled)return;
 const env=require('dotenv').parse(fs.readFileSync(process.env.DEPLOY_TEST_ENV));
 if(env.DB_HOST!=='127.0.0.1'||env.DB_PORT!=='3308'||env.DB_NAME!=='ellington_test_deploy')throw Error('Isolated test database only');
 db=database.connect(database.settings(process.env.DEPLOY_TEST_ENV,env.DB_HOST,env.DB_NAME));
 assert.match((await inspect(db)).version,/^11\.4\.13-MariaDB/);
 await rawSource();fixture=await require('../scripts/seed-test')(db);
 await db('crm_clients').where({id:fixture.client}).update({followup_count:2147483647,notes:'Preserve client ☃ and trailing spaces  '});
 [activity]=await db('crm_activities').insert({client_id:fixture.client,contact_id:null,owner_user_id:fixture.sales,type:'Kõne',status:'completed',due_date:'2026-01-01',notes:'Preserve activity result'});
 const long='synthetic õ'.repeat(9000);
 await db('crm_activity_details').insert({activity_id:activity,template_id:fixture.templates.Kõne,purpose:'Test Kõne',instructions:long,next_step_json:JSON.stringify({body:long})});
 await db('crm_v8_activity_events').insert({id:4294967295,activity_id:activity,user_id:fixture.sales,event_type:'completed',details:JSON.stringify({comment:long}),created_at:'2001-01-02 03:04:05'});
 const connection=await db.client.acquireConnection();const [[sqlMode]]=await db.raw('SELECT @@SESSION.sql_mode AS mode').connection(connection);
 try{await db.raw('SET SESSION sql_mode = ?',[sqlMode.mode+',NO_AUTO_VALUE_ON_ZERO']).connection(connection);await db('crm_v8_activity_events').insert({id:0,activity_id:activity,user_id:fixture.sales,event_type:'zero_id_preservation',details:'preserve zero PK',created_at:'2001-01-02 03:04:05'}).connection(connection);}
 finally{await db.raw('SET SESSION sql_mode = ?',[sqlMode.mode]).connection(connection);await db.client.releaseConnection(connection);}

 await db('crm_budget_change_log').insert({client_id:'9223372036854775807',user_id:fixture.sales,year:2026,before_annual:12.34,after_annual:56.78,reason:'Preserve budget audit',created_at:'2001-01-02 03:04:05'});
 const [transfer]=await db('crm_portfolio_transfers').insert({from_user_id:fixture.sales,to_user_id:fixture.admin,performed_by:fixture.admin,client_count:1,activity_count:1,created_at:'2001-01-02 03:04:05'});
 await db('crm_portfolio_transfer_items').insert({transfer_id:transfer,client_id:fixture.client,client_name:'Synthetic old owner history'});
 await db('crm_ionprint_sync_queue').insert({transfer_id:transfer,client_id:fixture.client,target_owner_user_id:fixture.admin,status:'awaiting_mapping',created_at:'2001-01-02 03:04:05'});
 const [outbox]=await db('crm_email_outbox').insert({activity_id:activity,client_id:fixture.client,contact_id:1,user_id:fixture.sales,sender:'sales@example.invalid',recipient:'contact@example.invalid',subject:'Preserve sent mail',body:long,message_id:'<synthetic@example.invalid>',status:'sent',smtp_response:'synthetic accepted',sent_at:'2001-01-02 03:04:05'});
 await db('crm_email_inbox').insert({id:4000000000,mailbox_user_id:fixture.sales,outbox_id:outbox,client_id:fixture.client,activity_id:activity,sender:'contact@example.invalid',recipient:'sales@example.invalid',subject:'Preserve reply',body:long,message_id:'<synthetic-reply@example.invalid>',received_at:'2001-01-02 03:04:05'});
 await db('crm_activity_history').insert({activity_id:activity,user_id:fixture.sales,event_type:'synthetic_preservation',details:'Preserve unchanged plain TEXT history'});
 await db('crm_templates').where({id:fixture.templates.Kõne}).update({next_step_json:JSON.stringify({body:long})});
 initial=await inspect(db);
});
after(async()=>{if(db)await db.destroy();});
test('provided profile covers all 52 production differences without guessing redacted strings',{skip:!enabled},async()=>{
 assert.equal(profile.columns.length,52);
 for(const item of profile.columns){const col=initial.columns.find(c=>c.TABLE_NAME===item.table&&c.COLUMN_NAME===item.column);assert.deepEqual(describe(col),item.actual,item.table+'.'+item.column);}
 assert.equal(validate(initial).ok,false);
 const proof=await transition.assess(db,initial);assert.equal(proof.ok,true);assert.equal(proof.changes.length,44);assert.equal(proof.checks.length,27);
 assert.equal(validate(initial,false,proof).ok,true);assert.equal(validate(initial,true,proof).ok,false);
 const env=require('dotenv').parse(fs.readFileSync(process.env.DEPLOY_TEST_ENV));
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 const result=await new Promise(resolve=>{const child=spawn(process.execPath,['ops/deploy.js','preflight','--env',path.resolve(process.env.DEPLOY_TEST_ENV),'--host',env.DB_HOST,'--database',env.DB_NAME,'--revision',revision,'--diagnostics'],{cwd:source,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',status=>resolve({status,out,err}));});
 assert.equal(result.status,0,result.err);const report=JSON.parse(result.out);assert.equal(report.ok,true);assert.equal(report.transition.changes.length,44);assert.equal(report.transition.checks.length,27);
 assert.equal(fingerprint(await inspect(db)),fingerprint(initial));
});
test('negative signed values block every DDL and never get clamped',{skip:!enabled},async()=>{
 await db('crm_clients').where({id:fixture.client}).update({followup_count:-1});const before=await inspect(db);
 try{
  const proof=await transition.assess(db,before);assert.equal(proof.ok,false);assert.equal(validate(before,false,proof).ok,false);
  await assert.rejects(transition.perform(db),/negative/);
  assert.equal(fingerprint(await inspect(db)),fingerprint(before));assert.equal((await db('crm_clients').where({id:fixture.client}).first()).followup_count,-1);
 }finally{await db('crm_clients').where({id:fixture.client}).update({followup_count:2147483647});}
});
test('unknown NULL history dates block instead of inventing timestamps',{skip:!enabled},async()=>{
 await db('crm_v8_activity_events').where({id:4294967295}).update({created_at:null});const before=await inspect(db);
 try{await assert.rejects(transition.perform(db),/null/);assert.equal(fingerprint(await inspect(db)),fingerprint(before));assert.equal((await db('crm_v8_activity_events').where({id:4294967295}).first()).created_at,null);}
 finally{await db('crm_v8_activity_events').where({id:4294967295}).update({created_at:'2001-01-02 03:04:05'});}
});
test('zero timestamps block before DDL and are never replaced with today',{skip:!enabled},async()=>{
 const connection=await db.client.acquireConnection();
 const [[mode]]=await db.raw('SELECT @@SESSION.sql_mode AS original_mode').connection(connection);
 try{await db.raw("SET SESSION sql_mode = ''").connection(connection);await db.raw("UPDATE crm_v8_activity_events SET created_at = '0000-00-00 00:00:00' WHERE id = 4294967295").connection(connection);}
 finally{await db.raw('SET SESSION sql_mode = ?',[mode.original_mode]).connection(connection);await db.client.releaseConnection(connection);}
 const before=await inspect(db);
 try{await assert.rejects(transition.perform(db),/zero_timestamp/);assert.equal(fingerprint(await inspect(db)),fingerprint(before));}
 finally{await db('crm_v8_activity_events').where({id:4294967295}).update({created_at:'2001-01-02 03:04:05'});}
});
test('unrecognized source width is not silently treated as an approved transition',{skip:!enabled},async()=>{
 await db.raw('ALTER TABLE crm_templates MODIFY COLUMN external_key varchar(119) NULL');
 try{const snapshot=await inspect(db),proof=await transition.assess(db,snapshot);assert.equal(validate(snapshot,false,proof).ok,false);}
 finally{await db.raw('ALTER TABLE crm_templates MODIFY COLUMN external_key varchar(120) NULL');}
});
test('all forward migrations preserve exact original records, large texts, comments and counters',{skip:!enabled},async()=>{
 const before=await inspect(db),evidence=await audit.capture(db,before,{allowDefaultReasons:true});
 const auto=await db('information_schema.tables').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:'crm_v8_activity_events'}).select(db.raw('CAST(AUTO_INCREMENT AS CHAR) AS next_value')).first();
 await db.migrate.latest({directory:path.join(source,'database/migrations')});
 const after=await inspect(db);assert.equal(validate(after,true).ok,true);
 await audit.verify(db,after,evidence);
 const column=await db('information_schema.columns').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:'crm_clients',COLUMN_NAME:'client_type'}).first();
 assert.equal(column.COLLATION_NAME,'utf8mb4_bin');assert.equal(column.COLUMN_COMMENT,privateComment);
 const next=await db('information_schema.tables').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:'crm_v8_activity_events'}).select(db.raw('CAST(AUTO_INCREMENT AS CHAR) AS next_value')).first();assert.ok(BigInt(next.next_value)>=BigInt(auto.next_value));
 for(const item of profile.columns.filter(c=>/^(longtext|mediumtext)$/.test(c.actual.type))){assert.equal(after.columns.find(c=>c.TABLE_NAME===item.table&&c.COLUMN_NAME===item.column).COLUMN_TYPE,item.actual.type);}
 const final=fingerprint(after);await transition.perform(db);assert.equal(fingerprint(await inspect(db)),final);await audit.verify(db,await inspect(db),evidence);
});
test('new defaults change future omission only and content audit detects real edits',{skip:!enabled},async()=>{
 const current=await inspect(db),evidence=await audit.capture(db,current);
 const [id]=await db('crm_clients').insert({name:'Synthetic new default',owner_user_id:fixture.sales});
 assert.equal((await db('crm_clients').where({id}).first()).client_type,null);
 await db('crm_clients').where({id}).delete();
 await db('crm_clients').where({id:fixture.client}).update({notes:'Synthetic deliberate changed content'});
 await assert.rejects(audit.verify(db,await inspect(db),evidence),/sisu muutus/);
});
