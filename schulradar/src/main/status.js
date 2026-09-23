'use strict';
// Status-Logik für den Hauptprozess (Erinnerungen). Die Oberfläche hat dieselbe Logik in renderer/logic.js.
const { startOfDay } = require('./util/dates');

const DONE_STATES = new Set(['submitted', 'graded', 'done']);

function isAppointment(item) {
  return item.type === 'exam' || item.type === 'event' || (item.source === 'own' && (item.kind === 'test' || item.kind === 'termin'));
}

function isExamLike(item) {
  return item.type === 'exam' || (item.source === 'own' && item.kind === 'test');
}

function effectiveStatus(item, local = {}, now = Date.now()) {
  if (local.done && local.done[item.id]) return 'done';
  if (DONE_STATES.has(item.status)) return item.status;
  const due = item.due;
  if (isAppointment(item)) {
    if (!due) return 'upcoming';
    const end = item.end || due;
    const past = item.allDay ? startOfDay(due) < startOfDay(now) : end < now;
    return past ? 'past' : 'upcoming';
  }
  if (due) {
    const overdue = item.allDay ? startOfDay(due) < startOfDay(now) : due < now;
    if (overdue) return 'overdue';
  }
  return 'open';
}

function isActive(item, local, now) {
  if (local.dismissed && local.dismissed[item.id]) return false;
  const st = effectiveStatus(item, local, now);
  return st === 'open' || st === 'upcoming' || st === 'overdue';
}

module.exports = { DONE_STATES, isAppointment, isExamLike, effectiveStatus, isActive };
