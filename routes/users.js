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

// Get user profile
router.get('/profile/:userId', verifyToken, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, username, created_at FROM users WHERE id = ?', [req.params.userId]);
    const profile = await dbGet('SELECT * FROM profiles WHERE user_id = ?', [req.params.userId]);
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ ...user, ...profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile
router.post('/profile/update', verifyToken, async (req, res) => {
  const { color, bio } = req.body;

  try {
    const updates = [];
    if (color) updates.push(dbRun('UPDATE profiles SET color = ? WHERE user_id = ?', [color, req.userId]));
    if (bio) updates.push(dbRun('UPDATE profiles SET bio = ? WHERE user_id = ?', [bio, req.userId]));

    await Promise.all(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const leaderboard = await dbAll(
      `SELECT u.username, p.total_wins, p.total_kills, p.total_score, p.total_games
       FROM profiles p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.total_score DESC LIMIT 100`
    );

    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record game stats
router.post('/stats/record', verifyToken, async (req, res) => {
  const { sessionId, kills, deaths, score, won } = req.body;

  try {
    await dbRun(
      'INSERT INTO session_stats (session_id, user_id, kills, deaths, score, won) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, req.userId, kills, deaths, score, won ? 1 : 0]
    );

    const profile = await dbGet('SELECT * FROM profiles WHERE user_id = ?', [req.userId]);

    await dbRun(
      'UPDATE profiles SET total_kills = ?, total_score = ?, total_games = ?, total_wins = ? WHERE user_id = ?',
      [
        (profile?.total_kills || 0) + kills,
        (profile?.total_score || 0) + score,
        (profile?.total_games || 0) + 1,
        (profile?.total_wins || 0) + (won ? 1 : 0),
        req.userId
      ]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;