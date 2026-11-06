const express = require('express');
const db = require('../db');
const workflow = require('../services/activity-workflow');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({
        error: 'Sisselogimine on vajalik.'
      });
    }

    const user = await db('users')
      .where({
        id: req.session.userId,
        is_active: 1
      })
      .first('id', 'name', 'role');

    if (!user) {
      return res.status(403).json({
        error: 'Kasutajal puudub ligipääs.'
      });
    }

    req.crmUser = require('../work-mode').sessionUser(user, req.session);
    next();
  } catch (error) {
    next(error);
  }
});



router.get('/clients/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Vigane kliendi ID.' });
    }

    const client = await db('crm_clients')
      .where({ id })
      .first();

    if (!client) {
      return res.status(404).json({ error: 'Klienti ei leitud.' });
    }

    if (req.crmUser.role !== 'admin' && Number(client.owner_user_id) !== Number(req.crmUser.id)) {
      return res.status(403).json({ error: 'Klient ei kuulu sinu portfelli.' });
    }

    const contacts = await db('crm_contacts')
      .where({ client_id: id })
      .select('id', 'name', 'email', 'phone', 'position')
      .orderBy('id');

    const history = await db('crm_imported_history')
      .where({ client_id: id })
      .select(
        'id', 'activity_type', 'original_value',
        'activity_date', 'source_column'
      )
      .orderBy('id');

    const owner = client.owner_user_id
      ? await db('users')
          .where({ id: client.owner_user_id })
          .first()
      : null;

    res.set('Cache-Control', 'no-store');

    const activities = await db('crm_activities as a')
      .leftJoin('crm_activity_details as d','d.activity_id','a.id')
      .where('a.client_id',id)
      .modify(q => { if (req.crmUser.role !== 'admin') q.where('a.owner_user_id', req.crmUser.id); })
      .select('a.*','d.purpose','d.instructions','d.subject','d.template_id','d.next_step_json')
      .orderBy('a.due_date','asc');
    activities.forEach(a=>{a.nextStep=workflow.parse(a.next_step_json);a.due_date=workflow.dateOnly(a.due_date)});

    // Completed CRM activities and their recorded outcomes are separate from imported history.
    const activityHistory = await db('crm_activities as a')
      .leftJoin('crm_activity_details as d', 'd.activity_id', 'a.id')
      .leftJoin('users as owner', 'owner.id', 'a.owner_user_id')
      .where('a.client_id', id)
      .whereIn('a.status', ['completed', 'stopped'])
      .select('a.id', 'a.type', 'a.status', 'a.due_date', 'a.notes',
        'a.updated_at', 'd.purpose', 'd.instructions', 'owner.name as owner_name')
      .orderBy('a.id', 'desc');

    if (activityHistory.length) {
      const activityIds = activityHistory.map(a => a.id);
      const events = await db('crm_v8_activity_events as e')
        .leftJoin('users as actor', 'actor.id', 'e.user_id')
        .whereIn('e.activity_id', activityIds)
        .whereIn('e.event_type', ['completed', 'completed_default_followup', 'completed_and_stopped', 'monitoring_stopped'])
        .select('e.id', 'e.activity_id', 'e.event_type', 'e.details',
          'e.created_at', 'actor.name as actor_name')
        .orderBy('e.id', 'desc');
      const latestByActivity = new Map();
      for (const e of events) {
        if (!latestByActivity.has(e.activity_id)) latestByActivity.set(e.activity_id, e);
      }
      for (const a of activityHistory) {
        const e = latestByActivity.get(a.id);
        let details = {};
        try { details = e && e.details ? JSON.parse(e.details) : {}; } catch (_) { /* preserve history even if malformed */ }
        a.result_comment = typeof details.comment === 'string' ? details.comment : (details.reason || '');
        a.outcome = typeof details.outcome === 'string' ? details.outcome : '';
        a.completed_at = e?.created_at || a.updated_at || null;
        a.completed_by = e?.actor_name || a.owner_name || null;
        a.has_completion_event = Boolean(e);
        a.completion_event_type = e?.event_type || '';
        // Recover only evidence that exists: older mail completions did not record a comment.
        if (!a.result_comment && a.type === 'E-kiri') {
          const sent = await db('crm_email_outbox').where({activity_id:a.id,status:'sent'}).first();
          if(sent) a.result_comment = 'Saadetud e-kiri: '+sent.subject+'\nSaaja: '+sent.recipient+'\n\n'+sent.body;
        }
      }
    }

    const replyEvents=await db('crm_v8_activity_events as e')
      .join('crm_activities as a','a.id','e.activity_id')
      .leftJoin('users as u','u.id','e.user_id')
      .where('a.client_id',id).where('e.event_type','reply_handled')
      .select('e.id','e.details','e.created_at','u.name as actor_name').orderBy('e.id','desc');
    const replyHistory=replyEvents.map(e=>({...e,...workflow.parse(e.details)}));
    const editEvents=await db('crm_v8_activity_events as e')
      .join('crm_activities as a','a.id','e.activity_id')
      .leftJoin('users as u','u.id','e.user_id')
      .where('a.client_id',id).where('e.event_type','activity_edited')
      .select('e.id','e.activity_id','e.details','e.created_at','u.name as actor_name').orderBy('e.id','desc');
    const editHistory=editEvents.map(e=>({...e,...workflow.parse(e.details)}));
    res.json({
      activities,
      activityHistory,
      replyHistory,
      editHistory,
      client: {
        id: client.id,
        name: client.name,
        client_type: client.client_type,
        owner_name: owner ? owner.name : null,
        owner_user_id: client.owner_user_id,
        stop_reason: client.stop_reason,
        followup_count: client.followup_count,
        client_comment: client.client_comment,
        our_comment: client.our_comment,
        notes: client.notes
      },
      contacts,
      history
    });
  } catch (error) {
    next(error);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    if (!search) {
      return res.json({ clients: [] });
    }

    if (search.length > 100) {
      return res.status(400).json({
        error: 'Otsing on liiga pikk.'
      });
    }

    const clients = await db('crm_clients as c')
      .leftJoin('crm_contacts as ct', 'ct.client_id', 'c.id')
      .where(function () {
        this.where('c.name', 'like', '%' + search + '%')
          .orWhere('ct.name', 'like', '%' + search + '%');
      })
      .modify(q => { if (req.crmUser.role !== 'admin') q.where('c.owner_user_id', req.crmUser.id); })
      .distinct(
        'c.id',
        'c.name',
        'c.client_type',
        'c.owner_user_id',
        'c.stop_reason',
        'c.followup_count'
      )
      .orderBy('c.name', 'asc')
      .limit(50);

    res.set('Cache-Control', 'no-store');
    res.json({ clients });
  } catch (error) {
    next(error);
  }
});

