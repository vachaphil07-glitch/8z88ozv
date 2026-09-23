'use strict';
// Erinnerungen als Windows-Benachrichtigung.
const { startOfDay, toIsoDate, DAY } = require('./util/dates');
const { isActive, isExamLike, isAppointment } = require('./status');

const HOUR = 3600 * 1000;
const GRACE = 6 * HOUR; // war der PC aus, wird eine verpasste Erinnerung bis zu 6 h später nachgeholt

const SOURCE_NAMES = { webuntis: 'WebUntis', teams: 'Teams', letto: 'Letto', eduvidual: 'Eduvidual', lms: 'LMS.at', own: 'Eigene' };

function parseTime(hhmm, fallback) {
  const m = String(hhmm || fallback).match(/^(\d{1,2}):(\d{2})$/);
  return m ? [Number(m[1]), Number(m[2])] : parseTime(fallback, '18:00');
}

function timeText(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function leadText(hours) {
  if (hours >= 48 && hours % 24 === 0) return `in ${hours / 24} Tagen`;
  if (hours === 24) return 'morgen um diese Zeit';
  if (hours === 1) return 'in 1 Stunde';
  return `in ${hours} Stunden`;
}

function describe(item) {
  const bits = [item.subject || item.course, SOURCE_NAMES[item.source]].filter(Boolean);
  return `${item.title}${bits.length ? ` (${bits.join(' · ')})` : ''}`;
}

/** Alle Erinnerungszeitpunkte für offene Einträge (reine Funktion, testbar). */
function reminderTriggers({ items, local, settings, now = Date.now() }) {
  const r = settings.reminders || {};
  if (!r.enabled) return [];
  const out = [];
  for (const it of items) {
    if (!it.due || it.due <= now || !isActive(it, local, now)) continue;
    const triggers = [];
    if ((it.allDay || isAppointment(it)) && r.eveningBefore) {
      const [hh, mm] = parseTime(r.eveningTime, '18:00');
      const d = new Date(startOfDay(it.due) - DAY);
      d.setHours(hh, mm, 0, 0);
      triggers.push({ at: d.getTime(), kind: 'vorabend' });
    }
    if (!it.allDay && !isAppointment(it)) {
      for (const h of r.leadHours || []) triggers.push({ at: it.due - h * HOUR, kind: `${h}h`, hours: h });
    }
    for (const tr of triggers) {
      let title;
      if (tr.kind === 'vorabend') {
        title = isExamLike(it)
          ? `Morgen: ${it.examType || 'Test'}${it.allDay ? '' : ` um ${timeText(it.due)}`}`
          : isAppointment(it)
            ? 'Morgen: Termin'
            : 'Morgen fällig';
      } else {
        title = `Fällig ${leadText(tr.hours)} (${timeText(it.due)})`;
      }
      out.push({ key: `${it.id}|${tr.kind}|${it.due}`, at: tr.at, itemId: it.id, title, body: describe(it) + (it.room ? ` · ${it.room}` : '') });
    }
  }
  return out;
}

/** Welche Erinnerungen sind jetzt fällig? (PC: wird jede Minute geprüft) */
function dueReminders({ items, local, settings, fired, now = Date.now() }) {
  return reminderTriggers({ items, local, settings, now }).filter((t) => !fired[t.key] && now >= t.at && now - t.at <= GRACE);
}

/** Künftige Erinnerungen zum Vorausplanen (Handy: Android stellt sie auch bei geschlossener App zu). */
function plannedReminders({ items, local, settings, fired = {}, now = Date.now(), horizonDays = 21 }) {
  const until = now + horizonDays * DAY;
  return reminderTriggers({ items, local, settings, now })
    .filter((t) => !fired[t.key] && t.at > now && t.at <= until)
    .sort((a, b) => a.at - b.at);
}

/** Morgendliche Übersicht (einmal pro Tag). */
function dailySummary({ items, local, settings, lastSummary, now = Date.now() }) {
  const r = settings.reminders || {};
  if (!r.enabled || !r.dailySummary) return null;
  const today = toIsoDate(now);
  if (lastSummary === today) return null;
  const [hh, mm] = parseTime(r.summaryTime, '07:00');
  const at = new Date(startOfDay(now));
  at.setHours(hh, mm, 0, 0);
  if (now < at.getTime() || now - at.getTime() > GRACE) return null;

  const tomorrow = startOfDay(now) + DAY;
  let dueToday = 0;
  let examsToday = 0;
  let overdue = 0;
  for (const it of items) {
    if (!isActive(it, local, now) || !it.due) continue;
    const today0 = startOfDay(now);
    if (it.due >= today0 && it.due < tomorrow) {
      if (isExamLike(it)) examsToday++;
      else if (!isAppointment(it)) dueToday++;
    } else if (!isAppointment(it) && (it.allDay ? startOfDay(it.due) < today0 : it.due < now)) {
      overdue++;
    }
  }
  if (!dueToday && !examsToday && !overdue) return { date: today, silent: true };
  const parts = [];
  if (dueToday) parts.push(`${dueToday} ${dueToday === 1 ? 'Abgabe' : 'Abgaben'} heute`);
  if (examsToday) parts.push(`${examsToday} ${examsToday === 1 ? 'Test' : 'Tests'} heute`);
  if (overdue) parts.push(`${overdue} überfällig`);
  return { date: today, title: 'Guten Morgen! Dein Überblick', body: parts.join(' · ') };
}

class ReminderService {
  constructor({ store, getItems, notify }) {
    this.store = store;
    this.getItems = getItems;
    this.notify = notify;
    this.timer = null;
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 60 * 1000);
    setTimeout(() => this.tick(), 15 * 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  tick(now = Date.now()) {
    const data = this.store.data;
    const settings = data.settings;
    const items = this.getItems();
    const reminders = dueReminders({ items, local: data.local, settings, fired: data.reminders.fired, now });
    for (const r of reminders) data.reminders.fired[r.key] = now;
    if (reminders.length > 3) {
      this.notify({
        title: `${reminders.length} Erinnerungen`,
        body: reminders.slice(0, 4).map((r) => `• ${r.body}`).join('\n') + (reminders.length > 4 ? '\n…' : '')
      });
    } else {
      for (const r of reminders) this.notify(r);
    }
    const summary = dailySummary({ items, local: data.local, settings, lastSummary: data.reminders.lastSummary, now });
    if (summary) {
      data.reminders.lastSummary = summary.date;
      if (!summary.silent) this.notify(summary);
    }
    if (reminders.length || summary) this.store.save();
  }
}

module.exports = { ReminderService, dueReminders, plannedReminders, reminderTriggers, dailySummary };
