const {test}=require('node:test');
const assert=require('node:assert/strict');
const {type,equalDefaults}=require('../ops/schema-values');
const {validate,diagnostics,migrations}=require('../ops/schema');
const contract=require('../ops/schema-contract.json');
function reference(){return {version:'11.4.13-MariaDB',columns:structuredClone(contract.columns),indexes:structuredClone(contract.indexes),tables:[...new Set(contract.columns.map(c=>c.TABLE_NAME))].map(TABLE_NAME=>({TABLE_NAME,TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB',TABLE_COLLATION:'utf8mb4_unicode_ci'})),triggers:[],checks:[],routines:[],charset:'utf8mb4',events:[],foreign:[],applied:[...migrations],locked:false};}
const column=(t,d,n='NO')=>({COLUMN_TYPE:t,COLUMN_DEFAULT:d,IS_NULLABLE:n});
test('MariaDB presentation aliases normalize without weakening unsigned, enum or timestamp semantics',()=>{
 assert.equal(type('INTEGER(11) unsigned'),type('int unsigned'));
 assert.equal(type('BOOLEAN'),type('tinyint(1)'));
 assert.notEqual(type('int unsigned'),type('int'));
 assert.notEqual(type('int(11) zerofill'),type('int'));
 assert.notEqual(type("enum('Admin','sales')"),type("enum('admin','sales')"));
 assert.equal(equalDefaults(column('varchar(100)','NULL','YES'),column('varchar(100)',null,'YES')),true);
 assert.equal(equalDefaults(column('varchar(100)',"'NULL'",'YES'),column('varchar(100)',null,'YES')),false);
 assert.equal(equalDefaults(column('varchar(100)',"'null'",'YES'),column('varchar(100)',"'NULL'",'YES')),false);
 assert.equal(equalDefaults(column('int',"'000'"),column('int',0)),true);
 assert.equal(equalDefaults(column('decimal(14,2)','0.00'),column('decimal(14,2)',0)),true);
 assert.equal(equalDefaults(column('varchar(10)',"'0'"),column('varchar(10)',null,'YES')),false);
 assert.equal(equalDefaults(column('bigint',"'9007199254740993'"),column('bigint','9007199254740992')),false);
 assert.equal(equalDefaults(column('timestamp','CURRENT_TIMESTAMP(0)'),column('timestamp','current_timestamp()')),true);
 assert.equal(equalDefaults(column('timestamp(6)','CURRENT_TIMESTAMP(6)'),column('timestamp','current_timestamp()')),false);
 assert.equal(equalDefaults(column('varchar(100)',"'ACTIVE'"),column('varchar(100)',"'active'")),false);
 assert.equal(equalDefaults(column('varchar(100)',' active '),column('varchar(100)',"'active'")),false);
 const mysqlString=(value)=>({...column('varchar(100)',value,'YES'),defaultDialect:'mysql'});
 assert.equal(equalDefaults(mysqlString('active'),column('varchar(100)',"'active'",'YES')),true);
 assert.equal(equalDefaults(mysqlString("'active'"),column('varchar(100)',"'active'",'YES')),false);
 assert.equal(equalDefaults(mysqlString('NULL'),column('varchar(100)',null,'YES')),false);
 assert.equal(equalDefaults(mysqlString('NULL'),column('varchar(100)',"'NULL'",'YES')),true);
});
test('cross-driver nullable NULL and quoted numeric defaults pass; genuine default changes block',()=>{
 const snapshot=reference();
 for(const c of snapshot.columns){
  if(c.IS_NULLABLE==='YES'&&c.COLUMN_DEFAULT==='NULL')c.COLUMN_DEFAULT=null;
  if(/^int|^tinyint/.test(c.COLUMN_TYPE)&&/^\d+$/.test(c.COLUMN_DEFAULT||''))c.COLUMN_DEFAULT="'"+c.COLUMN_DEFAULT+"'";
 }
 assert.equal(validate(snapshot,true).ok,true);
 assert.ok(diagnostics(snapshot).columns.some(c=>c.classification==='representation_only'));
 const count=snapshot.columns.find(c=>c.TABLE_NAME==='crm_clients'&&c.COLUMN_NAME==='followup_count');count.COLUMN_DEFAULT='-1';
 assert.equal(validate(snapshot).ok,false);
});
test('diagnostic exports redact all default strings, enum members and expression literals',()=>{
 const snapshot=reference(),secret='private-client-secret-XYZ';
 const c=snapshot.columns.find(c=>c.TABLE_NAME==='crm_clients'&&c.COLUMN_NAME==='client_type');
 c.COLUMN_DEFAULT="'"+secret+"'";c.COLUMN_TYPE="enum('"+secret+"')";
 const notes=snapshot.columns.find(c=>c.TABLE_NAME==='crm_clients'&&c.COLUMN_NAME==='notes');notes.COLUMN_DEFAULT="concat('"+secret+"')";notes.EXTRA=secret;
 const output=JSON.stringify(diagnostics(snapshot));assert.equal(output.includes(secret),false);assert.equal(output.includes('DB_PASSWORD'),false);
 assert.ok(diagnostics(snapshot).columns.some(x=>x.classification==='requires_review'));
});
test('only three known nonunique indexes can be deferred to the new pending migration',()=>{
 const snapshot=reference();snapshot.applied=['001_base.js','002_v8.js'];
 const {lookups}=require('../database/migrations/003_v8_lookup_indexes');
 for(const item of lookups){const name=snapshot.indexes.find(i=>i.TABLE_NAME===item.table&&i.COLUMN_NAME===item.columns[0]).INDEX_NAME;snapshot.indexes=snapshot.indexes.filter(i=>!(i.TABLE_NAME===item.table&&i.INDEX_NAME===name));}
 assert.equal(validate(snapshot).ok,true);assert.equal(validate(snapshot,true).ok,false);
 assert.equal(diagnostics(snapshot).missingIndexes.length,3);
 assert.ok(diagnostics(snapshot).missingIndexes.every(i=>i.plannedMigration==='003_v8_lookup_indexes.js'));
 const collision=structuredClone(snapshot),item=lookups[0];
 collision.indexes.push({TABLE_NAME:item.table,INDEX_NAME:item.name,NON_UNIQUE:1,SEQ_IN_INDEX:1,COLUMN_NAME:'id',SUB_PART:null});
 assert.equal(validate(collision).ok,false);
 assert.equal(diagnostics(collision).missingIndexes.find(i=>i.table===item.table).plannedMigration,null);
 const {covered}=require('../database/migrations/003_v8_lookup_indexes');
 const prefix=[...item.columns,'id'].map((COLUMN_NAME,i)=>({INDEX_NAME:'different_existing_name',SEQ_IN_INDEX:i+1,COLUMN_NAME,SUB_PART:null}));
 assert.equal(covered(prefix,item.columns),true);
 assert.equal(covered(prefix.map((r,i)=>i===0?{...r,SUB_PART:4}:r),item.columns),false);
 assert.equal(covered([...prefix].map((r,i)=>({...r,SEQ_IN_INDEX:prefix.length-i})),item.columns),false);

 snapshot.indexes=snapshot.indexes.filter(i=>!(i.TABLE_NAME==='crm_email_outbox'&&i.COLUMN_NAME==='activity_id'));
 assert.equal(validate(snapshot).ok,false);
});
