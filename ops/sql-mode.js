'use strict';
const originals=new WeakMap();
const flags=mode=>String(mode).split(',').map(x=>x.trim()).filter(Boolean);
const hasStrict=mode=>flags(mode).some(x=>x==='STRICT_TRANS_TABLES'||x==='STRICT_ALL_TABLES');
function required(mode,extras=[]){
 const result=new Set(flags(mode));
 if(!hasStrict(mode))result.add('STRICT_TRANS_TABLES');
 for(const flag of extras)result.add(flag);
 return [...result].join(',');
}
const query=(connection,sql,bindings=[])=>new Promise((resolve,reject)=>connection.query(sql,bindings,(error,rows)=>error?reject(error):resolve(rows)));
async function enter(connection,extras=[]){
 const [row]=await query(connection,'SELECT @@SESSION.sql_mode AS sql_mode');
 const state={original:row.sql_mode,effective:required(row.sql_mode,extras)};
 try{
  if(state.effective!==state.original)await query(connection,'SET SESSION sql_mode = ?',[state.effective]);
  const [actual]=await query(connection,'SELECT @@SESSION.sql_mode AS sql_mode');
  if(!hasStrict(actual.sql_mode)||!flags(state.effective).every(x=>flags(actual.sql_mode).includes(x)))throw Error('SQL mode verification failed');
  state.effective=actual.sql_mode;return state;
 }catch{
  try{await query(connection,'SET SESSION sql_mode = ?',[state.original]);}catch{}
  throw Error('Ühenduse range SQL-režiimi seadistamine ebaõnnestus.');
 }
}
async function restore(connection,state){
 await query(connection,'SET SESSION sql_mode = ?',[state.original]);
 const [actual]=await query(connection,'SELECT @@SESSION.sql_mode AS sql_mode');
 if(flags(actual.sql_mode).sort().join(',')!==flags(state.original).sort().join(','))throw Error('Ühenduse algse SQL-režiimi taastamine ebaõnnestus.');
}
async function withConnection(db,work,extras=[]){
 const connection=await db.client.acquireConnection();let state;
 try{
  state=await enter(connection,extras);
  return await work(connection,{...state,original:originals.get(connection)?.original??state.original});
 }catch(error){
  if(!state){connection.__knex__disposed='SQL mode initialization failed';connection.destroy();}
  throw error;
 }finally{
  try{if(state)await restore(connection,state);}
  catch(error){connection.__knex__disposed='SQL mode restoration failed';connection.destroy();throw error;}
  finally{await db.client.releaseConnection(connection);}
 }
}
function afterCreate(connection,done){
 enter(connection).then(state=>{originals.set(connection,state);done(null,connection);},error=>{connection.destroy();done(error);});
}
function restoreOnDestroy(db){
 // Knex 3.3 / Tarn invokes destroyRawConnection for every pooled physical connection.
 const destroy=db.client.destroyRawConnection.bind(db.client);
 db.client.destroyRawConnection=async connection=>{
  try{
   const state=originals.get(connection);
   if(state&&!connection.__knex__disposed)await restore(connection,state);
  }finally{originals.delete(connection);await destroy(connection);}
 };
 return db;
}
module.exports={flags,hasStrict,required,enter,restore,withConnection,afterCreate,restoreOnDestroy};
