const db = require('../db');
const config = require('../config');

const DEFAULTS = {
  stars_to_gram_rate: config.STARS_TO_GRAM_RATE,
  referral_bonus: config.REFERRAL_BONUS,
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null && row.value !== undefined) {
    const n = Number(row.value);
    return Number.isNaN(n) ? row.value : n;
  }
  return DEFAULTS[key];
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getAllSettings() {
  return {
    stars_to_gram_rate: getSetting('stars_to_gram_rate'),
    referral_bonus: getSetting('referral_bonus'),
  };
}

module.exports = { getSetting, setSetting, getAllSettings };
