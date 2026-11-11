const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),express=require('express');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Synthetic DB required');
const db=require('../server/db');require('../scripts/local-database')(db);
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const w=require('../server/services/activity-workflow'),signatures=require('../server/services/mail-signatures');
let server,base,users=[],acting,template,calls=[],env;
const texts=['Company A\nPerson A\na@example.invalid','Company B\nPerson B\nb@example.invalid','Company C\nPerson C\nc@example.invalid'];
async function api(route,body,status=200,method=body===undefined?'GET':'PATCH'){
 const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const x=await r.json();assert.equal(r.status,status,JSON.stringify(x));return x;
}
async function fixture(user=users[0],body='Synthetic body'){
 const [client]=await db('crm_clients').insert({name:'Signature fixture '+crypto.randomUUID(),owner_user_id:user.id,followup_count:4});const [contact]=await db('crm_contacts').insert({client_id:client,name:'Synthetic contact',email:'recipient@example.invalid'});
 const task=await db.transaction(trx=>w.create(trx,user,{client_id:client,type:'E-kiri',template_id:template,purpose:'Signature test',subject:'Synthetic subject',instructions:body,due_date:w.today()}));return {client,contact,id:task.id};
}
async function send(f,extra={},status=200){return api('/mail/activity/'+f.id+'/send',{contact_id:f.contact,recipient:'recipient@example.invalid',template_id:template,purpose:'Signature test',subject:'Synthetic subject',body:'Synthetic body',...extra},status,'POST');}
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 for(const role of ['sales','sales','admin']){const [id]=await db('users').insert({name:'Synthetic signature owner',email:crypto.randomUUID()+'@example.invalid',password_hash:'synthetic-non-login',role,is_active:1});users.push({id,role});}
 [template]=await db('crm_templates').insert({name:'Signature test',purpose:'Signature test',type:'E-kiri',subject:'Synthetic subject',body:'Synthetic body',is_active:1});acting=users[0];env={CRM_SMTP_HOST:'unused.invalid',CRM_SMTP_PORT:'465'};
 for(const u of users){env['CRM_MAILBOX_'+u.id]='sender'+u.id+'@example.invalid';env['CRM_MAIL_PASSWORD_'+u.id]='synthetic-unused';}
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.crmUser=acting;next();});app.use(require('../server/routes/crm_mail_extension')(db,{env,createTransport:()=>({async sendMail(message){calls.push(message);return {accepted:[message.to],response:'250 synthetic'};},close(){}})}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('composition normalizes line breaks and removes repeated matching trailing signatures exactly once',()=>{
 const f=signatures.format;assert.equal(f.compose('Hello\r\n\r\n'+texts[0]+'\n\n'+texts[0],texts[0]),'Hello\n\n'+texts[0]);assert.equal(f.compose('Hello',''),'Hello');assert.equal(f.strip('Hello\n\n'+texts[0],[texts[0]]),'Hello');assert.equal(f.strip('Hello '+texts[0],[texts[0]]),'Hello '+texts[0]);
});
test('own signature is persistent and stale writes cannot overwrite a newer version',async()=>{
 assert.deepEqual(await api('/mail/signature'),{signature:'',version:0});assert.deepEqual(await api('/mail/signature',{signature:texts[0],version:0}),{signature:texts[0],version:1});await api('/mail/signature',{signature:'Stale',version:0},409);assert.equal((await api('/mail/signature')).signature,texts[0]);
});
test('signatures are user-specific, and only an active administrator can manage another user',async()=>{
 await api('/admin/users-real/'+users[1].id+'/signature',{signature:'Wrong owner',version:0},403);
 acting=users[2];await api('/admin/users-real/'+users[1].id+'/signature',{signature:texts[1],version:0});const list=await api('/admin/users-real');assert.equal(list.users.find(u=>u.id===users[1].id).signature,texts[1]);
 acting=users[1];assert.equal((await api('/mail/signature')).signature,texts[1]);acting=users[0];assert.equal((await api('/mail/signature')).signature,texts[0]);
 await assert.rejects(signatures.save(db,{...users[0],role:'admin'},users[1].id,{signature:'Impersonated admin',version:1}),e=>e.status===403);
});
test('invalid signatures and profile field injection are rejected before saving',async()=>{
 for(const x of [{signature:'x'.repeat(3001),version:1},{signature:{html:'unsafe'},version:1},{signature:'Null\u0000byte',version:1},{signature:'Other',version:1,user_id:users[1].id}])await api('/mail/signature',x,400);
 assert.equal((await api('/mail/signature')).signature,texts[0]);
});
test('composer exposes own saved signature separately and strips an already embedded copy from the draft',async()=>{
 const f=await fixture(users[0],'Synthetic body\n\n'+texts[0]);const draft=await api('/mail/activity/'+f.id);assert.equal(draft.signature.signature,texts[0]);assert.equal(draft.draft_body,'Synthetic body');assert.equal(draft.activity.instructions,'Synthetic body\n\n'+texts[0]);
});
test('sending appends the saved signature to text, HTML and history, but leaves the next draft unsigned',async()=>{
 const f=await fixture(),before=calls.length,result=await send(f);assert.equal(calls.length,before+1);const sent='Synthetic body\n\n'+texts[0];assert.equal(calls.at(-1).text,sent);assert.ok(calls.at(-1).html.includes('Person A'));
 const row=await db('crm_email_outbox').where({activity_id:f.id}).first();assert.equal(row.body,sent);assert.equal((await db('crm_activity_details').where({activity_id:f.id}).first()).instructions,'Synthetic body');
 const event=await db('crm_v8_activity_events').where({activity_id:f.id,event_type:'completed_default_followup'}).first();assert.ok(JSON.parse(event.details).comment.endsWith(sent));
 const draft=await api('/mail/activity/'+result.completion.next_activity_id);assert.equal(draft.draft_body,'Synthetic body');assert.equal(draft.signature.signature,texts[0]);assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,5);
 await send(f,{},409);assert.equal(calls.length,before+1);
});
test('per-message signature edits and removal are honored without changing the saved profile',async()=>{
 const f=await fixture();await send(f,{signature:'Custom per-message signature'});assert.equal(calls.at(-1).text,'Synthetic body\n\nCustom per-message signature');assert.equal((await api('/mail/signature')).signature,texts[0]);
 const blank=await fixture();await send(blank,{body:'Synthetic body\n\n'+texts[0],signature:''});assert.equal(calls.at(-1).text,'Synthetic body');assert.equal((await api('/mail/signature')).signature,texts[0]);
});
test('signature from a second sender cannot leak into the first users sends',async()=>{
 acting=users[1];const f=await fixture(users[1]);await send(f);assert.ok(calls.at(-1).text.endsWith(texts[1]));assert.equal(calls.at(-1).text.includes(texts[0]),false);assert.equal(calls.at(-1).from.address,env['CRM_MAILBOX_'+users[1].id]);acting=users[0];
});
test('full message length including signature is checked before SMTP and outbox reservation',async()=>{
 const f=await fixture(),count=calls.length;await send(f,{body:'x'.repeat(9990)},400);assert.equal(calls.length,count);assert.equal((await db('crm_email_outbox').where({activity_id:f.id})).length,0);
});
test('concurrent own signature updates are versioned and cannot both overwrite the same saved value',async()=>{
 const current=await api('/mail/signature');const results=await Promise.allSettled(['One','Two'].map(signature=>signatures.save(db,users[0],users[0].id,{signature,version:current.version})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal((await api('/mail/signature')).version,current.version+1);
});

test('customer reply keeps its thread and acknowledgement workflow while appending the saved signature exactly once',async()=>{
 acting=users[0];const profile=await api('/mail/signature'),original=await fixture();await send(original);const outbox=await db('crm_email_outbox').where({activity_id:original.id}).first();
 const messageId='<combined-'+crypto.randomUUID()+'@example.invalid>';const [reply]=await db('crm_email_inbox').insert({mailbox_user_id:users[0].id,outbox_id:outbox.id,client_id:original.client,activity_id:original.id,sender:'recipient@example.invalid',recipient:env['CRM_MAILBOX_'+users[0].id],subject:'Re: Synthetic subject',body:'Synthetic feedback',message_id:messageId,received_at:db.fn.now()});
 const opened=await api('/mail/replies/'+reply+'/draft',{},200,'POST'),draft=await api('/mail/activity/'+opened.id);assert.equal(draft.reply.id,reply);assert.equal(draft.signature.signature,profile.signature);assert.equal((await db('crm_email_inbox').where({id:reply}).first()).handled_at,null);
 const result=await api('/mail/activity/'+opened.id+'/send',{contact_id:original.contact,recipient:'recipient@example.invalid',template_id:null,purpose:draft.activity.purpose,subject:draft.activity.subject,body:'Combined response\n\n'+profile.signature,signature:profile.signature,reply_ids:[reply]},200,'POST');
 assert.equal(calls.at(-1).text,'Combined response\n\n'+profile.signature);assert.ok(calls.at(-1).html.includes(profile.signature));assert.equal(calls.at(-1).inReplyTo,messageId);assert.deepEqual(calls.at(-1).references,[messageId]);assert.ok((await db('crm_email_inbox').where({id:reply}).first()).handled_at);assert.equal(result.completion.followup_source,'reply_wait');
 assert.equal((await db('crm_activity_details').where({activity_id:opened.id}).first()).instructions,'Combined response');assert.equal((await db('crm_activity_details').where({activity_id:result.completion.next_activity_id}).first()).instructions.includes(profile.signature),false);
});
