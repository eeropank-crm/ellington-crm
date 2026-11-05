const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {healthHost,healthMatches,smoke}=require('../ops/health-check');
const {args}=require('../ops/deploy');
const revision='synthetic-release';
async function fixture(t,host='127.0.135.83'){
 const state={release:revision,status:'ok',healthStatus:200,accountStatus:401,previewStatus:302,paths:[]};
 const server=http.createServer((req,res)=>{
  state.paths.push(req.url);
  if(req.url==='/health'){
   res.writeHead(state.healthStatus,{'Content-Type':'application/json',Location:'/redirected'});
   res.end(JSON.stringify({status:state.status,release:state.release}));
  }else if(req.url==='/api/me'){res.writeHead(state.accountStatus);res.end();}
  else if(req.url==='/prototype-preview'){res.writeHead(state.previewStatus,{Location:'/'});res.end();}
  else{res.writeHead(200);res.end('unexpected redirect target');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {state,config:{env:{PORT:String(server.address().port)}}};
}
test('health host defaults locally and accepts the observed Zone IP and IPv6 loopback',()=>{
 assert.equal(healthHost(),'127.0.0.1');
 assert.equal(healthHost('127.0.135.83'),'127.0.135.83');
 assert.equal(healthHost('::1'),'::1');
 for(const value of ['localhost','0.0.0.0','192.168.1.1','8.8.8.8','::','::ffff:127.0.0.1','http://127.0.0.1','127.0.0.1:3000','127.0.0.1/path','127.0.0.1@host','127.00.0.1','',null,42])assert.throws(()=>healthHost(value),/loopback/);
});
test('CLI distinguishes database host from health host and rejects unsafe or duplicate destinations',()=>{
 const base=['apply','--env','/private/config','--host','localhost','--database','synthetic'];
 const parsed=args([...base,'--health-host','127.0.135.83']);
 assert.equal(parsed.host,'localhost');assert.equal(parsed['health-host'],'127.0.135.83');
 assert.equal(args(base)['health-host'],undefined);
 assert.throws(()=>args([...base,'--health-host','example.invalid']),/loopback/);
 assert.throws(()=>args([...base,'--health-host','127.0.135.83','--health-host','127.0.0.1']),/korduv/);
 assert.throws(()=>args([...base,'--health-host']),/puudub/);
});
test('Zone-only listener passes SHA, account and protected-page checks at the configured address',async t=>{
 const {state,config}=await fixture(t);
 assert.equal(await healthMatches(config,revision,'127.0.0.1'),false);
 await smoke(config,revision,'127.0.135.83');
 assert.deepEqual(state.paths,['/health','/api/me','/prototype-preview']);
});
test('default address remains compatible with ordinary local deployments',async t=>{
 const {state,config}=await fixture(t,'127.0.0.1');
 await smoke(config,revision);
 assert.deepEqual(state.paths,['/health','/api/me','/prototype-preview']);
});
test('proxy environment cannot redirect a local health check',async t=>{
 const {config}=await fixture(t);
 const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NODE_USE_ENV_PROXY','NO_PROXY','no_proxy'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}});
 for(const k of keys)process.env[k]=k==='NODE_USE_ENV_PROXY'?'1':k.toLowerCase()==='no_proxy'?'':'http://127.0.0.1:1';
 await smoke(config,revision,'127.0.135.83');
});
test('wrong release, unhealthy payload, non-200 status and redirects cannot pass health checks',async t=>{
 const {state,config}=await fixture(t);
 state.release='old-release';assert.equal(await healthMatches(config,revision,'127.0.135.83'),false);
 state.release=revision;state.status='bad';assert.equal(await healthMatches(config,revision,'127.0.135.83'),false);
 state.status='ok';state.healthStatus=503;assert.equal(await healthMatches(config,revision,'127.0.135.83'),false);
 state.healthStatus=302;assert.equal(await healthMatches(config,revision,'127.0.135.83'),false);
 assert.ok(!state.paths.includes('/redirected'));
});
test('anonymous account and protected-page checks remain mandatory on the custom host',async t=>{
 const {state,config}=await fixture(t);
 state.accountStatus=200;await assert.rejects(smoke(config,revision,'127.0.135.83'),/Anonüümse/);
 state.accountStatus=401;state.previewStatus=200;await assert.rejects(smoke(config,revision,'127.0.135.83'),/Anonüümse/);
});
test('invalid destinations and ports fail before attempting a connection',async()=>{
 await assert.rejects(smoke({env:{PORT:'3000'}},revision,'example.invalid'),/loopback/);
 for(const port of ['0','80','65536','NaN'])await assert.rejects(smoke({env:{PORT:port}},revision,'127.0.135.83'),/port/);
});
