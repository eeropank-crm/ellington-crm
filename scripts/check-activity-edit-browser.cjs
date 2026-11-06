if(!/^ellington_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME||''))throw Error('Explicit synthetic DB required');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),crypto=require('crypto');
for(const k of Object.keys(process.env))if(/^CRM_(MAIL|SMTP|IMAP)/.test(k))delete process.env[k];process.env.CRM_IMAP_ENABLED='0';
const db=require('../server/db');require('../scripts/local-database')(db);
const w=require('../server/services/activity-workflow');
let server,browser;
(async()=>{try{
 const email=crypto.randomUUID()+'@example.invalid',password=crypto.randomBytes(24).toString('hex');
 const [uid]=await db('users').insert({name:'Tegevuste muutmise test',email,password_hash:await require('bcryptjs').hash(password,10),role:'admin',is_active:1});
 const user={id:uid,role:'sales'};const templates={};
 for(const type of w.TYPES){const [id]=await db('crm_templates').insert({name:'Muutmise test '+type,purpose:'Muutmise test '+type,type,subject:type==='E-kiri'?'Sünteetiline tutvustus':'',body:'Sünteetiline tegevuse sisu; päris kirja ei saadeta.',is_active:1});templates[type]=id;}
 const [client]=await db('crm_clients').insert({name:'Sünteetiline näidisklient',owner_user_id:uid,followup_count:5});
 await db('crm_contacts').insert({client_id:client,name:'Näidiskontakt',email:'contact@example.invalid'});
 const task=await db.transaction(trx=>w.create(trx,user,{client_id:client,type:'E-kiri',template_id:templates['E-kiri'],purpose:'Muutmise test E-kiri',subject:'Sünteetiline tutvustus',instructions:'Sünteetiline sisu',due_date:w.today()}));
 process.env['CRM_MAILBOX_'+uid]='staff@example.invalid';process.env['CRM_MAIL_PASSWORD_'+uid]='synthetic-unused';process.env.CRM_SMTP_HOST='127.0.0.1';process.env.CRM_SMTP_PORT='1';
 server=require('../server/app').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100},extraHTTPHeaders:{'X-Forwarded-Proto':'https'}}),page=await context.newPage(),errors=[];let sendAttempts=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(/\/send$|\/imap\/sync$/.test(u.pathname)){sendAttempts++;return route.abort();}if(u.hostname!=='127.0.0.1')return route.abort();return route.continue();});
 await page.goto(base+'/');await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('button[type=submit]').click();await page.waitForURL('**/prototype-preview');
 await page.getByRole('button',{name:'Ava tegevus',exact:true}).click();await page.getByRole('button',{name:'Saada kiri',exact:true}).waitFor();
 const workflow=page.locator('#crmWorkflow');fs.mkdirSync('docs/activity-edit',{recursive:true});
 // Cancelling must retain the activity and any unsaved email draft.
 await page.locator('#crmMailSubject').fill('Sünteetiline mustandi pealkiri');
 await workflow.getByRole('button',{name:'Muuda tegevust',exact:true}).click();await workflow.getByRole('heading',{name:'Muuda tegevust',exact:true}).waitFor();
 await workflow.locator('select').nth(0).selectOption('Kõne');await workflow.getByRole('button',{name:'Loobu muudatusest'}).click();await workflow.getByRole('button',{name:'Saada kiri',exact:true}).waitFor();
 assert.equal((await db('crm_activities').where({id:task.id}).first()).type,'E-kiri');assert.equal(await page.locator('#crmMailSubject').inputValue(),'Sünteetiline mustandi pealkiri');
 for(const [type,file]of [['Kõne','email-to-call'],['Kohtumine','call-to-meeting'],['E-kiri','meeting-to-email']]){
  await workflow.getByRole('button',{name:'Muuda tegevust',exact:true}).click();await workflow.getByRole('heading',{name:'Muuda tegevust',exact:true}).waitFor();
  await workflow.locator('select').nth(0).selectOption(type);await workflow.locator('select').nth(1).selectOption(String(templates[type]));
  await page.screenshot({path:'docs/activity-edit/'+file+'.png',fullPage:true});
  await workflow.getByRole('button',{name:'Salvesta muudatus',exact:true}).click();
  if(type==='E-kiri')await workflow.getByRole('button',{name:'Saada kiri',exact:true}).waitFor();else await workflow.getByRole('button',{name:'Tehtud',exact:true}).waitFor();
  assert.equal((await db('crm_activities').where({id:task.id}).first()).type,type);
 }
 await workflow.getByRole('button',{name:'Muuda tegevust',exact:true}).click();await workflow.getByRole('heading',{name:'Muuda tegevust',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'docs/activity-edit/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await workflow.getByRole('button',{name:'Loobu muudatusest'}).click();await workflow.getByRole('button',{name:'Sulge',exact:true}).click();
 await page.setViewportSize({width:1440,height:1100});await page.locator('#crmWorkMode').selectOption('admin');
 await page.getByText('Administraatori ülevaade kõigi töötajate järjekordadest.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Muuda tegevust',exact:true}).count(),0);
 await page.locator('#crmWorkMode').selectOption('user');await page.waitForFunction(()=>crmRealMe?.mode==='user');await page.getByRole('button',{name:'Kliendid',exact:true}).click();await page.evaluate(id=>openClientById(id),client);await page.getByText('Tegevust muudeti:',{exact:false}).first().waitFor();await page.screenshot({path:'docs/activity-edit/history.png',fullPage:true});
 assert.equal((await db('crm_clients').where({id:client}).first()).followup_count,5);assert.equal((await db('crm_email_outbox').where({activity_id:task.id})).length,0);assert.equal(sendAttempts,0);assert.deepEqual(errors,[]);
 console.log('PASS Chromium: email → call → meeting → email; cancel; mobile; admin read-only; unchanged client count; no send requests or JS errors.');
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.destroy();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
