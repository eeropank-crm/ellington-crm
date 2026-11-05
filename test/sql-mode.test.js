const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const mode=require('../ops/sql-mode'),database=require('../ops/database');
const baseline='IGNORE_SPACE,NO_AUTO_CREATE_USER';
const sorted=x=>mode.flags(x).sort();
const enabled=!!process.env.DEPLOY_TEST_ENV;
function config(){
 const env=require('dotenv').parse(fs.readFileSync(process.env.DEPLOY_TEST_ENV));
 assert.equal(env.DB_HOST,'127.0.0.1');assert.equal(env.DB_NAME,'ellington_test_deploy');assert.equal(env.DB_PORT,'3308');
 return database.settings(process.env.DEPLOY_TEST_ENV,env.DB_HOST,env.DB_NAME);
}
const query=(connection,sql,params=[])=>new Promise((resolve,reject)=>connection.query(sql,params,(e,rows)=>e?reject(e):resolve(rows)));
test('strict composition adds only the needed flag and preserves STRICT_ALL_TABLES',()=>{
 assert.deepEqual(sorted(mode.required(baseline)),sorted(baseline+',STRICT_TRANS_TABLES'));
 assert.equal(mode.required('IGNORE_SPACE,STRICT_ALL_TABLES'),'IGNORE_SPACE,STRICT_ALL_TABLES');
 assert.deepEqual(sorted(mode.required('STRICT_ALL_TABLES,NO_ZERO_DATE',['NO_BACKSLASH_ESCAPES'])),sorted('STRICT_ALL_TABLES,NO_ZERO_DATE,NO_BACKSLASH_ESCAPES'));
});
test('failed strict-mode verification rejects and discards the physical connection',async()=>{
 let destroyed=false;
 const connection={query(sql,bindings,callback){callback(null,sql.startsWith('SELECT')?[{sql_mode:baseline}]:{});},destroy(){destroyed=true;}};
 const error=await new Promise(resolve=>mode.afterCreate(connection,resolve));
 assert.ok(error);assert.equal(destroyed,true);assert.match(error.message,/range SQL-režiimi/);
});
test('physical pool connections are strict before use and restore original modes before closing',{skip:!enabled},async()=>{
 const db=database.connect(config()),acquire=db.client.acquireRawConnection.bind(db.client);const ended=[];
 db.client.acquireRawConnection=async()=>{
  const connection=await acquire();await query(connection,'SET SESSION sql_mode = ?',[baseline]);
  const end=connection.end.bind(connection);
  connection.end=callback=>{query(connection,'SELECT @@SESSION.sql_mode AS mode').then(rows=>{ended.push(rows[0].mode);end(callback);},error=>end(()=>callback(error)));};
  return connection;
 };
 let first,second,globalBefore;
 try{
  [first,second]=await Promise.all([db.client.acquireConnection(),db.client.acquireConnection()]);assert.notEqual(first.threadId,second.threadId);
  for(const c of [first,second]){const [row]=await query(c,'SELECT @@SESSION.sql_mode AS mode, @@GLOBAL.sql_mode AS global_mode');assert.deepEqual(sorted(row.mode),sorted(mode.required(baseline)));globalBefore=row.global_mode;}
  await db.client.releaseConnection(first);first=null;
  await mode.withConnection(db,async(connection,state)=>{
   assert.equal(state.original,baseline);assert.ok(mode.hasStrict(state.effective));
   const [row]=await query(connection,'SELECT @@SESSION.sql_mode AS mode');assert.ok(mode.flags(row.mode).includes('NO_AUTO_VALUE_ON_ZERO'));
  },['NO_BACKSLASH_ESCAPES','NO_AUTO_VALUE_ON_ZERO']);
  await db.client.releaseConnection(second);second=null;
  const [[row]]=await db.raw('SELECT @@GLOBAL.sql_mode AS mode');assert.equal(row.mode,globalBefore);
 }finally{if(first)await db.client.releaseConnection(first);if(second)await db.client.releaseConnection(second);await db.destroy();}
 assert.equal(ended.length,2);for(const value of ended)assert.deepEqual(sorted(value),sorted(baseline));
});
test('unmanaged 004 connection scope restores non-strict mode on success and failure without DDL',{skip:!enabled},async()=>{
 const db=require('knex')({client:'mysql2',connection:config().connection,pool:{min:0,max:1}});
 const connection=await db.client.acquireConnection();await query(connection,'SET SESSION sql_mode = ?',[baseline]);await db.client.releaseConnection(connection);
 try{
  const [[before]]=await db.raw('SELECT @@GLOBAL.sql_mode AS global_mode');
  for(const failure of [false,true]){
   const work=()=>mode.withConnection(db,async(c,state)=>{
    assert.equal(state.original,baseline);const [row]=await query(c,'SELECT @@SESSION.sql_mode AS mode');assert.ok(mode.hasStrict(row.mode));assert.ok(mode.flags(row.mode).includes('IGNORE_SPACE'));
    if(failure)throw Error('synthetic failure');
   },['NO_BACKSLASH_ESCAPES','NO_AUTO_VALUE_ON_ZERO']);
   if(failure)await assert.rejects(work(),/synthetic failure/);else await work();
   const [[after]]=await db.raw('SELECT @@SESSION.sql_mode AS mode, @@GLOBAL.sql_mode AS global_mode');assert.deepEqual(sorted(after.mode),sorted(baseline));assert.equal(after.global_mode,before.global_mode);
  }
 }finally{await db.destroy();}
});
test('preflight --diagnostics succeeds with non-strict physical sessions and only session-local mode changes',{skip:!enabled},async()=>{
 const c=config(),root=path.resolve(__dirname,'..'),revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const verifier=require('knex')({client:'mysql2',connection:c.connection,pool:{min:0,max:1}});
 const schema=require('../ops/schema'),audit=require('../ops/data-audit');
 const before=await schema.inspect(verifier),contents=await audit.capture(verifier,before);
 try{
 const result=await new Promise(resolve=>{
  const child=spawn(process.execPath,['--require',path.join(__dirname,'fixtures/non-strict-mysql.js'),'ops/deploy.js','preflight','--env',c.envPath,'--host',c.env.DB_HOST,'--database',c.env.DB_NAME,'--revision',revision,'--diagnostics'],{cwd:root,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',status=>resolve({status,out,err}));
 });
 assert.equal(result.status,0,result.err);const resultJson=JSON.parse(result.out);assert.equal(resultJson.ok,true);
 const sql=resultJson.transition.sqlMode;assert.deepEqual(sorted(sql.original),sorted(baseline));assert.deepEqual(sorted(sql.effective),sorted(mode.required(baseline)));assert.equal(sql.globalChanged,false);assert.equal(sql.scope,'SESSION');
 const after=await schema.inspect(verifier);assert.equal(schema.fingerprint(after),schema.fingerprint(before));await audit.verify(verifier,after,contents);
 }finally{await verifier.destroy();}
});
