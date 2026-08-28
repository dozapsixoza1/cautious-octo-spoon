const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { isOwner } = require('./admin');

const ANIMALS = [
  { key: 'tiger', label: 'Тигр', emoji: '🐯' },
  { key: 'bear', label: 'Медведь', emoji: '🐻' },
  { key: 'lion', label: 'Лев', emoji: '🦁' },
  { key: 'wolf', label: 'Волк', emoji: '🐺' },
  { key: 'fox', label: 'Лиса', emoji: '🦊' },
  { key: 'panda', label: 'Панда', emoji: '🐼' },
  { key: 'koala', label: 'Коала', emoji: '🐨' },
  { key: 'frog', label: 'Лягушка', emoji: '🐸' },
  { key: 'rabbit', label: 'Кролик', emoji: '🐰' },
  { key: 'pig', label: 'Свинья', emoji: '🐷' },
];

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Выбирает 4 случайных животных и одно из них как правильный ответ
function pickChallenge() {
  const options = shuffle(ANIMALS).slice(0, 4);
  const correct = options[Math.floor(Math.random() * options.length)];
  return { options: shuffle(options), correctKey: correct.key, correctLabel: correct.label };
}

function sendCaptcha(ctx) {
  const { options, correctKey, correctLabel } = pickChallenge();
  ctx.session.captcha = { correctKey };

  const buttons = options.map((a) => Markup.button.callback(`${a.emoji} ${a.label}`, `captcha_${a.key}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

  return ctx.reply(
    `🤖 Подтвердите, что вы не робот.\n\nВыберите животное «${correctLabel}»:`,
    Markup.inlineKeyboard(rows)
  );
}

// Глобальный "шлагбаум": пока капча не пройдена, ничего кроме /start и самой капчи не работает
function captchaGuard(ctx, next) {
  if (!ctx.from) return next();
  if (isOwner(ctx)) return next(); // владелец бота проходит без проверки

  if (ctx.updateType === 'callback_query') {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;
    if (data && data.startsWith('captcha_')) return next();
  }
  if (ctx.updateType === 'message' && ctx.message.text && ctx.message.text.startsWith('/start')) {
    return next();
  }

  if (userService.isCaptchaPassed(ctx.from.id)) return next();

  if (ctx.session.captcha) {
    return ctx.reply('Пожалуйста, сначала пройдите проверку выше ⬆️ — нажмите на нужное животное.');
  }
  return sendCaptcha(ctx);
}

// onPassed(ctx) вызывается сразу после успешного прохождения капчи (обычно — показать приветствие/меню)
function registerCaptcha(bot, onPassed) {
  bot.action(/^captcha_(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chosen = ctx.match[1];
    const expected = ctx.session.captcha && ctx.session.captcha.correctKey;
    if (!expected) return;

    if (chosen === expected) {
      userService.setCaptchaPassed(ctx.from.id, true);
      ctx.session.captcha = null;
      await ctx.editMessageText('✅ Проверка пройдена!').catch(() => {});
      if (typeof onPassed === 'function') onPassed(ctx);
    } else {
      await ctx.editMessageText('❌ Неверно, попробуйте ещё раз.').catch(() => {});
      await sendCaptcha(ctx);
    }
  });
}

module.exports = { registerCaptcha, captchaGuard, sendCaptcha };
