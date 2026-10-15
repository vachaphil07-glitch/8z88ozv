'use strict';
// Lernplaner und Wochenrückblick (reine Funktionen, testbar).
//
// Lernplaner: Vor jedem Test / jeder Schularbeit schlägt Schulradar Lerneinheiten in freien Zeiten vor –
// verteilt auf die Tage davor (öfter wiederholen hilft mehr als einmal lang lernen). Belegt sind:
// Unterricht laut WebUntis-Stundenplan, Termine (z. B. aus Google Kalender), eigene Termine und schon
// geplante Lerneinheiten.
const { isExamLike, isActive, isAppointment, effectiveStatus } = require('./status');
const { startOfDay, addDays } = require('./util/dates');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const DEFAULTS = {
  horizonDays: 14, // für Tests in den nächsten 14 Tagen planen
  sessionMin: 45,
  sessionsPerExam: 3,
  sessionsPerSchularbeit: 4,
  spreadDays: 7, // frühestens so viele Tage vor dem Test beginnen
  weekdayFrom: '15:00',
  weekdayTo: '20:00',
  weekendFrom: '10:00',
  weekendTo: '18:00',
  bufferMin: 15 // Pause nach Unterricht und Terminen
};

function parseTime(text, fallback) {
  const m = String(text || fallback).match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : parseTime(fallback, '00:00');
}

function isSchularbeit(item) {
  return /schularbeit|\bsa\b|klausur/i.test(`${item.examType || ''} ${item.title || ''}`);
}

/** Belegte Zeiten [{start, end}] aus Stundenplan, Terminen und eigenen Einträgen */
function busyTimes({ items = [], lessons = [], local = {}, now }) {
  const busy = [];
  for (const l of lessons) if (l.start && l.end && !l.cancelled) busy.push({ start: l.start, end: l.end, lesson: true });
  for (const it of items) {
    if (!it.due || it.allDay) continue;
    if (local.dismissed && local.dismissed[it.id]) continue;
    if (it.source === 'own' && it.kind === 'lernen') {
      busy.push({ start: it.due, end: it.end || it.due + DEFAULTS.sessionMin * MIN });
    } else if (isAppointment(it) && it.end) {
      busy.push({ start: it.due, end: it.end });
    } else if (isAppointment(it)) {
      busy.push({ start: it.due, end: it.due + 60 * MIN });
    }
  }
  return busy.filter((b) => b.end > now - DAY).sort((a, b) => a.start - b.start);
}

/** Erste freie Zeit an einem Tag, oder null */
function freeSlot(day, busy, opts, now) {
  const weekend = [0, 6].includes(new Date(day).getDay());
  const from = day + parseTime(weekend ? opts.weekendFrom : opts.weekdayFrom, '15:00') * MIN;
  const to = day + parseTime(weekend ? opts.weekendTo : opts.weekdayTo, '20:00') * MIN;
  const len = opts.sessionMin * MIN;
  const buffer = opts.bufferMin * MIN;
  const round = (ms) => Math.ceil(ms / (15 * MIN)) * 15 * MIN;
  let t = round(Math.max(from, now + 15 * MIN));
  const sameDay = busy.filter((b) => b.end > day && b.start < day + DAY);
  // nach dem letzten Unterricht des Tages beginnen
  const lastLesson = Math.max(0, ...sameDay.filter((b) => b.lesson).map((b) => b.end));
  if (lastLesson) t = Math.max(t, round(lastLesson + buffer));
  for (let guard = 0; guard < 50 && t + len <= to; guard++) {
    const clash = sameDay.find((b) => b.start < t + len + buffer && b.end + buffer > t);
    if (!clash) return { start: t, end: t + len };
    t = round(clash.end + buffer);
  }
  return null;
}

/** Tage gleichmäßig auswählen, vom Test aus rückwärts (der Tag davor ist immer dabei) */
function pickDays(days, n) {
  if (n <= 0 || !days.length) return [];
  if (days.length <= n) return [...days];
  const out = [];
  const step = days.length / n;
  for (let i = 0; i < n; i++) out.push(days[days.length - 1 - Math.floor(i * step)]);
  return out.sort((a, b) => a - b);
}

/**
 * Vorschläge: [{examId, examTitle, subject, start, end}] und Übersicht pro Test.
 * items: alle Einträge inkl. eigener (source 'own'), lessons: Stundenplan-Einheiten.
 */
