const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
// Explicit isolated database required. Never inherit the development database for tests.
if (!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME || '')) throw Error('Set DB_NAME=ellington_test for integration tests.');
process.env.CRM_IMAP_ENABLED = '0';
for (const key of Object.keys(process.env)) if (/^CRM_(MAIL|SMTP|IMAP)/.test(key)) delete process.env[key];
process.env.CRM_IMAP_ENABLED = '0';
const db = require('../server/db');
require('../scripts/local-database')(db);
// dotenv must not enable integrations from a local .env either.
for (const key of Object.keys(process.env)) if (/^CRM_(MAIL|SMTP|IMAP)/.test(key)) delete process.env[key];
process.env.CRM_IMAP_ENABLED = '0';
const migration = {directory:path.join(__dirname,'../database/migrations')};
let fixture, server, base, cookie;
async function api(url, body, status=200, method=body===undefined?'GET':'POST', session=cookie) {
  const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https',...(session?{Cookie:session}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));
  return {data,res};
}
before(async()=>{
  await db.migrate.latest(migration);
  fixture=await require('../scripts/seed-test')(db);
  const app=require('../server/app');
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.destroy();});
test('migrations and synthetic seed are repeatable and preserve data',async()=>{
  const before=await db('crm_clients').where({id:fixture.client}).first();
  assert.deepEqual((await db.migrate.latest(migration))[1],[]);
  await require('../database/migrations/002_v8').up(db); // interrupted DDL recovery path
  assert.deepEqual(await require('../scripts/seed-test')(db),fixture);
  assert.deepEqual(await db('crm_clients').where({id:fixture.client}).first(),before);
});
test('login, secure session, protected pages, search and client card',async()=>{
  await api('/api/me',undefined,401,'GET',null);
  await api('/api/login',{email:'crm-sales@example.invalid',password:'wrong'},401);
  const password=crypto.randomBytes(24).toString('hex');
  await db('users').where({id:fixture.sales}).update({password_hash:await require('bcryptjs').hash(password,10)});
  const login=await api('/api/login',{email:'crm-sales@example.invalid',password});
  const header=login.res.headers.get('set-cookie');assert.match(header,/Secure/);assert.match(header,/HttpOnly/);
  cookie=header.split(';')[0];
  assert.equal((await api('/api/me')).data.user.id,fixture.sales);
  for(const page of ['/dashboard','/prototype-preview'])assert.equal((await fetch(base+page,{headers:{Cookie:cookie}})).status,200);
  for(const search of ['Testettevõte','Testkontakt']) assert.ok((await api('/api/clients?search='+encodeURIComponent(search))).data.clients.some(c=>c.id===fixture.client));
  const card=(await api('/api/clients/'+fixture.client)).data;
  assert.equal(card.contacts[0].email,'contact@example.invalid');assert.equal(card.history.length,1);
  await api('/api/v8/config');await api('/api/v8/activities');
});
const today=()=>require('../server/services/activity-workflow').today();
async function create(type,due=today()){
  return (await api('/api/v8/activities',{client_id:fixture.client,type,due_date:due,template_id:fixture.templates[type],purpose:'Test '+type,instructions:'Testjuhis',subject:'Testpealkiri'})).data.id;
}
test('call completion is atomic and idempotent; follow-up can be replanned',async()=>{
  await db('crm_clients').where({id:fixture.client}).update({stop_reason:null});
  const id=await create('Kõne');
  await api('/api/v8/activities/'+id+'/resolve',{comment:''},400);
  const completed=(await api('/api/v8/activities/'+id+'/resolve',{comment:'Sünteetiline kõnetulemus'})).data;
  const again=(await api('/api/v8/activities/'+id+'/resolve',{comment:'Kordus'})).data;
  assert.equal(again.next_activity_id,completed.next_activity_id);assert.equal(again.already_completed,true);
  await api('/api/v8/activities/'+id+'/next-step',{next:'plan',planned:{type:'Kohtumine',due_date:today(),template_id:fixture.templates.Kohtumine,purpose:'Test Kohtumine',instructions:'Juhis'}});
  const card=(await api('/api/clients/'+fixture.client)).data;
  assert.equal(card.activityHistory.find(a=>a.id===id).result_comment,'Sünteetiline kõnetulemus');
});
test('meeting results, postponing, stopping and mail send guard',async()=>{
  const id=await create('Kohtumine');
  await api('/api/v8/activities/'+id+'/resolve',{outcome:'done',comment:'Valmis kohtumine'});
  const call=await create('Kõne');
  await api('/api/v8/activities/'+call+'/resolve',{action:'postpone',new_date:'2099-01-01'});
  const email=await create('E-kiri');
  await api('/api/v8/activities/'+email+'/resolve',{},409);
  const contact=await db('crm_contacts').where({client_id:fixture.client}).first();
  await api('/api/mail/activity/'+email+'/send',{contact_id:contact.id,recipient:contact.email,subject:'Test',body:'Test'},409);
  assert.equal(Number((await db('crm_email_outbox').where({activity_id:email}).count('* as n').first()).n),0);
  await api('/api/clients/'+fixture.client+'/stop-monitoring',{reason:'Sünteetilise testi lõpetamine'});
  assert.equal(Number((await db('crm_activities').where({client_id:fixture.client,status:'active'}).count('* as n').first()).n),0);
  await db('crm_clients').where({id:fixture.client}).update({stop_reason:null});
});
test('budget audit, mailbox reads, role checks and logout',async()=>{
  await api('/api/clients/'+fixture.client+'/budget',{mode:'annual',annual:1200},200,'PUT');
  await api('/api/clients/'+fixture.client+'/budget/history');
  for(const endpoint of ['/api/mail/client/'+fixture.client+'/history','/api/mail/client/'+fixture.client+'/replies','/api/mail/reply-alerts'])await api(endpoint);
  await api('/api/admin/portfolio-history',undefined,403);
  await api('/api/logout',{});await api('/api/me',undefined,401);
});
test('admin portfolio transfer writes audit and queue; ownership blocks changes',async()=>{
  const password=crypto.randomBytes(24).toString('hex');
  await db('users').where({id:fixture.admin}).update({password_hash:await require('bcryptjs').hash(password,10)});
  const login=await api('/api/login',{email:'crm-admin@example.invalid',password});
  cookie=login.res.headers.get('set-cookie').split(';')[0];
  await api('/api/work-mode',{mode:'admin'});
  await api('/api/admin/portfolio-history');
  const result=(await api('/api/admin/portfolio-transfer',{from_user_id:fixture.sales,to_user_id:fixture.admin,client_ids:[fixture.client]})).data;
  assert.equal(result.transferred,1);
  assert.ok(await db('crm_portfolio_transfer_items').where({transfer_id:result.transfer_id}).first());
  assert.equal((await db('crm_ionprint_sync_queue').where({transfer_id:result.transfer_id}).first()).status,'awaiting_mapping');
  await assert.rejects(db.transaction(trx=>require('../server/services/activity-workflow').create(trx,{id:fixture.sales,role:'sales'},{client_id:fixture.client})),e=>e.status===403);
  await api('/api/admin/portfolio-transfer',{from_user_id:fixture.admin,to_user_id:fixture.sales,client_ids:[fixture.client]});
});
