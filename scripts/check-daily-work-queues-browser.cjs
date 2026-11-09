'use strict';
if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit synthetic DB required');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),crypto=require('crypto'),fs=require('fs');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const w=require('../server/services/activity-workflow');
const day=w.today(),shift=n=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
let server,browser;const fixtures=[],errors=[];let sendRequests=0;
const empty=()=>({today:{ids:[],seen:[],batch:0},overdue:{ids:[],seen:[],batch:0}});
(async()=>{try{
 const password=crypto.randomBytes(24).toString('hex'),hash=await require('bcryptjs').hash(password,10);
 const [video]=await db('crm_templates').insert({type:'E-kiri',name:'Video tutvustus (päevaplaani test)',purpose:'Video tutvustus (päevaplaani test)',subject:'Sünteetiline video tutvustus',body:'Sünteetiline kirjamustand. Seda kirja ei saadeta.',is_active:1});
 const [call]=await db('crm_templates').insert({type:'Kõne',name:'Planeeritud kõne (test)',purpose:'Planeeritud kõne (test)',body:'Sünteetiline kokkulepitud kõne.',is_active:1});
 for(const [name,planned,role]of [['Eero',0,'admin'],['Indrek',3,'sales'],['Palme',6,'sales']]){
  const email=crypto.randomUUID()+'@example.invalid';const [id]=await db('users').insert({name:'Sünteetiline '+name,email,password_hash:hash,role,is_active:1});
  const old=empty(),current=empty();
  async function client(label,count=2){const [cid]=await db('crm_clients').insert({name:label,owner_user_id:id,followup_count:count});await db('crm_contacts').insert({client_id:cid,name:'Sünteetiline kontakt',email:'contact@example.invalid'});return cid;}
  async function activity(cid,type,template,due,status='active'){
   const t=await db('crm_templates').where({id:template}).first();const [aid]=await db('crm_activities').insert({client_id:cid,owner_user_id:id,type,status,due_date:due,sequence_number:3});
   await db('crm_activity_details').insert({activity_id:aid,template_id:template,purpose:t.purpose,subject:t.subject||'',instructions:t.body});return aid;
  }
  for(let i=0;i<6;i++){const cid=await client('Varasema päeva testklient '+name+' '+i);old.today.ids.push(await activity(cid,'E-kiri',video,shift(-3),'completed'));await activity(cid,'E-kiri',video,shift(14));}
  old.today.seen=[...old.today.ids];const cancelled=await activity(await client('Tühistatud testklient '+name,0),'Kõne',call,shift(-3),'cancelled');old.today.seen.push(cancelled);
  for(let i=0;i<planned;i++)current.today.ids.push(await activity(await client('Planeeritud klient '+name+' '+(i+1)),'Kõne',call,day));current.today.seen=[...current.today.ids];
  if(name==='Eero'){for(let i=0;i<2;i++)current.overdue.ids.push(await activity(await client('Hilinenud klient '+(i+1)),'Kõne',call,shift(-1)));current.overdue.seen=[...current.overdue.ids];}
  for(let i=0;i<38;i++)await client('Ootel klient '+name+' '+(i+1));
  await db('crm_work_queue_days').insert([{owner_user_id:id,work_date:shift(-3),version:1,state:JSON.stringify(old)},{owner_user_id:id,work_date:shift(-1),version:1,state:JSON.stringify(empty())},{owner_user_id:id,work_date:day,version:1,state:JSON.stringify(current)}]);
  process.env['CRM_MAILBOX_'+id]='staff@example.invalid';process.env['CRM_MAIL_PASSWORD_'+id]='synthetic-unused';
  fixtures.push({id,email,name,planned});
 }
 process.env.CRM_SMTP_HOST='127.0.0.1';process.env.CRM_SMTP_PORT='1';
 const before=JSON.stringify(await db('crm_clients').whereIn('owner_user_id',fixtures.map(f=>f.id)).orderBy('id'));
 server=require('../server/app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});fs.mkdirSync('docs/daily-work-queues',{recursive:true});
 for(const f of fixtures){
  const context=await browser.newContext({viewport:{width:1440,height:1100},extraHTTPHeaders:{'X-Forwarded-Proto':'https'}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(/\/send$|\/imap\/sync$/.test(u.pathname)){sendRequests++;return route.abort();}return u.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto(base+'/');await page.locator('#email').fill(f.email);await page.locator('#password').fill(password);await page.getByRole('button',{name:'Logi sisse'}).click();await page.waitForURL('**/prototype-preview');
  await page.waitForFunction(()=>crmReady&&crmQueues?.daily_ready===true&&crmQueues.queues.today.shown===6);
  const result=await page.evaluate(()=>({dated:crmQueues.queues.today.items.filter(a=>a.type==='Kõne').length,generated:crmQueues.queues.today.items.filter(a=>a.type==='E-kiri').length}));assert.equal(result.dated,f.planned);assert.equal(result.generated,6-f.planned);
  await page.screenshot({path:'docs/daily-work-queues/'+f.name.toLowerCase()+'.png',fullPage:true});
  const allocated=await db('crm_activities').where({owner_user_id:f.id}).orderBy('id');await page.reload();await page.waitForFunction(()=>crmReady&&crmQueues?.queues.today.shown===6);assert.deepEqual(await db('crm_activities').where({owner_user_id:f.id}).orderBy('id'),allocated);
  if(f.name==='Eero'){
   assert.match(await page.locator('button.card').filter({hasText:'Tänased tegevused'}).innerText(),/6\/38/);assert.match(await page.locator('button.card').filter({hasText:'Hilinenud tegevused'}).innerText(),/2\/2/);
   await page.getByRole('button',{name:'Ava tegevus',exact:true}).first().click();await page.getByRole('button',{name:'Saada kiri',exact:true}).waitFor();assert.equal(await page.locator('#crmMailSubject').inputValue(),'Sünteetiline video tutvustus');await page.locator('#crmWorkflow').getByRole('button',{name:'Sulge',exact:true}).click();
   const othersBefore=await db('crm_activities').whereIn('owner_user_id',fixtures.slice(1).map(f=>f.id)).orderBy('id');await page.locator('#crmWorkMode').selectOption('admin');await page.waitForFunction(()=>crmQueues?.read_only===true);assert.deepEqual(await db('crm_activities').whereIn('owner_user_id',fixtures.slice(1).map(f=>f.id)).orderBy('id'),othersBefore);
   await page.locator('#crmWorkMode').selectOption('user');await page.waitForFunction(()=>crmQueues?.read_only===false);await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/daily-work-queues/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  }
  await context.close();
 }
 assert.equal(JSON.stringify(await db('crm_clients').whereIn('owner_user_id',fixtures.map(f=>f.id)).orderBy('id')),before);assert.equal((await db('crm_email_outbox').whereIn('user_id',fixtures.map(f=>f.id))).length,0);assert.equal(sendRequests,0);assert.deepEqual(errors,[]);
 console.log('PASS Chromium: existing empty 0/38 → 6/38; 3 dated + 3 new; 6 dated + 0 new; old template restored across empty days; tasks open after initialization; reload no duplicates; admin read-only; mobile; owners/counters unchanged; 0 send requests and JS errors.');
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.destroy();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
