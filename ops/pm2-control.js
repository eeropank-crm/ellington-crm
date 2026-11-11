#!/usr/bin/env node
'use strict';
// Adapter for an existing, explicitly named PM2 application. Never prints jlist/env.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
// PM2 may print this version notice to stdout even for `jlist`.
// Accept only that complete, known preamble; never scrape an arbitrary JSON fragment.
function parseProcessList(output){
 let rows;
 try{
  try{rows=JSON.parse(output);}catch{
   const lines=output.split(/\r?\n/),index=lines.findIndex(line=>/^[ \t]*\[/.test(line));
   if(index<0)throw Error();
   const prefix=lines.slice(0,index).join('\n').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').trim();
   const version='[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?';
   const notice=new RegExp('^>>>> In-memory PM2 is out-of-date, do:\\s*\\n>>>> \\$ pm2 update\\s*\\nIn memory PM2 version: *'+version+'\\s*\\nLocal PM2 version: *'+version+'$');
   if(!notice.test(prefix))throw Error();
   rows=JSON.parse(lines.slice(index).join('\n'));
  }
  if(!Array.isArray(rows)||rows.some(p=>!p||typeof p.name!=='string'||!p.name||!Number.isSafeInteger(p.pm_id)||p.pm_id<0||!p.pm2_env||Array.isArray(p.pm2_env)||typeof p.pm2_env.status!=='string'||typeof p.pm2_env.pm_exec_path!=='string'||!path.isAbsolute(p.pm2_env.pm_exec_path)))throw Error();
  return rows;
 }catch{throw Error('PM2 protsessiloend pole oodatud kujul. Privaatset väljundit ei kuvata.');}
}
function main(){
const [action,release]=process.argv.slice(2);
const name=process.env.ELLINGTON_PM2_NAME;
function pm2(args){const r=spawnSync('pm2',args,{encoding:'utf8',maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error('PM2 käsk ebaõnnestus.');return r.stdout;}
try{
 if(!name||!/^[A-Za-z0-9_-]+$/.test(name)||!release||!path.isAbsolute(release))throw Error('Määra ELLINGTON_PM2_NAME ja absoluutne väljalaskekaust.');
 const matches=parseProcessList(pm2(['jlist'])).filter(p=>p.name===name);
 if(matches.length>1||(matches.length===0&&action!=='start'))throw Error('Oodatud on täpselt üks olemasolev PM2 protsess.');
 const app=matches[0],env=app?.pm2_env;
 // start changes the path only after stop; status/stop must refer to the exact live release.
 if(action!=='start'&&fs.realpathSync(env.pm_exec_path)!==fs.realpathSync(path.join(release,'server/index.js')))throw Error('PM2 protsessi tee ei vasta kontrollitud väljalaskele.');
 if(action==='status')process.exitCode=env.status==='online'?0:['stopped','errored'].includes(env.status)?3:1;
 else if(action==='stop'){pm2(['stop',String(app.pm_id)]);pm2(['save','--force']);}
 else if(action==='start'){
  if(app&&!['stopped','errored'].includes(env.status))throw Error('Enne käivitamist peab vana protsess olema peatatud.');
  if(app)pm2(['delete',String(app.pm_id)]);
  pm2(['start',path.join(release,'server/index.js'),'--name',name,'--cwd',release,'--interpreter',process.execPath,'--time']);
  pm2(['save','--force']);
 }else throw Error('Tundmatu protsessitoiming.');
}catch(e){console.error(e.message);process.exitCode=1;}

}
if(require.main===module)main();
module.exports={parseProcessList};
