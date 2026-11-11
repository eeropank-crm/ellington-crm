const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),express=require('express');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Synthetic DB required');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const w=require('../server/services/activity-workflow'),history=require('../public/mail-history');let server,base,users=[],acting,template,calls=[],env;
async function api(route,body,status=200){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const x=await r.json();assert.equal(r.status,status,JSON.stringify(x));return x;}
async function fixture(){
 const [client]=await db('crm_clients').insert({name:'Synthetic reply '+crypto.randomUUID(),owner_user_id:users[0].id,followup_count:2});
 const [contact]=await db('crm_contacts').insert({client_id:client,name:'Synthetic customer',email:'customer@example.invalid'});
 const task=await db.transaction(trx=>w.create(trx,users[0],{client_id:client,type:'E-kiri',template_id:template,purpose:'Synthetic initial',subject:'Original subject',instructions:'Unique original mail body',due_date:w.today()}));
 const [outbox]=await db('crm_email_outbox').insert({activity_id:task.id,client_id:client,contact_id:contact,user_id:users[0].id,sender:'sender@example.invalid',recipient:'customer@example.invalid',subject:'Original subject',body:'Unique original mail body',message_id:'<original-'+crypto.randomUUID()+'@example.invalid>',status:'sent',sent_at:db.fn.now()});
 const completed=await db.transaction(trx=>w.complete(trx,task.id,users[0],{}));
 const messageId='<reply-'+crypto.randomUUID()+'@example.invalid>',body='Customer feedback\n\nOn Monday Sender wrote:\n> Unique original mail body';
 const [reply]=await db('crm_email_inbox').insert({mailbox_user_id:users[0].id,outbox_id:outbox,client_id:client,activity_id:task.id,sender:'customer@example.invalid',recipient:'sender@example.invalid',subject:'Re: Original subject',body,message_id:messageId,received_at:db.fn.now()});
 await db.transaction(async trx=>{await trx('crm_activities').where({id:completed.next_activity_id}).update({status:'stopped'});await w.event(trx,completed.next_activity_id,users[0],'auto_followup_cancelled_reply',{inbox_message_id:messageId,original_activity_id:task.id});});
 return {client,contact,reply,messageId,body,original:task.id,cancelled:completed.next_activity_id};
}
async function open(f){const x=await api('/mail/replies/'+f.reply+'/draft',{});return {...f,id:x.id};}
async function send(f,extra={},status=200){return api('/mail/activity/'+f.id+'/send',{contact_id:f.contact,recipient:'customer@example.invalid',template_id:null,purpose:'Tänud tagasiside eest',subject:'Re: Original subject',body:'Thanks for the feedback',reply_ids:[f.reply],...extra},status);}
async function row(f){return db('crm_email_inbox').where({id:f.reply}).first();}
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 for(const role of ['sales','sales','admin']){const [id]=await db('users').insert({name:'Synthetic reply user',email:crypto.randomUUID()+'@example.invalid',password_hash:'synthetic-non-login',role,is_active:1});users.push({id,role});}
 [template]=await db('crm_templates').insert({name:'Synthetic initial',purpose:'Synthetic initial',type:'E-kiri',subject:'Original subject',body:'Unique original mail body',is_active:1});
 acting=users[0];env={CRM_SMTP_HOST:'unused.invalid',CRM_SMTP_PORT:'465'};for(const u of users){env['CRM_MAILBOX_'+u.id]='sender'+u.id+'@example.invalid';env['CRM_MAIL_PASSWORD_'+u.id]='synthetic-unused';}
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.crmUser=acting;req.session={userId:acting.id};next();});
 app.use(require('../server/routes/crm_mail_extension')(db,{env,createTransport:()=>({async sendMail(message){calls.push(message);if(message.subject==='Synthetic failure')throw Error('Synthetic SMTP error');if(message.subject==='Synthetic DB failure'){const reserved=await db('crm_email_outbox').where({message_id:message.messageId}).first();await db('crm_clients').where({id:reserved.client_id}).update({stop_reason:'Synthetic concurrent stop'});}return {accepted:[message.to],response:'250 synthetic'};},close(){}})}));
 app.use(require('../server/routes/crm_imap_extension')(db,{env,schedule:false}));app.use(require('../server/routes/crm'));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('quote boundaries collapse only the display; all quoted and inline text remains available',()=>{
 for(const body of ['Reply\n\nKontakt Sender kirjutas kuupäeval K, 11. november:\n> Old text','Reply\n\nOn Monday Sender\n<sender@example.invalid> wrote:\n> Old text','Reply\n\nOn Monday Sender wrote:\n> Original','Reply\n\nFrom: sender@example.invalid\nSent: Monday\nTo: customer\nSubject: Original\nOld text','Reply\n> Original\nInline reply after quote']){const x=history.split(body);assert.ok(x.quoted);assert.equal(x.text+'\n'+x.quoted,body);}
 for(const body of ['No quotes\nKeep everything','From: a colleague\nThis is actual feedback','2 > 1\nNormal content','<script>alert(1)</script>'])assert.deepEqual(history.split(body),{text:body,quoted:''});
});
test('opening and concurrently reopening a reply creates one resumable draft, not a send or an acknowledgement',async()=>{
 const f=await fixture(),before=await db('crm_clients').where({id:f.client}).first();const count=calls.length;
 const values=await Promise.all([open(f),open(f)]);assert.equal(values[0].id,values[1].id);const draft=await api('/mail/activity/'+values[0].id);assert.equal(draft.activity.purpose,'Tänud tagasiside eest');assert.ok(draft.activity.instructions.includes('Tänud tagasiside eest'));assert.equal(draft.activity.subject,'Re: Original subject');assert.equal(draft.reply.body,f.body);assert.equal(draft.reply.sender,'customer@example.invalid');assert.equal(draft.embedded_template,true);
 assert.equal((await row(f)).handled_at,null);assert.equal(calls.length,count);assert.deepEqual(await db('crm_clients').where({id:f.client}).first(),before);
});
test('the existing administrator-editable thank-you template supplies the initial content without its followup chain',async()=>{
 const [id]=await db('crm_templates').insert({name:'Tänud tagasiside eest',purpose:'Tänud tagasiside eest',type:'E-kiri',subject:'Template subject',body:'Custom thanks',is_active:1,next_step_json:JSON.stringify({type:'Kõne',purpose:'Template next',body:'Next',days:2})});
 try{const f=await open(await fixture()),draft=await api('/mail/activity/'+f.id);assert.equal(draft.activity.instructions,'Custom thanks');const result=await send(f,{template_id:id,purpose:'Tänud tagasiside eest'});assert.equal(result.completion.followup_source,'reply_wait');assert.equal(result.completion.due_date,w.today(new Date(Date.now()+14*86400000)));}finally{await db('crm_templates').where({id}).delete();}
});
test('successful reply sends thread headers, handles only that reply, increments once and creates a 14-day wait',async()=>{
 const f=await open(await fixture()),other=await fixture(),before=(await db('crm_clients').where({id:f.client}).first()).followup_count;
 const result=await send(f);assert.equal(calls.at(-1).inReplyTo,f.messageId);assert.deepEqual(calls.at(-1).references,[f.messageId]);assert.equal(calls.at(-1).text,'Thanks for the feedback');assert.ok(calls.at(-1).html);assert.ok((await row(f)).handled_at);assert.equal((await row(other)).handled_at,null);
 assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,before+1);assert.equal(result.completion.followup_source,'reply_wait');assert.equal(result.completion.followup.type,'Kõne');assert.equal(result.completion.due_date,w.today(new Date(Date.now()+14*86400000)));
 const next=await db('crm_activity_details').where({activity_id:result.completion.next_activity_id}).first();assert.equal(next.instructions.includes('Thanks for the feedback'),false);assert.equal(next.instructions.includes('Unique original mail body'),false);
 const count=calls.length;await send(f,{},409);assert.equal(calls.length,count);await api('/mail/replies/'+f.reply+'/draft',{},409);
});
test('after sending the next step can be replanned or monitoring stopped with an audited reason',async()=>{
 const [call]=await db('crm_templates').insert({name:'Synthetic call',purpose:'Synthetic call',type:'Kõne',body:'Call later',is_active:1});
 const first=await open(await fixture()),sent=await send(first);await db.transaction(trx=>w.selectNext(trx,first.id,users[0],{next:'plan',planned:{type:'Kõne',template_id:call,purpose:'Synthetic call',instructions:'Discuss feedback',due_date:w.today(new Date(Date.now()+86400000))}}));
 assert.equal((await db('crm_activity_details').where({activity_id:sent.completion.next_activity_id}).first()).instructions,'Discuss feedback');
 const [reason]=await db('crm_v8_stop_reasons').insert({label:'Synthetic reason',is_active:1,sort_order:999});const second=await open(await fixture());await send(second);await db.transaction(trx=>w.selectNext(trx,second.id,users[0],{next:'stop',reason_id:reason}));assert.equal((await db('crm_clients').where({id:second.client}).first()).stop_reason,'Synthetic reason');
});
test('SMTP uncertainty never handles the reply, increments counters or starts a waiting period; retries remain blocked',async()=>{
 const f=await open(await fixture()),before=await db('crm_clients').where({id:f.client}).first();await send(f,{subject:'Synthetic failure'},502);assert.equal((await row(f)).handled_at,null);assert.deepEqual(await db('crm_clients').where({id:f.client}).first(),before);assert.equal((await db('crm_activities').where({id:f.id}).first()).status,'active');assert.equal((await db('crm_email_outbox').where({activity_id:f.id}).first()).status,'uncertain');await send(f,{},409);
});
test('other users, administrators and transferred clients cannot answer through the wrong mailbox',async()=>{
 const f=await fixture();for(const u of users.slice(1)){acting=u;await api('/mail/replies/'+f.reply+'/draft',{},403);}acting=users[0];const draft=await open(f);await db('crm_clients').where({id:f.client}).update({owner_user_id:users[1].id});await send(draft,{},403);acting=users[1];await api('/mail/replies/'+f.reply+'/draft',{},403);acting=users[0];
});
test('invalid recipients, unrelated reply IDs and stale already-handled replies fail before SMTP',async()=>{
 const f=await open(await fixture()),other=await fixture(),count=calls.length;await send(f,{recipient:'wrong@example.invalid'},400);await send(f,{reply_ids:[other.reply]},400);assert.equal(calls.length,count);assert.equal((await row(f)).handled_at,null);await db('crm_email_inbox').where({id:f.reply}).update({handled_at:db.fn.now()});await send(f,{},409);assert.equal(calls.length,count);
});
test('legacy summary acknowledgement is rejected and draft conversion cannot bypass the reply workflow',async()=>{
 const f=await open(await fixture());await api('/mail/reply-alerts/'+f.reply+'/handled',{note:'Summary only'},409);assert.equal((await row(f)).handled_at,null);await assert.rejects(db.transaction(trx=>w.editable(trx,f.id,users[0])),e=>e.status===409);
});
test('client-card history recognizes automatic reply cancellation and provides sent-mail summaries without rewriting stored content',async()=>{
 const f=await fixture(),before=await row(f),card=await api('/clients/'+f.client);const stopped=card.activityHistory.find(a=>a.id===f.cancelled),sent=card.activityHistory.find(a=>a.id===f.original);assert.equal(stopped.cancelled_by_reply,true);assert.equal(stopped.has_completion_event,true);assert.match(stopped.result_comment,/Kliendi vastus saabus/);assert.equal(sent.sent_mail.subject,'Original subject');assert.equal(sent.instructions,'Unique original mail body');assert.ok(sent.result_comment.includes('Unique original mail body'));assert.deepEqual(await row(f),before);
});

