'use strict';
// LMS.at („Lernen mit System“): Aufgaben mit Abgabetermin und Termine (Tests, Schularbeiten).
//
// LMS.at hat keine öffentliche Schnittstelle für Schüler. Wie bei Letto öffnet die App die Seiten
// unsichtbar in der gemeinsamen Browser-Sitzung und liest sie aus. Welche Seiten das sind, merkt
// sich Schulradar im Anmeldefenster: Jede Seite, auf der Aufgaben oder Termine mit Datum erkannt
// werden (Tabellen oder Listen), wird gespeichert (höchstens drei). Ohne gemerkte Seite sucht der
// Abruf selbst nach Menüpunkten wie „Aufgaben“, „Termine“ oder „Kalender“.
const { withHiddenWindow, loadUrl, evalIn, waitFor, sleep, clearOrigins } = require('../platform');
const { LoginRequiredError, ConfigError, hashId } = require('./base');
const { startOfDay, toIsoDate } = require('../util/dates');
const { fillLogin, clickSsoButton } = require('./webpage');

const MAX_PAGES = 3;

// ---------------------------------------------------------------- Erkennen (testbar)

const COLUMN_PATTERNS = [
  ['title', [/^(aufgabe|titel|bezeichnung|name|thema|betreff|arbeitsauftrag|termin|was|beschreibung)/i, /aufgabe|titel|termin/i]],
  ['due', [/abgabe|frist|fällig|faellig|deadline|^bis\b|einreich/i, /^(datum|wann|zeit|ende|beginn|start|am)\b|datum|zeitpunkt/i]],
  ['course', [/^(kurs|fach|gegenstand|klasse|gruppe|lehrveranstaltung)/i]],
  ['status', [/status|abgegeben|erledigt|bewertung|zustand/i]]
];

const TASK_WORDS = /abgabe|frist|fällig|faellig|deadline|\bbis\b|aufgabe|arbeitsauftrag|hausübung|hausuebung|referat|präsentation|praesentation|protokoll|portfolio|abgeben/i;
const EXAM_WORDS = /schularbeit|\btest\b|prüfung|pruefung|lernzielkontrolle|\bLZK\b|wiederholung|mitarbeitskontrolle|quiz|kolloquium|überprüfung/i;
const EVENT_WORDS = /termin|exkursion|veranstaltung|ausflug|elternabend|sprechtag|projekttag|wandertag/i;

const MONTHS = { jän: 1, jan: 1, feb: 2, mär: 3, mae: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const DATE_TOKEN =
  /(\d{4}-\d{2}-\d{2})|(\d{1,2})\.\s?(\d{1,2})\.(?:(\d{4}|\d{2})(?!\d))?|(\d{1,2})\.?\s?(jän|jan|feb|mär|mae|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|dez|dec)[a-zäöü]*\.?(?:\s*(\d{4}))?/gi;
const TIME_AFTER = /^[,\s]*(?:um\s*)?(\d{1,2})[:.](\d{2})(?:\s*uhr)?(?:\s*(?:-|–|bis)\s*(\d{1,2})[:.](\d{2}))?/i;

function mapColumns(headers) {
  const idx = {};
  const used = new Set();
  for (const [key, patterns] of COLUMN_PATTERNS) {
    idx[key] = -1;
    for (const re of patterns) {
      const i = headers.findIndex((h, n) => !used.has(n) && re.test(String(h || '').trim()));
      if (i >= 0) {
        idx[key] = i;
        used.add(i);
        break;
      }
    }
  }
  return idx;
}

/** Alle Datumsangaben in einem Text, mit Uhrzeit (und Ende, z. B. „08:00–09:40“). */
function findDates(text, now = Date.now()) {
  const s = String(text || '');
  const out = [];
  DATE_TOKEN.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN.exec(s))) {
    let y;
    let mo;
    let d;
    if (m[1]) [y, mo, d] = m[1].split('-').map(Number);
    else if (m[2]) {
      d = +m[2];
      mo = +m[3];
      y = m[4] ? +m[4] : null;
    } else {
      d = +m[5];
      mo = MONTHS[m[6].toLowerCase().slice(0, 3)];
      y = m[7] ? +m[7] : null;
    }
    if (!mo || mo > 12 || !d || d > 31) continue;
    if (y !== null && y < 100) y += 2000;
    const rest = s.slice(m.index + m[0].length);
    const t = rest.match(TIME_AFTER);
    const hasTime = Boolean(t && +t[1] < 24 && +t[2] < 60);
    const make = (year, h = 0, min = 0) => new Date(year, mo - 1, d, h, min).getTime();
    let year = y || new Date(now).getFullYear();
    // ohne Jahr: liegt der Tag weit zurück, ist das nächste Jahr gemeint
    if (!y && make(year) < startOfDay(now) - 150 * 86400000) year += 1;
    const ms = hasTime ? make(year, +t[1], +t[2]) : make(year);
    const end = hasTime && t[3] !== undefined ? make(year, +t[3], +t[4]) : null;
    out.push({ ms, hasTime, end: end && end > ms ? end : null, index: m.index, length: m[0].length + (t ? t[0].length : 0) });
  }
  return out;
}

