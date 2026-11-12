'use strict';
const express = require('express');
const w=require('../services/activity-workflow');
const DEFAULT_REASONS = [
  'Ei soovi enam infot',
  'Ei soovi, et temaga ühendust võetakse',
  'Pole huvitatud',
  'Kliendiga suhtlus juba käib',
  'Vale kontakt / ettevõte',
  'Muu põhjus'
];
const TYPES = ['Kõne','E-kiri','Kohtumine'];
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
const clean = (s, max=5000) => typeof s === 'string' ? s.trim().slice(0,max+1) : '';
const admin = (req,res) => req.crmUser.role === 'admin' || (res.status(403).json({error:'Ainult administraatorile.'}),false);
module.exports = function(db) {
  const r = express.Router();
  r.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  r.get('/v8/config', async(req,res,next)=>{
    try {
      const templates=await db('crm_templates').where({is_active:1}).orderBy('id').select('*');
      const reasons=await db('crm_v8_stop_reasons').where({is_active:1}).orderBy('sort_order').orderBy('id').select('id','label');
      res.json({templates:templates.map(t=>({id:t.id,external_key:t.external_key,name:t.name,type:t.type,purpose:t.purpose||t.name,subject:t.subject||'',body:t.body||'',next:t.next_type,days:t.next_days,nextStep:parseJSON(t.next_step_json)})),reasons});
    }catch(e){next(e)}
  });
  r.post('/v8/templates',async(req,res,next)=>{
    try{
      if(!admin(req,res))return;
      const t=req.body||{};
      const purpose=clean(t.purpose,200),body=clean(t.body,10000),subject=clean(t.subject,500);
      if(!TYPES.includes(t.type)||!purpose||purpose.length>200||!body||body.length>10000||(t.type==='E-kiri'&&!subject)||(subject.length>500))return res.status(400).json({error:'Täida eesmärk, juhis ja e-kirja puhul pealkiri.'});
      if(t.nextStep!=null && JSON.stringify(t.nextStep).length>10000)return res.status(400).json({error:'Järeltegevuste ahel on liiga pikk.'});
      let nextStep;try{nextStep=w.chain(t.nextStep);}catch(e){if(e instanceof w.WorkflowError)return res.status(e.status).json({error:e.message});throw e;}
      const next=nextStep?.type || t.next || null, days=nextStep?.days || t.days || null;
      if(next!=null&&!TYPES.includes(next))return res.status(400).json({error:'Vigane järgmine tegevus.'});
      if(next!=null&&(!Number.isInteger(Number(days))||Number(days)<1||Number(days)>3650))return res.status(400).json({error:'Vigane järeltegevuse tähtaeg.'});
      const value={name:purpose,purpose,type:t.type,subject:t.type==='E-kiri'?subject:'',body,next_type:next,next_days:next?Number(days):null,next_step_json:nextStep?JSON.stringify(nextStep):null,is_active:1,updated_at:db.fn.now()};
      let id;
      if(t.id!=null){id=Number(t.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Vigane malli ID.'});const updated=await db('crm_templates').where({id}).update(value);if(!updated)return res.status(404).json({error:'Malli ei leitud.'});}
      else {[id]=await db('crm_templates').insert({...value,created_at:db.fn.now()});}
      res.json({id});
    }catch(e){next(e)}
  });
  r.post('/v8/templates/import',async(req,res,next)=>{
    try{
      if(!admin(req,res))return;
      const items=req.body?.templates;
      if(!Array.isArray(items)||items.length>200)return res.status(400).json({error:'Liiga palju malle.'});
      let imported=0,skipped=0;
      for(const t of items){
        const purpose=clean(t.purpose||t.name,200),body=clean(t.body,10000),subject=clean(t.subject,500);
        if(!TYPES.includes(t.type)||!purpose||purpose.length>200||!body||body.length>10000||(t.type==='E-kiri'&&!subject)){skipped++;continue;}
        const existing=await db('crm_templates').where({type:t.type,purpose}).first('id');
        if(existing){skipped++;continue;}
        const step=t.nextStep||null;
        if(step&&JSON.stringify(step).length>10000){skipped++;continue;}
        const next=step?.type||t.next||null,days=step?.days||t.days||null;
        if(next&&!TYPES.includes(next)){skipped++;continue;}
        if(next&&(!Number.isInteger(Number(days))||Number(days)<1||Number(days)>3650)){skipped++;continue;}
        await db('crm_templates').insert({name:purpose,purpose,type:t.type,subject:t.type==='E-kiri'?subject:'',body,next_type:next,next_days:next?Number(days):null,next_step_json:step?JSON.stringify(step):null,is_active:1});
        imported++;
      }
      res.json({imported,skipped});
    }catch(e){next(e)}
  });
  r.delete('/v8/templates/:id',async(req,res,next)=>{
    try{if(!admin(req,res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Vigane ID.'});await db('crm_templates').where({id}).update({is_active:0,updated_at:db.fn.now()});res.json({ok:true});}catch(e){next(e)}
  });
  r.post('/v8/reasons',async(req,res,next)=>{
    try{if(!admin(req,res))return;const label=clean(req.body?.label,200);if(label.length<3||label.length>200)return res.status(400).json({error:'Sisesta põhjus (3–200 märki).'});const [id]=await db('crm_v8_stop_reasons').insert({label,is_active:1,sort_order:1000});res.json({id});}catch(e){next(e)}
  });
  r.patch('/v8/reasons/:id',async(req,res,next)=>{
    try{if(!admin(req,res))return;const id=Number(req.params.id),label=clean(req.body?.label,200);if(!Number.isSafeInteger(id)||id<1||label.length<3||label.length>200)return res.status(400).json({error:'Vigane põhjus.'});const n=await db('crm_v8_stop_reasons').where({id}).update({label});if(!n)return res.status(404).json({error:'Põhjust ei leitud.'});res.json({ok:true});}catch(e){next(e)}
  });
  r.delete('/v8/reasons/:id',async(req,res,next)=>{
    try{if(!admin(req,res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Vigane ID.'});await db('crm_v8_stop_reasons').where({id}).update({is_active:0});res.json({ok:true});}catch(e){next(e)}
  });
  r.get('/v8/activities',async(req,res,next)=>{
    try{
      const rows=await db('crm_activities as a').leftJoin('crm_clients as c','a.client_id','c.id').leftJoin('crm_activity_details as d','d.activity_id','a.id').leftJoin('users as u','u.id','a.owner_user_id')
        .where('a.status','active')
        .modify(q=>{if(req.crmUser.role!=='admin')q.where('a.owner_user_id',req.crmUser.id)})
        .select('a.id','a.client_id','a.contact_id','a.owner_user_id','u.name as owner_name','c.name as client','c.client_type','a.type','a.due_date','a.notes','a.sequence_number','d.purpose','d.instructions','d.subject','d.template_id','d.next_step_json')
        .orderBy('a.due_date','asc');
      res.json({activities:rows.map(x=>({...x,due_date:w.dateOnly(x.due_date),nextStep:parseJSON(x.next_step_json)}))});
    }catch(e){next(e)}
  });
  const action=fn=>async(req,res,next)=>{try{const result=await db.transaction(trx=>fn(trx,req));res.json(result)}catch(e){if(e instanceof w.WorkflowError)return res.status(e.status).json({error:e.message});next(e)}};
  r.post('/v8/activities', action((trx,req)=>w.create(trx,req.crmUser,req.body||{})));
  const activityId=req=>{
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)throw new w.WorkflowError(400,'Vigane tegevus.');
    return id;
  };
  r.get('/v8/activities/:id/edit',action(async(trx,req)=>{const value=await w.editable(trx,activityId(req),req.crmUser);return {...value,contacts:await trx('crm_contacts').where({client_id:value.client_id}).select('id','name','email','phone').orderBy('id')};}));
  r.patch('/v8/activities/:id',action((trx,req)=>w.edit(trx,activityId(req),req.crmUser,req.body||{})));
  r.post('/v8/activities/:id/resolve', action(async(trx,req)=>{
    const id=Number(req.params.id),x=req.body||{};
    if(!Number.isSafeInteger(id)||id<1)throw new w.WorkflowError(400,'Vigane tegevus.');
    if(x.action==='postpone'||x.outcome==='postponed')return w.postpone(trx,id,req.crmUser,x);
    if(x.action&&x.action!=='complete')throw new w.WorkflowError(400,'Tundmatu toiming.');
    const result=await w.complete(trx,id,req.crmUser,x);
    // Legacy clients may still submit completion and selection together.
    if(x.next==='plan'||x.next==='stop')return {...result,...await w.selectNext(trx,id,req.crmUser,x)};
    return result;
  }));
  r.post('/v8/activities/:id/next-step',action((trx,req)=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw new w.WorkflowError(400,'Vigane tegevus.');
    return w.selectNext(trx,id,req.crmUser,req.body||{});
  }));
  return r;
};
function parseJSON(s){if(!s)return null;try{return JSON.parse(s)}catch{return null}}
