'use strict';
exports.config={transaction:false};
exports.up=async db=>{
 if(await db.schema.hasTable('crm_user_mail_settings'))return;
 await db.schema.createTable('crm_user_mail_settings',t=>{
  t.bigInteger('user_id').unsigned().primary();
  t.text('signature').notNullable();
  t.integer('version').unsigned().notNullable().defaultTo(1);
  t.timestamps(true,true);
 });
};
exports.down=async()=>{throw Error('Forward-only migration; restore a verified backup when required.');};