/** Den passenden Termin wählen: bevorzugt nach „Abgabe“, „bis“, „fällig“ … */
function pickDue(text, dates) {
  if (!dates.length) return null;
  const s = String(text || '');
  const keyed = dates.find((d) => /(abgabe|frist|fällig|faellig|deadline|\bbis|ende|einreichen)[^0-9]{0,25}$/i.test(s.slice(Math.max(0, d.index - 30), d.index)));
  return keyed || dates[0];
}

function classify(text) {
  const t = String(text || '');
  if (/schularbeit/i.test(t) || /\bSA\b/.test(t)) return { type: 'exam', examType: 'Schularbeit' };
  if (EXAM_WORDS.test(t)) return { type: 'exam', examType: /quiz/i.test(t) ? 'Quiz' : 'Test' };
  if (/hausübung|hausuebung|\bHÜ\b/i.test(t)) return { type: 'homework' };
  if (EVENT_WORDS.test(t) && !TASK_WORDS.test(t)) return { type: 'event' };
  return { type: 'assignment' };
}

function statusOf(text) {
  const t = String(text || '');
  if (/nicht\s+(abgegeben|eingereicht|erledigt|bewertet)|ausständig|ausstaendig|\boffen\b/i.test(t)) return 'open';
  if (/bewertet|benotet/i.test(t)) return 'graded';
  if (/abgegeben|eingereicht|erledigt|abgeschlossen/i.test(t)) return 'submitted';
  return 'open';
}

function cleanTitle(text, dates) {
  let s = String(text || '');
  for (const d of [...dates].sort((a, b) => b.index - a.index)) {
    // Datum samt Wochentag davor („Mo, 28.09.2026“) entfernen
    const before = s.slice(0, d.index).replace(/\b(mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\.?,?\s*$/i, '');
    s = before + ' ' + s.slice(d.index + d.length);
  }
  s = s
    .replace(/\b(abgabe(termin)?|frist|fällig( am| bis)?|deadline|bis|am|um|uhr|status|offen|abgegeben|nicht abgegeben)\b\s*:?/gi, ' ')
    .replace(/[|·•–—-]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:;|·•–—-]+|[\s,:;|·•–—-]+$/g, '')
    .trim();
  return s.length > 120 ? s.slice(0, 119).trimEnd() + '…' : s;
}

function makeItem({ title, course = '', status, date, text, link }) {
  const kind = classify(`${title} ${text || ''}`);
  const due = date.hasTime ? date.ms : startOfDay(date.ms);
  return {
    id: `lms:${hashId(course.toLowerCase(), title.toLowerCase(), toIsoDate(due))}`,
    ...kind,
    title,
    subject: course,
    due,
    end: kind.type === 'exam' || kind.type === 'event' ? date.end : null,
    allDay: !date.hasTime,
    status: kind.type === 'exam' || kind.type === 'event' ? 'open' : status,
    url: link || ''
  };
}

