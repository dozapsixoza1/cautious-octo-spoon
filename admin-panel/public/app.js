const state = { view: 'dashboard' };

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Ошибка запроса');
  }
  return res.json();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadView(state.view);
  loadTicker();
}

// ---------- Логин ----------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = document.getElementById('login').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await api('/login', { method: 'POST', body: JSON.stringify({ login, password }) });
    showApp();
  } catch (err) {
    errEl.textContent = 'Неверный логин или пароль';
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  showLogin();
});

// ---------- Навигация ----------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    loadView(view);
  });
});

function loadView(view) {
  if (view === 'dashboard') loadDashboard();
  if (view === 'users') loadUsers();
  if (view === 'tasks') loadTasks();
  if (view === 'ledger') loadLedger();
}

// ---------- Дашборд ----------
async function loadDashboard() {
  const s = await api('/stats');
  document.getElementById('stat-users').textContent = s.usersCount;
  document.getElementById('stat-tasks').textContent = s.activeTasksCount;
  document.getElementById('stat-gram').textContent = s.totalGramInCirculation.toLocaleString('ru-RU');
  document.getElementById('stat-stars').textContent = `${s.starsIncome.toLocaleString('ru-RU')} ⭐`;
}

// ---------- Тикер ----------
async function loadTicker() {
  try {
    const rows = await api('/ledger');
    const ticker = document.getElementById('ticker');
    if (rows.length === 0) {
      ticker.textContent = 'Операций пока нет…';
      return;
    }
    ticker.innerHTML = rows
      .map((r) => {
        const cls = r.amount >= 0 ? 'pos' : 'neg';
        const sign = r.amount >= 0 ? '+' : '';
        const name = r.username ? '@' + r.username : r.first_name || `id${r.user_id}`;
        return `<span>${name} <span class="${cls}">${sign}${r.amount} GRAM</span> · ${typeLabel(r.type)}</span>`;
      })
      .join('');
  } catch (e) {
    /* тихо игнорируем, если не авторизованы */
  }
}
setInterval(() => {
  if (!document.getElementById('app').classList.contains('hidden')) loadTicker();
}, 20000);

function typeLabel(type) {
  return (
    {
      topup_stars: 'пополнение Stars',
      task_reward: 'награда за задание',
      task_payment: 'оплата задания',
      task_refund: 'возврат бюджета',
      referral_bonus: 'реферальный бонус',
      admin_adjust: 'корректировка админом',
    }[type] || type
  );
}

// ---------- Пользователи ----------
async function loadUsers(q = '') {
  const rows = await api(`/users${q ? '?q=' + encodeURIComponent(q) : ''}`);
  const body = document.getElementById('users-body');
  body.innerHTML = rows
    .map(
      (u) => `
    <tr>
      <td class="mono">${u.id}</td>
      <td>${u.username ? '@' + escapeHtml(u.username) : escapeHtml(u.first_name || '—')}</td>
      <td class="mono">${u.balance}</td>
      <td class="mono">${u.ref_count}</td>
      <td>${u.is_banned ? '<span class="pill banned">забанен</span>' : '<span class="pill active">активен</span>'}</td>
      <td>
        <button class="row-btn" onclick="adjustBalance(${u.id})">+/- баланс</button>
        ${
          u.is_banned
            ? `<button class="row-btn" onclick="unbanUser(${u.id})">Разбанить</button>`
            : `<button class="row-btn danger" onclick="banUser(${u.id})">Забанить</button>`
        }
      </td>
    </tr>`
    )
    .join('');
}

document.getElementById('user-search').addEventListener('input', (e) => {
  loadUsers(e.target.value.trim());
});

async function banUser(id) {
  await api(`/users/${id}/ban`, { method: 'POST' });
  loadUsers(document.getElementById('user-search').value.trim());
}
async function unbanUser(id) {
  await api(`/users/${id}/unban`, { method: 'POST' });
  loadUsers(document.getElementById('user-search').value.trim());
}
async function adjustBalance(id) {
  const amount = prompt('На сколько изменить баланс? (можно отрицательное число)');
  if (amount === null) return;
  const reason = prompt('Причина (необязательно):', 'Ручная корректировка') || 'Ручная корректировка';
  try {
    await api(`/users/${id}/adjust`, { method: 'POST', body: JSON.stringify({ amount: Number(amount), reason }) });
    loadUsers(document.getElementById('user-search').value.trim());
  } catch (e) {
    alert(e.message);
  }
}

// ---------- Задания ----------
async function loadTasks() {
  const rows = await api('/tasks');
  const body = document.getElementById('tasks-body');
  const typeLabels = { subscribe_channel: 'Подписка', view_post: 'Просмотр поста' };
  const statusLabels = { active: '<span class="pill active">активно</span>', paused: '<span class="pill paused">пауза</span>', completed: '<span class="pill ok">завершено</span>' };
  body.innerHTML = rows
    .map(
      (t) => `
    <tr>
      <td class="mono">#${t.id}</td>
      <td>${t.username ? '@' + escapeHtml(t.username) : escapeHtml(t.first_name || t.owner_id)}</td>
      <td>${typeLabels[t.type] || t.type}</td>
      <td>${escapeHtml(t.target)}</td>
      <td class="mono">${t.reward}</td>
      <td class="mono">${t.slots_left}/${t.slots_total}</td>
      <td>${statusLabels[t.status] || t.status}</td>
      <td>
        ${
          t.status === 'active'
            ? `<button class="row-btn" onclick="taskAction(${t.id},'pause')">Пауза</button>`
            : t.status === 'paused'
            ? `<button class="row-btn" onclick="taskAction(${t.id},'resume')">Возобновить</button>`
            : ''
        }
        ${t.status !== 'completed' ? `<button class="row-btn danger" onclick="taskAction(${t.id},'delete')">Удалить</button>` : ''}
      </td>
    </tr>`
    )
    .join('');
}

async function taskAction(id, action) {
  await api(`/tasks/${id}/${action}`, { method: 'POST' });
  loadTasks();
}

// ---------- Леджер ----------
async function loadLedger() {
  const rows = await api('/ledger');
  const body = document.getElementById('ledger-body');
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td class="mono">${r.id}</td>
      <td>${r.username ? '@' + escapeHtml(r.username) : escapeHtml(r.first_name || r.user_id)}</td>
      <td>${typeLabel(r.type)}</td>
      <td class="mono">${r.amount >= 0 ? '+' : ''}${r.amount}</td>
      <td>${escapeHtml(r.meta || '')}</td>
      <td class="mono">${r.created_at}</td>
    </tr>`
    )
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Проверка сессии при загрузке ----------
(async function init() {
  try {
    await api('/stats');
    showApp();
  } catch (e) {
    showLogin();
  }
})();
