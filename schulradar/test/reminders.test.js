'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dueReminders, dailySummary } = require('../src/main/reminders');

const settings = {
  reminders: { enabled: true, leadHours: [24, 3], eveningBefore: true, eveningTime: '18:00', dailySummary: true, summaryTime: '07:00' }
};
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('Abgabe mit Uhrzeit: Erinnerung 3 Stunden vorher, genau einmal', () => {
  const items = [{ id: 't1', source: 'teams', type: 'assignment', title: 'Doku', due: at(2026, 9, 23, 23, 59), allDay: false, status: 'open' }];
  const now = at(2026, 9, 23, 21, 0);
  const fired = {};
  const r = dueReminders({ items, local: { done: {}, dismissed: {} }, settings, fired, now });
  assert.equal(r.length, 1);
  assert.match(r[0].title, /in 3 Stunden/);
  assert.match(r[0].body, /Doku/);
  fired[r[0].key] = now;
  assert.equal(dueReminders({ items, local: { done: {}, dismissed: {} }, settings, fired, now: now + 60000 }).length, 0);
});

test('Test am nächsten Tag: Erinnerung am Vorabend um 18:00', () => {
  const items = [{ id: 'e1', source: 'webuntis', type: 'exam', examType: 'Schularbeit', title: 'Schularbeit', subject: 'AM', room: 'R204', due: at(2026, 9, 29, 8, 0), allDay: false, status: 'open' }];
  const before = dueReminders({ items, local: { done: {}, dismissed: {} }, settings, fired: {}, now: at(2026, 9, 28, 17, 59) });
  assert.equal(before.length, 0);
  const r = dueReminders({ items, local: { done: {}, dismissed: {} }, settings, fired: {}, now: at(2026, 9, 28, 18, 5) });
  assert.equal(r.length, 1);
  assert.match(r[0].title, /Morgen: Schularbeit um 08:00/);
  assert.match(r[0].body, /R204/);
});

test('Keine Erinnerung für Erledigtes, Ausgeblendetes oder zu spät Nachgeholtes', () => {
  const hw = { id: 'h1', source: 'webuntis', type: 'homework', title: 'Buch', due: at(2026, 9, 24), allDay: true, status: 'open' };
  const now = at(2026, 9, 23, 18, 30);
  assert.equal(dueReminders({ items: [hw], local: { done: {}, dismissed: {} }, settings, fired: {}, now }).length, 1);
  assert.equal(dueReminders({ items: [hw], local: { done: { h1: 1 }, dismissed: {} }, settings, fired: {}, now }).length, 0);
  assert.equal(dueReminders({ items: [hw], local: { done: {}, dismissed: { h1: 1 } }, settings, fired: {}, now }).length, 0);
  assert.equal(dueReminders({ items: [{ ...hw, status: 'done' }], local: { done: {}, dismissed: {} }, settings, fired: {}, now }).length, 0);
  // PC war aus – die "1 Tag vorher"-Erinnerung ist 7 Stunden alt und wird nicht mehr nachgeholt
  const doc = { id: 't9', source: 'teams', type: 'assignment', title: 'Doku', due: at(2026, 9, 23, 23, 59), status: 'open' };
  assert.equal(dueReminders({ items: [doc], local: { done: {}, dismissed: {} }, settings, fired: {}, now: at(2026, 9, 23, 7, 0) }).length, 0);
  assert.equal(dueReminders({ items: [doc], local: { done: {}, dismissed: {} }, settings, fired: {}, now: at(2026, 9, 23, 3, 0) }).length, 1);
  // Erinnerungen aus
  assert.equal(dueReminders({ items: [hw], local: {}, settings: { reminders: { ...settings.reminders, enabled: false } }, fired: {}, now }).length, 0);
});

test('Morgendliche Übersicht zählt Abgaben, Tests und Überfälliges', () => {
  const items = [
    { id: 'a', source: 'teams', type: 'assignment', title: 'A', due: at(2026, 9, 23, 23, 59), status: 'open' },
    { id: 'b', source: 'webuntis', type: 'exam', title: 'B', due: at(2026, 9, 23, 10, 0), status: 'open' },
    { id: 'c', source: 'webuntis', type: 'homework', title: 'C', due: at(2026, 9, 21), allDay: true, status: 'open' },
    { id: 'd', source: 'teams', type: 'assignment', title: 'D', due: at(2026, 9, 23, 20, 0), status: 'submitted' }
  ];
  const s = dailySummary({ items, local: { done: {}, dismissed: {} }, settings, lastSummary: '', now: at(2026, 9, 23, 7, 10) });
  assert.equal(s.date, '2026-09-23');
  assert.equal(s.body, '1 Abgabe heute · 1 Test heute · 1 überfällig');
  assert.equal(dailySummary({ items, local: {}, settings, lastSummary: '2026-09-23', now: at(2026, 9, 23, 7, 10) }), null);
  assert.equal(dailySummary({ items, local: {}, settings, lastSummary: '', now: at(2026, 9, 23, 6, 50) }), null);
  const quiet = dailySummary({ items: [], local: {}, settings, lastSummary: '', now: at(2026, 9, 23, 7, 10) });
  assert.equal(quiet.silent, true);
});

test('Handy: künftige Erinnerungen werden im Voraus geplant', () => {
  const { plannedReminders } = require('../src/main/reminders');
  const items = [
    { id: 't1', source: 'teams', type: 'assignment', title: 'Doku', due: at(2026, 9, 25, 23, 59), status: 'open' },
    { id: 'e1', source: 'webuntis', type: 'exam', examType: 'Test', title: 'Test', subject: 'AM', due: at(2026, 9, 29, 8, 0), status: 'open' },
    { id: 'x', source: 'teams', type: 'assignment', title: 'Fertig', due: at(2026, 9, 26, 12, 0), status: 'submitted' }
  ];
  const plan = plannedReminders({ items, local: { done: {}, dismissed: {} }, settings, now: at(2026, 9, 23, 12, 0) });
  assert.deepEqual(
    plan.map((p) => [p.itemId, new Date(p.at).getDate(), new Date(p.at).getHours()]),
    [
      ['t1', 24, 23],
      ['t1', 25, 20],
      ['e1', 28, 18]
    ]
  );
  assert.equal(plannedReminders({ items, local: { done: { t1: 1 }, dismissed: {} }, settings, now: at(2026, 9, 23, 12, 0) }).length, 1);
});