/** Einträge aus einer ausgelesenen Seite (Tabellen + Listen). */
function parseLmsPage(page, { link = '', now = Date.now() } = {}) {
  const items = new Map();
  const add = (it) => {
    if (it && it.title && !items.has(it.id)) items.set(it.id, it);
  };
  if (!page) return [];

  for (const t of page.tables || []) {
    const idx = mapColumns(t.headers || []);
    if (idx.due < 0) continue;
    for (const row of t.rows || []) {
      const cells = row.cells || [];
      const dates = findDates(cells[idx.due], now);
      if (!dates.length) continue;
      const rowText = cells.join(' | ');
      let title = idx.title >= 0 ? cells[idx.title] : '';
      if (!title) title = cells.find((c, i) => i !== idx.due && i !== idx.course && i !== idx.status && c && !findDates(c, now).length) || '';
      title = String(title).trim();
      if (title.length > 120) title = title.slice(0, 119).trimEnd() + '…';
      if (!title) continue;
      add(
        makeItem({
          title,
          course: idx.course >= 0 ? String(cells[idx.course] || '').trim() : '',
          status: statusOf(idx.status >= 0 ? cells[idx.status] : rowText),
          date: pickDue(cells[idx.due], dates),
          text: rowText,
          link: row.link || link
        })
      );
    }
  }

  for (const b of page.blocks || []) {
    const text = String(b.text || '');
    if (!TASK_WORDS.test(text) && !EXAM_WORDS.test(text) && !EVENT_WORDS.test(text)) continue;
    const dates = findDates(text, now);
    const date = pickDue(text, dates);
    if (!date) continue;
    let title = b.title && !findDates(b.title, now).length ? String(b.title).trim().slice(0, 120) : '';
    if (!title || title.length < 3) title = cleanTitle(text, dates);
    if (!title) continue;
    const course = (text.match(/(?:kurs|fach|gegenstand)\s*:\s*([^|·•,\n]{2,40})/i) || [])[1] || '';
    add(makeItem({ title, course: course.trim(), status: statusOf(text), date, text, link: b.link || link }));
  }
  return [...items.values()];
}

// ---------------------------------------------------------------- Skript, das in der LMS-Seite läuft

