const express = require('express');
const db = require('../db');
const { sessionUser } = require('../work-mode');

const router = express.Router();

router.get('/me', async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Sisselogimine on vajalik.' });
    }

    const user = await db('users')
      .where({ id: req.session.userId, is_active: 1 })
      .first('id', 'name', 'email', 'role');

    if (!user) {
      return req.session.destroy(err => {
        if (err) return next(err);
        res.status(401).json({ error: 'Kasutajakonto ei ole aktiivne.' });
      });
    }

    res.set('Cache-Control', 'no-store');
    res.json({ user: sessionUser(user, req.session) });
  } catch (err) {
    next(err);
  }
});

router.post('/work-mode', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sisselogimine on vajalik.' });
    const mode = req.body?.mode;
    if (!['user', 'admin'].includes(mode)) return res.status(400).json({ error: 'Vigane töörežiim.' });
    const user = await db('users').where({ id: req.session.userId, is_active: 1 }).first('id', 'name', 'email', 'role');
    if (!user) return res.status(403).json({ error: 'Kasutajal puudub ligipääs.' });
    if (mode === 'admin' && user.role !== 'admin') return res.status(403).json({ error: 'Administraatori režiim pole lubatud.' });
    req.session.workMode = mode;
    req.session.save(err => {
      if (err) return next(err);
      res.set('Cache-Control', 'no-store');
      res.json({ user: sessionUser(user, req.session) });
    });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('ellington.sid', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax'
    });
    res.set('Cache-Control', 'no-store');
    res.json({ message: 'Välja logitud.' });
  });
});

module.exports = router;
