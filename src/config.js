require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  BOT_USERNAME: process.env.BOT_USERNAME || '',
  STARS_TO_GRAM_RATE: Number(process.env.STARS_TO_GRAM_RATE || 10),
  REFERRAL_BONUS: Number(process.env.REFERRAL_BONUS || 20),
  ADMIN_PORT: Number(process.env.ADMIN_PORT || 3001),
  ADMIN_LOGIN: process.env.ADMIN_LOGIN || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change_me',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev_secret_change_me',
  OWNER_TELEGRAM_ID: process.env.OWNER_TELEGRAM_ID ? Number(process.env.OWNER_TELEGRAM_ID) : null,
  DB_PATH: require('path').join(__dirname, '..', 'data', 'gram.db'),
};
