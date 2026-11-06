'use strict';
exports.config={transaction:false};
exports.up=async db=>{
 if(await db.schema.hasTable('crm_work_queue_days'))return;
 await db.schema.createTable('crm_work_queue_days',t=>{
  t.bigIncrements('id').primary();
  t.bigInteger('owner_user_id').unsigned().notNullable();
  t.date('work_date').notNullable();
  t.integer('version').unsigned().notNullable().defaultTo(0);
  t.text('state').notNullable();
  t.timestamps(true,true);
  t.unique(['owner_user_id','work_date']);
 });
};
exports.down=async()=>{throw Error('Forward-only migration; restore a verified backup when required.');};
