const express = require('express');
const sessionMiddleware = require('./session');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(sessionMiddleware);
app.use(express.static('public'));
app.get('/dashboard', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/');
  }

  res.sendFile('dashboard.html', {
    root: require('path').join(__dirname, '..', 'private')
  });
});

app.get('/prototype-preview', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/');
  }

  res.sendFile('prototuup_v8.html', {
    root: require('path').join(__dirname, '..', 'private', 'v8')
  });
});

app.use("/api", require("./routes/login"));
app.use("/api", require("./routes/account"));
app.use("/api", require("./routes/crm"));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', release: process.env.CRM_RELEASE_SHA || null });
});

module.exports = app;

