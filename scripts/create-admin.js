const readline = require('node:readline');
const bcrypt = require('bcryptjs');
const db = require('../server/db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function ask(question, hidden = false) {
  return new Promise(resolve => {
    if (hidden) {
      rl.stdoutMuted = true;
      rl._writeToOutput = function (text) {
        if (!this.stdoutMuted || text === question) this.output.write(text);
      };
    }
    rl.question(question, answer => {
      rl.stdoutMuted = false;
      if (hidden) rl.output.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  try {
    const email = (await ask('Eero e-posti aadress: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) throw new Error('Vigane e-posti aadress');
    const existing = await db('users').where({ email }).first();
    if (existing) throw new Error('Selle e-postiga kasutaja on juba olemas');
    const password = await ask('Eero parool (ei kuvata): ', true);
    if (password.length < 14 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Parool peab olema vähemalt 14 märki ja kuni 72 baiti');
    const hash = await bcrypt.hash(password, 12);
    await db('users').insert({ name: 'Eero', email, password_hash: hash, role: 'admin', is_active: 1 });
    console.log('Eero administraatorikonto loodud.');
  } catch (error) {
    console.error('Viga:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await db.destroy();
  }
})();