test('manual planning or unrelated completion cannot silently acknowledge an unsent customer reply',async()=>{
 const f=await fixture();await assert.rejects(db.transaction(trx=>w.replies(trx,f.client,[f.reply],users[0],null,'reviewed','Summary')),e=>e.status===409);
 await assert.rejects(db.transaction(trx=>w.create(trx,users[0],{client_id:f.client,type:'E-kiri',template_id:template,purpose:'Synthetic initial',subject:'Unrelated',instructions:'Unrelated',due_date:w.today(),reply_ids:[f.reply]})),e=>e.status===409);
 const manual=await db.transaction(trx=>w.create(trx,users[0],{client_id:f.client,type:'E-kiri',template_id:template,purpose:'Synthetic initial',subject:'Unrelated',instructions:'Unrelated',due_date:w.today()}));
 const count=calls.length;await api('/mail/activity/'+manual.id+'/send',{contact_id:f.contact,recipient:'customer@example.invalid',template_id:template,purpose:'Synthetic initial',subject:'Unrelated',body:'Unrelated',reply_ids:[f.reply]},409);assert.equal(calls.length,count);
 assert.equal((await row(f)).handled_at,null);
});
test('two simultaneous reply sends reserve one message and handle the bound reply exactly once',async()=>{
 const f=await open(await fixture()),before=calls.length;const results=await Promise.all([fetch(base+'/mail/activity/'+f.id+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact_id:f.contact,recipient:'customer@example.invalid',template_id:null,purpose:'Tänud tagasiside eest',subject:'Concurrent reply',body:'One reply'})}),fetch(base+'/mail/activity/'+f.id+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact_id:f.contact,recipient:'customer@example.invalid',template_id:null,purpose:'Tänud tagasiside eest',subject:'Concurrent reply',body:'One reply'})})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(calls.length,before+1);assert.ok((await row(f)).handled_at);
});

test('SMTP acceptance followed by a DB failure keeps the reply unhandled and the durable send reservation blocks retry',async()=>{
 const f=await open(await fixture()),before=calls.length;await send(f,{subject:'Synthetic DB failure'},503);assert.equal(calls.length,before+1);assert.equal((await row(f)).handled_at,null);assert.equal((await db('crm_email_outbox').where({activity_id:f.id}).first()).status,'sending');assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,3);await send(f,{},409);assert.equal(calls.length,before+1);
});