function scanPage() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const hasDate = (t) => /\d{1,2}\.\s?\d{1,2}\.|\d{1,2}\.?\s?(jän|jan|feb|mär|mar|apr|mai|jun|jul|aug|sep|okt|nov|dez)[a-zä]*|\d{4}-\d{2}-\d{2}/i.test(t);
  const linkOf = (el) => {
    const a = el.matches && el.matches('a[href]') ? el : el.querySelector('a[href]');
    if (!a) return null;
    return /^(javascript:|#$)/i.test(a.getAttribute('href') || '') ? null : a.href;
  };
  const out = { url: location.href, title: document.title, login: false, loggedIn: false, tables: [], blocks: [], nav: [] };
  out.login = Array.from(document.querySelectorAll('input[type=password]')).some(visible);
  out.loggedIn = Array.from(document.querySelectorAll('a,button')).some((e) => /^(abmelden|logout|ausloggen|log out)$/i.test(norm(e.innerText || e.title)));

  for (const table of document.querySelectorAll('table')) {
    if (!visible(table)) continue;
    let headers = Array.from(table.querySelectorAll('thead th, thead td')).map((c) => norm(c.innerText));
    let rows = Array.from(table.querySelectorAll('tbody tr'));
    if (!headers.length) {
      const first = table.querySelector('tr');
      if (first && first.querySelector('th')) {
        headers = Array.from(first.children).map((c) => norm(c.innerText));
        rows = Array.from(table.querySelectorAll('tr')).filter((r) => r !== first);
      }
    }
    const data = rows
      .map((tr) => ({ cells: Array.from(tr.children).map((td) => norm(td.innerText)), link: linkOf(tr) }))
      .filter((r) => r.cells.some(Boolean))
      .slice(0, 300);
    if (data.length) out.tables.push({ headers, rows: data });
  }

  const BLOCK = 'li, article, [role=listitem], [class*=card], [class*=item], [class*=entry], [class*=task], [class*=event], [class*=termin], [class*=aufgabe]';
  const seen = new Set();
  for (const el of document.querySelectorAll(BLOCK)) {
    if (el.closest('table, nav, header, footer') || !visible(el)) continue;
    const text = norm(el.innerText);
    if (!text || text.length > 600 || !hasDate(text) || seen.has(text)) continue;
    // nur das innerste Element mit Datum nehmen
    if (Array.from(el.querySelectorAll(BLOCK)).some((c) => visible(c) && hasDate(norm(c.innerText)))) continue;
    seen.add(text);
    const head = el.querySelector('h1,h2,h3,h4,h5,h6,strong,b,a[href]');
    out.blocks.push({ text, title: head ? norm(head.innerText) : '', link: linkOf(el) });
    if (out.blocks.length >= 200) break;
  }

  const navSeen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const t = norm(a.innerText || a.title);
    if (!t || t.length > 40 || navSeen.has(a.href) || !/^https?:/i.test(a.href)) continue;
    if (/aufgaben|termine|kalender|arbeitsauftr|abgaben|to-?do|planer/i.test(t)) {
      navSeen.add(a.href);
      out.nav.push({ text: t, href: a.href });
    }
  }
  out.nav = out.nav.slice(0, 12);
  out.text = norm(document.body ? document.body.innerText : '').slice(0, 3000);
  return out;
}

// ---------------------------------------------------------------- Abruf

