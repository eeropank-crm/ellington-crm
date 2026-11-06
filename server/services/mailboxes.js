'use strict';
const address=value=>typeof value==='string'&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(value)?value:null;
const port=(value,fallback)=>{const n=Number(value||fallback);return Number.isInteger(n)&&n>=1&&n<=65535?n:null;};
const host=value=>typeof value==='string'&&/^[A-Za-z0-9.-]+$/.test(value)?value:null;
function settings(id,env=process.env){
 const mailbox=address(env['CRM_MAILBOX_'+id]);
 const password=env['CRM_MAIL_PASSWORD_'+id];
 const smtpHost=host(env['CRM_SMTP_HOST_'+id]||env.CRM_SMTP_HOST),smtpPort=port(env['CRM_SMTP_PORT_'+id]||env.CRM_SMTP_PORT,465);
 const imapHost=host(env['CRM_IMAP_HOST_'+id]||env.CRM_IMAP_HOST),imapPort=port(env['CRM_IMAP_PORT_'+id]||env.CRM_IMAP_PORT,993);
 const credentials=!!(mailbox&&typeof password==='string'&&password.length);
 return {id:Number(id),address:mailbox,password,
  smtp:credentials&&smtpHost&&smtpPort?{host:smtpHost,port:smtpPort,secure:smtpPort===465}:null,
  imap:credentials&&imapHost&&imapPort?{host:imapHost,port:imapPort,secure:true}:null,
  enabled:(env['CRM_IMAP_ENABLED_'+id]??env.CRM_IMAP_ENABLED)==='1'};
}
function status(id,env=process.env){const s=settings(id,env);return {address:s.address,smtp_configured:!!s.smtp,imap_configured:!!s.imap,imap_enabled:s.enabled};}
function pollingEnabled(env=process.env){return env.CRM_IMAP_ENABLED==='1'||Object.keys(env).some(k=>/^CRM_IMAP_ENABLED_[1-9]\d*$/.test(k)&&env[k]==='1');}
module.exports={settings,status,pollingEnabled};
