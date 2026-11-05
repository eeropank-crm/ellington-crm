require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const knex = require('knex');

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  },
  pool: { min: 0, max: 5 }
});

module.exports = db;
