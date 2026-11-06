'use strict';
const express = require('express');
const workflow = require('../services/activity-workflow');
const mailboxes=require('../services/mailboxes');
const createSync=require('../services/mailbox-sync');
const isId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;

module.exports = function(db, options={}) {
  const router = express.Router();
  const service=createSync(db,options);
  const sync=service.sync;
  router.get('/mail/imap/status', async (req,res,next)=>{
    if(req.crmUser.role!=='admin')return res.status(403).json({error:'Ainult administraatorile.'});
    try{res.json(await service.status());}catch(e){next(e);}
  });
  router.post('/mail/imap/sync',async(req,res)=>{
    if(req.crmUser.role!=='admin')return res.status(403).json({error:'Ainult administraatorile.'});
    try{res.json(await sync());}catch{res.status(502).json({error:'Postkastide sünkroonimine ebaõnnestus. Kontrolli seadistust.'});}
  });
  router.get('/mail/client/:id/replies', async (req, res, next) => {
    try {
      if (!isId(req.params.id)) return res.status(400).json({ error: 'Vigane klient.' });
      const client = await db('crm_clients').where({ id: Number(req.params.id) }).first('owner_user_id');
      if (!client) return res.status(404).json({ error: 'Klienti ei leitud.' });
      if (req.crmUser.role !== 'admin' && Number(client.owner_user_id) !== Number(req.crmUser.id)) return res.status(403).json({ error: 'Ligipääs puudub.' });
      const replies = await db('crm_email_inbox').where({ client_id: Number(req.params.id) }).orderBy('received_at', 'desc').limit(100).select('id','sender','recipient','subject','body','received_at','activity_id','handled_at');
      res.json({ replies });
    } catch (e) { next(e); }
  });

  // CRM_REPLY_ALERTS_V2: only inbox messages visible to the logged-in owner/admin.
  router.get('/mail/reply-alerts', async (req,res,next) => {
    try {
      let q=db('crm_email_inbox as i')
        .join('crm_clients as c','c.id','i.client_id')
        .whereNull('i.handled_at');
      if(req.crmUser.role!=='admin')q=q.where('c.owner_user_id',req.crmUser.id);
      const alerts=await q.orderBy('i.received_at','desc').limit(100)
        .select('i.id','i.client_id','c.owner_user_id','c.name as client_name','i.sender','i.subject','i.received_at');
      res.set('Cache-Control','no-store');res.json({alerts});
    }catch(e){next(e)}
  });
  // A customer reply is actionable work, not a dismissible notification.
  router.post('/mail/reply-alerts/:id/handled',async(req,res,next)=>{
    try {
      const id=Number(req.params.id),note=workflow.text(req.body?.note,5000,'vastuse käsitlemise tulemus',5);
      if(!Number.isSafeInteger(id)||id<1)throw new workflow.WorkflowError(400,'Vigane vastus.');
      await db.transaction(async trx=>{
        const row=await trx('crm_email_inbox').where({id}).first();
        if(!row)throw new workflow.WorkflowError(404,'Vastust ei leitud.');
        await workflow.lockClient(trx,row.client_id,req.crmUser);
        await workflow.replies(trx,row.client_id,[id],req.crmUser,null,'reviewed',note);
      });
      res.json({handled:true});
    } catch(e){if(e instanceof workflow.WorkflowError)return res.status(e.status).json({error:e.message});next(e)}
  });
  if (options.schedule!==false && mailboxes.pollingEnabled(options.env||process.env)) {
    const timer = setInterval(() => sync().then(report=>{if(report.mailboxes?.some(m=>m.status!=='ok'||m.message_errors))console.error('[CRM IMAP] Mõne postkasti sünkroonimine vajab kontrollimist.');}).catch(()=>console.error('[CRM IMAP] Sünkroonimine ebaõnnestus; privaatsed veateated peidetud.')), 5 * 60 * 1000);
    timer.unref();
    setTimeout(() => sync().catch(()=>console.error('[CRM IMAP] Esmane sünkroonimine ebaõnnestus; privaatsed veateated peidetud.')), 15000).unref();
  }
  return router;
};