function lmsBase(s) {
  const url = String(s.url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new ConfigError('LMS.at-Adresse fehlt (Plattformen → LMS.at).');
  return url;
}

/** Seite auslesen, sobald Einträge oder eine Anmeldemaske da sind (Seiten laden oft nach). */
async function readPage(win, timeout = 15000) {
  const started = Date.now();
  let last = null;
  const found = await waitFor(
    win,
    async (w) => {
      last = await evalIn(w, scanPage);
      if (!last) return null;
      if (last.login || parseLmsPage(last).length) return last;
      // angemeldet, aber (noch) nichts gefunden: nicht die volle Zeit warten
      return last.loggedIn && Date.now() - started > 5000 ? last : null;
    },
    { timeout, interval: 900 }
  );
  return found || last;
}

async function tryAutoLogin(ctx, win) {
  const user = ctx.settings.username;
  const pass = ctx.secrets.get('password');
  if (user && pass) {
    ctx.log('Automatische Anmeldung mit gespeichertem Passwort …');
    await evalIn(win, fillLogin, { user, pass });
  } else if (await evalIn(win, clickSsoButton)) {
    ctx.log('Versuche Anmeldung über Microsoft …');
  } else {
    return false;
  }
  await sleep(2500);
  const ok = await waitFor(
    win,
    async (w) => {
      if (/login\.microsoftonline\.com/i.test(await w.getURL())) return null;
      const p = await evalIn(w, scanPage);
      return p && !p.login ? p : null;
    },
    { timeout: 25000, interval: 1000 }
  );
  return Boolean(ok);
}

const connector = {
  id: 'lms',
  name: 'LMS.at',
  color: '#0B7285',
  description: 'Aufgaben mit Abgabetermin und Termine wie Tests oder Schularbeiten aus LMS.at.',

  origins(s) {
    try {
      return [new URL(lmsBase(s)).origin];
    } catch (_) {
      return [];
    }
  },

  loginUrl(s) {
    return (s.pages && s.pages[0]) || lmsBase(s);
  },

  isConfigured() {
    return true;
  },

  async sync(ctx) {
    const base = lmsBase(ctx.settings);
    const pages = (ctx.settings.pages || []).filter((u) => /^https?:\/\//.test(u)).slice(0, MAX_PAGES);
    return withHiddenWindow(async (win) => {
      const first = pages[0] || base;
      await loadUrl(win, first);
      let page = await readPage(win);
      if (page && page.login) {
        if (!(await tryAutoLogin(ctx, win))) throw new LoginRequiredError('LMS.at: Bitte anmelden.');
        await loadUrl(win, first);
        page = await readPage(win);
        if (page && page.login) throw new LoginRequiredError('LMS.at: Anmeldung fehlgeschlagen – bitte Zugangsdaten prüfen.');
      }

      const items = new Map();
      const take = (p, url) => {
        const found = parseLmsPage(p, { link: url });
        for (const it of found) if (!items.has(it.id)) items.set(it.id, it);
        return found.length;
      };

      if (pages.length) {
        for (let i = 0; i < pages.length; i++) {
          if (i > 0) {
            await loadUrl(win, pages[i]);
            page = await readPage(win);
          }
          ctx.sample(`seite_${i + 1}`, page);
          if (page && page.login) throw new LoginRequiredError('LMS.at: Sitzung abgelaufen – bitte neu anmelden.');
          ctx.log(`${pages[i].split('?')[0]}: ${take(page, pages[i])} Einträge`);
        }
      } else {
        // Noch keine Seite gemerkt: Start­seite und Menüpunkte wie „Aufgaben“ oder „Termine“ probieren
        ctx.sample('startseite', page);
        const learned = [];
        const startUrl = (await win.getURL()) || first;
        if (take(page, startUrl)) learned.push(startUrl);
        const candidates = (page && page.nav) || [];
        ctx.log(`Suche Seiten mit Aufgaben: ${candidates.map((c) => c.text).join(', ') || 'keine Menüpunkte gefunden'}`);
        for (const c of candidates.slice(0, 5)) {
          if (learned.length >= MAX_PAGES) break;
          await loadUrl(win, c.href);
          const p = await readPage(win, 10000);
          const n = take(p, c.href);
          ctx.log(`„${c.text}“: ${n} Einträge`);
          if (n) {
            learned.push(c.href);
            ctx.sample(`gefunden_${learned.length}`, p);
          }
        }
        if (!learned.length) {
          throw new Error(
            'LMS.at: Keine Seite mit Aufgaben oder Terminen gefunden. Bitte unter Plattformen → LMS.at „Anmelden“ wählen und dort die Seite mit deinen Aufgaben öffnen.'
          );
        }
        ctx.saveSettings({ pages: learned });
      }
      ctx.log(`${items.size} Einträge gefunden.`);
      return { items: [...items.values()] };
    });
  },

  /** Im Anmeldefenster: Seiten mit Aufgaben oder Terminen merken. */
  async onLoginPage(ctx, win) {
    const page = await evalIn(win, scanPage);
    if (!page || page.login) return null;
    const n = parseLmsPage(page).length;
    const pages = ctx.settings.pages || [];
    if (!n || pages.includes(page.url)) return null;
    ctx.saveSettings({ pages: [page.url, ...pages].slice(0, MAX_PAGES) });
    ctx.sample('anmeldefenster', page);
    return {
      done: false,
      message: `LMS.at: ${n} ${n === 1 ? 'Eintrag' : 'Einträge'} erkannt, Seite gemerkt. Du kannst noch die Termine-Seite öffnen oder fertig machen.`
    };
  },

  async logout(ctx) {
    ctx.secrets.set('password', null);
    await clearOrigins(this.origins(ctx.settings));
  }
};

module.exports = connector;
module.exports.parseLmsPage = parseLmsPage;
module.exports.findDates = findDates;
module.exports.scanPage = scanPage;
module.exports.mapColumns = mapColumns;
