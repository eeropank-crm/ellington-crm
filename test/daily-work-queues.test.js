const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit synthetic DB required');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const q=require('../server/services/work-queues'),w=require('../server/services/activity-workflow');
let mail,call;
const day=w.today(),shift=n=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const state=()=>({today:{ids:[],seen:[],batch:0},overdue:{ids:[],seen:[],batch:0}});
async function client(owner,name,count=2,stop=null){const [id]=await db('crm_clients').insert({owner_user_id:owner,name:'Synthetic daily '+name,followup_count:count,stop_reason:stop});return id;}
async function activity(owner,cid,due,template=call,status='active'){
 const t=await db('crm_templates').where({id:template}).first();const [id]=await db('crm_activities').insert({owner_user_id:owner,client_id:cid,type:t.type,status,due_date:due,sequence_number:3});
 await db('crm_activity_details').insert({activity_id:id,template_id:template,purpose:t.purpose,subject:t.subject,instructions:t.body,next_step_json:t.next_step_json});return id;
}
async function fixture({planned=0,waiting=10,overdue=0,history=true,legacy=false,template=mail}={}){
 const [id]=await db('users').insert({name:'Synthetic daily owner',email:crypto.randomUUID()+'@example.invalid',password_hash:'synthetic-not-for-login',role:'sales',is_active:1});const user={id,role:'sales'},candidates=[],dated=[],late=[];
 if(history){
  const c=await client(id,'previous owner contact'),a=await activity(id,c,shift(-3),template,'completed');await activity(id,c,shift(14),template);
  const saved=state();saved.today.ids=[a];saved.today.seen=[a];
  await db('crm_work_queue_days').insert({owner_user_id:id,work_date:shift(-3),version:1,state:JSON.stringify(saved)});
 }
 for(let i=0;i<planned;i++)dated.push(await activity(id,await client(id,'dated '+i),day));
 for(let i=0;i<overdue;i++)late.push(await activity(id,await client(id,'overdue '+i),shift(-1)));
 for(let i=0;i<waiting;i++)candidates.push(await client(id,'waiting '+i));
 if(legacy){const saved=state();saved.today.ids=dated.slice(0,6);saved.today.seen=[...saved.today.ids];saved.overdue.ids=late.slice(0,6);saved.overdue.seen=[...saved.overdue.ids];await db('crm_work_queue_days').insert({owner_user_id:id,work_date:day,version:1,state:JSON.stringify(saved)});}
 return {user,candidates,dated,late};
}
const tasks=user=>db('crm_activities').where({owner_user_id:user.id}).orderBy('id');
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 [mail]=await db('crm_templates').insert({name:'Synthetic Video tutvustus',purpose:'Video tutvustus',type:'E-kiri',subject:'Synthetic video',body:'Synthetic body',is_active:1,next_step_json:JSON.stringify({type:'Kõne',purpose:'Synthetic follow-up',body:'Synthetic instructions',days:2})});
 [call]=await db('crm_templates').insert({name:'Synthetic daily call',purpose:'Synthetic daily call',type:'Kõne',body:'Synthetic call instructions',is_active:1});
});
after(async()=>{await db.destroy();});
test('today 0/38 legacy plan is filled once to six and no email, counters or owners are changed',async()=>{
 const f=await fixture({waiting:38,legacy:true,overdue:2}),before=await db('crm_clients').where({owner_user_id:f.user.id}).orderBy('id');
 const read=await q.read(db,f.user);assert.equal(read.queues.today.shown,0);assert.equal(read.unplanned.total,38);assert.equal(read.daily_ready,false);
 const result=await q.select(db,f.user,{action:'initialize'});assert.equal(result.queues.today.shown,6);assert.equal(result.unplanned.total,32);assert.equal(result.default_template_id,mail);assert.equal(result.daily_ready,true);assert.deepEqual(result.queues.today.items.map(a=>a.client_id),f.candidates.slice(0,6));assert.equal(result.queues.overdue.shown,2);
 assert.equal(result.queues.today.total+result.unplanned.total,38);assert.deepEqual(await db('crm_clients').where({owner_user_id:f.user.id}).orderBy('id'),before);
 const ids=result.queues.today.items.map(a=>a.id);assert.equal((await db('crm_email_outbox').whereIn('activity_id',ids)).length,0);
 for(const a of result.queues.today.items){assert.equal(a.type,'E-kiri');assert.equal(Number(a.template_id),mail);assert.equal(a.nextStep.purpose,'Synthetic follow-up');}
 const after=await tasks(f.user);assert.deepEqual(await q.select(db,f.user,{action:'initialize'}),result);assert.deepEqual(await tasks(f.user),after);
});
test('three scheduled activities take priority and exactly three waiting clients fill the free places',async()=>{
 const f=await fixture({planned:3,waiting:20,overdue:8});const result=await q.select(db,f.user,{action:'initialize'});
 assert.equal(result.queues.today.shown,6);assert.ok(f.dated.every(id=>result.queues.today.items.some(a=>a.id===id)));assert.equal(result.unplanned.total,17);assert.equal(result.queues.overdue.shown,6);assert.equal(result.queues.overdue.total,8);
 assert.equal(result.queues.today.items.filter(a=>f.candidates.includes(a.client_id)).length,3);
});
test('six or more scheduled activities leave no slots for automatic clients',async()=>{
 const f=await fixture({planned:9,waiting:20}),before=await tasks(f.user),result=await q.select(db,f.user,{action:'initialize'});
 assert.equal(result.queues.today.shown,6);assert.equal(result.queues.today.total,9);assert.equal(result.unplanned.total,20);assert.deepEqual(await tasks(f.user),before);
});
test('concurrent day initialization creates a single six-item batch',async()=>{
 const f=await fixture({waiting:25});const [a,b]=await Promise.all([q.select(db,f.user,{action:'initialize'}),q.select(db,f.user,{action:'initialize'})]);assert.deepEqual(a,b);assert.equal(a.queues.today.shown,6);
 assert.equal((await db('crm_work_queue_days').where({owner_user_id:f.user.id,work_date:day})).length,1);
 const ids=a.queues.today.items.map(a=>a.id);assert.equal((await db('crm_activities').whereIn('client_id',f.candidates)).length,6);assert.equal(new Set(ids).size,6);
});
test('completion, postponement and a page reload never automatically refill consumed places',async()=>{
 const f=await fixture({template:call,waiting:20});let view=await q.select(db,f.user,{action:'initialize'});const [first,second]=view.queues.today.items;
 await db.transaction(trx=>w.complete(trx,first.id,f.user,{comment:'Synthetic completed call'}));await db.transaction(trx=>w.postpone(trx,second.id,f.user,{new_date:shift(2)}));const before=await tasks(f.user);
 view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,4);assert.equal(view.unplanned.total,14);assert.deepEqual(await tasks(f.user),before);
});
test('new day gets a new batch while unfinished yesterday activities become overdue without copies',async()=>{
 const f=await fixture({template:call,waiting:20});const first=await q.select(db,f.user,{action:'initialize'}),tomorrow=shift(1);
 const next=await q.select(db,f.user,{action:'initialize'},tomorrow);assert.equal(next.queues.today.shown,6);assert.equal(next.queues.overdue.shown,6);assert.equal(next.unplanned.total,8);assert.deepEqual(next.queues.overdue.items.map(a=>a.id),first.queues.today.items.map(a=>a.id));
 const roots=await db('crm_activities').whereIn('client_id',f.candidates);assert.equal(roots.length,12);assert.equal(new Set(roots.map(a=>Number(a.client_id))).size,12);
});
test('all owners get independent batches and administrator overview cannot create work',async()=>{
 const [a,b,c]=await Promise.all([fixture({waiting:12}),fixture({waiting:12,template:call}),fixture({waiting:12})]);
 const outcomes=await Promise.allSettled([a,b,c].map(f=>q.select(db,f.user,{action:'initialize'})));
 for(const result of outcomes)assert.equal(result.status,'fulfilled',result.reason?.code);
 const batches=outcomes.map(result=>result.value);for(let i=0;i<3;i++){assert.equal(batches[i].queues.today.shown,6);assert.ok(batches[i].queues.today.items.every(row=>Number(row.owner_user_id)===[a,b,c][i].user.id));}
 assert.equal(batches[1].default_template_id,call);const before=await tasks(a.user);const admin={...a.user,role:'admin'};await q.read(db,admin);await assert.rejects(q.select(db,admin,{action:'initialize'}),e=>e.status===403);assert.deepEqual(await tasks(a.user),before);
});
test('missing, ambiguous or inactive defaults require an explicit template instead of guessing',async()=>{
 const missing=await fixture({history:false,waiting:8});let view=await q.select(db,missing.user,{action:'initialize'});assert.equal(view.queues.today.shown,0);assert.equal(view.daily_ready,true);assert.equal(view.unplanned.can_fill,true);assert.equal(view.default_template_id,null);
 view=await q.select(db,missing.user,{action:'fill',lane:'today',work_date:day,version:view.version,template_id:mail});assert.equal(view.queues.today.shown,6);assert.equal(view.default_template_id,mail);
 const ambiguous=await fixture({waiting:8}),previous=await db('crm_work_queue_days').where({owner_user_id:ambiguous.user.id,work_date:shift(-3)}).first(),saved=JSON.parse(previous.state);
 const id=await activity(ambiguous.user.id,await client(ambiguous.user.id,'ambiguous','2','Fixture paused'),shift(-3),call,'completed');saved.today.ids.push(id);saved.today.seen.push(id);await db('crm_work_queue_days').where({id:previous.id}).update({state:JSON.stringify(saved)});
 assert.equal((await q.select(db,ambiguous.user,{action:'initialize'})).queues.today.shown,0);
 const inactive=await fixture({waiting:8});await db('crm_templates').where({id:mail}).update({is_active:0});try{assert.equal((await q.select(db,inactive.user,{action:'initialize'})).queues.today.shown,0);}finally{await db('crm_templates').where({id:mail}).update({is_active:1});}
});
test('empty intervening days do not discard an older unambiguous selected template',async()=>{
 const f=await fixture({waiting:10});await db('crm_work_queue_days').insert({owner_user_id:f.user.id,work_date:shift(-1),version:1,state:JSON.stringify(state())});const view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,6);assert.equal(view.default_template_id,mail);
});
test('future work, stopped clients, unread replies, untouched leads and other owners are excluded',async()=>{
 const f=await fixture({waiting:8});const future=await client(f.user.id,'future');await activity(f.user.id,future,shift(10));const stopped=await client(f.user.id,'stopped',2,'Synthetic stop'),fresh=await client(f.user.id,'untouched',0),reply=await client(f.user.id,'reply');
 await db('crm_email_inbox').insert({mailbox_user_id:f.user.id,outbox_id:1,client_id:reply,activity_id:1,sender:'sender@example.invalid',recipient:'recipient@example.invalid',subject:'Synthetic',body:'Synthetic',message_id:'<'+crypto.randomUUID()+'@example.invalid>',received_at:db.fn.now()});
 const view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,6);assert.equal(view.unplanned.total,2);assert.ok(view.queues.today.items.every(a=>![future,stopped,fresh,reply].includes(a.client_id)));
});
test('partially available backlog gives fewer than six and zero candidates never invent work',async()=>{
 const f=await fixture({planned:2,waiting:1});let view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,3);assert.equal(view.unplanned.total,0);const before=await tasks(f.user);view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,3);assert.deepEqual(await tasks(f.user),before);
 const empty=await fixture({waiting:0});assert.equal((await q.select(db,empty.user,{action:'initialize'})).queues.today.shown,0);
});
test('an upgraded legacy day cannot refill six already consumed places',async()=>{
 const f=await fixture({planned:6,waiting:10,legacy:true});await db('crm_activities').whereIn('id',f.dated).update({status:'completed'});const before=await tasks(f.user);const view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,0);assert.equal(view.unplanned.total,16);assert.deepEqual(await tasks(f.user),before);
});
test('later arrivals can use never-allocated slots, but cannot replace already completed slots',async()=>{
 const f=await fixture({template:call,planned:2,waiting:0});let view=await q.select(db,f.user,{action:'initialize'});assert.equal(view.queues.today.shown,2);
 await db.transaction(trx=>w.complete(trx,f.dated[0],f.user,{comment:'Synthetic completed dated task'}));
 for(let i=0;i<10;i++)await client(f.user.id,'new eligible arrival '+i);
 view=await q.read(db,f.user);assert.equal(view.needs_daily_fill,true);view=await q.select(db,f.user,{action:'initialize'});
 assert.equal(view.queues.today.shown,5);assert.equal(view.queues.today.selected,6);assert.equal(view.unplanned.total,6);assert.equal(view.needs_daily_fill,false);
 const before=await tasks(f.user);await q.select(db,f.user,{action:'initialize'});assert.deepEqual(await tasks(f.user),before);
});
test('invalid saved template content cannot block scheduled work or manufacture unusable drafts',async()=>{
 const [id]=await db('crm_templates').insert({name:'Broken default',purpose:'Broken default',type:'E-kiri',subject:'',body:'',is_active:1});
 const f=await fixture({template:id,planned:3,waiting:8}),before=await tasks(f.user);const view=await q.select(db,f.user,{action:'initialize'});
 assert.equal(view.queues.today.shown,3);assert.equal(view.default_template_id,null);assert.equal(view.needs_daily_fill,false);assert.deepEqual(await tasks(f.user),before);
});
test('an oversized saved day rolls back any newly prepared activities rather than truncating state',async()=>{
 const f=await fixture({waiting:10,legacy:true}),plan=await db('crm_work_queue_days').where({owner_user_id:f.user.id,work_date:day}).first();
 const saved=JSON.parse(plan.state);saved.padding='';saved.padding='x'.repeat(59980-Buffer.byteLength(JSON.stringify(saved)));const text=JSON.stringify(saved);assert.equal(Buffer.byteLength(text),59980);
 await db('crm_work_queue_days').where({id:plan.id}).update({state:text});const before=await tasks(f.user);
 await assert.rejects(q.select(db,f.user,{action:'initialize'}),e=>e.status===409&&e.message.includes('maht'));
 assert.deepEqual(await tasks(f.user),before);assert.equal((await db('crm_work_queue_days').where({id:plan.id}).first()).state,text);
});
