const express = require('express');
const { dbRun, dbGet, dbAll } = require('../db');
const jwt = require('jsonwebtoken');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

router.get('/search', verifyToken, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const players = await dbAll(
      `SELECT id, username, email FROM users
       WHERE (username ILIKE ? OR email ILIKE ?) AND id != ?
       ORDER BY CASE WHEN lower(username) = lower(?) THEN 0 ELSE 1 END, lower(username) ASC
       LIMIT 10`,
      [`%${q}%`, `%${q}%`, req.userId, q]
    );

    const results = [];
    for (const player of players) {
      const relation = await dbGet(
        `SELECT status, user_id, friend_id FROM friends
         WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
         LIMIT 1`,
        [req.userId, player.id, player.id, req.userId]
      );
      results.push({
        id: player.id,
        username: player.username,
        status: relation?.status === 'accepted' ? 'friends'
          : relation?.status === 'pending' && Number(relation.user_id) === Number(req.userId) ? 'sent'
          : relation?.status === 'pending' ? 'received'
          : 'none'
      });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/request', verifyToken, async (req, res) => {
  const targetInput = String(req.body.targetUsername || req.body.username || req.body.email || '').trim();
  if (!targetInput) return res.status(400).json({ error: 'Enter a username or email.' });

  try {
    const target = await dbGet(
      `SELECT id, username FROM users
       WHERE lower(username) = lower(?) OR lower(email) = lower(?)
       LIMIT 1`,
      [targetInput, targetInput]
    );
    if (!target) return res.status(404).json({ error: `Player "${targetInput}" was not found. Make sure they have registered on this game server.` });
    if (Number(target.id) === Number(req.userId)) {
      return res.status(400).json({ error: 'You cannot send a friend request to yourself.' });
    }

    const existing = await dbGet(
      `SELECT user_id, friend_id, status FROM friends
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [req.userId, target.id, target.id, req.userId]
    );
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'You are already friends.' });
      if (Number(existing.user_id) === Number(target.id)) return res.status(409).json({ error: 'That player already sent you a friend request.' });
      return res.status(409).json({ error: 'Friend request already sent.' });
    }

    await dbRun(
      'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, "pending")',
      [req.userId, target.id]
    );
    res.json({ success: true, fromUserId: req.userId, toUserId: target.id, toUsername: target.username });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Friend request already exists.' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/accept', verifyToken, async (req, res) => {
  const { fromUserId } = req.body;
  try {
    if (Number(fromUserId) === Number(req.userId)) return res.status(400).json({ error: 'Invalid self friend request.' });
    const pending = await dbGet(
      'SELECT user_id FROM friends WHERE user_id = ? AND friend_id = ? AND status = "pending"',
      [fromUserId, req.userId]
    );
    if (!pending) return res.status(404).json({ error: 'Friend request not found.' });
    await dbRun('UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?', [fromUserId, req.userId]);
    await dbRun('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")', [req.userId, fromUserId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', verifyToken, async (req, res) => {
  try {
    const friends = await dbAll(
      `SELECT f.friend_id as id, u.username FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = "accepted" AND f.friend_id != ?`,
      [req.userId, req.userId]
    );
    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pending', verifyToken, async (req, res) => {
  try {
    const pending = await dbAll(
      `SELECT f.user_id as id, u.username FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = ? AND f.status = "pending" AND f.user_id != ?`,
      [req.userId, req.userId]
    );
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
