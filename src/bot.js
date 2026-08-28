const { Telegraf, Markup, session } = require('telegraf');
const config = require('./config');
const userService = require('./services/userService');
const taskService = require('./services/taskService');
const { getPackages } = require('./services/paymentService');
const { getSetting } = require('./services/settingsService');
const { registerAdmin, isOwner, ADMIN_ENTRY_BUTTON } = require('./handlers/admin');
const { registerCaptcha, captchaGuard, sendCaptcha } = require('./handlers/captcha');

if (!config.BOT_TOKEN) {
  console.error('BOT_TOKEN не задан в .env — бот не может запуститься.');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({ step: null, draft: {}, admin: {}, captcha: null }) }));

// Капча — до всего остального: пока не пройдена, никакие другие команды не работают
bot.use(captchaGuard);

// Регистрируем обработчики админ-панели ДО остальных текстовых хендлеров,
// чтобы шаги вида admin_* перехватывались первыми (иначе next() всё равно передаст дальше).
registerAdmin(bot);

// ---------- Клавиатуры ----------
function mainMenu(ctx) {
  const rows = [
    ['📋 Задания', '➕ Создать задание'],
    ['💰 Баланс', '💳 Пополнить'],
    ['🗂 Мои задания', '👥 Рефералы'],
  ];
  if (isOwner(ctx)) rows.push([ADMIN_ENTRY_BUTTON]);
  return Markup.keyboard(rows).resize();
}

function taskInlineKeyboard(taskId) {
  return Markup.inlineKeyboard([Markup.button.callback('✅ Выполнить', `do_${taskId}`)]);
}

// ---------- /start ----------
bot.start((ctx) => {
  const payload = ctx.startPayload; // e.g. "ref_123456"
  let refBy = null;
  if (payload && payload.startsWith('ref_')) {
    const parsed = Number(payload.slice(4));
    if (!Number.isNaN(parsed)) refBy = parsed;
  }
  const user = userService.ensureUser(ctx.from, refBy);
  if (userService.isBanned(user.id)) {
    return ctx.reply('🚫 Ваш аккаунт заблокирован. По вопросам — обратитесь к администратору.');
  }
  if (!isOwner(ctx) && !userService.isCaptchaPassed(user.id)) {
    return sendCaptcha(ctx);
  }
  return sendWelcome(ctx, user);
});

function sendWelcome(ctx, user) {
  ctx.reply(
    `Привет, ${ctx.from.first_name || 'друг'}! 👋\n\n` +
      `Это сервис взаимного продвижения. Выполняй задания и получай GRAM, ` +
      `или создавай свои задания, чтобы продвинуть канал.\n\n` +
      `Баланс: ${user.balance} GRAM`,
    mainMenu(ctx)
  );
}

// После успешного прохождения капчи показываем то же приветствие
registerCaptcha(bot, (ctx) => {
  const user = userService.getUser(ctx.from.id);
  if (user) sendWelcome(ctx, user);
});

function guardBanned(ctx, next) {
  const u = userService.getUser(ctx.from.id);
  if (u && u.is_banned) {
    return ctx.reply('🚫 Ваш аккаунт заблокирован.');
  }
  return next();
}

// ---------- Баланс ----------
bot.hears('💰 Баланс', (ctx) =>
  guardBanned(ctx, () => {
    const u = userService.getUser(ctx.from.id);
    ctx.reply(`Ваш баланс: ${u ? u.balance : 0} GRAM`);
  })
);

// ---------- Список заданий ----------
async function sendTaskCard(ctx, task) {
  const typeLabel = task.type === 'subscribe_channel' ? 'Подписаться на канал' : 'Посмотреть пост';
  await ctx.reply(
    `📌 Задание #${task.id}\n${typeLabel}: ${task.target}\n💰 Награда: ${task.reward} GRAM\nОсталось выполнений: ${task.slots_left}`,
    taskInlineKeyboard(task.id)
  );
}

bot.hears('📋 Задания', (ctx) =>
  guardBanned(ctx, async () => {
    const tasks = taskService.listAvailableTasks(ctx.from.id, 5);
    if (tasks.length === 0) {
      return ctx.reply('Сейчас нет доступных заданий. Загляните позже 🙂');
    }
    for (const t of tasks) await sendTaskCard(ctx, t);
  })
);

