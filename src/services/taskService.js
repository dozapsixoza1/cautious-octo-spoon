const db = require('../db');
const { addBalance } = require('./userService');

function createTask({ ownerId, type, target, title, reward, slots }) {
  const totalCost = reward * slots;
  const info = db
    .prepare(
      `INSERT INTO tasks (owner_id, type, target, title, reward, slots_total, slots_left, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .run(ownerId, type, target, title || target, reward, slots, slots);

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalCost, ownerId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)')
    .run(ownerId, 'task_payment', -totalCost, `Создано задание #${info.lastInsertRowid}`);

  return info.lastInsertRowid;
}

// Список активных заданий, доступных пользователю (не свои, ещё не выполненные им)
function listAvailableTasks(userId, limit = 5) {
  return db
    .prepare(
      `SELECT t.* FROM tasks t
       WHERE t.status = 'active' AND t.slots_left > 0 AND t.owner_id != ?
       AND NOT EXISTS (SELECT 1 FROM completions c WHERE c.task_id = t.id AND c.user_id = ?)
       ORDER BY t.created_at DESC
       LIMIT ?`
    )
    .all(userId, userId, limit);
}

function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function alreadyCompleted(taskId, userId) {
  return !!db
    .prepare('SELECT 1 FROM completions WHERE task_id = ? AND user_id = ?')
    .get(taskId, userId);
}

// Засчитать выполнение: начислить награду исполнителю, списать слот у задания
function confirmCompletion(taskId, userId) {
  const task = getTask(taskId);
  if (!task || task.status !== 'active' || task.slots_left <= 0) return false;
  if (alreadyCompleted(taskId, userId)) return false;

  db.prepare('INSERT INTO completions (task_id, user_id, status) VALUES (?, ?, ?)').run(
    taskId,
    userId,
    'confirmed'
  );

  db.prepare('UPDATE tasks SET slots_left = slots_left - 1 WHERE id = ?').run(taskId);
  const updated = getTask(taskId);
  if (updated.slots_left <= 0) {
    db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(taskId);
  }

  addBalance(userId, task.reward, 'task_reward', `Выполнено задание #${taskId}`);
  return true;
}

function myTasks(ownerId) {
  return db
    .prepare("SELECT * FROM tasks WHERE owner_id = ? AND status != 'deleted' ORDER BY created_at DESC")
    .all(ownerId);
}

function pauseTask(taskId, ownerId) {
  return db
    .prepare("UPDATE tasks SET status = 'paused' WHERE id = ? AND owner_id = ? AND status = 'active'")
    .run(taskId, ownerId).changes;
}

function resumeTask(taskId, ownerId) {
  return db
    .prepare("UPDATE tasks SET status = 'active' WHERE id = ? AND owner_id = ? AND status = 'paused'")
    .run(taskId, ownerId).changes;
}

// Удалить задание и вернуть остаток бюджета владельцу
function deleteTask(taskId, ownerId) {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND owner_id = ? AND status IN ('active','paused')")
    .get(taskId, ownerId);
  if (!task) return false;

  const refund = task.reward * task.slots_left;
  db.prepare("UPDATE tasks SET status = 'deleted' WHERE id = ?").run(taskId);
  if (refund > 0) {
    addBalance(ownerId, refund, 'task_refund', `Удалено задание #${taskId}, возврат остатка`);
  }
  return true;
}

// ---------- Админские функции (без проверки владельца) ----------
function listAllTasks(offset = 0, limit = 5) {
  return db
    .prepare(
      `SELECT t.*, u.username, u.first_name FROM tasks t
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.status != 'deleted'
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
}

function countAllTasks() {
  return db.prepare("SELECT COUNT(*) c FROM tasks WHERE status != 'deleted'").get().c;
}

function adminPauseTask(taskId) {
  return db.prepare("UPDATE tasks SET status = 'paused' WHERE id = ? AND status = 'active'").run(taskId).changes;
}

function adminResumeTask(taskId) {
  return db.prepare("UPDATE tasks SET status = 'active' WHERE id = ? AND status = 'paused'").run(taskId).changes;
}

function adminDeleteTask(taskId) {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND status IN ('active','paused')")
    .get(taskId);
  if (!task) return false;
  const refund = task.reward * task.slots_left;
  db.prepare("UPDATE tasks SET status = 'deleted' WHERE id = ?").run(taskId);
  if (refund > 0) {
    addBalance(task.owner_id, refund, 'task_refund', `Задание #${taskId} удалено администратором`);
  }
  return true;
}

module.exports = {
  createTask,
  listAvailableTasks,
  getTask,
  alreadyCompleted,
  confirmCompletion,
  myTasks,
  pauseTask,
  resumeTask,
  deleteTask,
  listAllTasks,
  countAllTasks,
  adminPauseTask,
  adminResumeTask,
  adminDeleteTask,
};
