// Maintenance and test commands must never target a remote database.
module.exports = function assertLocal(db) {
  const c = db.client.config.connection;
  if (!['127.0.0.1', 'localhost', '::1'].includes(c.host) ||
      !/^ellington_(dev|test)(_[a-z0-9_]+)?$/.test(c.database) || c.socketPath) {
    throw Error('Only a loopback ellington_dev / ellington_test database is allowed.');
  }
};
