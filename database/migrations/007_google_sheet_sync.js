"use strict";
exports.config = { transaction: false };
exports.up = async (db) => {
  if (!(await db.schema.hasTable("crm_sheet_sync_records")))
    await db.schema.createTable("crm_sheet_sync_records", (t) => {
      t.bigIncrements("id").primary();
      t.string("source_id", 64).notNullable().unique();
      t.bigInteger("client_id").unsigned().nullable();
      t.bigInteger("contact_id").unsigned().nullable();
      t.string("status", 30).notNullable();
      t.text("state").notNullable();
      t.timestamps(true, true);
    });
  if (!(await db.schema.hasTable("crm_sheet_sync_runs")))
    await db.schema.createTable("crm_sheet_sync_runs", (t) => {
      t.bigIncrements("id").primary();
      t.string("run_key", 80).notNullable().unique();
      t.string("status", 30).notNullable();
      t.text("summary").notNullable();
      t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      t.timestamp("completed_at").nullable();
    });
  if (!(await db.schema.hasTable("crm_sheet_sync_audit")))
    await db.schema.createTable("crm_sheet_sync_audit", (t) => {
      t.bigIncrements("id").primary();
      t.bigInteger("record_id").unsigned().notNullable();
      t.bigInteger("user_id").unsigned().nullable();
      t.string("action", 30).notNullable();
      t.text("details").notNullable();
      t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      t.index("record_id");
    });
};
exports.down = async () => {
  throw Error(
    "Forward-only migration; restore a verified backup when required.",
  );
};