bot.action(/do_(\d+)/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const task = taskService.getTask(taskId);
  if (!task || task.status !== 'active' || task.slots_left <= 0) {
    return ctx.reply('Это задание уже недоступно.');
  }
  if (taskService.alreadyCompleted(taskId, ctx.from.id)) {
    return ctx.reply('Вы уже выполняли это задание.');
  }

  if (task.type === 'subscribe_channel') {
    try {
      const member = await ctx.telegram.getChatMember(task.target, ctx.from.id);
      const ok = ['member', 'administrator', 'creator'].includes(member.status);
      if (!ok) {
        return ctx.reply(`Похоже, вы ещё не подписались на ${task.target}. Подпишитесь и нажмите «Выполнить» снова.`);
      }
    } catch (e) {
      return ctx.reply(
        'Не удалось проверить подписку. Убедитесь, что канал открыт для бота (бот добавлен администратором) и что username канала указан верно.'
      );
    }
  }
  // для type === 'view_post' автоматической проверки нет — засчитываем по факту нажатия

  const ok = taskService.confirmCompletion(taskId, ctx.from.id);
  if (ok) {
    ctx.reply(`✅ Задание выполнено! Начислено ${task.reward} GRAM.`);
  } else {
    ctx.reply('Не удалось засчитать выполнение (возможно, слоты закончились).');
  }
});

// ---------- Создание задания (пошаговый мастер) ----------
bot.hears('➕ Создать задание', (ctx) =>
  guardBanned(ctx, () => {
    ctx.session.step = 'new_task_type';
    ctx.session.draft = {};
    ctx.reply(
      'Выберите тип задания:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📢 Подписка на канал', 'type_subscribe_channel')],
        [Markup.button.callback('👁 Просмотр поста', 'type_view_post')],
      ])
    );
  })
);

bot.action(/type_(subscribe_channel|view_post)/, (ctx) => {
  ctx.answerCbQuery();
  ctx.session.draft = { type: ctx.match[1] };
  ctx.session.step = 'new_task_target';
  const hint =
    ctx.match[1] === 'subscribe_channel'
      ? 'Пришлите username канала, на который нужно подписаться (в формате @channel). Бот должен быть добавлен туда администратором.'
      : 'Пришлите ссылку на пост, который нужно посмотреть.';
  ctx.reply(hint);
});

bot.on('text', async (ctx, next) => {
  const step = ctx.session.step;
  if (!step) return next();

  if (step === 'new_task_target') {
    ctx.session.draft.target = ctx.message.text.trim();
    ctx.session.step = 'new_task_reward';
    return ctx.reply('Сколько GRAM платить за одно выполнение? (целое число, например 10)');
  }

  if (step === 'new_task_reward') {
    const reward = parseInt(ctx.message.text.trim(), 10);
    if (!Number.isInteger(reward) || reward <= 0) {
      return ctx.reply('Введите положительное целое число.');
    }
    ctx.session.draft.reward = reward;
    ctx.session.step = 'new_task_slots';
    return askSlots(ctx, reward);
  }

  if (step === 'new_task_slots') {
    return handleSlotsInput(ctx, ctx.message.text.trim());
  }

  return next();
});

// Считает, сколько выполнений максимум доступно на текущий баланс, и предлагает кнопки быстрого выбора
function askSlots(ctx, reward) {
  const user = userService.getUser(ctx.from.id);
  const balance = user ? user.balance : 0;
  const maxAffordable = Math.floor(balance / reward);

  const presets = [10, 25, 50, 100].filter((n) => n <= maxAffordable);
  const buttons = presets.map((n) => Markup.button.callback(`${n}`, `slots_${n}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (maxAffordable > 0) rows.push([Markup.button.callback(`Максимум (${maxAffordable})`, `slots_${maxAffordable}`)]);
  rows.push([Markup.button.callback('❌ Отмена', 'cancel_task')]);

  return ctx.reply(
    `Сколько всего выполнений хотите купить? (например 50)\n\n` +
      `💰 Доступно для вашего баланса: ${maxAffordable} шт. (баланс ${balance} GRAM, цена ${reward} GRAM за 1 выполнение)`,
    Markup.inlineKeyboard(rows)
  );
}

function slotsConfirmMessage(ctx, slots) {
  const draft = ctx.session.draft;
  const total = draft.reward * slots;
  const user = userService.getUser(ctx.from.id);

  if (!user || user.balance < total) {
    ctx.session.step = null;
    return ctx.reply(
      `❌ Недостаточно средств. Нужно ${total} GRAM, на балансе ${user ? user.balance : 0} GRAM.\n` +
        `Пополните баланс через «💳 Пополнить».`
    );
  }

  draft.slots = slots;
  ctx.session.step = 'new_task_confirm';
  return ctx.reply(
    `Проверьте задание:\nТип: ${draft.type === 'subscribe_channel' ? 'Подписка' : 'Просмотр поста'}\n` +
      `Цель: ${draft.target}\nНаграда за выполнение: ${draft.reward} GRAM\nКоличество: ${slots}\n` +
      `Итого спишется: ${total} GRAM\n\nПодтвердить?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Создать', 'confirm_task')],
      [Markup.button.callback('❌ Отмена', 'cancel_task')],
    ])
  );
}

function handleSlotsInput(ctx, rawText) {
  const slots = parseInt(rawText, 10);
  if (!Number.isInteger(slots) || slots <= 0) {
    return ctx.reply('Введите положительное целое число.');
  }
  return slotsConfirmMessage(ctx, slots);
}

