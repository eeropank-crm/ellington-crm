 'use strict';
const express=require('express');
const bcrypt=require('bcryptjs');
const nodemailer=require('nodemailer');
const crypto=require('crypto');
const workflow=require('../services/activity-workflow');
module.exports=function(db,options={}){
 const r=express.Router();
 const admin=(req,res)=>req.crmUser.role==='admin'||(res.status(403).json({error:'Ainult administraatorile.'}),false);
 const goodId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
 const mailConfig=id=>{
   const address=process.env['CRM_MAILBOX_'+id];
   const password=process.env['CRM_MAIL_PASSWORD_'+id];
   if(!address||!password||!process.env.CRM_SMTP_HOST) return null;
   return {address,password};
 };
 r.get('/mail/status',async(req,res,next)=>{try{const c=mailConfig(req.crmUser.id);res.json({configured:!!c,address:c?.address||null});}catch(e){next(e)}});
 r.get('/admin/users-real',async(req,res,next)=>{try{if(!admin(req,res))return;const users=await db('users').select('id','name','email','role','is_active').orderBy('id');res.json({users:users.map(u=>({...u,mailbox:process.env['CRM_MAILBOX_'+u.id]||null,mail_configured:!!mailConfig(u.id)}))});}catch(e){next(e)}});
 r.post('/admin/users-real',async(req,res,next)=>{try{if(!admin(req,res))return;const {name,email,password,role}=req.body||{};if(typeof name!=='string'||name.trim().length<2||name.length>150||typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>255||!['sales','admin'].includes(role)||typeof password!=='string'||password.length<12||password.length>128)return res.status(400).json({error:'Sisesta nimi, korrektne e-post, roll ja vähemalt 12-märgiline parool.'});const exists=await db('users').where({email:email.trim().toLowerCase()}).first('id');if(exists)return res.status(409).json({error:'See e-posti aadress on juba kasutusel.'});const [id]=await db('users').insert({name:name.trim(),email:email.trim().toLowerCase(),password_hash:await bcrypt.hash(password,12),role,is_active:1});res.json({id});}catch(e){next(e)}});
 r.patch('/admin/users-real/:id',async(req,res,next)=>{try{if(!admin(req,res))return;const id=Number(req.params.id);if(!goodId(id))return res.status(400).json({error:'Vigane kasutaja.'});const u=await db('users').where({id}).first();if(!u)return res.status(404).json({error:'Kasutajat ei leitud.'});const x=req.body||{};if(x.action==='password'){if(typeof x.password!=='string'||x.password.length<12||x.password.length>128)return res.status(400).json({error:'Parool peab olema vähemalt 12 märki.'});await db('users').where({id}).update({password_hash:await bcrypt.hash(x.password,12),updated_at:db.fn.now()});}
 else if(x.action==='active'){if(id===Number(req.crmUser.id)&&!x.active)return res.status(400).json({error:'Enda kontot ei saa peatada.'});if(x.active!==true&&x.active!==false)return res.status(400).json({error:'Vigane olek.'});if(!x.active&&u.role==='admin'){const n=await db('users').where({role:'admin',is_active:1}).count('* as n').first();if(Number(n.n)<=1)return res.status(409).json({error:'Viimast administraatorit ei saa peatada.'});}await db('users').where({id}).update({is_active:x.active?1:0,updated_at:db.fn.now()});}
 else return res.status(400).json({error:'Tundmatu toiming.'});res.json({ok:true});}catch(e){next(e)}});
 r.get('/mail/activity/:id',async(req,res,next)=>{try{const id=Number(req.params.id);if(!goodId(id))return res.status(400).json({error:'Vigane tegevus.'});const a=await db('crm_activities as a').leftJoin('crm_activity_details as d','d.activity_id','a.id').where('a.id',id).first('a.id','a.client_id','a.contact_id','a.owner_user_id','a.type','a.status','d.subject','d.instructions','d.purpose','d.template_id');if(!a)return res.status(404).json({error:'Tegevust ei leitud.'});if(a.owner_user_id!=req.crmUser.id)return res.status(403).json({error:'See tegevus ei kuulu sulle.'});if(a.type!=='E-kiri')return res.status(400).json({error:'See pole e-kirja tegevus.'});const contacts=await db('crm_contacts').where({client_id:a.client_id}).whereNotNull('email').select('id','name','email');const log=await db('crm_email_outbox').where({activity_id:id}).first('id','status','sent_at','recipient');res.json({activity:a,contacts,send:log||null,configured:!!mailConfig(req.crmUser.id)});}catch(e){next(e)}});
 r.post('/mail/activity/:id/send',async(req,res,next)=>{try{
 const id=Number(req.params.id),x=req.body||{};if(!goodId(id)||!goodId(x.contact_id))return res.status(400).json({error:'Vali kontaktisik.'});
 const subject=typeof x.subject==='string'?x.subject.trim():'',body=typeof x.body==='string'?x.body.trim():'';
 const recipient=typeof x.recipient==='string'?x.recipient.trim():'';
 if(recipient.length>254||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(recipient))return res.status(400).json({error:'Sisesta korrektne saaja e-posti aadress.'});
 if(!subject||subject.length>500||!body||body.length>10000)return res.status(400).json({error:'Kontrolli kirja pealkirja ja sisu.'});
 const config=mailConfig(req.crmUser.id);
 const reserved=await db.transaction(async trx=>{
 const locked=await workflow.lockActivity(trx,id,req.crmUser);const a=locked.activity;
 if(locked.client.stop_reason)return {error:'Kliendi jälgimine on lõpetatud.',status:409};if(!a)return {error:'Tegevust ei leitud.',status:404};if(a.owner_user_id!=req.crmUser.id)return {error:'Tegevus ei kuulu sulle.',status:403};if(a.type!=='E-kiri'||a.status!=='active')return {error:'Tegevus pole aktiivne e-kiri.',status:409};
 if(!config)return {error:'Sinu CRM-i postkast pole veel seadistatud.',status:409};
 const contact=await trx('crm_contacts').where({id:Number(x.contact_id),client_id:a.client_id}).first();if(!contact)return {error:'Valitud kontaktisikut ei leitud.',status:400};
 const old=await trx('crm_email_outbox').where({activity_id:id}).first();if(old)return {error:'Selle tegevuse saatmine on juba registreeritud ('+old.status+'). Topeltsaatmise vältimiseks kontrolli ajalugu.',status:409};
 const tpl=await trx('crm_templates').where({id:Number(x.template_id)||0,type:'E-kiri',is_active:1}).first();
 if(!tpl||x.purpose!==(tpl.purpose||tpl.name))return {error:'Vali e-kirja eesmärk rippmenüüst.',status:400};
 await workflow.validateReplies(trx,a.client_id,x.reply_ids);
 const messageId='<crm-'+id+'-'+crypto.randomUUID()+'@ellington.ee>';
 await trx('crm_email_outbox').insert({activity_id:id,client_id:a.client_id,contact_id:contact.id,user_id:req.crmUser.id,sender:config.address,recipient,subject,body,message_id:messageId,status:'sending',created_at:trx.fn.now()});await workflow.event(trx,id,req.crmUser,'mail_sending_reserved',{});return {recipient,messageId,next_step_json:tpl.next_step_json||null,purpose:tpl.purpose||tpl.name,template_id:tpl.id};
 });if(reserved.error)return res.status(reserved.status).json({error:reserved.error});
 const port=Number(process.env.CRM_SMTP_PORT||465);
 let info;
 try {
   if(!Number.isInteger(port)||port<1||port>65535)throw Error('Vigane SMTP port.');
   const transport=(options.createTransport||nodemailer.createTransport)({host:process.env.CRM_SMTP_HOST,port,secure:port===465,auth:{user:config.address,pass:config.password},requireTLS:port!==465,tls:{minVersion:'TLSv1.2'},connectionTimeout:12000,greetingTimeout:12000,socketTimeout:20000});
   try {
     info=await transport.sendMail({from:{name:req.crmUser.name+' | Ellington',address:config.address},to:reserved.recipient,subject,text:body,messageId:reserved.messageId,replyTo:config.address});
     if(!Array.isArray(info.accepted)||!info.accepted.some(a=>String(a).toLowerCase()===reserved.recipient.toLowerCase()))throw Error('SMTP ei kinnitanud saaja vastuvõtmist.');
   } finally { if(typeof transport.close==='function')transport.close(); }
 } catch(e) {
   await db('crm_email_outbox').where({activity_id:id}).update({status:'uncertain',smtp_response:String(e.message||e).slice(0,1000)});
   return res.status(502).json({error:'Saatmist ei õnnestunud kinnitada. Topeltsaatmise vältimiseks kontrolli postkasti ja pöördu administraatori poole. Tegevus jäi aktiivseks.'});
 }
 try {
   const completion=await db.transaction(async trx=>{
     await workflow.lockActivity(trx,id,req.crmUser);
     await trx('crm_email_outbox').where({activity_id:id}).update({status:'sent',sent_at:trx.fn.now(),smtp_response:String(info.response||'').slice(0,1000)});
     await trx('crm_activity_details').where({activity_id:id}).update({template_id:reserved.template_id,purpose:reserved.purpose,subject,instructions:body,next_step_json:reserved.next_step_json});
     return workflow.complete(trx,id,req.crmUser,{reply_ids:x.reply_ids});
   });
   res.json({ok:true,recipient:reserved.recipient,message_id:reserved.messageId,completion});
 } catch(e) {
   // SMTP accepted the message: never retry it automatically, even if the DB
   // commit failed. The durable reservation continues to prevent duplicates.
   return res.status(503).json({error:'SMTP võttis kirja vastu, kuid CRM-i lõpetamise salvestus ebaõnnestus. Ära saada uuesti; palu administraatoril saatmisreservatsioon ja ajalugu üle kontrollida.'});
 }
 }catch(e){if(e instanceof workflow.WorkflowError)return res.status(e.status).json({error:e.message});next(e)}});
 r.get('/mail/client/:id/history',async(req,res,next)=>{try{const id=Number(req.params.id);if(!goodId(id))return res.status(400).json({error:'Vigane klient.'});const c=await db('crm_clients').where({id}).first('owner_user_id');if(!c)return res.status(404).json({error:'Klienti ei leitud.'});if(req.crmUser.role!=='admin'&&Number(c.owner_user_id)!==Number(req.crmUser.id))return res.status(403).json({error:'Ligipääs puudub.'});const rows=await db('crm_email_outbox as m').leftJoin('users as u','u.id','m.user_id').where('m.client_id',id).select('m.id','m.sender','m.recipient','m.subject','m.body','m.status','m.sent_at','m.created_at','u.name as user_name').orderBy('m.id','desc').limit(100);res.json({messages:rows});}catch(e){next(e)}});
 return r;
};