function planStudy({ items = [], lessons = [], local = {}, settings = {}, now = Date.now() }) {
  const opts = { ...DEFAULTS, ...(settings || {}) };
  const busy = busyTimes({ items, lessons, local, now });
  const horizon = now + opts.horizonDays * DAY;
  const exams = items
    .filter((it) => isExamLike(it) && it.due && it.due > now && it.due <= horizon && isActive(it, local, now))
    .sort((a, b) => a.due - b.due);
  const plans = [];
  const suggestions = [];
  for (const exam of exams) {
    const planned = items.filter((it) => it.source === 'own' && it.kind === 'lernen' && it.examId === exam.id);
    const done = planned.filter((it) => effectiveStatus(it, local, now) === 'done').length;
    const wanted = isSchularbeit(exam) ? opts.sessionsPerSchularbeit : opts.sessionsPerExam;
    const missing = Math.max(0, wanted - planned.length);
    const examDay = startOfDay(exam.due);
    const days = [];
    for (let d = Math.max(startOfDay(now), addDays(examDay, -opts.spreadDays)); d < examDay; d = addDays(d, 1)) {
      if (planned.some((p) => startOfDay(p.due) === d)) continue; // an diesem Tag ist schon gelernt/geplant
      days.push(d);
    }
    const own = [];
    // erst die gewünschten Tage versuchen, dann auf andere freie Tage ausweichen
    const order = [...pickDays(days, missing), ...days.filter((d) => !pickDays(days, missing).includes(d)).reverse()];
    for (const day of order) {
      if (own.length >= missing) break;
      const slot = freeSlot(day, busy, opts, now);
      if (!slot) continue;
      const s = { examId: exam.id, examTitle: exam.title, subject: exam.subject || exam.course || '', start: slot.start, end: slot.end };
      own.push(s);
      busy.push({ start: slot.start, end: slot.end });
    }
    own.sort((a, b) => a.start - b.start);
    suggestions.push(...own);
    plans.push({ exam, wanted, planned: planned.length, done, suggestions: own, tooLate: missing > own.length });
  }
  return { plans, suggestions };
}

// ---------------------------------------------------------------- Wochenrückblick

function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Rückblick auf die laufende Woche (Mo–So) und Ausblick auf die nächste */
function weeklyReview({ items = [], local = {}, focusSessions = [], now = Date.now() }) {
  const weekStart = startOfWeek(now);
  const nextStart = addDays(weekStart, 7);
  const nextEnd = addDays(weekStart, 14);
  let doneCount = 0;
  for (const ts of Object.values(local.done || {})) if (ts >= weekStart && ts < nextStart) doneCount++;
  for (const it of items) {
    if (it.completedAt && it.completedAt >= weekStart && it.completedAt < nextStart && !(local.done || {})[it.id]) doneCount++;
  }
  let overdue = 0;
  let nextTasks = 0;
  const nextExams = [];
  for (const it of items) {
    if (!isActive(it, local, now)) continue;
    const st = effectiveStatus(it, local, now);
    if (st === 'overdue') overdue++;
    if (!it.due || it.due < nextStart || it.due >= nextEnd) continue;
    if (isExamLike(it)) nextExams.push({ id: it.id, title: it.title, subject: it.subject || '', due: it.due });
    else if (!isAppointment(it)) nextTasks++;
  }
  nextExams.sort((a, b) => a.due - b.due);
  const byLabel = {};
  let focusMin = 0;
  for (const s of focusSessions) {
    if (s.start < weekStart || s.start >= nextStart) continue;
    focusMin += Number(s.minutes) || 0;
    const key = s.label || 'Ohne Thema';
    byLabel[key] = (byLabel[key] || 0) + (Number(s.minutes) || 0);
  }
  const top = Object.entries(byLabel).sort((a, b) => b[1] - a[1])[0];
  return { weekStart, doneCount, overdue, nextTasks, nextExams, focusMin, topLabel: top ? top[0] : '', topMin: top ? top[1] : 0 };
}

function reviewText(r) {
  const parts = [];
  parts.push(`${r.doneCount} erledigt`);
  if (r.focusMin) parts.push(`${Math.round((r.focusMin / 60) * 10) / 10} h Fokus`.replace('.', ','));
  if (r.overdue) parts.push(`${r.overdue} überfällig`);
  const next = [];
  if (r.nextTasks) next.push(`${r.nextTasks} ${r.nextTasks === 1 ? 'Abgabe' : 'Abgaben'}`);
  if (r.nextExams.length) next.push(`${r.nextExams.length} ${r.nextExams.length === 1 ? 'Test' : 'Tests'} (${r.nextExams.slice(0, 3).map((e) => e.subject || e.title).join(', ')})`);
  return `Diese Woche: ${parts.join(' · ')}. Nächste Woche: ${next.length ? next.join(', ') : 'nichts Fälliges'}.`;
}

module.exports = { planStudy, busyTimes, freeSlot, pickDays, weeklyReview, reviewText, DEFAULTS, startOfWeek };
