'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const knex=require('knex');
const sqlMode=require('./sql-mode');
const {sha}=require('./schema');
function settings(file, expectedHost, expectedDatabase) {
  const envPath=fs.realpathSync(file);
  const stat=fs.statSync(envPath);
  if(!stat.isFile()||(stat.mode&0o077)) throw Error('.env peab olema tavakasutajale privaatne fail (chmod 600).');
  const content=fs.readFileSync(envPath);
  const env=require('dotenv').parse(content);
  if(!env.DB_HOST||!env.DB_USER||!env.DB_PASSWORD||!env.DB_NAME||!env.SESSION_SECRET)throw Error('.env failist puudub nõutud DB_* või SESSION_SECRET.');
  if(env.DB_HOST!==expectedHost||env.DB_NAME!==expectedDatabase)throw Error('Kinnitatud host/andmebaas ei vasta .env failile.');
  if(!/^[A-Za-z_][A-Za-z0-9_$-]*$/.test(env.DB_NAME))throw Error('Toetamata andmebaasinimi.');
  const port=Number(env.DB_PORT||3306);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Vigane andmebaasiport.');
  return {envPath,env,hash:sha(content),connection:{host:env.DB_HOST,port,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,charset:'utf8mb4'}};
}
const connect=config=>sqlMode.restoreOnDestroy(knex({client:'mysql2',connection:config.connection,pool:{min:0,max:2,afterCreate:sqlMode.afterCreate},acquireConnectionTimeout:15000}));
function clientOptions(config, dir) {
  const quote=x=>'"'+String(x).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')+'"';
  const file=path.join(dir,'.mysql-options');
  const c=config.connection;
  fs.writeFileSync(file,'[client]\n'+Object.entries({host:c.host,port:c.port,user:c.user,password:c.password,'default-character-set':'utf8mb4'}).map(([k,v])=>k+'='+quote(v)).join('\n')+'\n',{mode:0o600,flag:'wx'});
  return file;
}
function variant(command) {
  const result=spawnSync(command,['--version'],{encoding:'utf8',maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw Error('Andmebaasi klienditööriista versiooni ei saanud kontrollida.');
  if(/MariaDB/i.test(result.stdout))return 'mariadb';
  if(/MySQL/i.test(result.stdout)||/Ver [89]\./.test(result.stdout))return 'mysql';
  throw Error('Toetamata dump- või taastamiskliendi versioon.');
}
function dump(config,dir,command='mariadb-dump') {
  const flavour=variant(command);
  const options=clientOptions(config,dir), destination=path.join(dir,'database.sql');
  const fd=fs.openSync(destination,'wx',0o600);
  try{
    const result=spawnSync(command,['--defaults-file='+options,...(flavour==='mysql'?['--no-login-paths','--set-gtid-purged=OFF','--column-statistics=0']:[]),'--single-transaction','--quick','--routines','--events','--triggers','--hex-blob','--no-tablespaces','--skip-add-locks',config.connection.database],{stdio:['ignore',fd,'pipe'],maxBuffer:1024*1024});
    if(result.error||result.status!==0||fs.statSync(destination).size===0)throw Error('Andmebaasi dump ebaõnnestus; migratsioone ei alustata. Kontrolli klienditööriista ja varundusõigusi.');
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);fs.unlinkSync(options);}
}
function importDump(config,dir,destination,command='mariadb') {
  const flavour=variant(command);
  const options=clientOptions(config,dir), fd=fs.openSync(destination,'r');
  try {
    const result=spawnSync(command,['--defaults-file='+options,...(flavour==='mysql'?['--no-login-paths']:[]),config.connection.database],{stdio:[fd,'ignore','pipe'],maxBuffer:1024*1024});
    if(result.error||result.status!==0)throw Error('Taastamine tühja andmebaasi ebaõnnestus. Algandmebaasi ei muudetud; siht vajab eraldi kontrolli.');
  } finally{fs.closeSync(fd);fs.unlinkSync(options);}
}
async function counts(db,snapshot){
  const out={};for(const t of snapshot.tables)if(t.TABLE_TYPE==='BASE TABLE')out[t.TABLE_NAME]=String((await db(t.TABLE_NAME).count('* as n').first()).n);return out;
}
module.exports={settings,connect,dump,importDump,counts};
