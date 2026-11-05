'use strict';
// Only non-unique lookup indexes. Never rewrite columns or business records.
exports.config={transaction:false};
const lookups=[
  {table:'crm_v8_activity_events',columns:['activity_id','event_type'],name:'crm_v8_events_activity_type_lookup'},
  {table:'crm_budget_change_log',columns:['client_id','created_at'],name:'crm_budget_client_created_lookup'},
  {table:'crm_ionprint_sync_queue',columns:['transfer_id'],name:'crm_sync_transfer_lookup'}
];
function covered(rows,columns){
  const groups=new Map();for(const r of rows){if(!groups.has(r.INDEX_NAME))groups.set(r.INDEX_NAME,[]);groups.get(r.INDEX_NAME).push(r);}
  return [...groups.values()].some(group=>{
    const ordered=group.sort((a,b)=>Number(a.SEQ_IN_INDEX)-Number(b.SEQ_IN_INDEX));
    return columns.every((c,i)=>ordered[i]?.COLUMN_NAME===c&&ordered[i].SUB_PART===null);
  });
}
exports.lookups=lookups;exports.covered=covered;
exports.up=async function(db){
  const schema=db.client.config.connection.database;
  for(const item of lookups){
    if(!await db.schema.hasTable(item.table))throw Error('Index repair requires the existing table: '+item.table);
    for(const column of item.columns)if(!await db.schema.hasColumn(item.table,column))throw Error('Index repair requires the existing column: '+item.table+'.'+column);
    const rows=await db('information_schema.statistics').where({TABLE_SCHEMA:schema,TABLE_NAME:item.table}).select('INDEX_NAME','SEQ_IN_INDEX','COLUMN_NAME','SUB_PART');
    if(covered(rows,item.columns))continue;
    if(rows.some(r=>r.INDEX_NAME===item.name))throw Error('Index name collision: '+item.table+'.'+item.name);
    await db.schema.alterTable(item.table,t=>t.index(item.columns,item.name));
  }
};
exports.down=async()=>{throw Error('Forward-only migration; restore a verified backup when required.');};
