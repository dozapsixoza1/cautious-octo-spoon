const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('../src/db');
const config = require('../src/config');
const { requireAuth } = require('./middleware/auth');
const { addBalance } = require('../src/services/userService');

const app = express();
app.use(express.json());
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 часов
  })
);

app.use(express.static(path.join(__dirname, 'public')));
app.use(requireAuth);

// ---------- Аутентификация ----------
app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {};
  if (login === config.ADMIN_LOGIN && password === config.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- Дашборд ----------
app.get('/api/stats', (req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const activeTasksCount = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='active'").get().c;
  const totalGramInCirculation = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users').get().s;
  const totalStarsRevenue = db
    .prepare("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE type='task_payment'")
    .get().s; // GRAM потраченный на задания, для справки
  const starsIncome = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(substr(meta, 8, instr(meta,' XTR')-8) AS INTEGER)),0) s FROM transactions WHERE type='topup_stars'"
    )
    .get().s;
  res.json({ usersCount, activeTasksCount, totalGramInCirculation, totalStarsRevenue, starsIncome });
});

app.get('/api/ledger', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.username, u.first_name FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.id DESC LIMIT 30`
    )
    .all();
  res.json(rows);
});

// ---------- Пользователи ----------
app.get('/api/users', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db
      .prepare(
        `SELECT * FROM users WHERE CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ?
         ORDER BY created_at DESC LIMIT 100`
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 100').all();
  }
  res.json(rows);
});

app.post('/api/users/:id/ban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/users/:id/unban', (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/users/:id/adjust', (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  const reason = (req.body.reason || 'Ручная корректировка').toString();
  if (!Number.isInteger(amount) || amount === 0) {
    return res.status(400).json({ error: 'amount должен быть ненулевым целым числом' });
  }
  addBalance(Number(req.params.id), amount, 'admin_adjust', reason);
  res.json({ ok: true });
});

// ---------- Задания ----------
app.get('/api/tasks', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.username, u.first_name FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.status != 'deleted' ORDER BY t.created_at DESC LIMIT 100`
    )
    .all();
  res.json(rows);
});

app.post('/api/tasks/:id/pause', (req, res) => {
  db.prepare("UPDATE tasks SET status='paused' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/resume', (req, res) => {
  db.prepare("UPDATE tasks SET status='active' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/delete', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (task && task.slots_left > 0) {
    addBalance(task.owner_id, task.reward * task.slots_left, 'task_refund', `Задание #${task.id} удалено администратором`);
  }
  db.prepare("UPDATE tasks SET status='deleted' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Настройки ----------
app.get('/api/settings', (req, res) => {
  res.json({
    starsToGramRate: config.STARS_TO_GRAM_RATE,
    referralBonus: config.REFERRAL_BONUS,
  });
});

app.listen(config.ADMIN_PORT, () => {
  console.log(`Админ-панель запущена: http://localhost:${config.ADMIN_PORT}`);
});
