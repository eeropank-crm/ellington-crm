require('dotenv').config();
const db = require('../server/db');

async function create(name, define) {
  if (await db.schema.hasTable(name)) {
    console.log('Olemas:', name);
    return;
  }
  await db.schema.createTable(name, define);
  console.log('Loodud:', name);
}

async function main() {
  await create('crm_clients', t => {
    t.bigIncrements('id').primary();
    t.string('name', 255).notNullable();
    t.bigInteger('owner_user_id').unsigned().nullable();
    t.string('google_id', 255).nullable();
    t.string('ionprint_id', 255).nullable();
    t.text('notes').nullable();
    t.timestamps(true, true);
    t.index('owner_user_id');
  });

  await create('crm_contacts', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('client_id').unsigned().notNullable();
    t.string('name', 150).notNullable();
    t.string('email', 255).nullable();
    t.string('phone', 100).nullable();
    t.string('position', 150).nullable();
    t.timestamps(true, true);
    t.index('client_id');
  });

  await create('crm_templates', t => {
    t.bigIncrements('id').primary();
    t.string('name', 150).notNullable();
    t.string('type', 30).notNullable();
    t.string('subject', 255).nullable();
    t.text('body').nullable();
    t.string('next_type', 30).nullable();
    t.integer('next_days').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await create('crm_activities', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('client_id').unsigned().notNullable();
    t.bigInteger('contact_id').unsigned().nullable();
    t.bigInteger('owner_user_id').unsigned().notNullable();
    t.bigInteger('template_id').unsigned().nullable();
    t.string('type', 30).notNullable();
    t.string('status', 30).notNullable().defaultTo('active');
    t.date('due_date').notNullable();
    t.integer('sequence_number').notNullable().defaultTo(1);
    t.text('notes').nullable();
    t.timestamps(true, true);
    t.index(['owner_user_id', 'status', 'due_date']);
    t.index('client_id');
  });

  await create('crm_activity_history', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('activity_id').unsigned().notNullable();
    t.bigInteger('user_id').unsigned().notNullable();
    t.string('event_type', 50).notNullable();
    t.text('details').nullable();
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.index('activity_id');
  });

  await create('crm_budgets', t => {
    t.bigIncrements('id').primary();
    t.bigInteger('client_id').unsigned().notNullable();
    t.integer('year').notNullable();
    t.decimal('annual_target', 14, 2).notNullable().defaultTo(0);
    t.decimal('q1', 14, 2).notNullable().defaultTo(0);
    t.decimal('q2', 14, 2).notNullable().defaultTo(0);
    t.decimal('q3', 14, 2).notNullable().defaultTo(0);
    t.decimal('q4', 14, 2).notNullable().defaultTo(0);
    t.decimal('actual_revenue', 14, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['client_id', 'year']);
  });

  console.log('CRM-i tabelite loomine lõpetatud.');
}

main()
  .catch(error => {
    console.error('Viga:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
