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

// Send friend request. Players can be found by username OR account email.
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
    res.json({
      success: true,
      fromUserId: req.userId,
      fromUsername: req.body.targetUsername || req.body.username || req.body.email,
      toUserId: target.id,
      toUsername: target.username
    });
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
