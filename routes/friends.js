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
  const { targetUsername } = req.body;
  try {
    const target = await dbGet('SELECT id FROM users WHERE username = ?', [targetUsername]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    
    await dbRun(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "pending")',
      [req.userId, target.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept friend request
router.post('/accept', verifyToken, async (req, res) => {
  const { fromUserId } = req.body;
  try {
    await dbRun(
      'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?',
      [fromUserId, req.userId]
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
       WHERE f.friend_id = ? AND f.status = "pending"`,
      [req.userId]
    );
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;