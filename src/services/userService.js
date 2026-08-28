const db = require('../db');
const { getSetting } = require('./settingsService');

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function ensureUser(tgUser, refBy) {
  let user = getUser(tgUser.id);
  if (user) {
    db.prepare('UPDATE users SET username = ?, first_name = ? WHERE id = ?')
      .run(tgUser.username || null, tgUser.first_name || null, tgUser.id);
    return getUser(tgUser.id);
  }

  const validRef = refBy && refBy !== tgUser.id && getUser(refBy) ? refBy : null;

  db.prepare(
    `INSERT INTO users (id, username, first_name, balance, ref_by) VALUES (?, ?, ?, 0, ?)`
  ).run(tgUser.id, tgUser.username || null, tgUser.first_name || null, validRef);

  if (validRef) {
    db.prepare('UPDATE users SET ref_count = ref_count + 1 WHERE id = ?').run(validRef);
    addBalance(validRef, getSetting('referral_bonus'), 'referral_bonus', `Приглашён пользователь ${tgUser.id}`);
  }

  return getUser(tgUser.id);
}

function addBalance(userId, amount, type, meta) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)')
    .run(userId, type, amount, meta || null);
}

function hasEnough(userId, amount) {
  const u = getUser(userId);
  return u && u.balance >= amount;
}

function isBanned(userId) {
  const u = getUser(userId);
  return !!(u && u.is_banned);
}

// ---------- Админские функции ----------
function listUsers(offset = 0, limit = 5, query = '') {
  const q = query.trim();
  if (q) {
    return db
      .prepare(
        `SELECT * FROM users WHERE CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`, limit, offset);
  }
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
}

function countUsers(query = '') {
  const q = query.trim();
  if (q) {
    return db
      .prepare(
        `SELECT COUNT(*) c FROM users WHERE CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ?`
      )
      .get(`%${q}%`, `%${q}%`, `%${q}%`).c;
  }
  return db.prepare('SELECT COUNT(*) c FROM users').get().c;
}

function setBanned(userId, banned) {
  db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(banned ? 1 : 0, userId);
}

function getStats() {
  const usersCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const activeTasksCount = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='active'").get().c;
  const totalGramInCirculation = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s;
  const starsIncome = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(substr(meta, 8, instr(meta,' XTR')-8) AS INTEGER)),0) s FROM transactions WHERE type='topup_stars'"
    )
    .get().s;
  return { usersCount, activeTasksCount, totalGramInCirculation, starsIncome };
}

module.exports = {
  getUser,
  ensureUser,
  addBalance,
  hasEnough,
  isBanned,
  listUsers,
  countUsers,
  setBanned,
  getStats,
};
