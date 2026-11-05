const express = require('express');
const { verifyLogin } = require('../auth');

const router = express.Router();
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

router.post('/login', async (req, res, next) => {
  try {
    const key = req.ip;
    const now = Date.now();
    let record = attempts.get(key);

    if (!record || now - record.started >= WINDOW_MS) {
      record = { count: 0, started: now };
      attempts.set(key, record);
    }

    if (record.count >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Liiga palju katseid. Proovi hiljem uuesti.' });
    }

    const { email, password } = req.body || {};
    const user = await verifyLogin(email, password);

    if (!user) {
      record.count++;
      return res.status(401).json({ error: 'Vale e-post või parool.' });
    }

    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.workMode = 'user';
      req.session.save(err => {
        if (err) return next(err);
        attempts.delete(key);
        res.json({ user: require('../work-mode').sessionUser(user, req.session) });
      });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
