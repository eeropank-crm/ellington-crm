// MySQL/MariaDB DDL commits implicitly. Each step is restartable after interruption.
exports.config = { transaction: false };
exports.up = async function(db) {
  async function column(table, name, define) {
    if (!await db.schema.hasColumn(table, name)) await db.schema.alterTable(table, define);
  }
  async function create(name, define) {
    if (!await db.schema.hasTable(name)) await db.schema.createTable(name, define);
  }
  const id = t => t.bigIncrements('id').primary();
  const ref = (t, name, nullable = false) => {
    const c = t.bigInteger(name).unsigned();
    return nullable ? c.nullable() : c.notNullable();
  };
  const created = t => t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
  await column('crm_clients', 'client_type', t => t.string('client_type', 100).nullable());
  await column('crm_clients', 'stop_reason', t => t.text('stop_reason').nullable());
  await column('crm_clients', 'followup_count', t => t.integer('followup_count').unsigned().notNullable().defaultTo(0));
  for (const name of ['client_comment', 'our_comment']) await column('crm_clients', name, t => t.text(name).nullable());
  await column('crm_templates', 'purpose', t => t.string('purpose', 200).nullable());
  await column('crm_templates', 'external_key', t => t.string('external_key', 255).nullable());
  // Code parses these values as strings, so use TEXT rather than driver-decoded JSON.
  await column('crm_templates', 'next_step_json', t => t.text('next_step_json').nullable());
  await db.schema.alterTable('crm_templates', t => t.string('subject', 500).nullable().alter());
  // The user management route accepts names up to 150 characters.
  await db.schema.alterTable('users', t => t.string('name', 150).notNullable().alter());
  await create('crm_imported_history', t => {
    id(t); ref(t, 'client_id'); t.string('activity_type', 100); t.text('original_value');
    t.date('activity_date'); t.string('source_column', 255); t.index('client_id');
  });
  await create('crm_activity_details', t => {
    ref(t, 'activity_id').primary(); ref(t, 'template_id', true);
    t.string('purpose', 200); t.text('instructions'); t.string('subject', 500); t.text('next_step_json');
  });
  await create('crm_v8_activity_events', t => {
    id(t); ref(t, 'activity_id', true); ref(t, 'user_id'); t.string('event_type', 100).notNullable();
    t.text('details'); created(t); t.index(['activity_id', 'event_type']);
  });
  await create('crm_v8_stop_reasons', t => {
    id(t); t.string('label', 200).notNullable(); t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
  });
  const reasons = ['Ei soovi enam infot', 'Ei soovi, et temaga ühendust võetakse', 'Pole huvitatud', 'Kliendiga suhtlus juba käib', 'Vale kontakt / ettevõte', 'Muu põhjus'];
  for (const [sort_order, label] of reasons.entries()) {
    if (!await db('crm_v8_stop_reasons').where({label}).first()) await db('crm_v8_stop_reasons').insert({label, sort_order});
  }
  await create('crm_budget_change_log', t => {
    id(t); ref(t, 'client_id'); ref(t, 'user_id'); t.integer('year').notNullable();
    t.decimal('before_annual', 14, 2).notNullable(); t.decimal('after_annual', 14, 2).notNullable();
    t.text('reason'); created(t); t.index(['client_id', 'created_at']);
  });
  await create('crm_portfolio_transfers', t => {
    id(t); for (const n of ['from_user_id', 'to_user_id', 'performed_by']) ref(t, n);
    t.integer('client_count').notNullable(); t.integer('activity_count').notNullable().defaultTo(0); created(t);
  });
  await create('crm_portfolio_transfer_items', t => {
    id(t); ref(t, 'transfer_id'); ref(t, 'client_id'); t.string('client_name', 255).notNullable(); t.index('transfer_id');
  });
  await create('crm_ionprint_sync_queue', t => {
    id(t); ref(t, 'transfer_id'); ref(t, 'client_id'); ref(t, 'target_owner_user_id');
    t.string('ionprint_id', 255); t.string('status', 50).notNullable(); created(t); t.index('transfer_id');
  });
  await create('crm_email_outbox', t => {
    id(t); for (const n of ['activity_id', 'client_id', 'contact_id', 'user_id']) ref(t, n);
    t.string('sender', 255).notNullable(); t.string('recipient', 255).notNullable();
    t.string('subject', 500).notNullable(); t.text('body').notNullable(); t.string('message_id', 255).notNullable();
    t.string('status', 30).notNullable(); t.text('smtp_response'); t.timestamp('sent_at').nullable(); created(t);
    t.unique('activity_id'); t.unique('message_id'); t.index('client_id');
  });
  await create('crm_email_inbox', t => {
    id(t); for (const n of ['mailbox_user_id', 'outbox_id', 'client_id', 'activity_id']) ref(t, n);
    t.string('sender', 255).notNullable(); t.string('recipient', 255).notNullable(); t.string('subject', 500);
    t.text('body'); t.string('message_id', 255).notNullable(); t.timestamp('received_at').notNullable();
    t.timestamp('handled_at').nullable(); created(t); t.unique(['mailbox_user_id', 'message_id']); t.index('client_id');
  });
};
exports.down = async () => { throw Error('Forward-only migration: restore a verified backup to roll back.'); };
