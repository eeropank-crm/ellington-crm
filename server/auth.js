const bcrypt = require('bcryptjs');
const db = require('./db');

async function verifyLogin(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  if (email.length > 255 || password.length > 1024) return null;

  const user = await db('users')
    .where({ email: email.trim().toLowerCase(), is_active: 1 })
    .first();

  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return { id: user.id, name: user.name, role: user.role };
}

module.exports = { verifyLogin };