// Нажатие на кнопку быстрого выбора количества
bot.action(/slots_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.session.step !== 'new_task_slots') return;
  const slots = Number(ctx.match[1]);
  await slotsConfirmMessage(ctx, slots);
});

bot.action('confirm_task', (ctx) => {
  ctx.answerCbQuery();
  const draft = ctx.session.draft;
  if (!draft || !draft.type) {
    ctx.session.step = null;
    return ctx.reply('Сессия создания задания устарела, начните заново.');
  }
  const taskId = taskService.createTask({
    ownerId: ctx.from.id,
    type: draft.type,
    target: draft.target,
    title: draft.target,
    reward: draft.reward,
    slots: draft.slots,
  });
  ctx.session.step = null;
  ctx.session.draft = {};
  ctx.reply(`🎉 Задание #${taskId} создано и уже доступно исполнителям!`);
});

bot.action('cancel_task', (ctx) => {
  ctx.answerCbQuery();
  ctx.session.step = null;
  ctx.session.draft = {};
  ctx.reply('Создание задания отменено.');
});

// ---------- Мои задания ----------
bot.hears('🗂 Мои задания', (ctx) =>
  guardBanned(ctx, () => {
    const tasks = taskService.myTasks(ctx.from.id);
    if (tasks.length === 0) return ctx.reply('У вас пока нет заданий.');
    tasks.forEach((t) => {
      const statusLabel = { active: '🟢 активно', paused: '⏸ на паузе', completed: '✅ завершено' }[t.status] || t.status;
      ctx.reply(
        `#${t.id} ${t.target}\nСтатус: ${statusLabel}\nОсталось: ${t.slots_left}/${t.slots_total}\nНаграда: ${t.reward} GRAM`,
        Markup.inlineKeyboard(
          t.status === 'completed'
            ? []
            : [
                [
                  t.status === 'active'
                    ? Markup.button.callback('⏸ Пауза', `pause_${t.id}`)
                    : Markup.button.callback('▶️ Возобновить', `resume_${t.id}`),
                  Markup.button.callback('🗑 Удалить', `del_${t.id}`),
                ],
              ]
        )
      );
    });
  })
);

bot.action(/pause_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  taskService.pauseTask(Number(ctx.match[1]), ctx.from.id);
  ctx.reply('Задание поставлено на паузу.');
});
bot.action(/resume_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  taskService.resumeTask(Number(ctx.match[1]), ctx.from.id);
  ctx.reply('Задание возобновлено.');
});
bot.action(/del_(\d+)/, (ctx) => {
  ctx.answerCbQuery();
  const ok = taskService.deleteTask(Number(ctx.match[1]), ctx.from.id);
  ctx.reply(ok ? 'Задание удалено, остаток бюджета возвращён на баланс.' : 'Не удалось удалить задание.');
});

// ---------- Рефералы ----------
bot.hears('👥 Рефералы', (ctx) =>
  guardBanned(ctx, () => {
    const u = userService.getUser(ctx.from.id);
    const link = config.BOT_USERNAME
      ? `https://t.me/${config.BOT_USERNAME}?start=ref_${ctx.from.id}`
      : '(укажите BOT_USERNAME в .env, чтобы сформировать ссылку)';
    ctx.reply(
      `👥 Приглашено: ${u.ref_count}\n💰 Бонус за реферала: ${getSetting('referral_bonus')} GRAM\n\nВаша ссылка:\n${link}`
    );
  })
);

// ---------- Пополнение через Telegram Stars ----------
bot.hears('💳 Пополнить', (ctx) =>
  guardBanned(ctx, () => {
    ctx.reply(
      'Выберите пакет пополнения (оплата в Telegram Stars ⭐):',
      Markup.inlineKeyboard(
        getPackages().map((p) => [Markup.button.callback(`${p.stars} ⭐ → ${p.gram} GRAM`, `buy_${p.stars}`)])
      )
    );
  })
);

bot.action(/buy_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const stars = Number(ctx.match[1]);
  const pkg = getPackages().find((p) => p.stars === stars);
  if (!pkg) return;

  await ctx.replyWithInvoice({
    title: `${pkg.gram} GRAM`,
    description: `Пополнение баланса на ${pkg.gram} GRAM`,
    payload: `topup_${pkg.stars}_${pkg.gram}`,
    provider_token: '', // для Telegram Stars provider_token оставляем пустым
    currency: 'XTR',
    prices: [{ label: `${pkg.gram} GRAM`, amount: pkg.stars }],
  });
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', (ctx) => {
  const payment = ctx.message.successful_payment;
  const [, starsStr, gramStr] = payment.invoice_payload.split('_');
  const gram = Number(gramStr);
  userService.addBalance(ctx.from.id, gram, 'topup_stars', `Оплата ${payment.total_amount} XTR`);
  ctx.reply(`✅ Оплата получена! Начислено ${gram} GRAM.`);
});

// ---------- Запуск ----------
bot.launch().then(() => console.log('Бот запущен'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
