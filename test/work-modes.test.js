const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Set DB_NAME=ellington_test');
const db=require('../server/db');require('../scripts/local-database')(db);
for(const key of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(key))delete process.env[key];
process.env.CRM_IMAP_ENABLED='0';
let fixture, ownClient, ownActivity, otherActivity, server, base, adminCookie, salesCookie;
const passwords={admin:crypto.randomBytes(24).toString('hex'),sales:crypto.randomBytes(24).toString('hex')};
async function request(url,body,status=200,cookie=adminCookie,method=body===undefined?'GET':'POST'){
 const res=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return {res,data};
}
async function login(kind){
 const x=await request('/login',{email:'crm-'+kind+'@example.invalid',password:passwords[kind]},200,null);
 return x.res.headers.get('set-cookie').split(';')[0];
}
const snapshot=async()=>{
 const result={};
 for(const table of ['users','crm_clients','crm_activities','crm_activity_details','crm_activity_history','crm_v8_activity_events','crm_portfolio_transfers','crm_email_inbox','crm_email_outbox'])result[table]=await db(table).select('*');
 return result;
};
before(async()=>{
 await db.migrate.latest({directory:path.join(__dirname,'../database/migrations')});
 fixture=await require('../scripts/seed-test')(db);
 for(const kind of ['admin','sales'])await db('users').where({id:fixture[kind]}).update({password_hash:await require('bcryptjs').hash(passwords[kind],10)});
 let client=await db('crm_clients').where({google_id:'synthetic-mode-admin'}).first();
 if(!client){const [id]=await db('crm_clients').insert({name:'Sünteetiline Eero klient',google_id:'synthetic-mode-admin',owner_user_id:fixture.admin});client={id};}
 ownClient=client.id;
 await db('crm_clients').where({id:ownClient}).update({owner_user_id:fixture.admin,stop_reason:null});
 await db('crm_clients').where({id:fixture.client}).update({owner_user_id:fixture.sales,stop_reason:null});
 const w=require('../server/services/activity-workflow');
 async function create(client,user){return db.transaction(trx=>w.create(trx,{id:user,role:'sales'},{client_id:client,type:'Kõne',purpose:'Test Kõne',template_id:fixture.templates.Kõne,due_date:w.today(),instructions:'Sünteetiline juhis'}));}
 ownActivity=(await create(ownClient,fixture.admin)).id;otherActivity=(await create(fixture.client,fixture.sales)).id;
 server=require('../server/app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 adminCookie=await login('admin');salesCookie=await login('sales');
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('admin login defaults to user mode with unchanged account identity and own-only reads',async()=>{
 const me=(await request('/me')).data.user;
 assert.equal(me.id,fixture.admin);assert.equal(me.accountRole,'admin');assert.equal(me.role,'sales');assert.equal(me.mode,'user');
 for(const endpoint of ['/activities','/v8/activities']){
  const rows=(await request(endpoint)).data.activities;assert.ok(rows.some(a=>a.id===ownActivity));assert.ok(rows.every(a=>Number(a.owner_user_id)===fixture.admin));
 }
 const rows=(await request('/clients?search='+encodeURIComponent('Sünteetiline'))).data.clients;
 assert.ok(rows.some(c=>c.id===ownClient));assert.ok(rows.every(c=>Number(c.owner_user_id)===fixture.admin));
 await request('/clients/'+ownClient);await request('/clients/'+fixture.client,undefined,403);
 for(const url of ['/admin/users-real','/admin/portfolios','/admin/portfolio-history','/v8/budget/summary','/mail/imap/status'])await request(url,undefined,403);
 await request('/v8/templates',{type:'Kõne',purpose:'Ei tohi',body:'Ei tohi'},403);
});
test('mode switch persists across requests and does not mutate CRM, users, counters or histories',async()=>{
 const initial=await snapshot();
 const switched=(await request('/work-mode',{mode:'admin'})).data.user;
 assert.equal(switched.id,fixture.admin);assert.equal(switched.accountRole,'admin');assert.equal(switched.mode,'admin');
 assert.equal((await request('/me')).data.user.mode,'admin');
 assert.deepEqual(await snapshot(),initial);
 for(const url of ['/admin/users-real','/admin/portfolios','/admin/portfolio-history','/v8/budget/summary','/mail/imap/status'])await request(url);
 for(const endpoint of ['/activities','/v8/activities']){
  const rows=(await request(endpoint)).data.activities;assert.ok(rows.some(a=>a.id===ownActivity));assert.ok(rows.some(a=>a.id===otherActivity));
 }
 await request('/clients/'+fixture.client);
 // Search the fixture precisely: the endpoint intentionally returns at most 50
 // matches, so unrelated synthetic clients must not hide it on the first page.
 const target=await db('crm_clients').where({id:fixture.client}).first('name');
 assert.ok((await request('/clients?search='+encodeURIComponent(target.name))).data.clients.some(c=>c.id===fixture.client));
 await request('/work-mode',{mode:'user'});assert.deepEqual(await snapshot(),initial);
 await request('/clients/'+fixture.client,undefined,403);
});
test('both modes deny other employees workflow writes, even direct API requests',async()=>{
 for(const mode of ['user','admin']){
  await request('/work-mode',{mode});const initial=await snapshot();
  await request('/v8/activities/'+otherActivity+'/resolve',{comment:'Võõra tegevuse tulemus'},403);
  await request('/v8/activities/'+otherActivity+'/resolve',{action:'postpone',new_date:'2099-01-01'},403);
  await request('/v8/activities/'+otherActivity+'/next-step',{next:'default'},403);
  await request('/clients/'+fixture.client+'/stop-monitoring',{reason:'Võõra jälgimise lõpetamine'},403);
  await request('/v8/activities',{client_id:fixture.client},403);
  await request('/activities',{client_id:fixture.client},403);
  assert.deepEqual(await snapshot(),initial);
 }
});
test('admin can complete own tasks in both modes, with own user ID in history',async()=>{
 for(const mode of ['user','admin']){
  await request('/work-mode',{mode});
  const result=(await request('/v8/activities/'+ownActivity+'/resolve',{comment:'Sünteetiline tulemus '+mode})).data;
  assert.equal(result.completed,true);
  const event=await db('crm_v8_activity_events').where({activity_id:ownActivity,event_type:'completed_default_followup'}).first();
  assert.equal(Number(event.user_id),fixture.admin);ownActivity=result.next_activity_id;
 }
});
test('sales cannot elevate; invalid and anonymous switches fail; role revocation is checked live',async()=>{
 await request('/work-mode',{mode:'admin'},403,salesCookie);
 await request('/work-mode',{mode:'user'},200,salesCookie);
 await request('/admin/users-real',undefined,403,salesCookie);
 await request('/work-mode',{mode:'owner'},400);
 await request('/work-mode',{mode:'admin'},401,null);
 await db('users').where({id:fixture.admin}).update({role:'sales'});
 try{
  assert.equal((await request('/me')).data.user.mode,'user');
  await request('/admin/users-real',undefined,403);
  await request('/work-mode',{mode:'admin'},403);
 }finally{await db('users').where({id:fixture.admin}).update({role:'admin'});}
});
test('management writes require admin mode; templates, reasons and users are manageable',async()=>{
 const suffix=crypto.randomBytes(6).toString('hex');
 const template={type:'Kõne',purpose:'Režiimitest '+suffix,body:'Sünteetiline juhis'};
 const user={name:'Sünteetiline lisakasutaja',email:suffix+'@example.invalid',role:'sales',password:crypto.randomBytes(24).toString('hex')};
 await request('/work-mode',{mode:'user'});
 await request('/v8/templates',template,403);
 await request('/v8/reasons',{label:'Testpõhjus '+suffix},403);
 await request('/admin/users-real',user,403);
 await request('/work-mode',{mode:'admin'});
 const templateId=(await request('/v8/templates',template)).data.id;
 const reasonId=(await request('/v8/reasons',{label:'Testpõhjus '+suffix})).data.id;
 const userId=(await request('/admin/users-real',user)).data.id;
 await request('/v8/reasons/'+reasonId,{label:'Muudetud põhjus '+suffix},200,adminCookie,'PATCH');
 await request('/v8/templates/'+templateId,undefined,200,adminCookie,'DELETE');
 await request('/v8/reasons/'+reasonId,undefined,200,adminCookie,'DELETE');
 await request('/admin/users-real/'+userId,{action:'active',active:false},200,adminCookie,'PATCH');
 assert.equal(Number((await db('users').where({id:userId}).first()).is_active),0);
});
test('own client never permits completing or stopping a different owners activity',async()=>{
 const [id]=await db('crm_activities').insert({client_id:ownClient,owner_user_id:fixture.sales,type:'Kõne',status:'active',due_date:'2099-01-01'});
 try{
  for(const mode of ['user','admin']){
   await request('/work-mode',{mode});
   const card=(await request('/clients/'+ownClient)).data;
   assert.equal(card.activities.some(a=>a.id===id),mode==='admin');
   await request('/v8/activities/'+id+'/resolve',{comment:'Ei ole minu tegevus'},403);
   await request('/clients/'+ownClient+'/stop-monitoring',{reason:'Peatamise testpõhjus'},403);
   assert.equal((await db('crm_activities').where({id}).first()).status,'active');
   assert.equal((await db('crm_clients').where({id:ownClient}).first()).stop_reason,null);
  }
 }finally{await db('crm_activities').where({id}).delete();}
});
test('new login resets administrator mode without a second account',async()=>{
 await request('/work-mode',{mode:'admin'});
 adminCookie=await login('admin');
 const me=(await request('/me')).data.user;
 assert.equal(me.mode,'user');assert.equal(me.id,fixture.admin);
 await request('/admin/users-real',undefined,403);
});
