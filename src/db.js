const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.VERCEL 
  ? path.join("/tmp", "profiles.db") 
  : path.join(__dirname, "../data/profiles.db");

let db;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs({
        locateFile: file => path.join(__dirname, '../node_modules/sql.js/dist', file)
  });

  // Ensure data directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create table
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      gender TEXT,
      gender_probability REAL,
      sample_size INTEGER,
      age INTEGER,
      age_group TEXT,
      country_id TEXT,
      country_probability REAL,
      created_at TEXT NOT NULL
    )
  `);

  persist();
  return db;
}

function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
} catch (err) {
    // Log but don't crash the request — better to be in-memory only than dead
    console.error("Persistence failed:", err.message);
  }

module.exports = { getDb, persist };