router.get('/activities', async (req, res, next) => {
  try {
    let query = db('crm_activities as a')
      .leftJoin('crm_clients as c', 'a.client_id', 'c.id')
      .select(
        'a.id',
        'a.client_id',
        'c.name as client',
        'a.owner_user_id',
        'a.type',
        'a.status',
        'a.due_date',
        'a.notes'
      )
      .orderBy('a.due_date', 'asc');

    if (req.crmUser.role !== 'admin') {
      query = query.where(
        'a.owner_user_id',
        req.crmUser.id
      );
    }

    const activities = await query;

    res.set('Cache-Control', 'no-store');
    res.json({ activities });
  } catch (error) {
    next(error);
  }
});


// Compatibility endpoint uses the same validated workflow as the v8 form.
router.post('/activities', async (req,res,next)=>{
  try { const x=await db.transaction(trx=>workflow.create(trx,req.crmUser,req.body||{}));res.status(201).json(x); }
  catch(e){if(e instanceof workflow.WorkflowError)return res.status(e.status).json({error:e.message});next(e)}
});
router.post('/clients/:id/stop-monitoring',async(req,res,next)=>{
  try {const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Vigane klient.'});
    const x=await db.transaction(trx=>workflow.stop(trx,id,req.crmUser,req.body?.reason,req.body?.reply_ids));res.json(x);
  }catch(e){if(e instanceof workflow.WorkflowError)return res.status(e.status).json({error:e.message});next(e)}
});

