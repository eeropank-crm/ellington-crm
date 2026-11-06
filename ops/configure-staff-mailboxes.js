#!/usr/bin/env node
'use strict';
const {configure}=require('./staff-mailbox-settings');
const mailboxes=require('../server/services/mailboxes');
const fs=require('node:fs'),path=require('node:path');
process.umask(0o077);
async function checkUsers(env,staff){
 if(env.DB_HOST!=='localhost'||env.DB_NAME!=='d24248_ellingtoncrm')throw Error('DATABASE_IDENTITY');
 const db=await require('mysql2/promise').createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectTimeout:10000});
 try{
  const [rows]=await db.execute('SELECT id,email,is_active FROM users WHERE id IN (?,?)',staff.map(u=>u.id));
  if(rows.length!==staff.length||staff.some(u=>!rows.some(r=>Number(r.id)===u.id&&r.email===u.login&&Number(r.is_active)===1)))throw Error('ACCOUNT_NOT_READY');
 }finally{await db.end();}
}
async function verify(id,env){
 process.stderr.write('Kontrollin kasutaja '+id+' SMTP- ja IMAP-ühendust (kirja ei saadeta).\n');
 const config=mailboxes.settings(id,env);
 const transport=require('nodemailer').createTransport({...config.smtp,logger:false,debug:false,auth:{user:config.address,pass:config.password},requireTLS:!config.smtp.secure,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
 try{await transport.verify();}catch{throw Error('SMTP_AUTH_'+id);}finally{transport.close();}
 const client=new (require('imapflow').ImapFlow)({...config.imap,auth:{user:config.address,pass:config.password},logger:false,connectionTimeout:15000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},socketTimeout:20000,greetingTimeout:15000});
 try{await client.connect();const lock=await client.getMailboxLock('INBOX',{readOnly:true});lock.release();}
 catch{throw Error('IMAP_AUTH_'+id);}finally{try{await client.logout();}catch{try{client.close();}catch{}}}
}
(async()=>{
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--env')throw Error('ARGUMENTS');
 const active=path.join(process.env.HOME,'ellington-deploy/current');
 if(fs.realpathSync(active)!==fs.realpathSync(path.resolve(__dirname,'..')))throw Error('RELEASE_NOT_ACTIVE');
 if(fs.realpathSync(args[1])!==fs.realpathSync(path.join(active,'.env')))throw Error('ENV_IDENTITY');
 const result=await configure(args[1],{2:process.env.ELLINGTON_SETUP_PASSWORD_2,3:process.env.ELLINGTON_SETUP_PASSWORD_3},{checkUsers,verify});
 console.log(JSON.stringify(result,null,2));
})().catch(error=>{
 const allowed=['RELEASE_NOT_ACTIVE','ENV_IDENTITY','PASSWORD_REQUIRED','ENV_ENCODING','ENV_PERMISSIONS','ENV_CHANGED','WRITE_VERIFICATION','BACKUP_FAILED','DATABASE_IDENTITY','ACCOUNT_NOT_READY','ARGUMENTS','SMTP_AUTH_2','SMTP_AUTH_3','IMAP_AUTH_2','IMAP_AUTH_3'];
 console.error(JSON.stringify({ok:false,code:allowed.includes(error.message)?error.message:'SETUP_FAILED',testEmailSent:false}));process.exitCode=1;
});
