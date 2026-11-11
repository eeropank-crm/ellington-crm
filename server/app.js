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

app.get('/integrations/google-sheets', async (req, res) => {
  try {
    if (!req.session?.userId) return res.redirect('/');
    const user = await require('./db')('users')
      .where({ id: req.session.userId, is_active: 1 }).first('id', 'role');
    if (!user || require('./work-mode').sessionUser(user, req.session).role !== 'admin') {
      return res.status(403).send('Ainult administraatori töörežiimis.');
    }
    res.sendFile('google-sheets.html', {
      root: require('path').join(__dirname, '..', 'private')
    });
  } catch {
    res.status(503).send('Vaate avamine ebaõnnestus.');
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', release: process.env.CRM_RELEASE_SHA || null });
});

module.exports = app;

