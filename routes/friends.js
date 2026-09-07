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

// Send friend request
router.post('/request', verifyToken, async (req, res) => {
  const targetUsername = String(req.body.targetUsername || '').trim();
  if (!targetUsername) return res.status(400).json({ error: 'Enter a username.' });

  try {
    // Username matching is case-insensitive, so PlayerOne and playerone work.
    const target = await dbGet(
      'SELECT id, username FROM users WHERE lower(username) = lower(?) LIMIT 1',
      [targetUsername]
    );
    if (!target) return res.status(404).json({ error: `Player "${targetUsername}" was not found.` });
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
    res.json({ success: true, fromUserId: req.userId, fromUsername: req.body.targetUsername, toUserId: target.id, toUsername: target.username });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Friend request already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Accept friend request
router.post('/accept', verifyToken, async (req, res) => {
  const { fromUserId } = req.body;
  try {
    const pending = await dbGet(
      'SELECT user_id FROM friends WHERE user_id = ? AND friend_id = ? AND status = "pending"',
      [fromUserId, req.userId]
    );
    if (!pending) return res.status(404).json({ error: 'Friend request not found.' });
    await dbRun(
      'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?',
      [fromUserId, req.userId]
    );
    await dbRun(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")',
      [req.userId, fromUserId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friends list
router.get('/list', verifyToken, async (req, res) => {
  try {
    const friends = await dbAll(
      `SELECT f.friend_id as id, u.username FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = "accepted"`,
      [req.userId]
    );
    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending requests
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
