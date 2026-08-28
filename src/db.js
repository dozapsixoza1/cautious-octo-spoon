const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./config');

// Убедимся, что папка data существует
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,              -- telegram user id
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,  -- баланс в GRAM
  ref_by INTEGER,                      -- кто пригласил (telegram id)
  ref_count INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  captcha_passed INTEGER NOT NULL DEFAULT 0, -- прошёл ли проверку "выберите животное"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  type TEXT NOT NULL,                  -- 'subscribe_channel' | 'view_post'
  target TEXT NOT NULL,                -- @username канала или ссылка на пост
  title TEXT,
  reward INTEGER NOT NULL,             -- сколько GRAM получает исполнитель за 1 выполнение
  slots_total INTEGER NOT NULL,        -- сколько выполнений всего оплачено
  slots_left INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | completed | deleted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,   -- topup_stars | task_reward | task_payment | task_refund | referral_bonus | admin_adjust
  amount INTEGER NOT NULL, -- может быть отрицательным
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Миграция для уже существующих баз, созданных до появления капчи
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('captcha_passed')) {
  db.exec('ALTER TABLE users ADD COLUMN captcha_passed INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
