'use strict';
const http=require('node:http');
const net=require('node:net');

// Deployment targets must stay on this server, without DNS, proxies or redirects.
function healthHost(value='127.0.0.1'){
 if(typeof value==='string'&&net.isIP(value)===4&&value.split('.')[0]==='127')return value;
 if(value==='::1')return value;
 throw Error('--health-host peab olema loopback-IP (127.x.x.x või ::1).');
}
function portFor(config){
 const port=Number(config.env.PORT||3000);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Vigane rakenduseport.');
 return port;
}
function request(host,port,route){
 return new Promise((resolve,reject)=>{
  const agent=new http.Agent({keepAlive:false,proxyEnv:{}});
  let settled=false;
  function finish(error,value){if(settled)return;settled=true;agent.destroy();error?reject(error):resolve(value);}
  const req=http.get({hostname:host,port,path:route,agent,signal:AbortSignal.timeout(2000)},res=>{
   let body='',bytes=0;
   res.on('data',chunk=>{
    bytes+=chunk.length;
    if(bytes>65536){finish(Error('Tervisekontrolli vastus on liiga suur.'));res.destroy();return;}
    body+=chunk;
   });
   res.on('error',()=>finish(Error('Tervisekontrolli vastuse lugemine ebaõnnestus.')));
   res.on('end',()=>finish(null,{status:res.statusCode,body}));
  });
  req.on('error',()=>finish(Error('Tervisekontrolli ühendus ebaõnnestus.')));
 });
}
async function healthMatches(config,revision,host){
 host=healthHost(host);const port=portFor(config);
 try{
  const response=await request(host,port,'/health'),data=JSON.parse(response.body);
  return response.status===200&&data.status==='ok'&&(!revision||data.release===revision);
 }catch{return false;}
}
async function smoke(config,revision,host){
 host=healthHost(host);const port=portFor(config);
 let ok=false;
 for(let i=0;i<20;i++){
  if(await healthMatches(config,revision,host)){ok=true;break;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ok)throw Error('Uue väljalaske tervisekontroll ebaõnnestus.');
 for(const [route,status]of [['/api/me',401],['/prototype-preview',302]]){
  const response=await request(host,port,route);
  if(response.status!==status)throw Error('Anonüümse ligipääsu kontroll ebaõnnestus.');
 }
}
module.exports={healthHost,healthMatches,smoke};
