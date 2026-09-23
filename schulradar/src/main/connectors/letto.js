'use strict';
// Letto: offene Übungen/Hausübungen mit Abgabefrist aus dem Schüler-Dashboard.
//
// Letto hat keine offizielle Schnittstelle. Die App öffnet deshalb das Dashboard unsichtbar
// ("Offene Aktivitäten" und "Nicht gestartete Aktivitäten") und liest die Tabelle aus:
//   Aktivitätsname | Start | Abgabe | Fach | %
// Letto meldet nach 20 Minuten automatisch ab. Damit der Abruf im Hintergrund klappt, kann man
// Benutzername + Passwort speichern oder "Mit Microsoft anmelden" nutzen (dann reicht die
// Microsoft-Anmeldung in der App).
const { withHiddenWindow, loadUrl, evalIn, waitFor, sleep, clearOrigins } = require('../platform');
const { LoginRequiredError, ConfigError, hashId } = require('./base');
const { parseLooseDate, startOfDay } = require('../util/dates');
const { clickByText, fillLogin, clickSsoButton } = require('./webpage');

// ---------------------------------------------------------------- Parser (testbar)

const COLUMN_PATTERNS = [
  ['name', [/aktivit/i, /bezeichnung|titel|name|aufgabe|übung/i]],
  ['due', [/abgabe|fällig|faellig|deadline/i, /^ende|^bis/i]],
  ['start', [/^start|^beginn|^von|freigabe/i]],
  ['subject', [/^fach|gegenstand|kurs/i]],
  ['progress', [/%|fortschritt|erledigt|stand/i]]
];

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

function isActivityTable(t) {
  if (!t || !Array.isArray(t.headers)) return false;
  const idx = mapColumns(t.headers);
  return idx.name >= 0 && (idx.due >= 0 || idx.subject >= 0);
}

function parseLettoTables(tables, { started = null, link = '', now = Date.now() } = {}) {
  const items = new Map();
  for (const t of tables || []) {
    if (!isActivityTable(t)) continue;
    const idx = mapColumns(t.headers);
    for (const row of t.rows || []) {
      const cells = row.cells || row;
      const name = String(cells[idx.name] || '').trim();
      if (!name) continue;
      const subject = idx.subject >= 0 ? String(cells[idx.subject] || '').trim() : '';
      const due = idx.due >= 0 ? parseLooseDate(cells[idx.due], now) : null;
      const start = idx.start >= 0 ? parseLooseDate(cells[idx.start], now) : null;
      const pm = idx.progress >= 0 ? String(cells[idx.progress] || '').match(/(\d{1,3})\s*%/) : null;
      const progress = pm ? Math.min(100, Number(pm[1])) : null;
      const id = `letto:${hashId(subject.toLowerCase(), name.toLowerCase())}`;
      items.set(id, {
        id,
        type: 'exercise',
        title: name,
        subject,
        start: start ? start.ms : null,
        due: due ? (due.hasTime ? due.ms : startOfDay(due.ms)) : null,
        allDay: due ? !due.hasTime : false,
        progress,
        started: started === null ? progress !== null && progress > 0 : started,
        status: progress === 100 ? 'submitted' : 'open',
        url: row.link || link
      });
    }
  }
  return [...items.values()];
}

// ---------------------------------------------------------------- Skripte, die in der Letto-Seite laufen

