const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { dbRun, dbGet, dbAll } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Google OAuth uses only environment variables; no Google credentials are stored in the repo.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

// Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), hashed]
    );
    await dbRun(
      'INSERT INTO profiles (user_id, color) VALUES (?, ?)',
      [result.lastID, '#1e90ff']
    );
    const token = jwt.sign({ id: result.lastID, username: username.trim() }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: result.lastID, username: username.trim() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Login with either username OR email.
router.post('/login', async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!identifier || !password) return res.status(400).json({ error: 'Missing username/email or password' });

  try {
    const user = await dbGet(
      'SELECT * FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?) LIMIT 1',
      [identifier, identifier]
    );
    if (!user) return res.status(404).json({ error: 'User not found. If this is a new account, choose REGISTER first.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    await dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    res.json({ token, userId: user.id, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Google sign-in.
router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.status(503).send('Google login is not configured on this server yet.');
  }
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie('cso_google_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// Google callback: verify the OAuth response, find/create the game account, then hand the normal JWT to the client.
router.get('/google/callback', async (req, res) => {
  const fail = (message) => res.redirect('/#google_error=' + encodeURIComponent(message));
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return fail('Google login is not configured.');
  if (!req.query.code || !req.query.state || req.query.state !== req.cookies.cso_google_state) return fail('Google login security check failed.');
  res.clearCookie('cso_google_state');

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed.');
    const tokenData = await tokenResponse.json();
    const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token }
    });
    if (!userResponse.ok) throw new Error('Google profile lookup failed.');
    const googleUser = await userResponse.json();
    const email = String(googleUser.email || '').trim().toLowerCase();
    if (!email || googleUser.email_verified === false) throw new Error('Google did not provide a verified email.');

    let user = await dbGet('SELECT id, username, email FROM users WHERE lower(email) = lower(?) LIMIT 1', [email]);
    if (!user) {
      const base = String(googleUser.name || googleUser.given_name || email.split('@')[0] || 'Player')
        .replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'Player';
      let username = base;
      for (let i = 1; i < 1000; i++) {
        const exists = await dbGet('SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1', [username]);
        if (!exists) break;
        username = (base.slice(0, Math.max(1, 12 - String(i).length)) + i).slice(0, 16);
      }
      const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const result = await dbRun('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, randomPassword]);
      await dbRun('INSERT INTO profiles (user_id, color) VALUES (?, ?)', [result.lastID, '#1e90ff']);
      user = { id: result.lastID, username, email };
    }

    await dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.redirect('/#google_token=' + encodeURIComponent(token) + '&google_user=' + encodeURIComponent(user.username));
  } catch (err) {
    console.error('Google login error:', err.message);
    fail('Google login failed. Please try again.');
  }
});

router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, userId: decoded.id, username: decoded.username });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
