const session = require('express-session');
const { ConnectSessionKnexStore: KnexSessionStore } = require('connect-session-knex');
const db = require('./db');

const store = new KnexSessionStore({
  knex: db,
  tableName: 'user_sessions',
  createTable: false,
  sidFieldName: 'sid',
  cleanupInterval: 15 * 60 * 1000
});

module.exports = session({
  name: 'ellington.sid',
  secret: process.env.SESSION_SECRET,
  store,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
});
