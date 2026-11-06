'use strict';
const {ImapFlow}=require('imapflow');
const {simpleParser}=require('mailparser');
const mailboxes=require('./mailboxes');
const normalize=value=>String(value||'').trim().replace(/^<|>$/g,'').toLowerCase();
const email=value=>String(value||'').trim().toLowerCase();
const storedText=value=>new TextDecoder().decode(Buffer.from(String(value||'').slice(0,20000)).subarray(0,64000),{stream:true});
module.exports=function(db,{env=process.env,createClient=config=>new ImapFlow(config),parseMessage=simpleParser,now=()=>new Date()}={}){
 let busy=false;
 async function configurations(){
  const users=await db('users').where({is_active:1}).select('id');
  return users.map(u=>mailboxes.settings(u.id,env));
 }
 async function status(){
  const configs=await configurations();
  return {enabled:configs.some(c=>c.enabled),configured:configs.some(c=>c.imap),mailboxes:configs.map(c=>({user_id:c.id,...mailboxes.status(c.id,env)}))};
 }
 async function importReply(config,parsed){
  const messageId=normalize(parsed.messageId),sender=email(parsed.from?.value?.[0]?.address);
  if(!messageId||!sender||sender===email(config.address))return {matched:false,imported:false};
  const referenceText=[parsed.inReplyTo,...(Array.isArray(parsed.references)?parsed.references:[parsed.references])].flat().filter(Boolean).join(' ');
  const references=(referenceText.match(/<[^<>]+>/g)||referenceText.split(/\s+/)).map(normalize).filter(Boolean);
  if(!references.length)return {matched:false,imported:false};
  const sent=await db('crm_email_outbox').where({status:'sent',user_id:config.id}).whereIn('message_id',references.map(v=>'<'+v+'>')).orderBy('id','desc').first();
  if(!sent||sender!==email(sent.recipient))return {matched:false,imported:false};
  const imported=await db.transaction(async trx=>{
   const client=await trx('crm_clients').where({id:sent.client_id}).forUpdate().first();
   if(!client||!await trx('users').where({id:config.id,is_active:1}).first('id'))return false;
   if(await trx('crm_email_inbox').where({mailbox_user_id:config.id,message_id:'<'+messageId+'>'}).forUpdate().first('id'))return false;
   const received=parsed.date instanceof Date&&!Number.isNaN(parsed.date.getTime())?parsed.date:now();
   await trx('crm_email_inbox').insert({mailbox_user_id:config.id,outbox_id:sent.id,client_id:sent.client_id,activity_id:sent.activity_id,sender,recipient:email(config.address),subject:String(parsed.subject||'').slice(0,500),body:storedText(parsed.text),message_id:'<'+messageId+'>',received_at:received,created_at:trx.fn.now()});
   // Reply history follows the client after transfer; another owners work is never cancelled.
   if(Number(client.owner_user_id)!==config.id||client.stop_reason)return true;
   const automatic=await trx('crm_v8_activity_events').where({activity_id:sent.activity_id,event_type:'completed_default_followup'}).orderBy('id','desc').first('details');
   let followId;try{followId=JSON.parse(automatic?.details||'{}').next_activity_id;}catch{return true;}
   if(!Number.isSafeInteger(Number(followId))||Number(followId)<1)return true;
   const follow=await trx('crm_activities').where({id:followId,client_id:sent.client_id,owner_user_id:config.id,status:'active'}).forUpdate().first();
   if(!follow)return true;
   const touched=await trx('crm_v8_activity_events').where({activity_id:followId}).whereNotIn('event_type',['created_default_followup']).first('id');
   if(touched)return true;
   await trx('crm_activities').where({id:followId,status:'active'}).update({status:'stopped',updated_at:trx.fn.now()});
   await trx('crm_v8_activity_events').insert({activity_id:followId,user_id:config.id,event_type:'auto_followup_cancelled_reply',details:JSON.stringify({inbox_message_id:'<'+messageId+'>',original_activity_id:sent.activity_id})});
   return true;
  });
  return {matched:true,imported};
 }
 async function syncMailbox(config){
  const client=createClient({...config.imap,auth:{user:config.address,pass:config.password},logger:false,connectionTimeout:15000,socketTimeout:30000,greetingTimeout:15000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
  const counts={user_id:config.id,status:'ok',scanned:0,matched:0,imported:0,message_errors:0};
  try{
   await client.connect();const lock=await client.getMailboxLock('INBOX',{readOnly:true});
   try{
    const since=new Date(now().getTime()-45*86400000),uids=await client.search({since},{uid:true});
    for(const uid of uids.slice(-250)){
     try{
      const message=await client.fetchOne(uid,{uid:true,source:true},{uid:true});if(!message?.source)continue;
      counts.scanned++;const parsed=await parseMessage(message.source,{skipHtmlToText:false});
      const result=await importReply(config,parsed);if(result.matched)counts.matched++;if(result.imported)counts.imported++;
     }catch{counts.message_errors++;}
    }
   }finally{lock.release();}
  }finally{try{await client.logout();}catch{try{client.close();}catch{}}}
  return counts;
 }
 async function sync(){
  if(busy)return {skipped:true,reason:'already_running'};
  busy=true;
  try{
   const configured=(await configurations()).filter(c=>c.enabled&&c.imap),addresses=new Set();
   for(const config of configured){if(addresses.has(email(config.address)))throw Error('Postkastide seadistus vajab kontrollimist.');addresses.add(email(config.address));}
   const results=[];
   for(const config of configured){try{results.push(await syncMailbox(config));}catch{results.push({user_id:config.id,status:'error',code:'IMAP_SYNC_FAILED',scanned:0,matched:0,imported:0,message_errors:0});}}
   return {scanned:results.reduce((n,r)=>n+r.scanned,0),matched:results.reduce((n,r)=>n+r.matched,0),imported:results.reduce((n,r)=>n+r.imported,0),mailboxes:results};
  }finally{busy=false;}
 }
 return {sync,status};
};
