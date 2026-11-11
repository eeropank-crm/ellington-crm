'use strict';
const w=require('./activity-workflow'),format=require('../../public/mail-signatures');
async function read(db,id){const row=await db('crm_user_mail_settings').where({user_id:id}).first();return {signature:row?.signature||'',version:row?.version||0};}
function validate(value){if(typeof value!=='string'||value.length>3000||Buffer.byteLength(value,'utf8')>12000||/\u0000/.test(value))throw new w.WorkflowError(400,'Allkiri peab olema tekst pikkusega kuni 3000 märki.');return format.text(value);}
async function save(db,actor,id,x){
 if(!Number.isSafeInteger(id)||id<1||Object.keys(x).some(k=>!['signature','version'].includes(k))||!Number.isSafeInteger(x.version)||x.version<0)throw new w.WorkflowError(400,'Vigane allkirja salvestamise päring.');
 const signature=validate(x.signature);
 return db.transaction(async trx=>{
  const users=await trx('users').whereIn('id',[...new Set([Number(actor.id),id])]).orderBy('id').forUpdate().select('id','role','is_active');
  const current=users.find(u=>Number(u.id)===Number(actor.id)),target=users.find(u=>Number(u.id)===id);
  if(!current||!current.is_active||!target||Number(actor.id)!==id&&(actor.role!=='admin'||current.role!=='admin'))throw new w.WorkflowError(403,'Allkirja muutmise õigus puudub.');
  const row=await trx('crm_user_mail_settings').where({user_id:id}).first();
  if((row?.version||0)!==x.version)throw new w.WorkflowError(409,'Allkiri on vahepeal muutunud. Ava allkirja seaded uuesti.');
  const version=x.version+1;
  if(row)await trx('crm_user_mail_settings').where({user_id:id}).update({signature,version,updated_at:trx.fn.now()});
  else await trx('crm_user_mail_settings').insert({user_id:id,signature,version});
  return {signature,version};
 });
}
module.exports={read,save,validate,format};
