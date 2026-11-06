const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit synthetic DB required');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];
process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
const w=require('../server/services/activity-workflow'),queues=require('../server/services/work-queues');
let server,base,users=[],cookies=[],templates={};
const password=crypto.randomBytes(24).toString('hex');
async function api(route,body,status=200,cookie=cookies[0],method=body===undefined?'GET':'POST'){
 const res=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
}
async function activity(type='Kõne',owner=users[0],due=w.today()){
 const [client]=await db('crm_clients').insert({name:'Synthetic edit '+crypto.randomUUID(),owner_user_id:owner.id,followup_count:7});
 const task=await db.transaction(trx=>w.create(trx,owner,{client_id:client,type,template_id:templates[type],purpose:'Edit '+type,subject:type==='E-kiri'?'Synthetic subject':'',instructions:'Synthetic instructions',due_date:w.today()}));
 await db('crm_activities').where({id:task.id}).update({due_date:due});return {id:task.id,client};
}
const state=id=>api('/v8/activities/'+id+'/edit');
const patch=(type,s)=>({type,template_id:templates[type],purpose:'Edit '+type,subject:type==='E-kiri'?'Synthetic edited subject':'',instructions:'Edited synthetic instructions',expected_version:s.version});
const edit=(id,x,status=200,cookie=cookies[0])=>api('/v8/activities/'+id,x,status,cookie,'PATCH');
async function snapshot(){const out={};for(const t of ['crm_clients','crm_activities','crm_activity_details','crm_v8_activity_events','crm_activity_history','crm_work_queue_days','crm_email_outbox','crm_email_inbox'])out[t]=await db(t).orderBy(t==='crm_activity_details'?'activity_id':'id');return out;}
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 const hash=await require('bcryptjs').hash(password,10);
 for(const role of ['sales','sales','admin']){const email=crypto.randomUUID()+'@example.invalid';const [id]=await db('users').insert({name:'Synthetic editor',email,password_hash:hash,role,is_active:1});users.push({id,email,role});}
 for(const type of w.TYPES){const [id]=await db('crm_templates').insert({name:'Edit '+type,purpose:'Edit '+type,type,subject:type==='E-kiri'?'Synthetic subject':'',body:'Synthetic body',next_step_json:JSON.stringify({type:'Kõne',purpose:'Synthetic next',days:5}),is_active:1});templates[type]=id;}
 server=require('../server/app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 for(const u of users){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify({email:u.email,password})});assert.equal(r.status,200);cookies.push(r.headers.get('set-cookie').split(';')[0]);}
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('all six type conversions retain ID, owner, due date, client data and queue membership; no mail is sent',async()=>{
 for(const from of w.TYPES)for(const to of w.TYPES){if(from===to)continue;
  const a=await activity(from,users[0],'2026-01-01');
  const before=await db('crm_activities').where({id:a.id}).first(),client=await db('crm_clients').where({id:a.client}).first();
  await queues.select(db,users[0],{action:'initialize'});const plans=await db('crm_work_queue_days').where({owner_user_id:users[0].id});
  const s=await state(a.id),n=Number((await db('crm_activities').count('* as n').first()).n);
  const result=await edit(a.id,patch(to,s));assert.equal(result.id,a.id);assert.equal(result.type,to);assert.notEqual(result.version,s.version);
  const after=await db('crm_activities').where({id:a.id}).first();
  for(const field of ['id','client_id','owner_user_id','contact_id','due_date','sequence_number','status'])assert.deepEqual(after[field],before[field]);
  assert.deepEqual(await db('crm_clients').where({id:a.client}).first(),client);
  assert.deepEqual(await db('crm_work_queue_days').where({owner_user_id:users[0].id}),plans);
  assert.equal(Number((await db('crm_activities').count('* as n').first()).n),n);
  assert.equal((await db('crm_email_outbox').where({activity_id:a.id})).length,0);
  const event=await db('crm_v8_activity_events').where({activity_id:a.id,event_type:'activity_edited'}).first();const detail=JSON.parse(event.details);
  assert.equal(detail.before.type,from);assert.equal(detail.after.type,to);assert.equal(Number(event.user_id),users[0].id);
 }
});
test('same-type template replacement and legacy activity without details are supported',async()=>{
 const a=await activity();await db('crm_activity_details').where({activity_id:a.id}).delete();
 const s=await state(a.id);const x=patch('Kõne',s);x.instructions='Custom instructions';await edit(a.id,x);
 assert.equal((await db('crm_activity_details').where({activity_id:a.id}).first()).instructions,x.instructions);
});
test('invalid template, type, content and field injection roll back without changes',async()=>{
 const a=await activity(),s=await state(a.id),before=await snapshot();
 for(const x of [{...patch('E-kiri',s),template_id:templates.Kõne},{...patch('Kõne',s),type:'Invalid'},{...patch('E-kiri',s),subject:''},{...patch('Kõne',s),purpose:'Wrong'},{...patch('Kõne',s),owner_user_id:users[1].id},{...patch('Kõne',s),due_date:w.today()},{...patch('Kõne',s),instructions:'x'.repeat(10001)}])await edit(a.id,x,400);
 assert.deepEqual(await snapshot(),before);
});
test('inactive templates cannot be selected',async()=>{
 const a=await activity(),s=await state(a.id);const [id]=await db('crm_templates').insert({name:'Inactive',purpose:'Inactive',type:'Kõne',is_active:0});
 await edit(a.id,{...patch('Kõne',s),template_id:id,purpose:'Inactive'},400);
});
test('another user, admin mode and anonymous requests cannot edit; admin own task works in user mode',async()=>{
 const a=await activity(),s=await state(a.id),before=await snapshot();await edit(a.id,patch('E-kiri',s),403,cookies[1]);
 await api('/v8/activities/'+a.id+'/edit',undefined,403,cookies[1]);await edit(a.id,patch('E-kiri',s),401,null);
 const own=await activity('Kõne',users[2]);const ownState=await api('/v8/activities/'+own.id+'/edit',undefined,200,cookies[2]);
 await api('/work-mode',{mode:'admin'},200,cookies[2]);await edit(own.id,patch('E-kiri',ownState),403,cookies[2]);await edit(a.id,patch('E-kiri',s),403,cookies[2]);
 await api('/work-mode',{mode:'user'},200,cookies[2]);await edit(own.id,patch('E-kiri',ownState),200,cookies[2]);
 assert.deepEqual(await db('crm_clients').where({id:a.client}).first(),before.crm_clients.find(c=>Number(c.id)===a.client));
});
test('completed, cancelled and stopped-client tasks are immutable',async()=>{
 for(const status of ['completed','cancelled','active']){const a=await activity(),s=await state(a.id);
 if(status==='active')await db('crm_clients').where({id:a.client}).update({stop_reason:'Synthetic stop'});else await db('crm_activities').where({id:a.id}).update({status});
 const before=await snapshot();await edit(a.id,patch('E-kiri',s),409);assert.deepEqual(await snapshot(),before);}
});
test('all recorded email send states block editing and retain the outbox',async()=>{
 for(const status of ['sending','uncertain','sent','failed']){
  const a=await activity('E-kiri'),s=await state(a.id);
  const [contact]=await db('crm_contacts').insert({client_id:a.client,name:'Synthetic contact',email:'recipient@example.invalid'});
  await db('crm_email_outbox').insert({contact_id:contact,activity_id:a.id,client_id:a.client,user_id:users[0].id,sender:'sender@example.invalid',recipient:'recipient@example.invalid',subject:'Synthetic',body:'Synthetic',message_id:'<'+crypto.randomUUID()+'@example.invalid>',status});
  const before=await snapshot();await edit(a.id,patch('Kõne',s),409);await api('/v8/activities/'+a.id+'/edit',undefined,409);assert.deepEqual(await snapshot(),before);
 }
});
test('stale and simultaneous edits cannot overwrite a newer edit; missing version is rejected',async()=>{
 const a=await activity(),s=await state(a.id);await edit(a.id,{...patch('E-kiri',s),expected_version:null},409);
 const responses=await Promise.all(['E-kiri','Kohtumine'].map(type=>fetch(base+'/api/v8/activities/'+a.id,{method:'PATCH',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https',Cookie:cookies[0]},body:JSON.stringify(patch(type,s))})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const before=await snapshot();await edit(a.id,patch('Kõne',s),409);assert.deepEqual(await snapshot(),before);
});
test('a client transfer invalidates edit permissions even if the old activity owner has not changed',async()=>{
 const a=await activity(),s=await state(a.id);await db('crm_clients').where({id:a.client}).update({owner_user_id:users[1].id});await edit(a.id,patch('E-kiri',s),403);
});
test('template replacement within the same type keeps the original content in visible client audit history',async()=>{
 const a=await activity();await db('crm_activities').where({id:a.id}).update({notes:'Original separate note'});const s=await state(a.id);const [id]=await db('crm_templates').insert({type:'Kõne',name:'Second purpose',purpose:'Second purpose',body:'Second instructions',is_active:1});
 await edit(a.id,{...patch('Kõne',s),template_id:id,purpose:'Second purpose',instructions:'Second instructions'});
 const card=await api('/clients/'+a.client),event=card.editHistory.find(e=>Number(e.activity_id)===a.id);
 assert.equal(event.before.notes,'Original separate note');assert.ok(event.before.next_step_json);assert.equal(event.before.instructions,'Synthetic instructions');assert.equal(event.after.instructions,'Second instructions');assert.equal(event.after.template_id,id);
});
test('oversized Unicode audit cannot silently truncate original or new contents',async()=>{
 const a=await activity(),s=await state(a.id);await db('crm_activity_details').where({activity_id:a.id}).update({instructions:'漢'.repeat(19000)});
 const current=await state(a.id),before=await snapshot();await edit(a.id,{...patch('Kõne',current),instructions:'x'.repeat(10000)},400);assert.deepEqual(await snapshot(),before);
});
test('edited call completes normally, increments followup once and keeps completion idempotent',async()=>{
 const a=await activity('E-kiri'),s=await state(a.id);await edit(a.id,patch('Kõne',s));
 await api('/v8/activities/'+a.id+'/resolve',{comment:'Synthetic call completed'});
 await api('/v8/activities/'+a.id+'/resolve',{comment:'Duplicate completion'});
 assert.equal((await db('crm_clients').where({id:a.client}).first()).followup_count,8);
 assert.equal((await db('crm_activities').where({client_id:a.client,status:'active'})).length,1);
 await api('/v8/activities/'+a.id+'/edit',undefined,409);
});
test('simultaneous edit and send reservation serialize on the same client/activity locks',async()=>{
 const a=await activity('E-kiri'),s=await state(a.id);
 const [contact]=await db('crm_contacts').insert({client_id:a.client,name:'Synthetic contact',email:'recipient@example.invalid'});
 const outcomes=await Promise.allSettled([
  db.transaction(trx=>w.edit(trx,a.id,users[0],patch('Kõne',s))),
  db.transaction(async trx=>{
   const locked=await w.lockActivity(trx,a.id,users[0]);
   if(locked.activity.type!=='E-kiri')throw new w.WorkflowError(409,'Activity changed');
   await trx('crm_email_outbox').insert({contact_id:contact,activity_id:a.id,client_id:a.client,user_id:users[0].id,sender:'sender@example.invalid',recipient:'recipient@example.invalid',subject:'Synthetic',body:'Synthetic',message_id:'<'+crypto.randomUUID()+'@example.invalid>',status:'sending'});
  })
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 const row=await db('crm_activities').where({id:a.id}).first(),outbox=await db('crm_email_outbox').where({activity_id:a.id});
 assert.equal(row.type==='E-kiri',outbox.length===1);
});