function extractPage() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const linkOf = (el) => {
    const a = el.querySelector('a[href]');
    if (a && !/^(javascript:|#$)/i.test(a.getAttribute('href') || '')) return a.href;
    return null;
  };
  const out = { url: location.href, title: document.title, login: false, tables: [] };
  const pw = Array.from(document.querySelectorAll('input[type=password]')).find(visible);
  out.login = Boolean(pw);

  for (const table of document.querySelectorAll('table')) {
    if (!visible(table)) continue;
    let headers = Array.from(table.querySelectorAll('thead th, thead td')).map((c) => norm(c.innerText));
    let rows = Array.from(table.querySelectorAll('tbody tr'));
    if (!headers.length) {
      const first = table.querySelector('tr');
      if (first) {
        headers = Array.from(first.children).map((c) => norm(c.innerText));
        rows = rows.filter((r) => r !== first);
      }
    }
    out.tables.push({
      headers,
      rows: rows
        .map((tr) => ({ cells: Array.from(tr.children).map((td) => norm(td.innerText)), link: linkOf(tr) }))
        .filter((r) => r.cells.some(Boolean))
    });
  }

  for (const grid of document.querySelectorAll('[role=table],[role=grid]')) {
    if (grid.tagName === 'TABLE' || !visible(grid)) continue;
    const rowEls = Array.from(grid.querySelectorAll('[role=row]'));
    const cellsOf = (r) => Array.from(r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')).map((c) => norm(c.innerText));
    if (rowEls.length) out.tables.push({ headers: cellsOf(rowEls[0]), rows: rowEls.slice(1).map((r) => ({ cells: cellsOf(r), link: linkOf(r) })) });
  }

  // Tabellen aus <div>s: Kopfzeile über die Beschriftung "Aktivitätsname" finden
  if (!out.tables.length) {
    const label = Array.from(document.querySelectorAll('body *')).find(
      (el) => el.children.length === 0 && /^aktivit(ä|ae)tsname$/i.test(norm(el.textContent))
    );
    let headerRow = label;
    while (headerRow && headerRow.parentElement) {
      const t = norm(headerRow.innerText);
      if (/abgabe/i.test(t) && /fach/i.test(t) && headerRow.children.length >= 3) break;
      headerRow = headerRow.parentElement;
    }
    if (headerRow && headerRow.children.length >= 3) {
      let rowEls = [];
      for (let n = headerRow.nextElementSibling; n; n = n.nextElementSibling) rowEls.push(n);
      if (!rowEls.length && headerRow.parentElement && headerRow.parentElement.nextElementSibling) {
        rowEls = Array.from(headerRow.parentElement.nextElementSibling.children);
      }
      out.tables.push({
        headers: Array.from(headerRow.children).map((c) => norm(c.innerText)),
        rows: rowEls.map((r) => ({ cells: Array.from(r.children).map((c) => norm(c.innerText)), link: linkOf(r) }))
      });
    }
  }
  out.text = norm(document.body ? document.body.innerText : '').slice(0, 3000);
  return out;
}

// ---------------------------------------------------------------- Abruf

function lettoBase(s) {
  const url = String(s.url || '').trim();
  if (!/^https?:\/\//.test(url)) throw new ConfigError('Letto-Adresse fehlt (Plattformen → Letto).');
  return url;
}

function hasTable(page) {
  return Boolean(page && page.tables && page.tables.some(isActivityTable));
}

async function readPage(win, timeout = 20000) {
  let last = null;
  const found = await waitFor(
    win,
    async (w) => {
      last = await evalIn(w, extractPage);
      return last && (last.login || hasTable(last)) ? last : null;
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
      const url = await w.getURL();
      if (/login\.microsoftonline\.com/i.test(url)) return null;
      const p = await evalIn(w, extractPage);
      return p && !p.login ? p : null;
    },
    { timeout: 25000, interval: 1000 }
  );
  return Boolean(ok);
}

const connector = {
  id: 'letto',
  name: 'Letto',
  color: '#0E9F6E',
  description: 'Offene Übungen und Hausübungen mit Abgabefrist aus dem Letto-Dashboard.',

  origins(s) {
    try {
      return [new URL(lettoBase(s)).origin];
    } catch (_) {
      return [];
    }
  },

  loginUrl(s) {
    return s.dashboardUrl || lettoBase(s);
  },

  isConfigured() {
    return true;
  },

  async sync(ctx) {
    const base = lettoBase(ctx.settings);
    const target = ctx.settings.dashboardUrl || base;
    return withHiddenWindow(async (win) => {
      await loadUrl(win, target);
      let page = await readPage(win);
      if (page && page.login) {
        if (!(await tryAutoLogin(ctx, win))) throw new LoginRequiredError('Letto: Bitte anmelden.');
        if ((await win.getURL()) !== target) await loadUrl(win, target);
        page = await readPage(win);
        if (page && page.login) throw new LoginRequiredError('Letto: Anmeldung fehlgeschlagen – bitte Zugangsdaten prüfen.');
      }
      if (!hasTable(page)) {
        ctx.log('Dashboard nicht direkt gefunden – suche Menüpunkt „Dashboard“ …');
        if (await evalIn(win, clickByText, ['Dashboard'])) {
          await sleep(1500);
          page = await readPage(win);
          const url = await win.getURL();
          if (hasTable(page) && url && url !== target) ctx.saveSettings({ dashboardUrl: url });
        }
      }
      ctx.sample('dashboard', page);
      if (!hasTable(page)) {
        throw new Error('Letto: Dashboard nicht gefunden. Bitte unter Plattformen → Letto „Anmelden“ wählen und dort einmal das Dashboard öffnen.');
      }
      const link = (await win.getURL()) || target;
      const items = parseLettoTables(page.tables, { started: true, link });
      const before = JSON.stringify(page.tables);

      if (await evalIn(win, clickByText, ['Nicht gestartete Aktivitäten', 'Nicht gestartete'])) {
        const other = await waitFor(
          win,
          async (w) => {
            const p = await evalIn(w, extractPage);
            return p && hasTable(p) && JSON.stringify(p.tables) !== before ? p : null;
          },
          { timeout: 8000, interval: 800 }
        );
        if (other) {
          ctx.sample('nicht_gestartet', other);
          for (const it of parseLettoTables(other.tables, { started: false, link })) {
            if (!items.some((x) => x.id === it.id)) items.push(it);
          }
        }
      }
      ctx.log(`${items.length} offene Aktivitäten gefunden.`);
      return { items, pendingOnly: true };
    });
  },

  /** Im Anmeldefenster: Dashboard-Adresse merken. */
  async onLoginPage(ctx, win) {
    const url = await win.getURL();
    if (/dashboard/i.test(url) && url !== ctx.settings.dashboardUrl) {
      ctx.saveSettings({ dashboardUrl: url });
      return { done: false, message: 'Letto-Dashboard gefunden – du kannst das Fenster jetzt schließen.' };
    }
    return null;
  },

  async logout(ctx) {
    ctx.secrets.set('password', null);
    await clearOrigins(this.origins(ctx.settings));
  }
};

module.exports = connector;
module.exports.parseLettoTables = parseLettoTables;
module.exports.mapColumns = mapColumns;
module.exports.extractPage = extractPage;
module.exports.clickByText = clickByText;
module.exports.fillLogin = fillLogin;
