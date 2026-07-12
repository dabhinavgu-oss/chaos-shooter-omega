const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'game.db'), (err) => {
  if (err) console.error(err);
  else console.log('Connected to SQLite database');
});

db.serialize(() => {
  // Users: accounts + login
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )`);

  // Profiles: cosmetics + stats
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER UNIQUE NOT NULL,
    color TEXT DEFAULT '#1e90ff',
    bio TEXT DEFAULT '',
    total_wins INTEGER DEFAULT 0,
    total_kills INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Rewards: tracked by user
  db.run(`CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reward_type TEXT,
    amount INTEGER DEFAULT 1,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Friends: mutual friend relationships
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, friend_id)
  )`);

  // Parties: group lobbies
  db.run(`CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    creator_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mode TEXT DEFAULT 'zombies',
    capacity INTEGER DEFAULT 4,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Party members
  db.run(`CREATE TABLE IF NOT EXISTS party_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    ready BOOLEAN DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(party_id, user_id)
  )`);

  // Maps: available game maps
  db.run(`CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed INTEGER,
    mode TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Map votes: for voting system
  db.run(`CREATE TABLE IF NOT EXISTS map_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id INTEGER NOT NULL,
    map_id TEXT NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES maps(id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Game sessions: track games for stats
  db.run(`CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT,
    map_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (map_id) REFERENCES maps(id)
  )`);

  // Player session stats
  db.run(`CREATE TABLE IF NOT EXISTS session_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    won BOOLEAN DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  console.log('Database initialized successfully');
  db.close();
});