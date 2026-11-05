const express = require('express');
const db = require('../db');

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
    res.json({ user });
  } catch (err) {
    next(err);
  }
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
