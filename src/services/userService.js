const db = require('../db');
const { REFERRAL_BONUS } = require('../config');

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
    addBalance(validRef, REFERRAL_BONUS, 'referral_bonus', `Приглашён пользователь ${tgUser.id}`);
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

module.exports = { getUser, ensureUser, addBalance, hasEnough, isBanned };
