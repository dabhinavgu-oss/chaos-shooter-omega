const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'game.db');
const db = new sqlite3.Database(dbPath);

// Render can start with a brand-new SQLite file. Build the schema first and make
// every query wait for that work to finish, so requests can never race the
// CREATE TABLE statements and produce "no such table: users".
const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER UNIQUE NOT NULL,
    color TEXT DEFAULT '#1e90ff',
    bio TEXT DEFAULT '',
    total_wins INTEGER DEFAULT 0,
    total_kills INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reward_type TEXT,
    amount INTEGER DEFAULT 1,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
  )`,
  `CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    creator_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mode TEXT DEFAULT 'zombies',
    capacity INTEGER DEFAULT 4,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS party_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    ready BOOLEAN DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(party_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed INTEGER,
    mode TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS map_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id INTEGER NOT NULL,
    map_id TEXT NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT,
    map_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS session_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    won BOOLEAN DEFAULT 0
  )`
];

const dbReady = new Promise((resolve, reject) => {
  db.serialize(() => {
    let remaining = schema.length;
    let failed = false;
    for (const sql of schema) {
      db.run(sql, (err) => {
        if (failed) return;
        if (err) {
          failed = true;
          console.error('SQLite schema initialization failed:', err.message);
          reject(err);
          return;
        }
        remaining -= 1;
        if (remaining === 0) {
          console.log(`SQLite ready: ${dbPath}`);
          resolve();
        }
      });
    }
  });
});

// Promise-based query wrappers. Every operation waits for schema creation.
const dbRun = async (sql, params = []) => {
  await dbReady;
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = async (sql, params = []) => {
  await dbReady;
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = async (sql, params = []) => {
  await dbReady;
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

module.exports = { db, dbRun, dbGet, dbAll, dbReady };
