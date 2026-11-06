const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),express=require('express');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit synthetic DB required');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const w=require('../server/services/activity-workflow');
let server,base,user,other,acting,calls=[],env;
const steps=()=>({type:'E-kiri',purpose:'Video järelkiri '+crypto.randomUUID(),subject:'Uue sisuga järelkiri',body:'Sünteetiline teine kiri, mitte esimese kirja koopia.',days:2,nextStep:{type:'Kõne',purpose:'Video järelkõne',body:'Uuri tagasisidet.',days:1,nextStep:null}});
async function api(route,body,status=200,method=body===undefined?'GET':'POST'){
 const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const x=await r.json();assert.equal(r.status,status,JSON.stringify(x));return x;
}
async function fixture(type='E-kiri',next=steps()){
 const [client]=await db('crm_clients').insert({name:'Synthetic template flow '+crypto.randomUUID(),owner_user_id:user.id,followup_count:0});
 const [contact]=await db('crm_contacts').insert({client_id:client,name:'Synthetic contact',email:'contact@example.invalid'});
 const [template]=await db('crm_templates').insert({name:'Video tutvustus',purpose:'Video tutvustus',type,subject:type==='E-kiri'?'Esimene kiri':'',body:'Sünteetiline esimene sisu.',next_step_json:next?JSON.stringify(next):null,is_active:1});
 const a=await db.transaction(trx=>w.create(trx,user,{client_id:client,contact_id:contact,type,template_id:template,purpose:'Video tutvustus',subject:type==='E-kiri'?'Esimene kiri':'',instructions:'Sünteetiline esimene sisu.',due_date:w.today()}));
 return {client,contact,template,id:a.id,next};
}
async function send(item,status=200,overrides={}){return api('/mail/activity/'+item.id+'/send',{contact_id:item.contact,recipient:'contact@example.invalid',template_id:item.template,purpose:'Video tutvustus',subject:'Esimene kiri',body:'Sünteetiline esimene sisu.',...overrides},status);}
const rows=client=>db('crm_activities').where({client_id:client}).orderBy('id');
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 for(const name of ['Template owner','Other owner']){const [id]=await db('users').insert({name,email:crypto.randomUUID()+'@example.invalid',password_hash:'synthetic-not-for-login',role:'sales',is_active:1});if(!user)user={id,name,role:'sales'};else other={id,name,role:'sales'};}
 acting=user;env={CRM_SMTP_HOST:'unused.invalid',CRM_SMTP_PORT:'465',['CRM_MAILBOX_'+user.id]:'mailbox@example.invalid',['CRM_MAIL_PASSWORD_'+user.id]:'synthetic-unused'};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.crmUser=acting;next();});
 app.use(require('../server/routes/crm_v8_extension')(db));
 app.use(require('../server/routes/crm_mail_extension')(db,{env,createTransport:()=>({async sendMail(mail){calls.push(mail);if(mail.subject==='Slow synthetic send')await new Promise(r=>setTimeout(r,30));if(mail.subject==='Synthetic SMTP failure')throw Error('Synthetic');return {accepted:[mail.to],response:'250 synthetic'};},close(){}})}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('working-day deadlines skip weekends, including Tallinn DST boundaries',()=>{
 assert.equal(w.chain('null'),null);
 assert.equal(w.businessDate('2026-11-06',1),'2026-11-09');assert.equal(w.businessDate('2026-11-06',2),'2026-11-10');assert.equal(w.businessDate('2026-03-27',1),'2026-03-30');assert.equal(w.businessDate('2026-10-23',1),'2026-10-26');assert.throws(()=>w.businessDate(w.today(),0));
});
test('sending Video tutvustus automatically creates its configured second email with new content and remaining chain',async()=>{
 const f=await fixture(),count=calls.length,result=await send(f),nextId=result.completion.next_activity_id;
 assert.equal(calls.length,count+1);assert.equal(result.completion.followup_source,'template');assert.equal(result.completion.due_date,w.businessDate(w.today(),2));assert.equal(result.completion.followup.subject,f.next.subject);
 const next=await db('crm_activities').where({id:nextId}).first(),d=await db('crm_activity_details').where({activity_id:nextId}).first();
 assert.equal(next.type,'E-kiri');assert.equal(Number(next.contact_id),f.contact);assert.equal(d.template_id,null);assert.equal(d.subject,f.next.subject);assert.equal(d.instructions,f.next.body);assert.equal(d.purpose,f.next.purpose);assert.equal(JSON.parse(d.next_step_json).type,'Kõne');assert.equal((await rows(f.client)).length,2);
 assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,1);
 assert.equal((await db('crm_templates').where({purpose:f.next.purpose})).length,0);
 const state=await api('/mail/activity/'+nextId);assert.equal(state.embedded_template,true);assert.equal(state.activity.instructions,f.next.body);
});
test('embedded follow-up can be sent without a separate template and consumes exactly one chain node',async()=>{
 const f=await fixture(),first=await send(f),nextId=first.completion.next_activity_id;
 await db('crm_templates').where({id:f.template}).update({next_step_json:JSON.stringify({type:'Kõne',purpose:'Changed parent',days:20})});
 const result=await send({...f,id:nextId,template:null},200,{purpose:f.next.purpose,subject:f.next.subject,body:f.next.body});
 const next=await db('crm_activities').where({id:result.completion.next_activity_id}).first(),d=await db('crm_activity_details').where({activity_id:next.id}).first();
 assert.equal(next.type,'Kõne');assert.equal(d.purpose,'Video järelkõne');assert.equal(d.next_step_json,null);assert.equal(result.completion.due_date,w.businessDate(w.today(),1));assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,2);
 const count=calls.length;await send({...f,id:nextId,template:null},409,{purpose:f.next.purpose,subject:f.next.subject,body:f.next.body});assert.equal(calls.length,count);
 const done=await api('/v8/activities/'+next.id+'/resolve',{comment:'Synthetic call result'});
 assert.equal(done.followup_source,'fallback');const tail=await db('crm_activities').where({id:done.next_activity_id}).first();assert.equal(tail.type,'Kõne');assert.equal((await db('crm_activity_details').where({activity_id:tail.id}).first()).next_step_json,null);
 const again=await api('/v8/activities/'+next.id+'/resolve',{comment:'Duplicate'});assert.equal(again.next_activity_id,done.next_activity_id);assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,3);
});
test('no-chain activities retain the existing 14-calendar-day fallback',async()=>{
 const f=await fixture('Kõne',null),result=await api('/v8/activities/'+f.id+'/resolve',{comment:'Synthetic call result'});
 const date=new Date(w.today()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+14);assert.equal(result.due_date,date.toISOString().slice(0,10));assert.equal(result.followup_source,'fallback');assert.equal(result.followup.type,'Kõne');
});
test('a root created before its template gained a chain uses the current configured chain',async()=>{
 const f=await fixture('Kõne',null),next=steps();await db('crm_templates').where({id:f.template}).update({next_step_json:JSON.stringify(next)});
 const result=await api('/v8/activities/'+f.id+'/resolve',{comment:'Synthetic result'});assert.equal(result.followup_source,'template');assert.equal(result.followup.subject,next.subject);
});
test('manual override updates the generated follow-up instead of creating a second one',async()=>{
 const f=await fixture(),result=await send(f);const [template]=await db('crm_templates').insert({name:'Manual call',purpose:'Manual call',type:'Kõne',body:'Manual instructions',is_active:1});
 await api('/v8/activities/'+f.id+'/next-step',{next:'plan',planned:{type:'Kõne',template_id:template,purpose:'Manual call',instructions:'Manual instructions',due_date:w.today()}});
 const activities=await rows(f.client);assert.equal(activities.length,2);const next=activities.find(a=>Number(a.id)===Number(result.completion.next_activity_id));assert.equal(next.type,'Kõne');assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,1);
});
test('embedded purpose cannot be spoofed and unmarked ordinary activities cannot bypass template selection',async()=>{
 const f=await fixture();let count=calls.length;await send({...f,template:null},400);assert.equal(calls.length,count);
 const result=await send(f),next=result.completion.next_activity_id;count=calls.length;await send({...f,id:next,template:null},400,{purpose:'Spoofed inline purpose'});assert.equal(calls.length,count);
 acting=other;await api('/mail/activity/'+next,undefined,403);acting=user;
});
test('invalid nested chains are rejected before any SMTP reservation or message',async()=>{
 const f=await fixture();await db('crm_templates').where({id:f.template}).update({next_step_json:JSON.stringify({type:'E-kiri',purpose:'Broken',days:2,subject:'Missing body'})});const count=calls.length;
 await send(f,400);assert.equal(calls.length,count);assert.equal((await db('crm_email_outbox').where({activity_id:f.id})).length,0);assert.equal((await rows(f.client)).length,1);assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,0);
});
test('SMTP failure creates no follow-up and retains the uncertain-send guard',async()=>{
 const f=await fixture();await send(f,502,{subject:'Synthetic SMTP failure'});const count=calls.length;await send(f,409,{subject:'Synthetic SMTP failure'});assert.equal(calls.length,count);assert.equal((await rows(f.client)).length,1);assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,0);
});
test('template saving validates every nested step and preserves valid inline content',async()=>{
 acting={...user,role:'admin'};const next=steps(),root={type:'E-kiri',purpose:'Video tutvustus',subject:'Synthetic',body:'Synthetic',nextStep:next};
 const created=await api('/v8/templates',root);assert.equal(JSON.parse((await db('crm_templates').where({id:created.id}).first()).next_step_json).body,next.body);
 await api('/v8/templates',{...root,nextStep:{...next,nextStep:{type:'E-kiri',purpose:'Broken deeper',days:0}}},400);acting=user;
});
test('all activity types honor a configured next-step type without incrementing followup for a cancelled meeting',async()=>{
 const f=await fixture('Kohtumine',{type:'Kõne',purpose:'Kohtumise järelkõne',body:'Uus juhis',days:1});
 const result=await api('/v8/activities/'+f.id+'/resolve',{outcome:'cancelled',comment:'Synthetic cancelled meeting'});assert.equal(result.followup.type,'Kõne');assert.equal(result.followup.instructions,'Uus juhis');assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,0);
});
test('a received reply cancels the untouched template follow-up without changing its stored chain or followup count',async()=>{
 const f=await fixture(),result=await send(f),nextId=result.completion.next_activity_id;
 const outbox=await db('crm_email_outbox').where({activity_id:f.id}).first();const before=await db('crm_activity_details').where({activity_id:nextId}).first();
 const imapEnv={...env,CRM_IMAP_ENABLED:'1',CRM_IMAP_HOST:'unused.invalid'};
 const reply={messageId:'<'+crypto.randomUUID()+'@example.invalid>',from:{value:[{address:'contact@example.invalid'}]},inReplyTo:outbox.message_id,text:'Synthetic reply',subject:'Re: Synthetic',date:new Date()};
 const sync=require('../server/services/mailbox-sync')(db,{env:imapEnv,createClient:()=>({async connect(){},async getMailboxLock(){return {release(){}};},async search(){return [1];},async fetchOne(){return {source:Buffer.from('Synthetic')};},async logout(){}}),parseMessage:async()=>reply});
 assert.equal((await sync.sync()).imported,1);assert.equal((await db('crm_activities').where({id:nextId}).first()).status,'stopped');assert.deepEqual(await db('crm_activity_details').where({activity_id:nextId}).first(),before);assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,1);
});
test('the final embedded email keeps the existing 14-day fallback without restarting its parent chain',async()=>{
 const f=await fixture('E-kiri',{type:'E-kiri',purpose:'Terminal inline email',subject:'Last planned email',body:'Terminal content',days:1});
 const first=await send(f),id=first.completion.next_activity_id;
 const done=await send({...f,id,template:null},200,{purpose:'Terminal inline email',subject:'Last planned email',body:'Terminal content'});
 assert.equal(done.completion.followup_source,'fallback');const state=await api('/mail/activity/'+done.completion.next_activity_id);assert.equal(state.embedded_template,true);assert.equal(state.activity.subject,'Last planned email');assert.equal(state.activity.instructions,'Terminal content');
 const d=await db('crm_activity_details').where({activity_id:done.completion.next_activity_id}).first();assert.equal(d.next_step_json,null);assert.equal(d.template_id,null);
});
test('two simultaneous send attempts create only one message and one configured follow-up',async()=>{
 const f=await fixture(),count=calls.length;
 const request={contact_id:f.contact,recipient:'contact@example.invalid',template_id:f.template,purpose:'Video tutvustus',subject:'Slow synthetic send',body:'Synthetic content'};
 const responses=await Promise.all([1,2].map(()=>fetch(base+'/mail/activity/'+f.id+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(calls.length,count+1);assert.equal((await rows(f.client)).length,2);assert.equal((await db('crm_clients').where({id:f.client}).first()).followup_count,1);
});
