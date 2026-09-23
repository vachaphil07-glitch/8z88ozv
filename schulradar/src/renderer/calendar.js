// Termine in einen Kalender übernehmen: Google, Outlook, Yahoo oder als .ics-Datei.
// Reine Funktionen ohne DOM – werden auch mit node:test getestet.
import { SOURCE_META, DAY, startOfDay, addDays, fmtTime, typeLabel, displayTitle, isAppointment, isExamLike, effectiveStatus, isFinished } from './logic.js';

const MIN = 60 * 1000;
const p2 = (n) => String(n).padStart(2, '0');

/** Kalendereintrag aus einem Schulradar-Eintrag (null, wenn es kein Datum gibt). */
export function calendarEvent(item) {
  if (!item || !item.due) return null;
  const appointment = isAppointment(item);
  const meta = SOURCE_META[item.source] || SOURCE_META.own;
  const where = item.subject || item.course || '';
  let title = displayTitle(item);
  if (!appointment) title = `${typeLabel(item)}: ${title}`;
  if (where && !title.toLowerCase().includes(where.toLowerCase())) title += ` (${where})`;

  const allDay = Boolean(item.allDay);
  let start;
  let end;
  if (allDay) {
    start = startOfDay(item.due);
    end = addDays(start, 1);
  } else if (appointment) {
    start = item.due;
    end = item.end && item.end > item.due ? item.end : item.due + (isExamLike(item) ? 50 : 60) * MIN;
  } else {
    // Abgabe: kurzer Block, der zur Abgabezeit endet
    end = item.due;
    start = item.due - 30 * MIN;
  }

  const lines = [`${typeLabel(item)} · ${meta.name}${where ? ` · ${where}` : ''}`];
  if (!appointment && !allDay) lines.push(`Abgabe bis ${fmtTime(item.due)} Uhr`);
  if (item.teacher) lines.push(`Lehrkraft: ${item.teacher}`);
  if (item.description && item.description.trim() !== String(item.title || '').trim()) lines.push('', String(item.description).trim().slice(0, 1500));
  if (item.url) lines.push('', item.url);
  lines.push('', 'Eingetragen mit Schulradar');

  return {
    uid: `${String(item.id).replace(/[^A-Za-z0-9._:-]/g, '_')}@schulradar`,
    title,
    start,
    end,
    allDay,
    description: lines.join('\n'),
    location: item.room || '',
    // bei Tests & Schularbeiten am Vorabend erinnern (18:00)
    alarm: isExamLike(item) ? startOfDay(start) - DAY + 18 * 60 * MIN : null
  };
}

/** Alle kommenden Termine (Tests, Schularbeiten …) – auf Wunsch auch offene Abgaben. */
export function upcomingEvents(items, local = {}, now = Date.now(), { withTasks = false } = {}) {
  return items
    .filter((it) => it.due && !(local.dismissed && local.dismissed[it.id]))
    .filter((it) => (isAppointment(it) ? true : withTasks))
    .filter((it) => {
      const st = effectiveStatus(it, local, now);
      return !isFinished(st) && st !== 'past' && st !== 'overdue';
    })
    .sort((a, b) => a.due - b.due)
    .map(calendarEvent)
    .filter(Boolean);
}

// ---------------------------------------------------------------- Formate

function utc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
}

function localDate(ms, sep = '') {
  const d = new Date(ms);
  return [d.getFullYear(), p2(d.getMonth() + 1), p2(d.getDate())].join(sep);
}

const q = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

export function googleUrl(ev) {
  const dates = ev.allDay ? `${localDate(ev.start)}/${localDate(ev.end)}` : `${utc(ev.start)}/${utc(ev.end)}`;
  return `https://calendar.google.com/calendar/render?${q({ action: 'TEMPLATE', text: ev.title, dates, details: ev.description, location: ev.location })}`;
}

/** Outlook: office = Schul-/Arbeitskonto (Microsoft 365), sonst Outlook.com */
export function outlookUrl(ev, { office = true } = {}) {
  const base = office ? 'https://outlook.office.com/calendar/deeplink/compose' : 'https://outlook.live.com/calendar/0/deeplink/compose';
  const startdt = ev.allDay ? localDate(ev.start, '-') : new Date(ev.start).toISOString();
  const enddt = ev.allDay ? localDate(ev.end, '-') : new Date(ev.end).toISOString();
  return `${base}?${q({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: ev.title,
    startdt,
    enddt,
    allday: ev.allDay ? 'true' : undefined,
    body: ev.description,
    location: ev.location
  })}`;
}

export function yahooUrl(ev) {
  const params = ev.allDay
    ? { v: 60, title: ev.title, st: localDate(ev.start), dur: 'allday', desc: ev.description, in_loc: ev.location }
    : { v: 60, title: ev.title, st: utc(ev.start), et: utc(ev.end), desc: ev.description, in_loc: ev.location };
  return `https://calendar.yahoo.com/?${q(params)}`;
}

// ---------------------------------------------------------------- iCalendar (.ics)

function escapeText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Zeilen nach 75 Bytes umbrechen (RFC 5545), ohne UTF-8-Zeichen zu zerteilen. */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function icsCalendar(events, { name = 'Schulradar', now = Date.now() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Schulradar//Schulradar//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${utc(now)}`);
    if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${localDate(ev.start)}`, `DTEND;VALUE=DATE:${localDate(ev.end)}`);
    else lines.push(`DTSTART:${utc(ev.start)}`, `DTEND:${utc(ev.end)}`);
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.alarm && ev.alarm < ev.start) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(`Morgen: ${ev.title}`)}`, `TRIGGER;VALUE=DATE-TIME:${utc(ev.alarm)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Dateiname ohne Sonderzeichen, z. B. „schularbeit-am-2026-09-28.ics“ */
export function icsFileName(ev) {
  const slug = String(ev.title || 'termin')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'termin'}-${localDate(ev.start, '-')}.ics`;
}