// portfolio-transfer-v1

router.get('/admin/portfolios', async (req,res,next)=>{
  try {
    if(req.crmUser.role!=='admin')
      return res.status(403).json({error:'Ainult administraatorile.'});

    const users=await db('users')
      .select('id','name','role','is_active')
      .orderBy('name');

    const clients=await db('crm_clients')
      .select('id','name','owner_user_id','client_type','ionprint_id')
      .orderBy('name');

    res.set('Cache-Control','no-store');
    res.json({users,clients});
  } catch(e){next(e);}
});

router.get('/admin/portfolio-history',async(req,res,next)=>{
  try {
    if(req.crmUser.role!=='admin')
      return res.status(403).json({error:'Ainult administraatorile.'});

    const history=await db('crm_portfolio_transfers')
      .orderBy('id','desc').limit(30);

    res.set('Cache-Control','no-store');
    res.json({history});
  }catch(e){next(e);}
});

router.post('/admin/portfolio-transfer',async(req,res,next)=>{
  try {
    if(req.crmUser.role!=='admin')
      return res.status(403).json({error:'Ainult administraatorile.'});

    const {from_user_id,to_user_id,client_ids}=req.body||{};

    if(!Number.isSafeInteger(from_user_id) ||
       !Number.isSafeInteger(to_user_id) ||
       from_user_id===to_user_id ||
       !Array.isArray(client_ids) ||
       client_ids.length<1 || client_ids.length>500 ||
       !client_ids.every(x=>Number.isSafeInteger(x)&&x>0) ||
       new Set(client_ids).size!==client_ids.length){
      return res.status(400).json({error:'Vigased üleandmise andmed.'});
    }

    const outcome=await db.transaction(async trx=>{
      const users=await trx('users')
        .whereIn('id',[from_user_id,to_user_id])
        .select('id','name');

      if(users.length!==2)
        return {error:'Vastutajat ei leitud.',status:400};

      const clients=await trx('crm_clients')
        .whereIn('id',client_ids)
        .forUpdate()
        .select('id','name','owner_user_id','ionprint_id');

      if(clients.length!==client_ids.length ||
         clients.some(c=>Number(c.owner_user_id)!==from_user_id)){
        return {
          error:'Mõni klient ei kuulu enam valitud vastutajale. Värskenda nimekirja.',
          status:409
        };
      }

      const [transferId]=await trx('crm_portfolio_transfers').insert({
        from_user_id,
        to_user_id,
        performed_by:req.crmUser.id,
        client_count:clients.length,
        activity_count:0
      });

      const ids=clients.map(c=>c.id);

      await trx('crm_clients').whereIn('id',ids).update({
        owner_user_id:to_user_id,
        updated_at:trx.fn.now()
      });

      const moved=await trx('crm_activities')
        .whereIn('client_id',ids)
        .where('status','active')
        .update({
          owner_user_id:to_user_id,
          updated_at:trx.fn.now()
        });

      await trx('crm_portfolio_transfers')
        .where({id:transferId})
        .update({activity_count:moved});

      for(const client of clients){
        await trx('crm_portfolio_transfer_items').insert({
          transfer_id:transferId,
          client_id:client.id,
          client_name:client.name
        });

        await trx('crm_ionprint_sync_queue').insert({
          transfer_id:transferId,
          client_id:client.id,
          ionprint_id:client.ionprint_id||null,
          target_owner_user_id:to_user_id,
          status:client.ionprint_id
            ? 'awaiting_connection'
            : 'awaiting_mapping'
        });
      }

      return {
        transferred:clients.length,
        activities:moved,
        transfer_id:transferId,
        ionprint_status:'Ootab ühendamist'
      };
    });

    if(outcome.error)
      return res.status(outcome.status).json({error:outcome.error});

    res.json(outcome);
  }catch(e){next(e);}
});

router.use(require('./work-queues')(db));
router.use(require('./crm_budget_extension')(db));
router.use(require('./crm_v8_extension')(db));
router.use(require('./crm_mail_extension')(db));
router.use(require('./crm_imap_extension')(db));

module.exports = router;
