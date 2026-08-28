const { Markup } = require('telegraf');
const config = require('../config');
const userService = require('../services/userService');
const taskService = require('../services/taskService');
const settingsService = require('../services/settingsService');

const PAGE_SIZE = 5;
const ADMIN_ENTRY_BUTTON = '⚙️ Админ-панель';

function isOwner(ctx) {
  return !!config.OWNER_TELEGRAM_ID && ctx.from && ctx.from.id === config.OWNER_TELEGRAM_ID;
}

function ownerGuard(ctx, next) {
  if (!isOwner(ctx)) return; // молча игнорируем, не раскрываем существование панели
  return next();
}

function adminMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'adm_stats')],
    [Markup.button.callback('👥 Пользователи', 'adm_users_0')],
    [Markup.button.callback('📋 Все задания', 'adm_tasks_0')],
    [Markup.button.callback('⚙️ Настройки', 'adm_settings')],
    [Markup.button.callback('✖️ Закрыть', 'adm_close')],
  ]);
}

function backButton(target = 'adm_back_main') {
  return [Markup.button.callback('◀️ Назад', target)];
}

function registerAdmin(bot) {
  // ---------- Вход в панель ----------
  function showMainMenu(ctx) {
    const text = '⚙️ Админ-панель\n\nВыберите раздел:';
    if (ctx.updateType === 'callback_query') {
      return ctx.editMessageText(text, adminMainKeyboard()).catch(() => ctx.reply(text, adminMainKeyboard()));
    }
    return ctx.reply(text, adminMainKeyboard());
  }

  bot.hears(ADMIN_ENTRY_BUTTON, ownerGuard, showMainMenu);
  bot.command('admin', ownerGuard, showMainMenu);

  bot.action('adm_back_main', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    showMainMenu(ctx);
  });

  bot.action('adm_close', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    ctx.deleteMessage().catch(() => {});
  });

  // ---------- Статистика ----------
  bot.action('adm_stats', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    const s = userService.getStats();
    ctx.editMessageText(
      `📊 Статистика\n\n` +
        `👥 Пользователей: ${s.usersCount}\n` +
        `📋 Активных заданий: ${s.activeTasksCount}\n` +
        `💰 GRAM в обороте: ${s.totalGramInCirculation}\n` +
        `⭐ Пополнено Stars всего: ${s.starsIncome}`,
      Markup.inlineKeyboard([backButton()])
    );
  });

  // ---------- Пользователи ----------
  function usersListText(page, query) {
    const offset = page * PAGE_SIZE;
    const rows = userService.listUsers(offset, PAGE_SIZE, query || '');
    const total = userService.countUsers(query || '');
    return { rows, total, offset };
  }

  function renderUsersList(ctx, page, query) {
    const { rows, total, offset } = usersListText(page, query);
    if (rows.length === 0) {
      return ctx.editMessageText(
        query ? `По запросу «${query}» никого не найдено.` : 'Пользователей пока нет.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔎 Поиск', 'adm_users_search')],
          backButton(),
        ])
      );
    }
    const lines = rows.map(
      (u, i) =>
        `${offset + i + 1}. ${u.first_name || '—'} (@${u.username || '—'}) · ID ${u.id}\n` +
        `   💰 ${u.balance} GRAM · рефералов: ${u.ref_count}${u.is_banned ? ' · 🚫 забанен' : ''}`
    );
    const buttons = rows.map((u) => [
      Markup.button.callback(`👤 ${u.first_name || u.id}`, `adm_u_${u.id}`),
    ]);
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️', `adm_users_${page - 1}${query ? `_q_${query}` : ''}`));
    if (offset + PAGE_SIZE < total) nav.push(Markup.button.callback('➡️', `adm_users_${page + 1}${query ? `_q_${query}` : ''}`));
    if (nav.length) buttons.push(nav);
    buttons.push([Markup.button.callback('🔎 Поиск', 'adm_users_search')]);
    buttons.push(backButton());

    return ctx.editMessageText(
      `👥 Пользователи (${total})${query ? `\nПоиск: «${query}»` : ''}\n\n${lines.join('\n')}`,
      Markup.inlineKeyboard(buttons)
    );
  }

  bot.action(/^adm_users_(\d+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    renderUsersList(ctx, Number(ctx.match[1]), '');
  });

  bot.action(/^adm_users_(\d+)_q_(.+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    renderUsersList(ctx, Number(ctx.match[1]), ctx.match[2]);
  });

  bot.action('adm_users_search', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'admin_user_search';
    ctx.reply('Введите ID, username или имя пользователя для поиска:');
  });

  function userDetailText(u) {
    return (
      `👤 ${u.first_name || '—'} (@${u.username || '—'})\n` +
      `ID: ${u.id}\n` +
      `💰 Баланс: ${u.balance} GRAM\n` +
      `👥 Рефералов: ${u.ref_count}\n` +
      `Статус: ${u.is_banned ? '🚫 забанен' : '✅ активен'}`
    );
  }

  function userDetailKeyboard(u) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('➕ Начислить/списать', `adm_adj_${u.id}`)],
      [
        u.is_banned
          ? Markup.button.callback('✅ Разбанить', `adm_unban_${u.id}`)
          : Markup.button.callback('🚫 Забанить', `adm_ban_${u.id}`),
      ],
      [Markup.button.callback('◀️ К списку', 'adm_users_0')],
    ]);
  }

  bot.action(/^adm_u_(\d+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    const u = userService.getUser(Number(ctx.match[1]));
    if (!u) return ctx.reply('Пользователь не найден.');
    ctx.editMessageText(userDetailText(u), userDetailKeyboard(u));
  });

  bot.action(/^adm_ban_(\d+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery('Пользователь забанен');
    userService.setBanned(Number(ctx.match[1]), true);
    const u = userService.getUser(Number(ctx.match[1]));
    ctx.editMessageText(userDetailText(u), userDetailKeyboard(u));
  });

  bot.action(/^adm_unban_(\d+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery('Пользователь разбанен');
    userService.setBanned(Number(ctx.match[1]), false);
    const u = userService.getUser(Number(ctx.match[1]));
    ctx.editMessageText(userDetailText(u), userDetailKeyboard(u));
  });

  bot.action(/^adm_adj_(\d+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'admin_adjust_amount';
    ctx.session.admin = { targetUserId: Number(ctx.match[1]) };
    ctx.reply(
      'Введите сумму корректировки в GRAM.\nПоложительное число — начислить, отрицательное — списать (например: -50).'
    );
  });

  // ---------- Задания ----------
  function renderTasksList(ctx, page) {
    const offset = page * PAGE_SIZE;
    const rows = taskService.listAllTasks(offset, PAGE_SIZE);
    const total = taskService.countAllTasks();
    if (rows.length === 0) {
      return ctx.editMessageText('Заданий пока нет.', Markup.inlineKeyboard([backButton()]));
    }
    const statusLabel = { active: '🟢', paused: '⏸', completed: '✅' };
    const lines = rows.map(
      (t, i) =>
        `${offset + i + 1}. #${t.id} ${statusLabel[t.status] || t.status} ${t.target}\n` +
        `   Владелец: ${t.first_name || '—'} (@${t.username || '—'})\n` +
        `   Награда: ${t.reward} GRAM · Осталось: ${t.slots_left}/${t.slots_total}`
    );
    const buttons = rows
      .filter((t) => t.status !== 'completed')
      .map((t) => [
        t.status === 'active'
          ? Markup.button.callback(`⏸ #${t.id}`, `adm_task_pause_${t.id}`)
          : Markup.button.callback(`▶️ #${t.id}`, `adm_task_resume_${t.id}`),
        Markup.button.callback(`🗑 #${t.id}`, `adm_task_delete_${t.id}`),
      ]);
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️', `adm_tasks_${page - 1}`));
    if (offset + PAGE_SIZE < total) nav.push(Markup.button.callback('➡️', `adm_tasks_${page + 1}`));
    if (nav.length) buttons.push(nav);
    buttons.push(backButton());

    return ctx.editMessageText(`📋 Все задания (${total})\n\n${lines.join('\n')}`, Markup.inlineKeyboard(buttons));
  }

  bot.action(/^adm_tasks_(\d+)$/, ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    renderTasksList(ctx, Number(ctx.match[1]));
  });

  bot.action(/^adm_task_pause_(\d+)$/, ownerGuard, (ctx) => {
    taskService.adminPauseTask(Number(ctx.match[1]));
    ctx.answerCbQuery('Задание на паузе');
    renderTasksList(ctx, 0);
  });

  bot.action(/^adm_task_resume_(\d+)$/, ownerGuard, (ctx) => {
    taskService.adminResumeTask(Number(ctx.match[1]));
    ctx.answerCbQuery('Задание возобновлено');
    renderTasksList(ctx, 0);
  });

  bot.action(/^adm_task_delete_(\d+)$/, ownerGuard, (ctx) => {
    taskService.adminDeleteTask(Number(ctx.match[1]));
    ctx.answerCbQuery('Задание удалено, остаток возвращён владельцу');
    renderTasksList(ctx, 0);
  });

  // ---------- Настройки ----------
  function settingsText() {
    const s = settingsService.getAllSettings();
    return (
      `⚙️ Настройки\n\n` +
      `💱 Курс Stars → GRAM: 1 ⭐ = ${s.stars_to_gram_rate} GRAM\n` +
      `🎁 Реферальный бонус: ${s.referral_bonus} GRAM`
    );
  }

  bot.action('adm_settings', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
      settingsText(),
      Markup.inlineKeyboard([
        [Markup.button.callback('💱 Изменить курс', 'adm_set_rate')],
        [Markup.button.callback('🎁 Изменить бонус', 'adm_set_refbonus')],
        backButton(),
      ])
    );
  });

  bot.action('adm_set_rate', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'admin_set_rate';
    ctx.reply('Введите новый курс (сколько GRAM за 1 Star), например: 10');
  });

  bot.action('adm_set_refbonus', ownerGuard, (ctx) => {
    ctx.answerCbQuery();
    ctx.session.step = 'admin_set_refbonus';
    ctx.reply('Введите новый реферальный бонус в GRAM, например: 20');
  });

  // ---------- Текстовые шаги админки ----------
  bot.on('text', (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const step = ctx.session.step;
    if (!step || !step.startsWith('admin_')) return next();

    if (step === 'admin_user_search') {
      ctx.session.step = null;
      const query = ctx.message.text.trim();
      return renderUsersListAsReply(ctx, 0, query);
    }

    if (step === 'admin_adjust_amount') {
      const amount = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(amount) || amount === 0) {
        return ctx.reply('Введите ненулевое целое число, например 50 или -20.');
      }
      const targetId = ctx.session.admin && ctx.session.admin.targetUserId;
      ctx.session.step = null;
      if (!targetId) return ctx.reply('Сессия устарела, откройте пользователя заново через панель.');
      userService.addBalance(targetId, amount, 'admin_adjust', 'Ручная корректировка администратором');
      const u = userService.getUser(targetId);
      return ctx.reply(
        `✅ Готово. Новый баланс пользователя ${targetId}: ${u.balance} GRAM`,
        Markup.inlineKeyboard([[Markup.button.callback('👤 К пользователю', `adm_u_${targetId}`)]])
      );
    }

    if (step === 'admin_set_rate') {
      const rate = Number(ctx.message.text.trim().replace(',', '.'));
      if (!rate || rate <= 0) return ctx.reply('Введите положительное число, например 10.');
      settingsService.setSetting('stars_to_gram_rate', rate);
      ctx.session.step = null;
      return ctx.reply('✅ Курс обновлён.', Markup.inlineKeyboard([[Markup.button.callback('⚙️ К настройкам', 'adm_settings')]]));
    }

    if (step === 'admin_set_refbonus') {
      const bonus = parseInt(ctx.message.text.trim(), 10);
      if (!Number.isInteger(bonus) || bonus < 0) return ctx.reply('Введите целое число ≥ 0, например 20.');
      settingsService.setSetting('referral_bonus', bonus);
      ctx.session.step = null;
      return ctx.reply('✅ Бонус обновлён.', Markup.inlineKeyboard([[Markup.button.callback('⚙️ К настройкам', 'adm_settings')]]));
    }

    return next();
  });

  // Поиск пользователей приходит текстом, а не через callback — рендерим списком в новом сообщении
  function renderUsersListAsReply(ctx, page, query) {
    const { rows, total, offset } = usersListText(page, query);
    if (rows.length === 0) {
      return ctx.reply(
        `По запросу «${query}» никого не найдено.`,
        Markup.inlineKeyboard([[Markup.button.callback('🔎 Новый поиск', 'adm_users_search')], backButton()])
      );
    }
    const lines = rows.map(
      (u, i) =>
        `${offset + i + 1}. ${u.first_name || '—'} (@${u.username || '—'}) · ID ${u.id}\n` +
        `   💰 ${u.balance} GRAM · рефералов: ${u.ref_count}${u.is_banned ? ' · 🚫 забанен' : ''}`
    );
    const buttons = rows.map((u) => [Markup.button.callback(`👤 ${u.first_name || u.id}`, `adm_u_${u.id}`)]);
    const nav = [];
    if (offset + PAGE_SIZE < total) nav.push(Markup.button.callback('➡️', `adm_users_${page + 1}_q_${query}`));
    if (nav.length) buttons.push(nav);
    buttons.push([Markup.button.callback('🔎 Новый поиск', 'adm_users_search')]);
    buttons.push(backButton());
    return ctx.reply(`👥 Найдено (${total})\nПоиск: «${query}»\n\n${lines.join('\n')}`, Markup.inlineKeyboard(buttons));
  }
}

module.exports = { registerAdmin, isOwner, ADMIN_ENTRY_BUTTON };
