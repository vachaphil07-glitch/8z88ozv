'use strict';
// Daten für das Android-Widget: offene Aufgaben und kommende Tests mit Datum.
// Was davon „heute“ ist, rechnet das Widget selbst aus (stimmt so auch am nächsten Morgen).
const { isActive, isExamLike, isAppointment } = require('./status');

const DAY = 24 * 3600 * 1000;

function widgetData({ items = [], local = {}, now = Date.now() }) {
  const tasks = [];
  const exams = [];
  for (const it of items) {
    if (!it.due || !isActive(it, local, now)) continue;
    if (it.due > now + 21 * DAY) continue;
    const row = { t: String(it.title || '').slice(0, 80), s: String(it.subject || it.course || '').slice(0, 30), d: it.due, a: Boolean(it.allDay) };
    if (isExamLike(it)) exams.push(row);
    else if (!isAppointment(it)) tasks.push(row);
  }
  tasks.sort((a, b) => a.d - b.d);
  exams.sort((a, b) => a.d - b.d);
  return { tasks: tasks.slice(0, 40), exams: exams.slice(0, 10), at: now };
}

module.exports = { widgetData };
