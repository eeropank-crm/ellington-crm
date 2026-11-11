'use strict';
const w=require('./activity-workflow');
const PURPOSE='Tänud tagasiside eest';
// Opening a reply is resumable work, not acknowledgement and not a send.
async function draft(trx,user,id){
 if(!Number.isSafeInteger(id)||id<1)throw new w.WorkflowError(400,'Vigane vastus.');
 const ref=await trx('crm_email_inbox').where({id}).first('client_id');
 if(!ref)throw new w.WorkflowError(404,'Vastust ei leitud.');
 const client=await w.lockClient(trx,ref.client_id,user);
 const reply=await trx('crm_email_inbox').where({id}).forUpdate().first();
 if(Number(reply.mailbox_user_id)!==Number(user.id))throw new w.WorkflowError(403,'Vastus kuulub teise kasutaja postkasti.');
 if(reply.handled_at||client.stop_reason)throw new w.WorkflowError(409,'Vastus on juba käsitletud või kliendi jälgimine lõpetatud.');
 const events=await trx('crm_v8_activity_events as e').join('crm_activities as a','a.id','e.activity_id').where({'a.client_id':client.id,'e.event_type':'created_customer_reply'}).forUpdate().select('e.activity_id','e.details','a.owner_user_id','a.status');
 const prior=events.find(e=>Number(w.parse(e.details).reply_id)===id);
 if(prior){if(Number(prior.owner_user_id)!==Number(user.id)||prior.status!=='active')throw new w.WorkflowError(409,'Vastamise tegevus on juba muutunud. Kontrolli kliendikaarti.');return {id:Number(prior.activity_id),resumed:true};}
 const original=await trx('crm_email_outbox').where({id:reply.outbox_id,client_id:client.id,user_id:user.id,status:'sent'}).first();
 const contact=original&&await trx('crm_contacts').where({id:original.contact_id,client_id:client.id}).first();
 if(!contact)throw new w.WorkflowError(409,'Vastusega seotud kontaktisik puudub. Kontrolli kliendikaarti.');
 const template=await trx('crm_templates').where({type:'E-kiri',is_active:1}).where(q=>q.where({purpose:PURPOSE}).orWhere({name:PURPOSE})).orderBy('id').first();
 const subject=(/^re:/i.test(reply.subject||'')?reply.subject:'Re: '+(reply.subject||original.subject)).slice(0,500);
 const body=w.text(template?.body?.trim()||'Tere!\n\nTänud tagasiside eest!\n\nParimat',10000,'vastuskirja sisu',1);
 const [activity]=await trx('crm_activities').insert({client_id:client.id,contact_id:contact.id,owner_user_id:user.id,type:'E-kiri',status:'active',due_date:w.today(),sequence_number:Number(client.followup_count||0)+1});
 await trx('crm_activity_details').insert({activity_id:activity,template_id:null,purpose:PURPOSE,subject,instructions:body,next_step_json:null});
 await w.event(trx,activity,user,'created_customer_reply',{reply_id:id,embedded_template:true});
 return {id:activity,resumed:false};
}
module.exports={draft,PURPOSE};
