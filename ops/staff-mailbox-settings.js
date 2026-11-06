'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dotenv=require('dotenv');
const staff=[{id:2,login:'indrek@ellington.ee',mailbox:'indrek.mae@ellington.ee'},{id:3,login:'palme@ellington.ee',mailbox:'palme.kaggovere@ellington.ee'}];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function encoded(value){
 for(const candidate of [JSON.stringify(value),"'"+value+"'",'`'+value+'`','"'+value+'"']){
  if(dotenv.parse('VALUE='+candidate).VALUE===value)return candidate;
 }
 throw Error('ENV_ENCODING');
}
function additions(passwords){
 const values={};
 for(const user of staff){
  const password=passwords[user.id];if(typeof password!=='string'||!password.length||/[\r\n\0]/.test(password))throw Error('PASSWORD_REQUIRED');
  Object.assign(values,{['CRM_MAILBOX_'+user.id]:user.mailbox,['CRM_MAIL_PASSWORD_'+user.id]:password,['CRM_SMTP_HOST_'+user.id]:'smtp.zone.eu',['CRM_SMTP_PORT_'+user.id]:'465',['CRM_IMAP_HOST_'+user.id]:'imap.zone.eu',['CRM_IMAP_PORT_'+user.id]:'993',['CRM_IMAP_ENABLED_'+user.id]:'1'});
 }
 return values;
}
function compose(original,values){
 const keys=new Set(Object.keys(values));
 const lines=original.toString('utf8').split(/\r?\n/).filter(line=>{
  const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);return !match||!keys.has(match[1]);
 });
 const result=lines.join('\n').replace(/\n*$/,'')+'\n\n# CRM kasutajate postkastid\n'+Object.entries(values).map(([key,value])=>key+'='+encoded(value)).join('\n')+'\n';
 const before=dotenv.parse(original),after=dotenv.parse(result);
 for(const [key,value]of Object.entries({...before,...values}))if(after[key]!==value)throw Error('ENV_ENCODING');
 return result;
}
async function configure(file,passwords,{checkUsers,verify}={}){
 if(typeof checkUsers!=='function'||typeof verify!=='function')throw Error('VERIFICATION_REQUIRED');
 const target=fs.realpathSync(file),stat=fs.statSync(target);
 if(!stat.isFile()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))throw Error('ENV_PERMISSIONS');
 const original=fs.readFileSync(target),env=dotenv.parse(original),values=additions(passwords),next=compose(original,values);
 await checkUsers(env,staff);
 for(const user of staff)await verify(user.id,{...env,...values});
 if(hash(fs.readFileSync(target))!==hash(original))throw Error('ENV_CHANGED');
 const token=crypto.randomBytes(10).toString('hex'),backup=target+'.before-mailboxes-'+token+'.bak',temp=target+'.mailboxes-'+token+'.tmp';
 function write(file,content){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 write(backup,original);
 if(hash(fs.readFileSync(backup))!==hash(original))throw Error('BACKUP_FAILED');
 try{
  write(temp,next);
  if(hash(fs.readFileSync(target))!==hash(original))throw Error('ENV_CHANGED');
  fs.renameSync(temp,target);
  if(hash(fs.readFileSync(target))!==hash(next)||(fs.statSync(target).mode&0o777)!==0o600)throw Error('WRITE_VERIFICATION');
  const dir=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return {ok:true,backup,users:staff.map(u=>({userId:u.id,login:u.login,mailbox:u.mailbox,credentialsVerified:true})),restartRequired:true,testEmailSent:false};
}
module.exports={staff,additions,compose,configure};
