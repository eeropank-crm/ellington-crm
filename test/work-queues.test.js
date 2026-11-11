const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),path=require('node:path');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit isolated database required');
for(const key of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(key))delete process.env[key];
process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
for(const key of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(key))delete process.env[key];
process.env.CRM_IMAP_ENABLED='0';
const w=require('../server/services/activity-workflow'),queues=require('../server/services/work-queues');
const {inspect,validate,migrations}=require('../ops/schema');
const day=w.today(),shift=(days)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const password=crypto.randomBytes(24).toString('hex');
let a,b,admin,templates,server,base,cookie,adminCookie,otherCookie;
const fixtures={overdue:[],today:[],future:[],unplanned:[]};
async function api(route,body,status=200,session=cookie){
 const res=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https',...(session?{Cookie:session}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return {data,res};
}
const view=async()=>((await api('/v8/work-queues')).data);
async function snapshot(){const out={};for(const table of ['users','crm_clients','crm_activities','crm_activity_details','crm_activity_history','crm_v8_activity_events','crm_imported_history','crm_email_inbox','crm_email_outbox','crm_portfolio_transfers'])out[table]=await db(table).select('*').orderBy(table==='crm_activity_details'?'activity_id':'id');return out;}
async function client(owner,name,count=1,stop=null){const [id]=await db('crm_clients').insert({name:'Queue fixture '+name,owner_user_id:owner,followup_count:count,stop_reason:stop});return id;}
async function activity(owner,clientId,due){const [id]=await db('crm_activities').insert({owner_user_id:owner,client_id:clientId,type:'Kõne',status:'active',due_date:due,notes:'Synthetic existing activity'});return id;}
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 templates=(await require('../scripts/seed-test')(db)).templates;
 const suffix=crypto.randomBytes(6).toString('hex'),hash=await require('bcryptjs').hash(password,10);
 async function user(name,role='sales'){const email='queue-'+name+'-'+suffix+'@example.invalid';const [id]=await db('users').insert({name,email,password_hash:hash,role,is_active:1});return {id,name,email,role};}
 a=await user('First');b=await user('Second');admin=await user('Admin','admin');
 for(let i=0;i<15;i++)fixtures.overdue.push(await activity(a.id,await client(a.id,'overdue '+i),shift(-i-1)));
 for(let i=0;i<10;i++)fixtures.today.push(await activity(a.id,await client(a.id,'today '+i),day));
 for(let i=0;i<2;i++)fixtures.future.push(await activity(a.id,await client(a.id,'future '+i),shift(14)));
 for(let i=0;i<10;i++){
  const id=await client(a.id,'returning '+i,i===9?0:i+1);fixtures.unplanned.push(id);
  if(i>1)await db('crm_imported_history').insert({client_id:id,activity_type:'Kõne',activity_date:'2024-'+String(i).padStart(2,'0')+'-01',original_value:'Synthetic previous contact'});
 }
 fixtures.fresh=await client(a.id,'fresh lead',0);
 fixtures.stopped=await client(a.id,'stopped',4,'Synthetic stop');await activity(a.id,fixtures.stopped,shift(-100));
 fixtures.reply=await client(a.id,'reply awaiting',5);
 await db('crm_email_inbox').insert({mailbox_user_id:a.id,outbox_id:1,client_id:fixtures.reply,activity_id:1,sender:'sender@example.invalid',recipient:'sales@example.invalid',subject:'Synthetic reply',body:'Synthetic',message_id:'<queue-'+suffix+'@example.invalid>',received_at:db.fn.now()});
 fixtures.otherClient=await client(b.id,'other owner');fixtures.otherActivity=await activity(b.id,fixtures.otherClient,day);
 fixtures.mismatch=await activity(a.id,fixtures.otherClient,day);
 server=require('../server/app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 for(const [user,assign]of [[a,c=>cookie=c],[b,c=>otherCookie=c],[admin,c=>adminCookie=c]]){const result=await api('/login',{email:user.email,password},200,null);assign(result.res.headers.get('set-cookie').split(';')[0]);}
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('work date follows Tallinn midnight in winter and summer',()=>{
 assert.equal(w.today(new Date('2026-01-01T21:59:59Z')),'2026-01-01');
 assert.equal(w.today(new Date('2026-01-01T22:00:00Z')),'2026-01-02');
 assert.equal(w.today(new Date('2026-06-01T21:00:00Z')),'2026-06-02');
});
test('queue reads preserve records and exclude stopped, future, untouched, reply-awaiting and other-owner clients',async()=>{
 const before=await snapshot(),result=await view();
 assert.equal(result.initialized,false);assert.equal(result.work_date,day);
 assert.equal(result.queues.overdue.total,15);assert.equal(result.queues.today.total,10);assert.equal(result.unplanned.total,10);
 assert.deepEqual(Object.keys(result.queues).sort(),['overdue','today']);assert.equal(result.revenue_warnings.available,false);
 assert.deepEqual(await snapshot(),before);
 assert.equal(Number((await db('crm_work_queue_days').where({owner_user_id:a.id}).count('* as n').first()).n),0);
 await api('/v8/work-queues',undefined,401,null);
});
test('concurrent first opens create one stable six-per-lane day plan without modifying existing business data',async()=>{
 const before=await snapshot();
 const [first,second]=await Promise.all([api('/v8/work-queues/select',{action:'initialize'}),api('/v8/work-queues/select',{action:'initialize'})]);
 assert.deepEqual(first.data,second.data);assert.equal(first.data.version,1);
 assert.deepEqual(first.data.queues.overdue.items.map(a=>a.id),fixtures.overdue.slice().reverse().slice(0,6));
 assert.deepEqual(first.data.queues.today.items.map(a=>a.id),fixtures.today.slice(0,6));
 assert.equal(first.data.queues.overdue.shown,6);assert.equal(first.data.queues.overdue.total,15);
 assert.deepEqual(await snapshot(),before);assert.deepEqual(await view(),first.data);
 assert.equal(Number((await db('crm_work_queue_days').where({owner_user_id:a.id}).count('* as n').first()).n),1);
});
test('completion increments followup once, hides its card and never automatically refills a slot',async()=>{
 const before=await view(),id=before.queues.overdue.items[0].id;
 const task=await db('crm_activities').where({id}).first(),clientBefore=await db('crm_clients').where({id:task.client_id}).first();
 await api('/v8/activities/'+id+'/resolve',{comment:'Synthetic queue completion'});
 await api('/v8/activities/'+id+'/resolve',{comment:'Repeated completion'});
 assert.equal((await db('crm_clients').where({id:task.client_id}).first()).followup_count,clientBefore.followup_count+1);
 const after=await view();assert.equal(after.queues.overdue.shown,5);assert.equal(after.queues.overdue.total,14);assert.equal(after.queues.overdue.selected,6);
 assert.deepEqual(after.queues.overdue.items.map(a=>a.id),before.queues.overdue.items.slice(1).map(a=>a.id));
 assert.deepEqual((await api('/v8/work-queues/select',{action:'initialize'})).data,after);
 const original=await snapshot();await api('/v8/work-queues/select',{action:'next',lane:'overdue',version:after.version,work_date:day},409);assert.deepEqual(await snapshot(),original);
});
test('postponing and stopping preserve counters, remove cards without refill, and do not rewrite other due dates',async()=>{
 const before=await view(),postpone=before.queues.today.items[0],stop=before.queues.overdue.items[0];
 const original=await db('crm_clients').whereIn('id',[postpone.client_id,stop.client_id]).orderBy('id');
 await api('/v8/activities/'+postpone.id+'/resolve',{action:'postpone',new_date:shift(1)});
 await api('/clients/'+stop.client_id+'/stop-monitoring',{reason:'Synthetic queue stop'});
 const after=await view();assert.equal(after.queues.today.shown,5);assert.equal(after.queues.overdue.shown,4);
 const clients=await db('crm_clients').whereIn('id',[postpone.client_id,stop.client_id]).orderBy('id');assert.deepEqual(clients.map(c=>c.followup_count),original.map(c=>c.followup_count));
 assert.equal(w.dateOnly((await db('crm_activities').where({id:postpone.id}).first()).due_date),shift(1));
 assert.deepEqual(after.queues.today.items.map(a=>a.id),before.queues.today.items.slice(1).map(a=>a.id));
});
test('explicit next batch is atomic across browser tabs and keeps the original activities intact',async()=>{
 let current=await view();const firstBatch=fixtures.overdue.slice().reverse().slice(0,6);
 for(const task of current.queues.overdue.items)await api('/v8/activities/'+task.id+'/resolve',{action:'postpone',new_date:shift(2)});
 current=await view();assert.equal(current.queues.overdue.can_next,true);assert.equal(current.queues.overdue.shown,0);
 const before=await snapshot(),body={action:'next',lane:'overdue',version:current.version,work_date:day};
 const responses=await Promise.all([fetch(base+'/api/v8/work-queues/select',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}),fetch(base+'/api/v8/work-queues/select',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const after=await view();assert.equal(after.version,current.version+1);assert.equal(after.queues.overdue.shown,6);assert.ok(after.queues.overdue.items.every(a=>!firstBatch.includes(a.id)));
 assert.deepEqual(await snapshot(),before);
});
test('dated work takes priority and returning clients fill only the two unused slots in todays six',async()=>{
 let current=await view();
 const body=()=>({action:'fill',lane:'today',version:current.version,work_date:day,template_id:templates.Kõne});
 const beforeBlocked=await snapshot();assert.equal(current.unplanned.can_fill,false);
 await api('/v8/work-queues/select',body(),409);assert.deepEqual(await snapshot(),beforeBlocked);
 for(const task of current.queues.today.items)await api('/v8/activities/'+task.id+'/resolve',{comment:'Finish dated task first'});
 current=await view();assert.equal(current.queues.today.shown,0);assert.equal(current.queues.today.total,4);assert.equal(current.unplanned.can_fill,false);
 await api('/v8/work-queues/select',body(),409);
 current=(await api('/v8/work-queues/select',{action:'next',lane:'today',version:current.version,work_date:day})).data;
 assert.equal(current.queues.today.shown,4);assert.equal(current.unplanned.slots,2);assert.equal(current.unplanned.can_fill,true);
 const original=await snapshot(),fillBody=body();
 await api('/v8/work-queues/select',{...fillBody,template_id:null},400);assert.deepEqual(await snapshot(),original);
 await api('/v8/work-queues/select',{...fillBody,work_date:shift(-1)},409);
 await api('/v8/work-queues/select',{...fillBody,user_id:b.id},400);
 await api('/v8/work-queues/select',{...fillBody,lane:'continuation'},400);
 const selected=(await api('/v8/work-queues/select',fillBody)).data;
 assert.equal(selected.queues.today.shown,6);assert.equal(selected.queues.today.total,6);assert.equal(selected.unplanned.total,8);assert.equal(selected.unplanned.can_fill,false);
 const newTasks=selected.queues.today.items.filter(a=>fixtures.unplanned.includes(a.client_id));
 assert.deepEqual(newTasks.map(a=>a.client_id),fixtures.unplanned.slice(0,2));
 const after=await snapshot();assert.deepEqual(after.crm_clients,original.crm_clients);assert.deepEqual(after.crm_email_outbox,original.crm_email_outbox);
 assert.equal(after.crm_activities.length,original.crm_activities.length+2);
 for(const task of newTasks){assert.equal(task.due_date,day);assert.equal(task.owner_user_id,a.id);}
 await api('/v8/work-queues/select',fillBody,409);
 assert.deepEqual(await snapshot(),after);assert.deepEqual((await view()).queues.today.items.map(a=>a.id),selected.queues.today.items.map(a=>a.id));
});
test('finishing a filled slot does not reopen its allocation or refill the daily plan',async()=>{
 const current=await view(),task=current.queues.today.items[0];
 await api('/v8/activities/'+task.id+'/resolve',{comment:'No automatic replacement'});
 const next=await view();assert.equal(next.queues.today.shown,5);assert.equal(next.queues.today.total,5);assert.equal(next.unplanned.slots,0);assert.equal(next.unplanned.can_fill,false);
 const before=await snapshot();await api('/v8/work-queues/select',{action:'fill',lane:'today',version:next.version,work_date:day,template_id:templates.Kõne},409);assert.deepEqual(await snapshot(),before);
});
test('user scope and administrator overview cannot reassign or complete another employees work',async()=>{
 const own=await view(),other=(await api('/v8/work-queues',undefined,200,otherCookie)).data;
 assert.equal(other.queues.today.total,1);assert.equal(other.unplanned.total,0);
 await api('/v8/work-queues?today_page=1',undefined,403);
 await api('/v8/activities/'+fixtures.otherActivity+'/resolve',{comment:'Must reject'},403);
 await api('/work-mode',{mode:'admin'},200,adminCookie);
 const before=await snapshot(),count=Number((await db('crm_work_queue_days').count('* as n').first()).n);
 const global=(await api('/v8/work-queues',undefined,200,adminCookie)).data;
 assert.equal(global.read_only,true);assert.ok(global.queues.today.total>own.queues.today.total);assert.equal(global.queues.today.shown,6);
 const page2=(await api('/v8/work-queues?today_page=1',undefined,200,adminCookie)).data;
 assert.ok(page2.queues.today.items.every(a=>!global.queues.today.items.some(b=>b.id===a.id)));
 await api('/v8/work-queues/select',{action:'initialize'},403,adminCookie);
 await api('/v8/activities/'+fixtures.otherActivity+'/resolve',{comment:'Admin must reject'},403,adminCookie);
 assert.deepEqual(await snapshot(),before);assert.equal(Number((await db('crm_work_queue_days').count('* as n').first()).n),count);
});
test('next day keeps unfinished tasks as overdue and fills only new daily slots without copying old work',async()=>{
 const current=await view(),ids=current.queues.today.items.filter(a=>fixtures.unplanned.includes(a.client_id)).map(a=>a.id),before=await snapshot();
 const tomorrow=await queues.read(db,a,{day:shift(1)});assert.equal(tomorrow.initialized,false);assert.equal(tomorrow.unplanned.total,8);
 const initialized=await queues.select(db,a,{action:'initialize'},shift(1));assert.equal(initialized.work_date,shift(1));
 const plans=await db('crm_work_queue_days').where({owner_user_id:a.id});assert.equal(plans.length,2);
 const overdue=await db('crm_activities').whereIn('id',ids).select('id','status','due_date');
 assert.equal(overdue.length,ids.length);assert.ok(overdue.every(a=>a.status==='active'&&w.dateOnly(a.due_date)<shift(1)));
 const ownDay=await queues.read(db,a,{day:shift(1)});assert.ok(ownDay.queues.overdue.total>=ids.length);
 const after=await snapshot();
 for(const table of Object.keys(before)){
  const field=table==='crm_activity_details'?'activity_id':'id',oldIds=new Set(before[table].map(row=>String(row[field])));
  assert.deepEqual(after[table].filter(row=>oldIds.has(String(row[field]))),before[table]);
  if(!['crm_activities','crm_activity_details','crm_v8_activity_events'].includes(table))assert.deepEqual(after[table],before[table]);
 }
 const oldIds=new Set(before.crm_activities.map(row=>String(row.id))),created=after.crm_activities.filter(row=>!oldIds.has(String(row.id)));
 assert.equal(created.length,Math.min(6-Math.min(6,tomorrow.queues.today.total),tomorrow.unplanned.total));
 assert.equal(new Set(created.map(row=>row.client_id)).size,created.length);
});
test('corrupted saved state fails closed and does not manufacture replacement selections',async()=>{
 const plan=await db('crm_work_queue_days').where({owner_user_id:a.id,work_date:day}).first(),before=await snapshot();
 try{await db('crm_work_queue_days').where({id:plan.id}).update({state:'invalid JSON'});await api('/v8/work-queues',undefined,409);await api('/v8/work-queues/select',{action:'initialize'},409);assert.deepEqual(await snapshot(),before);}
 finally{await db('crm_work_queue_days').where({id:plan.id}).update({state:plan.state});}
});
test('new migration is restartable and strict preflight accepts only its known missing table',async()=>{
 const initial=await inspect(db);assert.equal(validate(initial,true).ok,true);assert.ok(initial.applied.includes('005_daily_work_queues.js'));
 const prior=structuredClone(initial);prior.tables=prior.tables.filter(t=>t.TABLE_NAME!=='crm_work_queue_days');prior.columns=prior.columns.filter(c=>c.TABLE_NAME!=='crm_work_queue_days');prior.indexes=prior.indexes.filter(i=>i.TABLE_NAME!=='crm_work_queue_days');prior.applied=prior.applied.filter(x=>!['005_daily_work_queues.js','006_user_mail_signatures.js'].includes(x));
 assert.equal(validate(prior).ok,true);assert.deepEqual(validate(prior).pending,['005_daily_work_queues.js','006_user_mail_signatures.js']);assert.equal(validate(prior,true).ok,false);
 const partial=structuredClone(initial);partial.applied=prior.applied;partial.columns=partial.columns.filter(c=>!(c.TABLE_NAME==='crm_work_queue_days'&&c.COLUMN_NAME==='state'));assert.equal(validate(partial).ok,false);
 const before=await snapshot(),plans=await db('crm_work_queue_days').select('*');await require('../database/migrations/005_daily_work_queues').up(db);assert.deepEqual(await snapshot(),before);assert.deepEqual(await db('crm_work_queue_days').select('*'),plans);
 await assert.rejects(require('../database/migrations/005_daily_work_queues').down(db),/Forward-only/);
 assert.equal(migrations.length,6);
});
test('a concurrent manual planner cannot produce a second active task for a returning client',async()=>{
 const suffix=crypto.randomBytes(6).toString('hex');
 const [id]=await db('users').insert({name:'Queue race',email:'queue-race-'+suffix+'@example.invalid',password_hash:'synthetic-non-login-hash',role:'sales',is_active:1});
 const user={id,role:'sales'},first=await client(id,'concurrent first'),second=await client(id,'concurrent second');
 const initial=await queues.select(db,user,{action:'initialize'});
 let release,holding,observed=false;
 const unlocked=new Promise(r=>release=r),locked=new Promise(r=>holding=r);
 const manual=db.transaction(async trx=>{
  await w.lockClient(trx,first,user);holding();await unlocked;
  return w.create(trx,user,{client_id:first,type:'Kõne',template_id:templates.Kõne,purpose:'Test Kõne',instructions:'Concurrent manual plan',due_date:day});
 });
 await locked;
 const listener=query=>{if(query.sql.includes('crm_clients')&&query.sql.includes('for update')&&query.bindings.includes(first)){observed=true;release();}};
 const timer=setTimeout(release,5000);db.on('query',listener);
 try{
  const selected=await queues.select(db,user,{action:'fill',lane:'today',version:initial.version,work_date:day,template_id:templates.Kõne});
  await manual;assert.equal(observed,true);
  assert.deepEqual(selected.queues.today.items.map(a=>a.client_id),[second]);
  assert.equal(Number((await db('crm_activities').where({client_id:first,status:'active'}).count('* as n').first()).n),1);
 }finally{clearTimeout(timer);db.removeListener('query',listener);release();await manual;}
});
