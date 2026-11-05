const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
async function seed(db) {
  require('./local-database')(db);
  return db.transaction(async trx => {
    const user = async (email, role) => {
      let row = await trx('users').where({email}).first();
      if (!row) {
        const [id] = await trx('users').insert({name: 'Sünteetiline ' + role, email, role,
          password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), is_active: 1});
        row = {id};
      }
      return row.id;
    };
    const admin = await user('crm-admin@example.invalid', 'admin');
    const sales = await user('crm-sales@example.invalid', 'sales');
    let client = await trx('crm_clients').where({google_id:'synthetic-v8-fixture'}).first();
    if (!client) {
      const [id] = await trx('crm_clients').insert({name:'Sünteetiline Testettevõte', google_id:'synthetic-v8-fixture',owner_user_id:sales,client_type:'Testklient'});
      client = {id};
      await trx('crm_contacts').insert({client_id:id,name:'Testkontakt Näidis',email:'contact@example.invalid',position:'Testkontakt'});
      await trx('crm_imported_history').insert({client_id:id,activity_type:'Kõne',original_value:'Sünteetiline ajalugu',activity_date:'2026-01-01',source_column:'test'});
    }
    const templates = {};
    for (const type of ['Kõne','Kohtumine','E-kiri']) {
      const external_key = 'synthetic-' + type;
      let row = await trx('crm_templates').where({external_key}).first();
      if (!row) {
        const [id] = await trx('crm_templates').insert({external_key,name:'Test '+type,purpose:'Test '+type,type,subject:'Testpealkiri',body:'Sünteetiline testjuhis',is_active:1});
        row = {id};
      }
      templates[type] = row.id;
    }
    return {admin,sales,client:client.id,templates};
  });
}
module.exports = seed;
if (require.main === module) {
  const db = require('../server/db');
  seed(db).then(() => console.log('Synthetic fixtures ready; account passwords are random and are not printed.'))
    .catch(e => {console.error(e.message);process.exitCode=1;}).finally(()=>db.destroy());
}
