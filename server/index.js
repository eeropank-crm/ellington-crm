const app = require('./app');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error('Vigane serveri port.');
  process.exit(1);
}

app.listen(PORT, HOST, () => {
  console.log(`Ellington CRM kuulab aadressil ${HOST}:${PORT}`);
});
