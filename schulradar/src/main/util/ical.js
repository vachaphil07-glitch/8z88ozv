'use strict';
// Kleiner iCalendar-Leser (RFC 5545) für Kalender-Abos, z. B. die „Geheime Adresse im iCal-Format“
// von Google Kalender. Unterstützt Zeitzonen (TZID), ganztägige Termine, Wiederholungen (RRULE mit
// DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY), Ausnahmen (EXDATE) und
// geänderte Einzeltermine (RECURRENCE-ID).

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Outlook/Exchange schreibt manchmal Windows-Zeitzonennamen
const WINDOWS_ZONES = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'UTC': 'UTC',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles'
};

// ---------------------------------------------------------------- Zeilen & Eigenschaften

function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function unescapeText(v) {
  return String(v || '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** "DTSTART;TZID=Europe/Vienna:20261015T080000" -> {name, params, value} */
function parseLine(line) {
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.split(';');
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

// ---------------------------------------------------------------- Zeitzonen

const offsetFormatters = new Map();

function zoneFormatter(tz) {
  if (!offsetFormatters.has(tz)) {
    let fmt = null;
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (_) {
      fmt = null;
    }
    offsetFormatters.set(tz, fmt);
  }
  return offsetFormatters.get(tz);
}

/** Abstand der Zeitzone zu UTC (ms) zum Zeitpunkt utcMs */
function zoneOffset(utcMs, tz) {
  const fmt = zoneFormatter(tz);
  if (!fmt) return null;
  const p = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function resolveZone(tzid) {
  if (!tzid) return null;
  const tz = WINDOWS_ZONES[tzid] || tzid;
  return zoneFormatter(tz) ? tz : null;
}

/** Wanduhrzeit in einer Zone -> ms. zone: 'UTC', IANA-Name oder null (= lokale Zeit dieses Geräts). */
function wallToMs({ y, m, d, hh = 0, mm = 0, ss = 0 }, zone) {
  if (zone === 'UTC') return Date.UTC(y, m - 1, d, hh, mm, ss);
  if (!zone) return new Date(y, m - 1, d, hh, mm, ss).getTime();
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let ms = guess - zoneOffset(guess, zone);
  // zweiter Durchgang für Zeitumstellungen
  ms = guess - zoneOffset(ms, zone);
  return ms;
}

// ---------------------------------------------------------------- Datumswerte

/** "20261015" / "20261015T080000Z" -> {wall, zone, allDay} */
function parseDateValue(value, params = {}) {
  const m = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] || 0), mm: +(m[5] || 0), ss: +(m[6] || 0) };
  const allDay = params.VALUE === 'DATE' || !m[4];
  const zone = allDay ? null : m[7] ? 'UTC' : resolveZone(params.TZID);
  return { wall, zone, allDay };
}

function dateToMs(dv) {
  return dv ? wallToMs(dv.wall, dv.allDay ? null : dv.zone) : null;
}

/** "PT1H30M", "P1D" -> ms */
function parseDuration(value) {
  const m = String(value || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60000 + +(m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---------------------------------------------------------------- Kalender lesen

function parseCalendar(text) {
  const lines = unfold(text);
  const cal = { name: '', timezone: '', events: [] };
  let ev = null;
  let depth = 0; // verschachtelte Blöcke in VEVENT (z. B. VALARM) überspringen
  for (const raw of lines) {
    if (!raw) continue;
    const { name, params, value } = parseLine(raw);
    if (name === 'BEGIN') {
      if (value === 'VEVENT' && !ev) {
        ev = { exdates: [] };
        depth = 0;
      } else if (ev) depth++;
      continue;
    }
    if (name === 'END') {
      if (ev && depth > 0) depth--;
      else if (ev && value === 'VEVENT') {
        cal.events.push(ev);
        ev = null;
      }
      continue;
    }
    if (!ev) {
      if (name === 'X-WR-CALNAME') cal.name = unescapeText(value);
      if (name === 'X-WR-TIMEZONE') cal.timezone = value;
      continue;
    }
    if (depth > 0) continue;
    switch (name) {
      case 'UID':
        ev.uid = value;
        break;
      case 'SUMMARY':
        ev.summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        ev.description = unescapeText(value);
        break;
      case 'LOCATION':
        ev.location = unescapeText(value);
        break;
      case 'URL':
        ev.url = value;
        break;
      case 'STATUS':
        ev.status = value.toUpperCase();
        break;
      case 'DTSTART':
        ev.start = parseDateValue(value, params);
        break;
      case 'DTEND':
        ev.end = parseDateValue(value, params);
        break;
      case 'DURATION':
        ev.duration = parseDuration(value);
        break;
      case 'RRULE':
        ev.rrule = parseRule(value);
        break;
      case 'EXDATE':
        for (const v of value.split(',')) {
          const dv = parseDateValue(v, params);
          if (dv) ev.exdates.push(dv);
        }
        break;
      case 'RECURRENCE-ID':
        ev.recurrenceId = parseDateValue(value, params);
        break;
      default:
        break;
    }
  }
  return cal;
}

function parseRule(value) {
  const rule = {};
  for (const part of String(value).split(';')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) rule[k.toUpperCase()] = v;
  }
  const out = {
    freq: rule.FREQ,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: rule.COUNT ? Number(rule.COUNT) : null,
    until: rule.UNTIL ? parseDateValue(rule.UNTIL, {}) : null,
    byday: rule.BYDAY
      ? rule.BYDAY.split(',')
          .map((s) => s.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/))
          .filter(Boolean)
          .map((x) => ({ n: x[1] ? Number(x[1]) : 0, wd: WEEKDAYS.indexOf(x[2]) }))
      : null,
    bymonthday: rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number).filter(Boolean) : null,
    bymonth: rule.BYMONTH ? rule.BYMONTH.split(',').map(Number).filter(Boolean) : null
  };
  return out;
}

// ---------------------------------------------------------------- Wiederholungen

// Kalenderrechnung auf reinen Datumswerten (ohne Zeitzone)
function civil(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dayKey(c) {
  return c.y * 10000 + c.m * 100 + c.d;
}

/** Tage im Monat, die zu BYDAY (z. B. 2MO, -1FR, MO) bzw. BYMONTHDAY passen */
function monthDays(y, m, rule, startDay) {
  const n = daysInMonth(y, m);
  const days = [];
  if (rule.byday) {
    for (const { n: ord, wd } of rule.byday) {
      const matches = [];
      for (let d = 1; d <= n; d++) if (civil(y, m, d).wd === wd) matches.push(d);
      if (!ord) days.push(...matches);
      else {
        const pick = ord > 0 ? matches[ord - 1] : matches[matches.length + ord];
        if (pick) days.push(pick);
      }
    }
  } else if (rule.bymonthday) {
    for (const md of rule.bymonthday) {
      const d = md > 0 ? md : n + md + 1;
      if (d >= 1 && d <= n) days.push(d);
    }
  } else if (startDay <= n) {
    days.push(startDay);
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Liefert die Startzeitpunkte (ms) aller Wiederholungen bis "to".
 * Gerechnet wird in der Wanduhrzeit der Zone des Termins, damit z. B. ein Termin um 08:00
 * auch nach der Zeitumstellung um 08:00 bleibt.
 */
function expandRule(start, rule, to, maxCount = 1500) {
  const zone = start.allDay ? null : start.zone;
  const { hh, mm, ss } = start.wall;
  const s = civil(start.wall.y, start.wall.m, start.wall.d);
  const untilMs = rule.until ? dateToMs(rule.until.allDay ? { ...rule.until, wall: { ...rule.until.wall, hh: 23, mm: 59, ss: 59 } } : rule.until) : Infinity;
  const startKey = dayKey(s);
  const out = [];
  let emitted = 0;
  const emit = (c) => {
    if (dayKey(c) < startKey) return true;
    const ms = wallToMs({ y: c.y, m: c.m, d: c.d, hh, mm, ss }, zone);
    if (ms > untilMs || ms > to) return false;
    emitted++;
    out.push(ms);
    return !(rule.count && emitted >= rule.count) && emitted < maxCount;
  };

  const freq = rule.freq;
  const step = rule.interval;
  for (let i = 0; i < maxCount; i++) {
    let days = [];
    if (freq === 'DAILY') {
      days = [civil(s.y, s.m, s.d + i * step)];
    } else if (freq === 'WEEKLY') {
      const monday = civil(s.y, s.m, s.d - ((s.wd + 6) % 7) + i * 7 * step);
      const wds = rule.byday ? rule.byday.map((b) => b.wd) : [s.wd];
      days = [...new Set(wds)]
        .map((wd) => civil(monday.y, monday.m, monday.d + ((wd + 6) % 7)))
        .sort((a, b) => dayKey(a) - dayKey(b));
    } else if (freq === 'MONTHLY') {
      const first = civil(s.y, s.m + i * step, 1);
      days = monthDays(first.y, first.m, rule, s.d).map((d) => civil(first.y, first.m, d));
    } else if (freq === 'YEARLY') {
      const y = s.y + i * step;
      const months = rule.bymonth || [s.m];
      for (const m of months) {
        const list = rule.byday || rule.bymonthday ? monthDays(y, m, rule, s.d) : s.d <= daysInMonth(y, m) ? [s.d] : [];
        days.push(...list.map((d) => civil(y, m, d)));
      }
    } else {
      return [wallToMs({ ...start.wall }, zone)];
    }
    if (rule.bymonth && freq !== 'YEARLY') days = days.filter((c) => rule.bymonth.includes(c.m));
    for (const c of days) if (!emit(c)) return out;
    // Abbruch, wenn wir schon über "to" hinaus sind
    if (days.length && wallToMs({ ...days[days.length - 1], hh, mm, ss }, zone) > to) return out;
  }
  return out;
}

/**
 * Alle Termine im Zeitraum [from, to] als flache Liste:
 * {uid, start, end, allDay, summary, description, location, url, recurring}
 */
function eventsInRange(cal, from, to) {
  const overrides = new Map();
  for (const ev of cal.events) {
    if (ev.recurrenceId && ev.uid) overrides.set(`${ev.uid}|${dateToMs(ev.recurrenceId)}`, ev);
  }
  const out = [];
  const push = (ev, startMs, recurring, baseLen) => {
    if (ev.status === 'CANCELLED') return;
    const len = baseLen !== null ? baseLen : eventLength(ev);
    const endMs = startMs + len;
    if (endMs < from || startMs > to) return;
    out.push({
      uid: ev.uid || '',
      start: startMs,
      end: ev.start.allDay ? null : endMs,
      allDay: ev.start.allDay,
      days: ev.start.allDay ? Math.max(1, Math.round(len / DAY)) : 0,
      summary: ev.summary || '',
      description: ev.description || '',
      location: ev.location || '',
      url: ev.url || '',
      recurring
    });
  };
  for (const ev of cal.events) {
    if (!ev.start || ev.recurrenceId) continue;
    if (!ev.rrule) {
      push(ev, dateToMs(ev.start), false, null);
      continue;
    }
    const excluded = new Set(ev.exdates.map(dateToMs));
    const len = eventLength(ev);
    for (const ms of expandRule(ev.start, ev.rrule, to)) {
      if (excluded.has(ms)) continue;
      const override = ev.uid && overrides.get(`${ev.uid}|${ms}`);
      if (override) {
        if (override.start) push(override, dateToMs(override.start), true, null);
        continue;
      }
      push(ev, ms, true, len);
    }
  }
  // geänderte Einzeltermine, deren Serie nicht (mehr) im Kalender steht
  for (const ev of overrides.values()) {
    const base = cal.events.find((e) => e.uid === ev.uid && !e.recurrenceId && e.rrule);
    if (!base && ev.start) push(ev, dateToMs(ev.start), true, null);
  }
  return out.sort((a, b) => a.start - b.start);
}

function eventLength(ev) {
  const start = dateToMs(ev.start);
  if (ev.end) return Math.max(0, dateToMs(ev.end) - start);
  if (ev.duration !== null && ev.duration !== undefined) return ev.duration;
  return ev.start.allDay ? DAY : 0;
}

module.exports = { parseCalendar, eventsInRange, expandRule, parseDateValue, parseRule, parseDuration, wallToMs, unfold };
