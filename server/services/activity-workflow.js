'use strict';
// A completion and its default follow-up are committed together. Selecting a
// different next step never completes the original activity a second time.
const TYPES = ['Kõne', 'E-kiri', 'Kohtumine'];
const crypto = require('node:crypto');
class WorkflowError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new WorkflowError(status, message); };
const today = (now=new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Tallinn', year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
const dateOnly = x => x instanceof Date ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Tallinn',year:'numeric',month:'2-digit',day:'2-digit'}).format(x) : String(x).slice(0,10);
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
const text = (v, max, label, min=0) => { if (v==null) v=''; if(typeof v!=='string'||v.trim().length<min||v.trim().length>max) fail(400,'Kontrolli välja: '+label+'.'); return v.trim(); };
const parse = s => { try { return typeof s === 'object' && s !== null ? s : JSON.parse(s || '{}'); } catch { return {}; } };
const event = (trx,id,user,type,details) => trx('crm_v8_activity_events').insert({activity_id:id,user_id:user.id,event_type:type,details:JSON.stringify(details)});
const allowed = (user,c) => { if(Number(c.owner_user_id)!==Number(user.id)) fail(403,'Klient ei kuulu sinu portfelli.'); };
async function lockClient(trx,id,user) { const c=await trx('crm_clients').where({id}).forUpdate().first(); if(!c) fail(404,'Klienti ei leitud.'); allowed(user,c); return c; }
async function lockActivity(trx,id,user) {
  const ref=await trx('crm_activities').where({id}).first('client_id'); if(!ref) fail(404,'Tegevust ei leitud.');
  const client=await lockClient(trx,ref.client_id,user);
  const activity=await trx('crm_activities').where({id}).forUpdate().first();
  if(Number(activity.owner_user_id)!==Number(user.id)) fail(403,'Tegevus ei kuulu sulle.');
  return {activity,client};
}
async function validateReplies(trx,clientId,ids) {
  if(ids==null) return [];
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length) fail(400,'Vigased vastuste viited.');
  if(!ids.length) return [];
  const rows=await trx('crm_email_inbox').whereIn('id',ids).where({client_id:clientId}).forUpdate().select('*');
  if(rows.length!==ids.length) fail(400,'Vastus ei kuulu sellele kliendile.');
  return rows;
}
async function replies(trx,clientId,ids,user,activityId,action,note='') {
  const rows=await validateReplies(trx,clientId,ids);
  if(rows.some(r=>!r.handled_at)){
    const bound=activityId&&await replyContext(trx,activityId);
    const sent=bound&&await trx('crm_email_outbox').where({activity_id:activityId,client_id:clientId,status:'sent'}).first('id');
    if(action!=='completed'||!sent||rows.length!==1||Number(bound.id)!==Number(rows[0].id))fail(409,'Kliendi vastus märgitakse käsitletuks alles pärast seotud vastuskirja edukat saatmist.');
  }
  for(const r of rows) if(!r.handled_at) {
    await trx('crm_email_inbox').where({id:r.id}).update({handled_at:trx.fn.now()});
    await event(trx,activityId||r.activity_id,user,'reply_handled',{reply_id:r.id,action,note});
  }
}
async function planned(trx,x) {
  if(!TYPES.includes(x.type)||!validDate(x.due_date)||x.due_date<today()) fail(400,'Vali tegevuse tüüp ja tänane või tulevane kuupäev.');
  const purpose=text(x.purpose,200,'eesmärk',1), instructions=text(x.instructions,10000,'juhis'), subject=text(x.subject,500,'pealkiri');
  if(x.type==='E-kiri'&&(!subject||!instructions)) fail(400,'E-kirjal peab olema pealkiri ja sisu.');
  const tpl=await trx('crm_templates').where({id:Number(x.template_id)||0,is_active:1,type:x.type}).first();
  if(!tpl||purpose!==(tpl.purpose||tpl.name)) fail(400,'Vali eesmärk olemasolevast rippmenüüst.');
  return {purpose,instructions,subject,template_id:tpl.id,next_step_json:tpl.next_step_json||null};
}
async function completionEvent(trx,id) { return trx('crm_v8_activity_events').where({activity_id:id}).whereIn('event_type',['completed_default_followup','completed','completed_and_stopped']).orderBy('id','desc').first(); }
function chain(value,depth=0) {
  if(value==null||value==='') return null;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{fail(400,'Malli järeltegevuste ahel vajab parandamist.');}}
  if(value==null) return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||depth>=20||!TYPES.includes(value.type)) fail(400,'Malli järeltegevuste ahel vajab parandamist.');
  const days=Number(value.days);
  if(!Number.isInteger(days)||days<1||days>3650) fail(400,'Kontrolli malli järeltegevuse tööpäevade arvu.');
  const purpose=text(value.purpose,200,'järeltegevuse eesmärk',1),subject=text(value.subject,500,'järelkirja pealkiri'),body=text(value.body,10000,'järeltegevuse sisu');
  if(value.type==='E-kiri'&&(!subject||!body)) fail(400,'Malli järelkirjal peab olema pealkiri ja sisu.');
  return {type:value.type,purpose,subject:value.type==='E-kiri'?subject:'',body,days,nextStep:chain(value.nextStep,depth+1)};
}
function businessDate(day,days) {
  if(!validDate(day)||!Number.isInteger(days)||days<1||days>3650) fail(400,'Vigane järeltegevuse tähtaeg.');
  const d=new Date(day+'T12:00:00Z');
  for(let left=days;left>0;){d.setUTCDate(d.getUTCDate()+1);if(![0,6].includes(d.getUTCDay()))left--;}
  return d.toISOString().slice(0,10);
}
async function replyContext(trx,id) {
 const e=await trx('crm_v8_activity_events').where({activity_id:id,event_type:'created_customer_reply'}).first('details');
 if(!e)return null;
 const reply=await trx('crm_email_inbox').where({id:Number(parse(e.details).reply_id)||0}).first();
 if(!reply)fail(409,'Vastuse algne kiri puudub.');
 return reply;
}
async function embedded(trx,id,d) {
  if(!d||d.template_id!=null) return false;
  const created=await trx('crm_v8_activity_events').where({activity_id:id}).whereIn('event_type',['created_default_followup','created_customer_reply']).forUpdate().first('details');
  return parse(created?.details).embedded_template===true;
}
async function followupPlan(trx,a,d,day=today()) {
  if(await replyContext(trx,a.id)){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+14);return {source:'reply_wait',type:'Kõne',due_date:date.toISOString().slice(0,10),template_id:null,purpose:'Kontroll pärast vastust',instructions:'Kontrolli kliendiga suhtluse jätkamist.',subject:'',next_step_json:null,embedded_template:false};}
  let raw=d?.next_step_json;
  // Previously created root activities may predate the template's chain.
  if(!raw&&d?.template_id){const t=await trx('crm_templates').where({id:d.template_id,is_active:1}).first('next_step_json');raw=t?.next_step_json;}
  const step=chain(raw);
  if(step) return {source:'template',type:step.type,due_date:businessDate(day,step.days),template_id:null,purpose:step.purpose,subject:step.subject,instructions:step.body,next_step_json:step.nextStep?JSON.stringify(step.nextStep):null,embedded_template:true};
  const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+14);
  return {source:'fallback',type:a.type,due_date:date.toISOString().slice(0,10),template_id:d?.template_id||null,purpose:d?.purpose||'Kontroll',instructions:d?.instructions||'',subject:d?.subject||'',next_step_json:null,embedded_template:await embedded(trx,a.id,d)};
}
async function complete(trx,id,user,x={}) {
  const {activity:a,client:c}=await lockActivity(trx,id,user);
  if(a.status!=='active') {
    const e=await completionEvent(trx,id); if(e) return {completed:true,already_completed:true,...parse(e.details)};
    fail(409,'Tegevus ei ole aktiivne.');
  }
  if(c.stop_reason) fail(409,'Kliendi jälgimine on lõpetatud.');
  if(!TYPES.includes(a.type)) fail(400,'Tundmatu tegevuse tüüp.');
  let outcome=x.outcome||'done', comment=text(x.comment,5000,'tulemus');
  if(a.type==='Kõne') { if(outcome!=='done') fail(400,'Kõne lõpetamiseks salvesta tulemus; edasilükkamiseks kasuta eraldi toimingut.'); if(!comment) fail(400,'Kirjuta kõne tulemus.'); }
  if(a.type==='Kohtumine') {
    if(dateOnly(a.due_date)>today()) fail(409,'Kohtumise tulemust saab märkida alates planeeritud kuupäevast.');
    if(!['done','cancelled'].includes(x.outcome)||comment.length<5) fail(400,'Vali kohtumise tulemus ja kirjuta vähemalt 5 märgi pikkune kommentaar.');
  }
  let sent;
  if(a.type==='E-kiri') {
    sent=await trx('crm_email_outbox').where({activity_id:id,status:'sent'}).first();
    if(!sent) fail(409,'E-kirja edukas saatmine pole kinnitatud.');
    outcome='done'; comment='Saadetud e-kiri: '+sent.subject+'\nSaaja: '+sent.recipient+'\n\n'+sent.body;
  }
  const d=await trx('crm_activity_details').where({activity_id:id}).first();
  const next=await followupPlan(trx,a,d),due=next.due_date;
  await trx('crm_activities').where({id}).update({status:'completed',updated_at:trx.fn.now()});
  const performed=outcome==='done';
  if(performed) await trx('crm_clients').where({id:c.id}).update({followup_count:trx.raw('COALESCE(followup_count, 0) + 1'),updated_at:trx.fn.now()});
  const [nextId]=await trx('crm_activities').insert({client_id:c.id,contact_id:sent?.contact_id||a.contact_id,owner_user_id:c.owner_user_id,type:next.type,status:'active',due_date:due,notes:next.source==='template'?next.instructions.slice(0,5000)||null:a.notes,sequence_number:Number(a.sequence_number||0)+(performed?1:0)});
  await trx('crm_activity_details').insert({activity_id:nextId,template_id:next.template_id,purpose:next.purpose,instructions:next.instructions,subject:next.subject,next_step_json:next.next_step_json});
  const details={outcome,comment,next_activity_id:nextId,due_date:due,default_followup:true,followup_source:next.source,followup:{type:next.type,purpose:next.purpose,subject:next.subject,instructions:next.instructions}};
  await event(trx,id,user,'completed_default_followup',details);
  await event(trx,nextId,user,'created_default_followup',{previous_activity_id:id,followup_source:next.source,embedded_template:next.embedded_template});
  const reply=await replyContext(trx,id);
  await replies(trx,c.id,reply?[Number(reply.id)]:x.reply_ids,user,id,'completed');
  return {completed:true,...details};
}
async function stop(trx,clientId,user,reason,replyIds) {
  const c=await lockClient(trx,clientId,user); reason=text(reason,1000,'lõpetamise põhjus',5);
  if(c.stop_reason) return {stopped:true,already_stopped:true};
  const activities=await trx('crm_activities').where({client_id:clientId,status:'active'}).orderBy('id').forUpdate().select('*');
  if(activities.some(a => Number(a.owner_user_id) !== Number(user.id))) fail(403,'Kliendil on teisele töötajale kuuluv tegevus.');
  if(activities.length) {
    const sending=await trx('crm_email_outbox').whereIn('activity_id',activities.map(a=>a.id)).whereIn('status',['sending','uncertain','sent']).first();
    if(sending) fail(409,'Kliendil on kinnitamist vajav e-kirja saatmine. Kontrolli selle tegevuse saatmisolekut enne jälgimise lõpetamist.');
  }
  await trx('crm_clients').where({id:clientId}).update({stop_reason:reason,updated_at:trx.fn.now()});
  for(const a of activities) {
    await trx('crm_activities').where({id:a.id}).update({status:'stopped',updated_at:trx.fn.now()});
    await event(trx,a.id,user,'monitoring_stopped',{reason});
  }
  await replies(trx,clientId,replyIds,user,null,'stopped',reason);
  return {stopped:true,stopped_activities:activities.length};
}
async function selectNext(trx,id,user,x={}) {
  const {activity:a,client:c}=await lockActivity(trx,id,user);
  if(a.status!=='completed') fail(409,'Lõpeta kõigepealt tegevus.');
  const e=await completionEvent(trx,id); const completion=parse(e?.details); const nextId=Number(completion.next_activity_id);
  if(!nextId) fail(409,'Sellel varasemal tegevusel puudub muudetav vaikimisi järeltegevus.');
  if(!['plan','stop','default'].includes(x.next)) fail(400,'Vali järgmine samm.');
  const selection=JSON.stringify({next:x.next,planned:x.planned||null,reason_id:x.reason_id||null,reason_other:x.reason_other||''});
  const prior=await trx('crm_v8_activity_events').where({activity_id:id,event_type:'next_step_selected'}).first();
  if(prior) { if(parse(prior.details).selection===selection) return {ok:true,already_selected:true,next_activity_id:nextId}; fail(409,'Järgmine samm on juba kinnitatud. Ava kehtiv tegevus kliendikaardilt.'); }
  if(x.next==='default') return {ok:true,next_activity_id:nextId};
  if(c.stop_reason) fail(409,'Kliendi jälgimine on lõpetatud.');
  const n=await trx('crm_activities').where({id:nextId,client_id:c.id}).forUpdate().first();
  const changed=await trx('crm_v8_activity_events').where({activity_id:nextId}).whereNotIn('event_type',['created_default_followup']).first();
  if(!n||n.status!=='active'||changed) fail(409,'Järeltegevust on juba muudetud või klient on vastanud. Värskenda vaadet.');
  if(x.next==='plan') {
    const values=await planned(trx,x.planned||{});
    await trx('crm_activities').where({id:nextId}).update({type:x.planned.type,due_date:x.planned.due_date,notes:values.instructions.slice(0,5000)||null,updated_at:trx.fn.now()});
    await trx('crm_activity_details').where({activity_id:nextId}).update(values);
    await event(trx,nextId,user,'next_step_planned',{previous_activity_id:id});
  } else {
    const r=await trx('crm_v8_stop_reasons').where({id:Number(x.reason_id)||0,is_active:1}).first();
    if(!r) fail(400,'Vali lõpetamise põhjus.');
    const other=text(x.reason_other,1000,'põhjuse täpsustus',r.label==='Muu põhjus'?5:0);
    await stop(trx,c.id,user,r.label==='Muu põhjus'?r.label+': '+other:r.label,x.reply_ids);
  }
  await event(trx,id,user,'next_step_selected',{selection,next_activity_id:nextId,next:x.next});
  return {ok:true,next_activity_id:nextId,stopped:x.next==='stop'};
}
async function postpone(trx,id,user,x) {
  const {activity:a,client:c}=await lockActivity(trx,id,user);
  if(a.status!=='active'||c.stop_reason) fail(409,'Tegevus pole aktiivne.');
  if(!validDate(x.new_date)||x.new_date<=today()||x.new_date<=dateOnly(a.due_date)) fail(400,'Vali tänasest ja senisest tähtajast hilisem kuupäev.');
  if(await trx('crm_email_outbox').where({activity_id:id}).first()) fail(409,'Saatmine on registreeritud. Tegevust ei saa edasi lükata.');
  await trx('crm_activities').where({id}).update({due_date:x.new_date,updated_at:trx.fn.now()});
  await event(trx,id,user,'postponed',{from:dateOnly(a.due_date),to:x.new_date});
  return {postponed:true,due_date:x.new_date};
}
async function create(trx,user,x) {
  if(!Number.isSafeInteger(x.client_id)||x.client_id<1) fail(400,'Vigane klient.');
  const c=await lockClient(trx,x.client_id,user); if(c.stop_reason||!c.owner_user_id) fail(409,'Kliendi jälgimine on lõpetatud või vastutaja puudub.');
  const values=await planned(trx,x);
  if(x.contact_id!=null&&(!Number.isSafeInteger(x.contact_id)||!(await trx('crm_contacts').where({id:x.contact_id,client_id:c.id}).first()))) fail(400,'Vigane kontaktisik.');
  const [id]=await trx('crm_activities').insert({client_id:c.id,contact_id:x.contact_id||null,owner_user_id:c.owner_user_id,type:x.type,status:'active',due_date:x.due_date,notes:values.instructions.slice(0,5000)||null,sequence_number:Number(c.followup_count||0)+1});
  await trx('crm_activity_details').insert({activity_id:id,...values});
  await event(trx,id,user,'created',{purpose:values.purpose,due_date:x.due_date});
  await replies(trx,c.id,x.reply_ids,user,id,'planned');
  return {id};
}
async function editable(trx,id,user) {
  if(await replyContext(trx,id))fail(409,'Vastuskirja sisu ja malli saab muuta kirja koostamise vormis.');
  if(user.role==='admin') fail(403,'Tegevuse muutmiseks lülitu tavakasutaja režiimi.');
  const {activity:a,client:c}=await lockActivity(trx,id,user);
  if(a.status!=='active'||c.stop_reason) fail(409,'Muuta saab ainult avatud kliendi aktiivset tegevust.');
  // Locking reads see reservations/edits committed while the client lock was awaited.
  if(await trx('crm_email_outbox').where({activity_id:id}).forUpdate().first('id')) fail(409,'Saatmine on juba registreeritud. Seda tegevust ei saa muuta.');
  const d=await trx('crm_activity_details').where({activity_id:id}).forUpdate().first();
  const latest=await trx('crm_v8_activity_events').where({activity_id:id}).orderBy('id','desc').forUpdate().first('id');
  const version=crypto.createHash('sha256').update(JSON.stringify([a,d||null,c.owner_user_id,c.stop_reason,latest?.id||null])).digest('hex');
  return {id:Number(a.id),type:a.type,due_date:dateOnly(a.due_date),template_id:d?.template_id||null,purpose:d?.purpose||'',subject:d?.subject||'',instructions:d?.instructions??a.notes??'',notes:a.notes??null,next_step_json:d?.next_step_json??null,version};
}
async function edit(trx,id,user,x={}) {
  if(Object.keys(x).some(k=>!['type','template_id','purpose','subject','instructions','expected_version'].includes(k))) fail(400,'Vigased tegevuse muutmise väljad.');
  const before=await editable(trx,id,user);
  if(typeof x.expected_version!=='string'||x.expected_version!==before.version) fail(409,'Tegevus muutus. Sulge vorm ja ava tegevus uuesti.');
  // Changing the template never changes the existing due date or queue position.
  const values=await planned(trx,{...x,due_date:today()});
  if(x.type!=='E-kiri') values.subject='';
  const audit={before,after:{type:x.type,...values,due_date:before.due_date}};
  if(Buffer.byteLength(JSON.stringify(audit),'utf8')>64000) fail(400,'Muudatuse ajalugu on liiga mahukas. Lühenda tegevuse sisu.');
  await trx('crm_activities').where({id}).update({type:x.type,notes:values.instructions.slice(0,5000)||null,updated_at:trx.fn.now()});
  const exists=await trx('crm_activity_details').where({activity_id:id}).first('activity_id');
  if(exists) await trx('crm_activity_details').where({activity_id:id}).update(values);
  else await trx('crm_activity_details').insert({activity_id:id,...values});
  await event(trx,id,user,'activity_edited',audit);
  return {updated:true,...await editable(trx,id,user)};
}
module.exports={WorkflowError,TYPES,today,dateOnly,validDate,parse,text,event,allowed,lockClient,lockActivity,validateReplies,replies,planned,complete,stop,selectNext,postpone,create,editable,edit,chain,businessDate,embedded,followupPlan,replyContext};
