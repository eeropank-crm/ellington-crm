'use strict';
const express = require('express');
const workflow = require('../services/activity-workflow');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const normalizeId = v => String(v || '').trim().replace(/^<|>$/g, '').toLowerCase();
const email = v => String(v || '').trim().toLowerCase();
const isId = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const quote = v => String(v || '').slice(0, 1000);

module.exports = function(db) {
  const router = express.Router();
  let busy = false;
  async function sync() {
    if (busy) return { skipped: true, reason: 'already_running' };
    const mailbox = process.env.CRM_MAILBOX_1;
    const password = process.env.CRM_MAIL_PASSWORD_1;
    const host = process.env.CRM_IMAP_HOST;
    if (!mailbox || !password || !host) throw new Error('IMAP ei ole seadistatud (CRM_IMAP_HOST, CRM_MAILBOX_1, CRM_MAIL_PASSWORD_1).');
    const port = Number(process.env.CRM_IMAP_PORT || 993);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Vigane IMAP port.');
    busy = true;
    let client;
    let scanned = 0, imported = 0, matched = 0;
    try {
      client = new ImapFlow({ host, port, secure: true, auth: { user: mailbox, pass: password }, logger: false, socketTimeout: 30000, greetingTimeout: 15000, tls: { minVersion: 'TLSv1.2' } });
      await client.connect();
      const box = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 45 * 86400000);
        const uids = await client.search({ since }, { uid: true });
        // Limit per sync; newest first, no message flags changed.
        for (const uid of uids.slice(-250)) {
          const message = await client.fetchOne(uid, { uid: true, source: true }, { uid: true });
          if (!message?.source) continue;
          scanned++;
          const parsed = await simpleParser(message.source, { skipHtmlToText: false });
          const messageId = normalizeId(parsed.messageId);
          if (!messageId) continue;
          const sender = email(parsed.from?.value?.[0]?.address);
          if (!sender || sender === email(mailbox)) continue;
          const referenceText = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])].flat().filter(Boolean).join(' ');
          const references = (referenceText.match(/<[^<>]+>/g) || referenceText.split(/\s+/)).map(normalizeId).filter(Boolean);
          if (!references.length) continue; // Do not guess client identity by subject alone.
          const sent = await db('crm_email_outbox').where({ status: 'sent', user_id: 1 }).whereIn('message_id', references.map(v => '<' + v + '>')).orderBy('id', 'desc').first();
          if (!sent || sender !== email(sent.recipient)) continue;
          matched++;
          const text = String(parsed.text || '').slice(0, 20000);
          const subject = quote(parsed.subject).slice(0, 500);
          const date = parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date();
          await db.transaction(async trx => {
            // Same lock order as completion, selection, send and stop.
            await trx('crm_clients').where({id:sent.client_id}).forUpdate().first('id');
            const exists = await trx('crm_email_inbox').where({ mailbox_user_id: 1, message_id: '<' + messageId + '>' }).first('id');
            if (exists) return;
            await trx('crm_email_inbox').insert({ mailbox_user_id: 1, outbox_id: sent.id, client_id: sent.client_id, activity_id: sent.activity_id, sender, recipient: email(mailbox), subject, body: text, message_id: '<' + messageId + '>', received_at: date, created_at: trx.fn.now() });
            imported++;
            // Cancel only an untouched automatic 14-day follow-up created from this exact activity.
            const automatic = await trx('crm_v8_activity_events').where({ activity_id: sent.activity_id, event_type: 'completed_default_followup' }).orderBy('id', 'desc').first('details');
            if (!automatic) return;
            let followId;
            try { followId = JSON.parse(automatic.details).next_activity_id; } catch (_) { return; }
            if (!isId(followId)) return;
            const follow = await trx('crm_activities').where({ id: followId, client_id: sent.client_id, status: 'active' }).forUpdate().first();
            if (!follow) return;
            const changed = await trx('crm_v8_activity_events').where({ activity_id: followId }).whereNotIn('event_type', ['created_default_followup']).first('id');
            if (changed) return;
            await trx('crm_activities').where({ id: followId, status: 'active' }).update({ status: 'stopped', updated_at: trx.fn.now() });
            await trx('crm_v8_activity_events').insert({ activity_id: followId, user_id: 1, event_type: 'auto_followup_cancelled_reply', details: JSON.stringify({ inbox_message_id: '<' + messageId + '>', original_activity_id: sent.activity_id }) });
          });
        }
      } finally { box.release(); }
      return { scanned, matched, imported };
    } finally {
      if (client) { try { await client.logout(); } catch (_) { try { client.close(); } catch (_) {} } }
      busy = false;
    }
  }
  router.get('/mail/imap/status', (req, res) => {
    if (req.crmUser.role !== 'admin') return res.status(403).json({ error: 'Ainult administraatorile.' });
    res.json({ enabled: process.env.CRM_IMAP_ENABLED === '1', configured: !!(process.env.CRM_IMAP_HOST && process.env.CRM_MAILBOX_1 && process.env.CRM_MAIL_PASSWORD_1), mailbox: process.env.CRM_MAILBOX_1 || null });
  });
  router.post('/mail/imap/sync', async (req, res, next) => {
    if (req.crmUser.role !== 'admin') return res.status(403).json({ error: 'Ainult administraatorile.' });
    try { res.json(await sync()); } catch (err) { next(err); }
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
        .select('i.id','i.client_id','c.name as client_name','i.sender','i.subject','i.received_at');
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
  if (process.env.CRM_IMAP_ENABLED === '1') {
    const timer = setInterval(() => sync().catch(e => console.error('[CRM IMAP] Sync failed:', e.message)), 5 * 60 * 1000);
    timer.unref();
    setTimeout(() => sync().catch(e => console.error('[CRM IMAP] Initial sync failed:', e.message)), 15000).unref();
  }
  return router;
};
