const db = require('../server/db');
const path = require('node:path');
(async () => {
  require('./local-database')(db);
  const [, files] = await db.migrate.latest({ directory: path.join(__dirname, '../database/migrations') });
  console.log('Applied migrations:', files);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.destroy());
