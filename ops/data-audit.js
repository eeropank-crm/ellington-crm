'use strict';
const crypto=require('node:crypto');
const contract=require('./schema-contract.json');
const tables=new Set(contract.columns.map(c=>c.TABLE_NAME));
async function digest(db,table,columns,primary,bound){
 const bindings=[];
 const parts=columns.map(c=>{
  // Timestamp instants must not depend on session display timezone.
  let value='CAST(?? AS BINARY)';let args=[c.COLUMN_NAME];
  if(/^timestamp/i.test(c.COLUMN_TYPE)){
   value="CAST(CASE WHEN CAST(?? AS CHAR) LIKE '0000-%' THEN 'ZERO_TIMESTAMP' ELSE CAST(UNIX_TIMESTAMP(??) AS CHAR) END AS BINARY)";args=[c.COLUMN_NAME,c.COLUMN_NAME];
  }
  bindings.push(c.COLUMN_NAME,...args,...args);
  return "CASE WHEN ?? IS NULL THEN 'N' ELSE CONCAT('V', OCTET_LENGTH("+value+"), ':', SHA2("+value+",256)) END";
 });
 const query=db(table).select(db.raw("SHA2(CONCAT("+parts.join(",'|',")+"),256) AS row_hash",bindings)).orderBy(primary);
 if(bound?.empty)query.whereRaw('1=0');else if(bound)query.where(primary[0],'<=',bound.maximum);
 const hash=crypto.createHash('sha256');let count=0n;
 for await(const row of query.stream()){
  if(!/^[a-f0-9]{64}$/i.test(row.row_hash||''))throw Error('Andmesisu kontrollsumma arvutamine ebaõnnestus: '+table);
  hash.update(row.row_hash+'\n');count++;
 }
 return {count:count.toString(),hash:hash.digest('hex')};
}
async function capture(db,snapshot,{allowDefaultReasons=false,template=null}={}){
 const output={};
 for(const table of snapshot.tables.map(t=>t.TABLE_NAME).filter(t=>tables.has(t)).sort()){
  const prior=template?.[table];if(template&&!prior)continue;
  const columns=prior?.columns||snapshot.columns.filter(c=>c.TABLE_NAME===table);
  const primary=prior?.primary||snapshot.indexes.filter(i=>i.TABLE_NAME===table&&i.INDEX_NAME==='PRIMARY').sort((a,b)=>Number(a.SEQ_IN_INDEX)-Number(b.SEQ_IN_INDEX)).map(i=>i.COLUMN_NAME);
  if(!primary.length)throw Error('Andmete kontroll nõuab primaarvõtit: '+table);
  let bound=prior?.bound;
  if(!template&&allowDefaultReasons&&table==='crm_v8_stop_reasons'){
   const row=await db(table).select(db.raw('CAST(MAX(??) AS CHAR) AS maximum',[primary[0]])).first();
   bound=row.maximum===null?{empty:true}:{maximum:String(row.maximum)};
  }
  output[table]={columns,primary,...(bound?{bound}:{}),...await digest(db,table,columns,primary,bound)};
 }
 return output;
}
async function verify(db,snapshot,before){
 const after=await capture(db,snapshot,{template:before});
 for(const [table,entry]of Object.entries(before))if(after[table]?.hash!==entry.hash||after[table]?.count!==entry.count)throw Error('Olemasolevate andmete sisu muutus: '+table);
 return true;
}
module.exports={capture,verify};
