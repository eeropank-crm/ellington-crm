// Isolated deployment test adapter. Deliberately refuses non-test databases.
const fs=require('node:fs');
const {spawnSync,spawn}=require('node:child_process');
const [action,release]=process.argv.slice(2);
if(!/^ellington_test/.test(process.env.DB_NAME||'')||process.env.DB_HOST!=='127.0.0.1'||!process.env.ELLINGTON_TEST_PID)process.exit(1);
const file=process.env.ELLINGTON_TEST_PID;
function state(){
 try{const entry=JSON.parse(fs.readFileSync(file));process.kill(entry.pid,0);if(fs.readlinkSync('/proc/'+entry.pid+'/cwd')!==release)throw Error('wrong path');return entry;}
 catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}
}
(async()=>{
 if(action==='status')process.exitCode=state()?0:3;
 else if(action==='stop'){
  const entry=state();if(entry){process.kill(entry.pid,'SIGTERM');for(let i=0;i<50;i++){try{process.kill(entry.pid,0);}catch{break;}await new Promise(r=>setTimeout(r,100));}fs.unlinkSync(file);}
 }else if(action==='start'){
  if(state())throw Error('already running');
  const log=fs.openSync(file+'.log','a',0o600);
  const child=spawn(process.execPath,['server/index.js'],{cwd:release,env:process.env,detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
  fs.writeFileSync(file,JSON.stringify({pid:child.pid}),{mode:0o600});
  await new Promise(r=>setTimeout(r,500));if(!state())throw Error('not running');
 }else throw Error('invalid action');
})().catch(()=>{process.exitCode=1;});
