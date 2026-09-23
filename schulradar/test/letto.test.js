'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseLettoTables, mapColumns, extractPage, clickByText } = require('../src/main/connectors/letto');
const { toIsoDate } = require('../src/main/util/dates');

// Tabelle wie im Letto-Dashboard (siehe LeTTo-Wiki "Dashboard")
const HEADERS = ['Aktivitätsname', 'Start', 'Abgabe', 'Fach', '%', ''];
const ROWS = [
  ['16. Hausübung - Mag. Feld Grundlagen', '14. Jan. 2026', '23. Feb. 2026', 'AT1', '45%', ''],
  ['12. Hausübung - Getriebe', '14. Jan. 2026', '22. Nov. 2025', 'AT1', '5%', ''],
  ['1. Übung', '14. Jan. 2026', '24. Okt. 2025', 'AM', '0%', '']
];

test('Spalten werden an den Überschriften erkannt', () => {
  const idx = mapColumns(HEADERS);
  assert.deepEqual(idx, { name: 0, due: 2, start: 1, subject: 3, progress: 4 });
});

test('Dashboard-Tabelle wird zu Einträgen', () => {
  const items = parseLettoTables([{ headers: HEADERS, rows: ROWS.map((cells) => ({ cells, link: null })) }], { started: true, link: 'https://letto.htl-hl.ac.at/dashboard' });
  assert.equal(items.length, 3);
  const [a, b] = items;
  assert.equal(a.title, '16. Hausübung - Mag. Feld Grundlagen');
  assert.equal(a.subject, 'AT1');
  assert.equal(a.progress, 45);
  assert.equal(toIsoDate(a.due), '2026-02-23');
  assert.equal(a.allDay, true);
  assert.equal(toIsoDate(a.start), '2026-01-14');
  assert.equal(a.type, 'exercise');
  assert.equal(a.url, 'https://letto.htl-hl.ac.at/dashboard');
  assert.equal(b.progress, 5);
  // gleiche Aktivität ergibt immer dieselbe ID
  const again = parseLettoTables([{ headers: HEADERS, rows: ROWS.map((cells) => ({ cells })) }]);
  assert.equal(again[0].id, a.id);
});

test('Tabellen ohne passende Spalten werden ignoriert', () => {
  assert.deepEqual(parseLettoTables([{ headers: ['Name', 'Wert'], rows: [{ cells: ['x', 'y'] }] }]), []);
});

function dom(html) {
  const window = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only' }).window;
  // jsdom kennt kein Layout: sichtbar machen und innerText nachbilden
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get: () => 10 });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get: () => 10 });
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  return window;
}

function runInWindow(window, fn, arg) {
  const src = `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`;
  return window.eval(src);
}

test('extractPage liest eine echte <table> aus', () => {
  const html = `<table><thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${ROWS.map(
    (r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`
  ).join('')}</tbody></table>`;
  const window = dom(html);
  const page = runInWindow(window, extractPage);
  assert.equal(page.login, false);
  assert.equal(page.tables.length, 1);
  const items = parseLettoTables(page.tables);
  assert.equal(items.length, 3);
  assert.equal(items[2].subject, 'AM');
});

test('extractPage erkennt Tabellen aus <div>s und Login-Seiten', () => {
  const row = (cells) => `<div class="row">${cells.map((c) => `<div>${c}</div>`).join('')}</div>`;
  const html = `<div class="list"><div class="head"><div>Aktivitätsname</div><div>Start</div><div>Abgabe</div><div>Fach</div><div>%</div></div>${ROWS.map((r) =>
    row(r.slice(0, 5))
  ).join('')}</div>`;
  const page = runInWindow(dom(html), extractPage);
  const items = parseLettoTables(page.tables);
  assert.equal(items.length, 3);
  assert.equal(items[0].progress, 45);

  const login = runInWindow(dom('<form><input type="text" name="u"><input type="password" name="p"><button>Anmelden</button></form>'), extractPage);
  assert.equal(login.login, true);
});

test('clickByText klickt den passenden Knopf', () => {
  const window = dom('<div><button id="a">OFFENE AKTIVITÄTEN</button><button id="b">NICHT GESTARTETE AKTIVITÄTEN</button></div>');
  let clicked = '';
  window.document.getElementById('b').addEventListener('click', () => (clicked = 'b'));
  assert.equal(runInWindow(window, clickByText, ['Nicht gestartete Aktivitäten']), true);
  assert.equal(clicked, 'b');
  assert.equal(runInWindow(window, clickByText, ['Gibt es nicht']), false);
});
