'use strict';
const contract=require('./schema-contract.json');
const profile=require('./legacy-v8-profile.json');
const {describe,type}=require('./schema-values');
const sqlMode=require('./sql-mode');
const migration='004_legacy_v8_transition.js';
const own002=new Set(['users.name','crm_templates.subject']);
const key=c=>(c.table||c.TABLE_NAME)+'.'+(c.column||c.COLUMN_NAME);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function project(snapshot){
 const projected={...snapshot,columns:snapshot.columns.map(c=>({...c}))},changes=[];
 if(snapshot.applied.includes(migration))return {projected,changes};
 for(const item of profile.columns){
  if(own002.has(key(item)))continue;
  const current=snapshot.columns.find(c=>key(c)===key(item));
  const target=contract.columns.find(c=>key(c)===key(item));
  if(!current||!same(describe(current),item.actual))continue;
  // Preserve larger TEXT storage. The strict contract already permits it.
  if(/^(?:mediumtext|longtext)$/.test(type(current.COLUMN_TYPE))&&type(target.COLUMN_TYPE)==='text')continue;
  if(same(describe(current),describe(target)))continue;
  changes.push({table:item.table,column:item.column,source:item.actual,target:describe(target)});
  Object.assign(projected.columns.find(c=>key(c)===key(item)),target);
 }
 return {projected,changes};
}
function checksFor(changes){
 const checks=[];
 for(const change of changes){
  if(/^(?:int|bigint)$/.test(change.source.type)&&/ unsigned$/.test(change.target.type))checks.push({table:change.table,column:change.column,kind:'negative'});
  if(change.source.nullable==='YES'&&change.target.nullable==='NO'){
   checks.push({table:change.table,column:change.column,kind:'null'});
   if(change.source.type==='timestamp')checks.push({table:change.table,column:change.column,kind:'zero_timestamp'});
  }
 }
 return checks;
}
async function assess(db,snapshot){
 const {changes}=project(snapshot),checks=checksFor(changes),errors=[];
 const mode=await sqlMode.withConnection(db,async(connection,state)=>({original:state.original,effective:state.effective,scope:'SESSION',globalChanged:false}));
 if(changes.length){
  if(!/^11\.4\.13-MariaDB/i.test(snapshot.version))errors.push('Pärandskeemi üleminek on kontrollitud ainult MariaDB 11.4.13 jaoks.');
  if(!sqlMode.hasStrict(mode.effective))errors.push('Üleminek nõuab ranget SQL-režiimi.');
 }
 for(const table of [...new Set(checks.map(c=>c.table))]){
  const group=checks.filter(c=>c.table===table);
  const expressions=group.map((c,i)=>db.raw('COUNT(CASE WHEN '+(c.kind==='negative'?'?? < 0':c.kind==='null'?'?? IS NULL':"CAST(?? AS CHAR) LIKE '0000-%'")+' THEN 1 END) AS ??',[c.column,'guard_'+i]));
  const row=await db(table).select(expressions).first();
  group.forEach((c,i)=>{c.violations=String(row['guard_'+i]);if(c.violations!=='0')errors.push(c.table+'.'+c.column+': '+c.kind+' kontroll ei ole null ('+c.violations+').');});
 }
 // Require evidence tied to this exact metadata snapshot; no CLI bypass flag exists.
 const {fingerprint}=require('./schema');
 return {ok:errors.length===0,snapshotHash:fingerprint(snapshot),serverVersion:snapshot.version,sqlMode:mode,changes,checks,errors};
}
function definition(target,current){
 const parts=[target.COLUMN_TYPE];
 if(target.CHARACTER_SET_NAME){
  if(current.CHARACTER_SET_NAME!=='utf8mb4'||!/^utf8mb4_[a-z0-9_]+$/i.test(current.COLLATION_NAME))throw Error('Veeru märgistik/kollatsioon vajab eraldi ülevaatust.');
  parts.push('CHARACTER SET utf8mb4 COLLATE '+current.COLLATION_NAME);
 }
 parts.push(target.IS_NULLABLE==='YES'?'NULL':'NOT NULL');
 if(target.COLUMN_DEFAULT!==null){
  if(target.COLUMN_DEFAULT==='NULL')parts.push('DEFAULT NULL');
  else if(/^[0-9]+$/.test(target.COLUMN_DEFAULT))parts.push('DEFAULT '+target.COLUMN_DEFAULT);
  else if(/^current_timestamp\(\)$/i.test(target.COLUMN_DEFAULT))parts.push('DEFAULT CURRENT_TIMESTAMP');
  else throw Error('Ülemineku vaikeväärtus vajab eraldi ülevaatust.');
 }
 if(target.EXTRA==='auto_increment')parts.push('AUTO_INCREMENT');
 else if(target.EXTRA)throw Error('Ülemineku automaatreegel vajab eraldi ülevaatust.');
 if(typeof current.COLUMN_COMMENT!=='string'||current.COLUMN_COMMENT.includes('\0'))throw Error('Veerukommentaari kodeering vajab ülevaatust.');
 // DDL runs with NO_BACKSLASH_ESCAPES: SQL quote doubling preserves literal bytes.
 parts.push("COMMENT '"+current.COLUMN_COMMENT.replace(/'/g,"''")+"'");return parts.join(' ');
}
async function perform(db){
 const schema=require('./schema'),audit=require('./data-audit');
 const before=await schema.inspect(db),assessment=await assess(db,before);
 // Knex itself holds its lock while up() runs; external preflight still rejects locks.
 const checked=schema.validate({...before,locked:false},false,assessment);
 if(!checked.ok)throw Error('Ülemineku eelkontroll: '+checked.errors.join(' '));
 if(!assessment.changes.length)return;
 const evidence=await audit.capture(db,before);
 const auto={};
 for(const table of new Set(assessment.changes.filter(c=>c.target.extra==='auto_increment').map(c=>c.table))){
  const row=await db('information_schema.tables').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:table}).select(db.raw('CAST(AUTO_INCREMENT AS CHAR) AS next_value')).first();auto[table]=row.next_value;
 }
 for(const change of assessment.changes){
  const current=await db('information_schema.columns').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:change.table,COLUMN_NAME:change.column}).first();
  if(!same(describe(current),change.source))throw Error('Veerg muutus ülemineku ajal: '+key(change));
  const target=contract.columns.find(c=>key(c)===key(change));
  try{
   await sqlMode.withConnection(db,async connection=>{
    const result=await db.raw('ALTER TABLE ?? MODIFY COLUMN ?? '+definition(target,current),[change.table,change.column]).connection(connection);
    if(result[0]?.warningStatus)throw Error('DDL warning');
   },['NO_BACKSLASH_ESCAPES','NO_AUTO_VALUE_ON_ZERO']);
  }catch{throw Error('Ülemineku DDL ebaõnnestus: '+key(change)+'; SQL ja privaatsed metaandmed on peidetud.');}
 }
 for(const [table,next]of Object.entries(auto)){
  const row=await db('information_schema.tables').where({TABLE_SCHEMA:db.client.config.connection.database,TABLE_NAME:table}).select(db.raw('CAST(AUTO_INCREMENT AS CHAR) AS next_value')).first();
  if(next&&row.next_value&&BigInt(row.next_value)<BigInt(next)){
   if(!/^[0-9]+$/.test(next))throw Error('Vigane AUTO_INCREMENT metaandmestik.');
   await db.raw('ALTER TABLE ?? AUTO_INCREMENT = '+next,[table]);
  }
 }
 const after=await schema.inspect(db);
 await audit.verify(db,after,evidence);
 const finalPlan=schema.validate({...after,locked:false});
 if(!finalPlan.ok)throw Error('Ülemineku järelkontroll ebaõnnestus: '+finalPlan.errors.join(' '));
}
module.exports={migration,project,checksFor,assess,perform};
