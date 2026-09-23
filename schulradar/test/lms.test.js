'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { parseLmsPage, findDates, scanPage, mapColumns } = require('../src/main/connectors/lms');

const NOW = new Date(2026, 8, 23, 12, 0).getTime();
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('LMS.at: Datumsangaben mit Uhrzeit, Zeitraum und Monatsnamen', () => {
  const [a] = findDates('Mo, 28.09.2026, 08:00 - 09:40', NOW);
  assert.equal(a.ms, at(2026, 9, 28, 8, 0));
  assert.equal(a.end, at(2026, 9, 28, 9, 40));
  assert.equal(a.hasTime, true);
  const [b] = findDates('fällig am 25. Sep. 2026 um 23:59 Uhr', NOW);
  assert.equal(b.ms, at(2026, 9, 25, 23, 59));
  const [c] = findDates('2026-10-02', NOW);
  assert.equal(c.ms, at(2026, 10, 2));
  assert.equal(c.hasTime, false);
  // ohne Jahr: im Jänner ist der nächste Jänner gemeint
  const [d] = findDates('bis 12.01.', NOW);
  assert.equal(d.ms, at(2027, 1, 12));
  assert.equal(findDates('Kapitel 3 und 4', NOW).length, 0);
});

test('LMS.at: Aufgaben-Tabelle mit Kurs und Status', () => {
  const page = {
    tables: [
      {
        headers: ['Aufgabe', 'Kurs', 'Abgabetermin', 'Status'],
        rows: [
          { cells: ['Referat Energiewende', '4AHIT GGP', '25.09.2026 23:59', 'nicht abgegeben'], link: 'https://lms.at/a/1' },
          { cells: ['Protokoll', 'MTRS', '21.09.2026', 'abgegeben'], link: null },
          { cells: ['Lernzielkontrolle Kapitel 2', 'AM', '30.09.2026', 'offen'], link: null },
          { cells: ['ohne Datum', 'D', '', 'offen'], link: null }
        ]
      },
      { headers: ['Name', 'Wert'], rows: [{ cells: ['x', '01.01.2026'] }] }
    ]
  };
  const items = parseLmsPage(page, { link: 'https://lms.at/aufgaben', now: NOW });
  assert.equal(items.length, 3);
  const [ref, prot, lzk] = items;
  assert.equal(ref.title, 'Referat Energiewende');
  assert.equal(ref.subject, '4AHIT GGP');
  assert.equal(ref.status, 'open');
  assert.equal(ref.due, at(2026, 9, 25, 23, 59));
  assert.equal(ref.allDay, false);
  assert.equal(ref.url, 'https://lms.at/a/1');
  assert.equal(prot.status, 'submitted');
  assert.equal(prot.allDay, true);
  assert.equal(prot.url, 'https://lms.at/aufgaben');
  assert.equal(lzk.type, 'exam');
  assert.equal(lzk.examType, 'Test');
  // gleiche Eingabe → gleiche IDs (Häkchen bleiben erhalten)
  assert.deepEqual(parseLmsPage(page, { now: NOW }).map((i) => i.id), items.map((i) => i.id));
});

test('LMS.at: Listen und Karten – Abgabedatum nach „bis“, Termine, Nachrichten ignorieren', () => {
  const page = {
    blocks: [
      { text: 'Arbeitsauftrag Präsentation · Freigabe 20.09.2026 · Abgabe bis 25.09.2026 23:59', title: 'Arbeitsauftrag Präsentation', link: null },
      { text: 'Schularbeit Mathematik Mo, 28.09.2026, 08:00 - 09:40 Raum 204', title: 'Schularbeit Mathematik', link: null },
      { text: 'Sa, 26.09.2026 Exkursion Technisches Museum', title: '', link: null },
      { text: 'Neuigkeit vom 01.09.2026 – Schulstart', title: 'Willkommen', link: null }
    ]
  };
  const items = parseLmsPage(page, { now: NOW });
  assert.equal(items.length, 3);
  const task = items.find((i) => i.title === 'Arbeitsauftrag Präsentation');
  assert.equal(task.due, at(2026, 9, 25, 23, 59));
  assert.equal(task.type, 'assignment');
  const sa = items.find((i) => i.title === 'Schularbeit Mathematik');
  assert.equal(sa.examType, 'Schularbeit');
  assert.equal(sa.end, at(2026, 9, 28, 9, 40));
  const ex = items.find((i) => /Exkursion/.test(i.title));
  assert.equal(ex.type, 'event', '„Sa“ (Samstag) ist keine Schularbeit');
  assert.equal(ex.title, 'Exkursion Technisches Museum');
});

test('LMS.at: Spalten erkennen', () => {
  assert.deepEqual(mapColumns(['Titel', 'Fach', 'Fällig am', 'Status']), { title: 0, due: 2, course: 1, status: 3 });
  assert.deepEqual(mapColumns(['Termin', 'Datum', 'Gruppe']), { title: 0, due: 1, course: 2, status: -1 });
});

function dom(html) {
  const window = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', url: 'https://lms.at/dotlrn/' }).window;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get: () => 10 });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get: () => 10 });
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  return window;
}

// wie im echten Abruf: das Ergebnis kommt als JSON aus der Seite
const run = (window, fn) => JSON.parse(JSON.stringify(window.eval(`(${fn.toString()})(null)`)));

test('LMS.at: Seite im Browser auslesen (Tabelle, Liste, Menü, Anmeldung)', () => {
  const page = run(
    dom(`<nav><a href="/dotlrn/aufgaben">Aufgaben</a> <a href="/dotlrn/kalender">Termine</a> <a href="/logout">Abmelden</a></nav>
      <table><thead><tr><th>Aufgabe</th><th>Abgabe</th></tr></thead><tbody><tr><td><a href="/a/1">Referat</a></td><td>25.09.2026 23:59</td></tr></tbody></table>
      <ul><li class="cal-item"><strong>Test Wirtschaft</strong> <span>29.09.2026 09:45</span></li><li>ohne Datum</li></ul>`),
    scanPage
  );
  assert.equal(page.login, false);
  assert.equal(page.loggedIn, true);
  assert.deepEqual(page.nav.map((n) => n.text), ['Aufgaben', 'Termine']);
  assert.equal(page.tables[0].rows[0].link, 'https://lms.at/a/1');
  assert.equal(page.blocks.length, 1);
  const items = parseLmsPage(page, { now: NOW });
  assert.deepEqual(items.map((i) => [i.title, i.type]), [['Referat', 'assignment'], ['Test Wirtschaft', 'exam']]);

  const login = run(dom('<form><input type="text"><input type="password"><button>Anmelden</button></form>'), scanPage);
  assert.equal(login.login, true);
});
