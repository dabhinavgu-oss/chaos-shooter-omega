const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// If DATABASE_URL is set, use hosted PostgreSQL (for Render production).
// Without it, keep SQLite for simple local development.
const usePostgres = Boolean(process.env.DATABASE_URL);
let db = null;
let pool = null;

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    color TEXT DEFAULT '#1e90ff',
    bio TEXT DEFAULT '',
    total_wins INTEGER DEFAULT 0,
    total_kills INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS rewards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_type TEXT,
    amount INTEGER DEFAULT 1,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS friends (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
  )`,
  `CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    creator_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mode TEXT DEFAULT 'zombies',
    capacity INTEGER DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS party_members (
    id SERIAL PRIMARY KEY,
    party_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    ready BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(party_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed INTEGER,
    mode TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS map_votes (
    id SERIAL PRIMARY KEY,
    session_id TEXT,
    user_id INTEGER NOT NULL,
    map_id TEXT NOT NULL,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT,
    map_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS session_stats (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    won BOOLEAN DEFAULT FALSE
  )`
];

function postgresSql(sql) {
  let out = String(sql)
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
    .replace(/\bBOOLEAN\s+DEFAULT\s+0\b/gi, 'BOOLEAN DEFAULT FALSE')
    .replace(/\bBOOLEAN\s+DEFAULT\s+1\b/gi, 'BOOLEAN DEFAULT TRUE')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
    .replace(/\bAUTOINCREMENT\b/gi, '')
    .replace(/\?\s*;?/g, (m) => m); // placeholder conversion happens below

  // Existing SQLite queries sometimes use double quotes for string literals.
  out = out.replace(/(status\s*=\s*)"([^"]+)"/gi, "$1'$2'");
  out = out.replace(/(VALUES\s*\([^)]*?),\s*"([^"]+)"(\s*\))/gi, "$1, '$2'$3");

  let index = 0;
  out = out.replace(/\?/g, () => `$${++index}`);

  // SQLite's INSERT OR IGNORE maps to PostgreSQL's ON CONFLICT DO NOTHING.
  if (/^\s*INSERT\s+INTO/i.test(out) && /OR\s+IGNORE/i.test(sql)) {
    out += ' ON CONFLICT DO NOTHING';
  }
  return out;
}

const dbReady = usePostgres ? (async () => {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5
  });
  const client = await pool.connect();
  try {
    for (const sql of schema) await client.query(sql);
    console.log('PostgreSQL ready: hosted database');
  } finally {
    client.release();
  }
})() : (() => {
  const persistentDir = path.join(__dirname, 'data');
  if (!fs.existsSync(persistentDir)) fs.mkdirSync(persistentDir, { recursive: true });
  const dbPath = process.env.DATABASE_PATH || path.join(persistentDir, 'game.db');
  db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // SQLite-compatible schema for local development.
      const sqliteSchema = schema.map((sql) => sql
        .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
        .replace(/TIMESTAMP/g, 'DATETIME')
        .replace(/BOOLEAN DEFAULT FALSE/g, 'BOOLEAN DEFAULT 0')
        .replace(/BOOLEAN DEFAULT TRUE/g, 'BOOLEAN DEFAULT 1'));
      let remaining = sqliteSchema.length;
      let failed = false;
      for (const sql of sqliteSchema) db.run(sql, (err) => {
        if (failed) return;
        if (err) { failed = true; reject(err); return; }
        if (--remaining === 0) {
          console.log(`SQLite ready: ${dbPath}`);
          resolve();
        }
      });
    });
  });
})();

const dbRun = async (sql, params = []) => {
  await dbReady;
  if (usePostgres) {
    let query = postgresSql(sql);
    // Preserve sqlite3's result.lastID for the auto-id tables used by the app.
    if (/^\s*INSERT\s+INTO\s+(users|rewards|friends|party_members|map_votes|session_stats)\b/i.test(query) && !/\bRETURNING\b/i.test(query)) {
      query += ' RETURNING id';
    }
    const result = await pool.query(query, params);
    return {
      rowCount: result.rowCount,
      lastID: result.rows[0]?.id,
      rows: result.rows
    };
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = async (sql, params = []) => {
  await dbReady;
  if (usePostgres) {
    const result = await pool.query(postgresSql(sql), params);
    return result.rows[0];
  }
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
};

const dbAll = async (sql, params = []) => {
  await dbReady;
  if (usePostgres) {
    const result = await pool.query(postgresSql(sql), params);
    return result.rows;
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
};

module.exports = { db, dbRun, dbGet, dbAll, dbReady };
