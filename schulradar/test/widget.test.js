'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { widgetData } = require('../src/main/widget');

test('Widget: offene Aufgaben und Tests mit Datum, sortiert', () => {
  const now = new Date(2026, 9, 15, 12).getTime();
  const d = (day, h = 0) => new Date(2026, 9, day, h).getTime();
  const data = widgetData({
    items: [
      { id: 'a', source: 'teams', type: 'assignment', title: 'Abgabe B', due: d(16, 23), status: 'open' },
      { id: 'b', source: 'teams', type: 'assignment', title: 'Abgabe A', due: d(15, 23), status: 'open', subject: 'SEW' },
      { id: 'c', source: 'teams', type: 'assignment', title: 'Abgegeben', due: d(15, 23), status: 'submitted' },
      { id: 'e', source: 'webuntis', type: 'exam', title: 'Schularbeit', subject: 'AM', due: d(20, 8), status: 'open' },
      { id: 'f', source: 'gcal', type: 'event', title: 'Training', due: d(15, 17), status: 'open' },
      { id: 'g', source: 'teams', type: 'assignment', title: 'Weit weg', due: d(15) + 40 * 864e5, status: 'open' },
      { id: 'h', source: 'own', kind: 'task', title: 'Abgehakt', due: d(15, 20) }
    ],
    local: { done: { h: now } },
    now
  });
  assert.deepEqual(data.tasks.map((t) => t.t), ['Abgabe A', 'Abgabe B']);
  assert.equal(data.tasks[0].s, 'SEW');
  assert.deepEqual(data.exams.map((e) => [e.t, e.s]), [['Schularbeit', 'AM']]);
});
