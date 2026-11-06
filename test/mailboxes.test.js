const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit synthetic DB required');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const boxes=require('../server/services/mailboxes'),createSync=require('../server/services/mailbox-sync'),w=require('../server/services/activity-workflow');
const setup=require('../ops/staff-mailbox-settings');
const express=require('express');
let users=[],templates,env,acting,server,base,calls=[],messages=new Map(),failAddress=null,sync,clientCalls=[];
const secret='SYNTHETIC_MAIL_SECRET_NOT_FOR_OUTPUT';
function fakeClient(config){
 clientCalls.push(config);
 const list=messages.get(config.auth.user)||[];
 return {async connect(){if(config.auth.user===failAddress)throw Error(secret);},async getMailboxLock(name,opts){assert.equal(name,'INBOX');assert.equal(opts.readOnly,true);return {release(){}};},async search(){return list.map((_,i)=>i);},async fetchOne(uid){return {source:Buffer.from(JSON.stringify(list[uid]))};},async logout(){},close(){}};
}
const parseMessage=async source=>{const p=JSON.parse(source.toString());p.date=new Date('2026-01-02T12:00:00Z');return p;};
async function fixture(user,label){
 const [client]=await db('crm_clients').insert({name:'Mailbox fixture '+label,owner_user_id:user.id,followup_count:2});
 const recipient='contact-'+crypto.randomBytes(5).toString('hex')+'@example.invalid';
 const [contact]=await db('crm_contacts').insert({client_id:client,name:'Synthetic recipient',email:recipient});
 const created=await db.transaction(trx=>w.create(trx,user,{client_id:client,type:'E-kiri',template_id:templates['E-kiri'],purpose:'Test E-kiri',subject:'Synthetic subject',instructions:'Synthetic body',due_date:w.today()}));
 return {client,contact,recipient,activity:created.id,user};
}
async function sent(user,label){
 const item=await fixture(user,label),messageId='<sent-'+crypto.randomBytes(8).toString('hex')+'@example.invalid>';
 await db('crm_email_outbox').insert({activity_id:item.activity,client_id:item.client,contact_id:item.contact,user_id:user.id,sender:boxes.settings(user.id,env).address,recipient:item.recipient,subject:'Synthetic original',body:'Synthetic body',message_id:messageId,status:'sent',sent_at:db.fn.now()});
 const completion=await db.transaction(trx=>w.complete(trx,item.activity,user,{}));
 return {...item,messageId,followup:completion.next_activity_id};
}
const reply=(item,suffix='')=>({messageId:'reply-'+item.activity+suffix+'@example.invalid',from:{value:[{address:item.recipient}]},inReplyTo:item.messageId,text:'Synthetic customer reply',subject:'Re: Synthetic original'});
async function api(route,body,status=200){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});templates=(await require('../scripts/seed-test')(db)).templates;
 for(const label of ['First','Second','Disabled']){const [id]=await db('users').insert({name:'Mailbox '+label,email:'mail-login-'+crypto.randomBytes(6).toString('hex')+'@example.invalid',password_hash:'synthetic-non-login-hash',role:'sales',is_active:label==='Disabled'?0:1});users.push({id,name:label,role:'sales'});}
 env={CRM_SMTP_HOST:'global.smtp.invalid',CRM_IMAP_HOST:'global.imap.invalid',CRM_IMAP_ENABLED:'1'};
 for(const user of users){env['CRM_MAILBOX_'+user.id]='box-'+user.id+'@example.invalid';env['CRM_MAIL_PASSWORD_'+user.id]=secret;}
 env['CRM_SMTP_HOST_'+users[1].id]='smtp.zone.eu';env['CRM_IMAP_HOST_'+users[1].id]='imap.zone.eu';
 sync=createSync(db,{env,createClient:fakeClient,parseMessage});acting=users[0];
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.crmUser=acting;next();});
 app.use('/api',require('../server/routes/crm_imap_extension')(db,{env,createClient:fakeClient,parseMessage,schedule:false}));
 app.use('/api',require('../server/routes/crm_mail_extension')(db,{env,createTransport:config=>{calls.push(config);return {async sendMail(mail){calls.at(-1).message=mail;if(mail.subject==='Synthetic failure')throw Error(secret);return {accepted:[mail.to],response:'250 synthetic accepted'};},close(){}};}}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{
 if(server)await new Promise(r=>server.close(r));
 if(users.length){await db('crm_email_inbox').whereIn('mailbox_user_id',users.map(u=>u.id)).delete();await db('crm_email_outbox').whereIn('user_id',users.map(u=>u.id)).delete();}
 await db.destroy();
});
test('mailbox identities and per-user host overrides stay separate from login identities and old global settings',async()=>{
 const first=boxes.settings(users[0].id,env),second=boxes.settings(users[1].id,env);
 assert.equal(first.smtp.host,'global.smtp.invalid');assert.equal(second.smtp.host,'smtp.zone.eu');assert.equal(second.imap.host,'imap.zone.eu');assert.equal(second.smtp.port,465);assert.equal(second.imap.port,993);assert.equal(second.smtp.secure,true);
 assert.equal(env.CRM_SMTP_HOST,'global.smtp.invalid');assert.equal(boxes.pollingEnabled({CRM_IMAP_ENABLED:'0',CRM_IMAP_ENABLED_2:'1'}),true);
 assert.equal(boxes.settings(users[0].id,{...env,['CRM_IMAP_ENABLED_'+users[0].id]:'0'}).enabled,false);
 const status=await sync.status();assert.equal(JSON.stringify(status).includes(secret),false);assert.equal(status.mailboxes.some(s=>s.user_id===users[2].id),false);
 const login=await db('users').where({id:users[1].id}).first();assert.notEqual(login.email,second.address);
});
test('multiple active mailboxes import only their own referenced replies, deduplicate and attribute followup cancellation correctly',async()=>{
 const first=await sent(users[0],'first'),second=await sent(users[1],'second');
 const forged=reply(second,'forged'),wrong=reply(first,'wrong');wrong.from.value[0].address='other@example.invalid';
 messages=new Map([[boxes.settings(users[0].id,env).address,[reply(first),forged,wrong,{messageId:'unrelated@example.invalid',from:{value:[{address:first.recipient}]},subject:'Same subject',text:'No reference'}]],[boxes.settings(users[1].id,env).address,[reply(second)]],[boxes.settings(users[2].id,env).address,[reply(second,'disabled')]]]);
 const before=await db('crm_clients').whereIn('id',[first.client,second.client]).orderBy('id');
 const report=await sync.sync();assert.equal(report.imported,2);assert.equal(report.matched,2);assert.equal(report.mailboxes.length,2);assert.ok(clientCalls.every(c=>c.auth.user!==boxes.settings(users[2].id,env).address));
 const rows=await db('crm_email_inbox').whereIn('mailbox_user_id',users.slice(0,2).map(u=>u.id)).whereIn('outbox_id',(await db('crm_email_outbox').whereIn('activity_id',[first.activity,second.activity])).map(x=>x.id)).orderBy('mailbox_user_id');
 assert.deepEqual(rows.map(r=>r.mailbox_user_id),users.slice(0,2).map(u=>u.id));assert.equal(rows[1].recipient,boxes.settings(users[1].id,env).address);
 for(const item of [first,second]){assert.equal((await db('crm_activities').where({id:item.followup}).first()).status,'stopped');const e=await db('crm_v8_activity_events').where({activity_id:item.followup,event_type:'auto_followup_cancelled_reply'}).first();assert.equal(e.user_id,item.user.id);}
 assert.deepEqual((await db('crm_clients').whereIn('id',[first.client,second.client]).orderBy('id')).map(c=>c.followup_count),before.map(c=>c.followup_count));
 assert.equal((await sync.sync()).imported,0);
 const parallel=await Promise.all([sync.sync(),sync.sync()]);assert.ok(parallel.some(r=>r.skipped&&r.reason==='already_running'));
});
test('human-edited or transferred followups are preserved when a reply arrives',async()=>{
 const edited=await sent(users[0],'edited'),transferred=await sent(users[0],'transferred');
 await db('crm_v8_activity_events').insert({activity_id:edited.followup,user_id:users[0].id,event_type:'postponed',details:'{}'});
 await db('crm_clients').where({id:transferred.client}).update({owner_user_id:users[1].id});
 messages=new Map([[boxes.settings(users[0].id,env).address,[reply(edited),reply(transferred)]]]);
 const result=await sync.sync();assert.equal(result.imported,2);
 for(const item of [edited,transferred])assert.equal((await db('crm_activities').where({id:item.followup}).first()).status,'active');
});
test('one failing mailbox does not block another and no provider errors expose credentials',async()=>{
 const second=await sent(users[1],'fault isolated');failAddress=boxes.settings(users[0].id,env).address;
 messages=new Map([[boxes.settings(users[1].id,env).address,[reply(second)]]]);
 try{const report=await sync.sync();assert.equal(report.imported,1);assert.equal(report.mailboxes[0].status,'error');assert.equal(report.mailboxes[1].status,'ok');assert.equal(JSON.stringify(report).includes(secret),false);}
 finally{failAddress=null;}
});
test('large Unicode replies fit TEXT without corrupting characters',async()=>{
 const item=await sent(users[1],'unicode'),message=reply(item);message.text='😀'.repeat(20000);messages=new Map([[boxes.settings(users[1].id,env).address,[message]]]);
 assert.equal((await sync.sync()).imported,1);const row=await db('crm_email_inbox').where({activity_id:item.activity}).first();assert.ok(Buffer.byteLength(row.body)<=64000);assert.equal(row.body.includes('\uFFFD'),false);
});
test('duplicate configured addresses fail before connecting and non-admin sync/status requests are denied',async()=>{
 const duplicate=createSync(db,{env:{...env,['CRM_MAILBOX_'+users[1].id]:boxes.settings(users[0].id,env).address},createClient:()=>{throw Error('must not connect');},parseMessage});
 await assert.rejects(duplicate.sync(),/seadistus/);
 acting=users[0];await api('/api/mail/imap/status',undefined,403);await api('/api/mail/imap/sync',{},403);
 acting={...users[0],role:'admin'};const status=await api('/api/mail/imap/status');assert.equal(status.mailboxes.filter(m=>m.imap_configured).length,2);assert.equal(JSON.stringify(status).includes(secret),false);acting=users[0];
});
test('SMTP uses the owners CRM mailbox and override host, completes once, and prevents duplicate sends',async()=>{
 const item=await fixture(users[1],'SMTP success');acting=users[1];const before=await db('crm_clients').where({id:item.client}).first();
 const body={contact_id:item.contact,recipient:item.recipient,subject:'Synthetic success',body:'Synthetic body',template_id:templates['E-kiri'],purpose:'Test E-kiri',user_id:users[0].id};
 const count=calls.length;await api('/api/mail/activity/'+item.activity+'/send',body);
 assert.equal(calls.length,count+1);const transport=calls.at(-1);assert.equal(transport.host,'smtp.zone.eu');assert.equal(transport.auth.user,boxes.settings(users[1].id,env).address);assert.equal(transport.message.from.address,transport.auth.user);assert.equal(transport.message.replyTo,transport.auth.user);
 await api('/api/mail/activity/'+item.activity+'/send',body,409);assert.equal(calls.length,count+1);
 assert.equal((await db('crm_clients').where({id:item.client}).first()).followup_count,before.followup_count+1);
 const status=await api('/api/mail/status');assert.equal(status.address,transport.auth.user);assert.equal(JSON.stringify(status).includes(secret),false);
});
test('SMTP failure stays uncertain, never retries automatically and does not persist secret exception text',async()=>{
 const item=await fixture(users[0],'SMTP failure');acting=users[0];const before=await db('crm_clients').where({id:item.client}).first();
 const body={contact_id:item.contact,recipient:item.recipient,subject:'Synthetic failure',body:'Synthetic body',template_id:templates['E-kiri'],purpose:'Test E-kiri'};
 const count=calls.length,result=await api('/api/mail/activity/'+item.activity+'/send',body,502);assert.equal(JSON.stringify(result).includes(secret),false);
 const row=await db('crm_email_outbox').where({activity_id:item.activity}).first();assert.equal(row.status,'uncertain');assert.equal(row.smtp_response.includes(secret),false);
 await api('/api/mail/activity/'+item.activity+'/send',body,409);assert.equal(calls.length,count+1);assert.equal((await db('crm_activities').where({id:item.activity}).first()).status,'active');assert.equal((await db('crm_clients').where({id:item.client}).first()).followup_count,before.followup_count);
});
test('credential setup verifies first, preserves existing settings and backs up the private env atomically',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ellington-mailbox-test-')),file=path.join(dir,'.env');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original='DB_HOST=localhost\nDB_NAME=d24248_ellingtoncrm\nSESSION_SECRET="SYNTHETIC_SESSION"\nCRM_MAILBOX_1=original@example.invalid\nCRM_MAIL_PASSWORD_1="UNCHANGED"\nCRM_IMAP_ENABLED=0\n';fs.writeFileSync(file,original,{mode:0o600});
 const passwords={2:'synthetic # " quote \\ password',3:"synthetic ' single quote password"};let verified=[];
 const result=await setup.configure(file,passwords,{checkUsers:async(env,staff)=>{assert.equal(staff[0].login,'indrek@ellington.ee');assert.equal(staff[1].login,'palme@ellington.ee');},verify:async(id,env)=>{verified.push(id);assert.equal(env['CRM_MAIL_PASSWORD_'+id],passwords[id]);assert.equal(fs.readFileSync(file,'utf8'),original);}});
 const next=require('dotenv').parse(fs.readFileSync(file));assert.deepEqual(verified,[2,3]);assert.equal(next.CRM_MAILBOX_2,'indrek.mae@ellington.ee');assert.equal(next.CRM_MAILBOX_3,'palme.kaggovere@ellington.ee');assert.equal(next.CRM_MAIL_PASSWORD_2,passwords[2]);assert.equal(next.CRM_MAIL_PASSWORD_1,'UNCHANGED');assert.equal(next.CRM_IMAP_ENABLED,'0');assert.equal(next.CRM_IMAP_ENABLED_2,'1');assert.equal(fs.readFileSync(result.backup,'utf8'),original);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(JSON.stringify(result).includes(passwords[2]),false);
});
test('failed verification or a concurrent env edit cannot overwrite the configuration',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ellington-mailbox-failure-')),file=path.join(dir,'.env');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(file,'SESSION_SECRET=before\n',{mode:0o600});const passwords={2:secret,3:secret};
 const checked=[];await assert.rejects(setup.configure(file,passwords,{checkUsers:async()=>{},verify:async id=>{checked.push(id);if(id===3)throw Error('synthetic verification failure');}}));assert.deepEqual(checked,[2,3]);assert.equal(fs.readFileSync(file,'utf8'),'SESSION_SECRET=before\n');assert.deepEqual(fs.readdirSync(dir),['.env']);
 await assert.rejects(setup.configure(file,passwords,{checkUsers:async()=>{},verify:async()=>{fs.writeFileSync(file,'SESSION_SECRET=concurrent\n');}}),/ENV_CHANGED/);assert.equal(fs.readFileSync(file,'utf8'),'SESSION_SECRET=concurrent\n');
});
test('malformed messages do not block the rest of a mailbox and errors contain no message text',async()=>{
 const item=await sent(users[1],'parse isolation'),address=boxes.settings(users[1].id,env).address;
 messages=new Map([[address,[{broken:true},reply(item)]]]);
 const worker=createSync(db,{env,createClient:fakeClient,parseMessage:async source=>{const value=JSON.parse(source.toString());if(value.broken)throw Error(secret);return parseMessage(source);}});
 const result=await worker.sync();assert.equal(result.imported,1);assert.equal(result.mailboxes.find(m=>m.user_id===users[1].id).message_errors,1);assert.equal(JSON.stringify(result).includes(secret),false);
});
test('polling remains bounded to the newest 250 messages',async()=>{
 const item=await sent(users[1],'bounded polling'),address=boxes.settings(users[1].id,env).address;
 const list=Array.from({length:251},(_,i)=>({messageId:'unmatched-'+i+'@example.invalid',from:{value:[{address:item.recipient}]},text:'No reference'}));
 list[0]=reply(item,'oldest');list[250]=reply(item,'newest');messages=new Map([[address,list]]);
 const result=await sync.sync();assert.equal(result.scanned,250);assert.equal(result.imported,1);
 assert.equal(await db('crm_email_inbox').where({mailbox_user_id:users[1].id,message_id:'<'+list[0].messageId+'>'}).first(),undefined);
});
