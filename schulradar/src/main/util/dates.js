'use strict';
// Datums-Hilfen. Alle Zeiten werden als Millisekunden (lokale Zeit des PCs) gespeichert.

const DAY = 24 * 60 * 60 * 1000;

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

/** 20260923 (Zahl oder String) -> {y, m, d} */
function splitUntisDate(value) {
  const s = String(value).padStart(8, '0');
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(4, 6)), d: Number(s.slice(6, 8)) };
}

/** Untis-Datum + optional Untis-Zeit (830 = 08:30) -> ms */
function untisToMs(date, time) {
  if (date === undefined || date === null || date === '') return null;
  const { y, m, d } = splitUntisDate(date);
  let hh = 0;
  let mm = 0;
  if (time !== undefined && time !== null && time !== '') {
    const t = String(time).padStart(4, '0');
    hh = Number(t.slice(0, 2));
    mm = Number(t.slice(2, 4));
  }
  const ms = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Date -> 20260923 */
function toUntisDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** Date -> 2026-09-23 */
function toIsoDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Montag der Woche, in der ms liegt (00:00) */
function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7; // Mo = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

const MONTHS = {
  jan: 1, januar: 1, jänner: 1, jän: 1, jaen: 1, january: 1,
  feb: 2, februar: 2, february: 2,
  mär: 3, mrz: 3, märz: 3, maerz: 3, mar: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dezember: 12, dec: 12, december: 12
};

/**
 * Liest Datumsangaben, wie sie auf Webseiten stehen:
 *  "23. Feb. 2026", "23. Februar 2026 14:30", "23.02.2026", "23.02.26 8:00",
 *  "2026-02-23", "2026-02-23T14:30:00Z", "Feb 23, 2026"
 * Liefert {ms, hasTime} oder null.
 */
function parseLooseDate(text, now = Date.now()) {
  if (text === undefined || text === null) return null;
  if (typeof text === 'number') return { ms: text, hasTime: true };
  const s = String(text).trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // ISO mit Zeitangabe (Zeitzone wird von Date korrekt behandelt)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? { ms, hasTime: true } : null;
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const hasTime = m[4] !== undefined;
    const ms = new Date(+m[1], +m[2] - 1, +m[3], hasTime ? +m[4] : 0, hasTime ? +m[5] : 0).getTime();
    return { ms, hasTime };
  }

  const time = s.match(/(\d{1,2})[:.](\d{2})\s*(?:uhr|h)?\s*$/i);
  const timeOk = time && !/\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(s) && +time[1] < 24 && +time[2] < 60;

  // 23.02.2026 / 23.2.26
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    const hasTime = Boolean(timeOk);
    const ms = new Date(year, +m[2] - 1, +m[1], hasTime ? +time[1] : 0, hasTime ? +time[2] : 0).getTime();
    return { ms, hasTime };
  }

  // 23. Feb. 2026 / 23 Februar 2026 / 23. Feb.
  m = s.match(/(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]{3,})\.?\s*(\d{4})?/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()] || MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (month) {
      let year = m[3] ? +m[3] : new Date(now).getFullYear();
      const hasTime = Boolean(timeOk);
      let ms = new Date(year, month - 1, +m[1], hasTime ? +time[1] : 0, hasTime ? +time[2] : 0).getTime();
      if (!m[3] && ms < now - 180 * DAY) {
        year += 1;
        ms = new Date(year, month - 1, +m[1], hasTime ? +time[1] : 0, hasTime ? +time[2] : 0).getTime();
      }
      return { ms, hasTime };
    }
  }

  // Feb 23, 2026
  m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()] || MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (month) {
      const hasTime = Boolean(timeOk);
      const ms = new Date(+m[3], month - 1, +m[2], hasTime ? +time[1] : 0, hasTime ? +time[2] : 0).getTime();
      return { ms, hasTime };
    }
  }
  return null;
}

module.exports = {
  DAY,
  pad,
  splitUntisDate,
  untisToMs,
  toUntisDate,
  toIsoDate,
  startOfDay,
  addDays,
  startOfWeek,
  parseLooseDate
};
