'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./schema-contract.json');
const migrations = ['001_base.js', '002_v8.js', '003_v8_lookup_indexes.js', '004_legacy_v8_transition.js', '005_daily_work_queues.js', '006_user_mail_signatures.js', '007_google_sheet_sync.js'];
const {type,equalDefaults,describe}=require('./schema-values');
const {lookups}=require('../database/migrations/003_v8_lookup_indexes');
const additions = {
  crm_clients: ['client_type', 'stop_reason', 'followup_count', 'client_comment', 'our_comment'],
  crm_templates: ['purpose', 'external_key', 'next_step_json']
};
const base = new Set(['users', 'user_sessions', 'crm_clients', 'crm_contacts', 'crm_templates', 'crm_activities', 'crm_activity_history', 'crm_budgets']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const extra = value => value.toLowerCase().replace(/default_generated\s*/g, '').replace(/current_timestamp\(\)/g, 'current_timestamp').trim();
function groups(rows) {
  const out = {};
  for (const row of rows) (out[row.TABLE_NAME] ||= []).push(row);
  return out;
}
function keys(rows) {
  const map = new Map();
  for (const r of rows) {
    const name = r.TABLE_NAME + ':' + r.INDEX_NAME;
    if (!map.has(name)) map.set(name, {table:r.TABLE_NAME, unique:!Number(r.NON_UNIQUE), primary:r.INDEX_NAME==='PRIMARY', columns:[]});
    map.get(name).columns.push({name:r.COLUMN_NAME, order:Number(r.SEQ_IN_INDEX), prefix:r.SUB_PART});
  }
  return [...map.values()].map(x => ({...x, columns:x.columns.sort((a,b)=>a.order-b.order).map(c=>c.prefix ? c.name+'('+c.prefix+')' : c.name)}));
}
async function inspect(db) {
  // SELECTs only: do not call migrate.list/latest here; they may create tracking tables.
  const schema = db.client.config.connection.database;
  const columns = await db('information_schema.columns').where({TABLE_SCHEMA:schema}).orderBy('TABLE_NAME').orderBy('ORDINAL_POSITION')
    .select('TABLE_NAME','COLUMN_NAME','COLUMN_TYPE','IS_NULLABLE','COLUMN_DEFAULT','EXTRA','CHARACTER_SET_NAME');
  const indexes = await db('information_schema.statistics').where({TABLE_SCHEMA:schema}).orderBy('TABLE_NAME').orderBy('INDEX_NAME').orderBy('SEQ_IN_INDEX')
    .select('TABLE_NAME','INDEX_NAME','NON_UNIQUE','SEQ_IN_INDEX','COLUMN_NAME','SUB_PART');
  const tables = await db('information_schema.tables').where({TABLE_SCHEMA:schema}).orderBy('TABLE_NAME').select('TABLE_NAME','TABLE_TYPE','ENGINE','TABLE_COLLATION');
  const triggers = await db('information_schema.triggers').where({TRIGGER_SCHEMA:schema}).select('EVENT_OBJECT_TABLE');
  const schemaInfo=await db('information_schema.schemata').where({SCHEMA_NAME:schema}).first('DEFAULT_CHARACTER_SET_NAME');
  const checks=await db('information_schema.table_constraints as t').join('information_schema.check_constraints as c',function(){this.on('c.CONSTRAINT_SCHEMA','t.CONSTRAINT_SCHEMA').andOn('c.CONSTRAINT_NAME','t.CONSTRAINT_NAME');}).where('t.TABLE_SCHEMA',schema).where('t.CONSTRAINT_TYPE','CHECK').orderBy('t.TABLE_NAME').orderBy('t.CONSTRAINT_NAME').select('t.TABLE_NAME','c.CHECK_CLAUSE');
  const routines=await db('information_schema.routines').where({ROUTINE_SCHEMA:schema}).select('ROUTINE_NAME');
  const events = await db('information_schema.events').where({EVENT_SCHEMA:schema}).select('EVENT_NAME');
  const foreign = await db('information_schema.key_column_usage').where({TABLE_SCHEMA:schema}).whereNotNull('REFERENCED_TABLE_NAME').select('TABLE_NAME','COLUMN_NAME');
  let applied = [];
  if (tables.some(t=>t.TABLE_NAME==='knex_migrations')) applied=(await db('knex_migrations').orderBy('id').select('name')).map(x=>x.name);
  let locked = false;
  if (tables.some(t=>t.TABLE_NAME==='knex_migrations_lock')) locked=(await db('knex_migrations_lock').select('is_locked')).some(x=>Number(x.is_locked)!==0);
  const [[version]] = await db.raw('SELECT VERSION() AS version');
  // mysql2 exposes MySQL string defaults unquoted; MariaDB exposes SQL literals.
  // Non-enumerable annotation keeps existing backup fingerprints unchanged.
  for(const c of columns)Object.defineProperty(c,'defaultDialect',{value:/MariaDB/i.test(version.version)?'mariadb':'mysql'});
  return {version:version.version, tables, columns, indexes, triggers, checks, routines, events, foreign, applied, locked, charset:schemaInfo?.DEFAULT_CHARACTER_SET_NAME};
}
function fingerprint(snapshot) {
  return sha(JSON.stringify({tables:snapshot.tables, columns:snapshot.columns, indexes:snapshot.indexes, triggers:snapshot.triggers, checks:snapshot.checks, routines:snapshot.routines, charset:snapshot.charset, events:snapshot.events, foreign:snapshot.foreign, applied:snapshot.applied}));
}
function validate(snapshot, final = false, transition = null) {
  const errors = [];
  const allowedTransition=!final&&transition?.changes?.length>0&&transition?.ok===true&&transition.snapshotHash===fingerprint(snapshot)&&transition.serverVersion===snapshot.version&&!snapshot.applied.includes('004_legacy_v8_transition.js');
  const effective=allowedTransition?require('./legacy-transition').project(snapshot).projected:snapshot;
  const expected = groups(contract.columns), actual = groups(effective.columns);
  if(transition&&!transition.ok)errors.push(...transition.errors);
  if(!actual.users||!actual.user_sessions)errors.push('Senine autentimisskeem puudub; kontrolli, et valitud on õige olemasolev andmebaas.');
  const pending = migrations.filter(m=>!snapshot.applied.includes(m));
  const migrationFiles=fs.readdirSync(path.join(__dirname,'../database/migrations')).filter(f=>f.endsWith('.js')).sort();
  if (JSON.stringify(migrationFiles)!==JSON.stringify(migrations)) errors.push('Migratsioonide loend ei vasta kontrollitud skeemile.');
  if (snapshot.applied.some((name,i)=>name!==migrations[i])) errors.push('Tundmatu või vales järjekorras migratsiooniajalugu.');
  if(snapshot.charset!=='utf8mb4') errors.push('Andmebaasi vaikimisi märgistik peab olema utf8mb4.');
  if (snapshot.locked) errors.push('Knexi migratsioonilukk on aktiivne.');
  const tracker=snapshot.tables.filter(t=>['knex_migrations','knex_migrations_lock'].includes(t.TABLE_NAME));
  if (tracker.length===1) errors.push('Poolik Knexi migratsioonide haldusskeem.');
  if (!/^(?:8\.|9\.)/.test(snapshot.version) && !/^(?:10\.(?:[6-9]|[1-9]\d)|1[1-9]\.)[^ ]*MariaDB/i.test(snapshot.version)) errors.push('Nõutud on MySQL 8+ või MariaDB 10.6+.');
  for(const check of snapshot.checks)if(expected[check.TABLE_NAME]&&!(check.TABLE_NAME==='user_sessions'&&/^\(*json_valid\(sess\)\)*$/.test(check.CHECK_CLAUSE.toLowerCase().replace(/[`\s]/g,''))))errors.push(check.TABLE_NAME+': tundmatu CHECK-piirang vajab ülevaatust.');
  for(const fk of snapshot.foreign)if(expected[fk.TABLE_NAME])errors.push(fk.TABLE_NAME+': täiendav välisvõti vajab eraldi skeemiülevaatust.');
  for (const t of snapshot.tables) {
    if(expected[t.TABLE_NAME]&&!t.TABLE_COLLATION?.startsWith('utf8mb4_'))errors.push(t.TABLE_NAME+': tabeli vaikimisi märgistik peab olema utf8mb4.');
    if (t.TABLE_TYPE!=='BASE TABLE' || t.ENGINE!=='InnoDB') errors.push(t.TABLE_NAME+': varunduseks on nõutud InnoDB baastabel (vaated vajavad eraldi ülevaatust).');
  }
  if(snapshot.routines.length) errors.push('Andmebaasi rutiinid vajavad eraldi skeemi- ja taastamisülevaatust.');
  if(snapshot.events.length) errors.push('Andmebaasis on ajastatud sündmused; nende mõju vajab eraldi ülevaatust.');
  for (const trigger of snapshot.triggers) if(expected[trigger.EVENT_OBJECT_TABLE]) errors.push(trigger.EVENT_OBJECT_TABLE+': tundmatu päästik vajab ülevaatust.');
  if (pending.includes('002_v8.js')) for(const fk of snapshot.foreign) {
    if ((fk.TABLE_NAME==='users'&&fk.COLUMN_NAME==='name')||(fk.TABLE_NAME==='crm_templates'&&fk.COLUMN_NAME==='subject')) errors.push(fk.TABLE_NAME+'.'+fk.COLUMN_NAME+': muudetav veerg osaleb välisvõtmes.');
  }
  for (const [table, columns] of Object.entries(expected)) {
    const creator=['crm_sheet_sync_records','crm_sheet_sync_runs','crm_sheet_sync_audit'].includes(table)?'007_google_sheet_sync.js':table==='crm_user_mail_settings'?'006_user_mail_signatures.js':table==='crm_work_queue_days'?'005_daily_work_queues.js':base.has(table)?'001_base.js':'002_v8.js';
    if (!actual[table]) {
      if (final || !pending.includes(creator)) errors.push(table+': tabel puudub, kuid selle loomise migratsioon pole ootel.');
      continue;
    }
    for (const c of columns) {
      const a=actual[table].find(x=>x.COLUMN_NAME===c.COLUMN_NAME);
      const added=additions[table]?.includes(c.COLUMN_NAME);
      const label=table+'.'+c.COLUMN_NAME;
      if (!a) {
        if (final || !added || !pending.includes('002_v8.js')) errors.push(label+': olemasolevas tabelis puudub nõutud veerg.');
        continue;
      }
      let compatible=type(a.COLUMN_TYPE)===type(c.COLUMN_TYPE);
      const wanted=/^varchar\((\d+)\)$/.exec(type(c.COLUMN_TYPE)), found=/^varchar\((\d+)\)$/.exec(type(a.COLUMN_TYPE));
      if (wanted && found) {
        let min=Number(wanted[1]);
        if(!final&&pending.includes('002_v8.js')&&label==='users.name') min=100;
        if(!final&&pending.includes('002_v8.js')&&label==='crm_templates.subject') min=255;
        compatible=Number(found[1])>=min;
        if(pending.includes('002_v8.js')&&['users.name','crm_templates.subject'].includes(label)&&Number(found[1])>Number(wanted[1])) compatible=false;
      }
      if (/text$/.test(type(c.COLUMN_TYPE))) { const rank={text:1,mediumtext:2,longtext:3}; compatible=(rank[type(a.COLUMN_TYPE)]||0)>=(rank[type(c.COLUMN_TYPE)]||99); }
      if (label==='user_sessions.sess' && ['json','longtext'].includes(type(a.COLUMN_TYPE))) compatible=true;
      if(!compatible) errors.push(label+': veerutüüp ei sobi või migratsioon kitsendaks seda.');
      if(a.IS_NULLABLE!==c.IS_NULLABLE) errors.push(label+': NULL-piirang erineb.');
      if(!equalDefaults(a,c)) errors.push(label+': vaikeväärtus erineb.');
      if(extra(a.EXTRA)!==extra(c.EXTRA)) errors.push(label+': automaatväärtuse või genereerimise reegel erineb.');
      if(c.CHARACTER_SET_NAME && a.CHARACTER_SET_NAME!=='utf8mb4' && !(label==='user_sessions.sess'&&type(a.COLUMN_TYPE)==='json')) errors.push(label+': nõutud on utf8mb4.');
    }
    for(const a of actual[table]) if(!columns.some(c=>c.COLUMN_NAME===a.COLUMN_NAME)&&a.IS_NULLABLE==='NO'&&a.COLUMN_DEFAULT===null&&!/auto_increment|generated/i.test(a.EXTRA)) errors.push(table+'.'+a.COLUMN_NAME+': lisaveerg takistab CRM-i sisestusi.');
  }
  const wantedKeys=keys(contract.indexes), actualKeys=keys(snapshot.indexes);
  for(const k of wantedKeys) if(actual[k.table]) {
    const match=actualKeys.some(a=>a.table===k.table&&(!k.primary||a.primary)&&(!k.unique||a.unique)&&JSON.stringify(a.columns.slice(0,k.columns.length))===JSON.stringify(k.columns)&&(!k.unique||a.columns.length===k.columns.length));
    if(!match){
      const planned=!final&&pending.includes('003_v8_lookup_indexes.js')&&!k.unique&&lookups.some(x=>x.table===k.table&&JSON.stringify(x.columns)===JSON.stringify(k.columns))&&k.columns.every(name=>actual[k.table].some(c=>c.COLUMN_NAME===name));
      if(!planned)errors.push(k.table+': puuduv indeks ('+k.columns.join(', ')+').');
      else {const repair=lookups.find(x=>x.table===k.table&&JSON.stringify(x.columns)===JSON.stringify(k.columns));if(snapshot.indexes.some(i=>i.TABLE_NAME===k.table&&i.INDEX_NAME===repair.name))errors.push(k.table+': paranduse indeksi nimi on juba teise definitsiooni kasutuses.');}
    }
  }
  for(const k of actualKeys) if(expected[k.table]&&k.unique&&!wantedKeys.some(a=>a.table===k.table&&a.unique&&JSON.stringify(a.columns)===JSON.stringify(k.columns))) errors.push(k.table+': täiendav unikaalsuspiirang vajab ülevaatust.');
  if(final&&pending.length) errors.push('Kõik migratsioonid ei ole lõpetatud.');
  return {ok:!errors.length, errors:[...new Set(errors)], pending, tables:snapshot.tables.length, schemaHash:fingerprint(snapshot)};
}
function diagnostics(snapshot){
 const actual=groups(snapshot.columns), expected=groups(contract.columns), findings=[];
 for(const [table,columns]of Object.entries(expected))for(const c of columns){
  const a=actual[table]?.find(x=>x.COLUMN_NAME===c.COLUMN_NAME);
  if(!a){findings.push({table,column:c.COLUMN_NAME,classification:'missing',expected:describe(c)});continue;}
  const fields=['COLUMN_TYPE','COLUMN_DEFAULT','IS_NULLABLE','EXTRA','CHARACTER_SET_NAME'].filter(k=>a[k]!==c[k]);
  if(!fields.length)continue;
  const representationOnly=type(a.COLUMN_TYPE)===type(c.COLUMN_TYPE)&&equalDefaults(a,c)&&a.IS_NULLABLE===c.IS_NULLABLE&&extra(a.EXTRA)===extra(c.EXTRA)&&a.CHARACTER_SET_NAME===c.CHARACTER_SET_NAME;
  findings.push({table,column:c.COLUMN_NAME,fields,classification:representationOnly?'representation_only':'requires_review',expected:describe(c),actual:describe(a)});
 }
 const actualKeys=keys(snapshot.indexes), missingIndexes=keys(contract.indexes).filter(k=>actual[k.table]&&!actualKeys.some(a=>a.table===k.table&&(!k.primary||a.primary)&&(!k.unique||a.unique)&&JSON.stringify(a.columns.slice(0,k.columns.length))===JSON.stringify(k.columns)&&(!k.unique||a.columns.length===k.columns.length))).map(k=>({table:k.table,columns:k.columns,unique:k.unique,plannedMigration:!snapshot.applied.includes('003_v8_lookup_indexes.js')&&!k.unique&&k.columns.every(name=>actual[k.table].some(c=>c.COLUMN_NAME===name))&&lookups.some(x=>x.table===k.table&&JSON.stringify(x.columns)===JSON.stringify(k.columns)&&!snapshot.indexes.some(i=>i.TABLE_NAME===k.table&&i.INDEX_NAME===x.name))?'003_v8_lookup_indexes.js':null}));
 return {formatVersion:1,serverVersion:/^[0-9.]+(?:-MariaDB)?/.exec(snapshot.version)?.[0]||'unknown',columns:findings,missingIndexes,redaction:'String defaults, enum members, expressions, credentials, database/host names and row data are not exported.'};
}
module.exports={inspect,validate,diagnostics,fingerprint,sha,migrations};
