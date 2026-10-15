'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planStudy, freeSlot, pickDays, weeklyReview, reviewText, DEFAULTS } = require('../src/main/planner');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 12, 10, 0); // Montag, 12. Oktober, 10:00

test('Freie Zeit: nach dem Unterricht, um Termine herum, nicht in der Vergangenheit', () => {
  const day = at(2026, 10, 13);
  const busy = [
    { start: at(2026, 10, 13, 8), end: at(2026, 10, 13, 15, 50), lesson: true },
    { start: at(2026, 10, 13, 16, 30), end: at(2026, 10, 13, 18) } // Training
  ];
  const slot = freeSlot(day, busy, DEFAULTS, NOW);
  assert.equal(slot.start, at(2026, 10, 13, 18, 15), '16:15 wäre zu knapp vor dem Training → nach dem Training');
  assert.equal(slot.end - slot.start, 45 * 60000);
  const full = [{ start: at(2026, 10, 13, 8), end: at(2026, 10, 13, 19, 30), lesson: true }];
  assert.equal(freeSlot(day, full, DEFAULTS, NOW), null);
  const today = freeSlot(at(2026, 10, 12), [], DEFAULTS, at(2026, 10, 12, 16, 7));
  assert.equal(today.start, at(2026, 10, 12, 16, 30), 'frühestens 15 Min. ab jetzt, auf Viertelstunden gerundet');
});

test('Tage gleichmäßig verteilen, Tag vor dem Test immer dabei', () => {
  assert.deepEqual(pickDays([1, 2, 3, 4, 5, 6], 3), [2, 4, 6]);
  assert.deepEqual(pickDays([1, 2], 3), [1, 2]);
});

test('Lernplan: Schularbeit bekommt 4 Einheiten, geplante zählen mit, Stundenplan wird beachtet', () => {
  const sa = { id: 'wu:sa', source: 'webuntis', type: 'exam', examType: 'Schularbeit', title: 'Schularbeit', subject: 'AM', due: at(2026, 10, 20, 8), status: 'open' };
  const test1 = { id: 'wu:t', source: 'webuntis', type: 'exam', examType: 'Test', title: 'Test', subject: 'E', due: at(2026, 10, 16, 10), status: 'open' };
  const far = { id: 'wu:far', source: 'webuntis', type: 'exam', title: 'Test', due: at(2026, 12, 20, 8), status: 'open' };
  const planned = { id: 'own:1', source: 'own', kind: 'lernen', examId: 'wu:t', title: 'Lernen', due: at(2026, 10, 15, 15), end: at(2026, 10, 15, 15, 45) };
  const lessons = [];
  for (let d = 12; d <= 20; d++) lessons.push({ start: at(2026, 10, d, 8), end: at(2026, 10, d, 14, 25) });
  const { plans, suggestions } = planStudy({ items: [sa, test1, far, planned], lessons, now: NOW });
  assert.equal(plans.length, 2, 'Test in 5 Wochen ist noch nicht dran');
  const [pt, ps] = plans;
  assert.equal(pt.exam.id, 'wu:t');
  assert.equal(pt.planned, 1);
  assert.equal(pt.suggestions.length, 2);
  assert.ok(pt.suggestions.every((s) => new Date(s.start).getDate() !== 15), 'nicht am Tag, an dem schon gelernt wird');
  assert.equal(ps.suggestions.length, 4);
  assert.ok(ps.suggestions.every((s) => s.start < sa.due));
  for (const s of suggestions) {
    const h = new Date(s.start).getHours();
    const weekend = [0, 6].includes(new Date(s.start).getDay());
    assert.ok(weekend ? h >= 10 : h >= 15, `nicht während des Unterrichts: ${new Date(s.start)}`);
  }
  const starts = suggestions.map((s) => s.start);
  for (const a of suggestions) for (const b of suggestions) if (a !== b) assert.ok(a.end <= b.start || b.end <= a.start, 'keine Überschneidung');
  assert.equal(new Set(starts).size, starts.length);
});

test('Wochenrückblick', () => {
  const now = at(2026, 11, 15, 18); // Sonntag
  const items = [
    { id: 'a', source: 'teams', type: 'assignment', title: 'A', due: at(2026, 11, 18, 23, 59), status: 'open' },
    { id: 'b', source: 'webuntis', type: 'exam', title: 'Test', subject: 'AM', due: at(2026, 11, 19, 8), status: 'open' },
    { id: 'c', source: 'teams', type: 'assignment', title: 'alt', due: at(2026, 11, 10), status: 'open' },
    { id: 'g', source: 'gtasks', type: 'task', title: 'G', status: 'done', completedAt: at(2026, 11, 13, 9) }
  ];
  const r = weeklyReview({
    items,
    local: { done: { x: at(2026, 11, 12, 9), y: at(2026, 11, 5) } },
    focusSessions: [
      { start: at(2026, 11, 13, 16), minutes: 50, label: 'Diplomarbeit' },
      { start: at(2026, 11, 14, 16), minutes: 25, label: 'AM' },
      { start: at(2026, 11, 1, 16), minutes: 99, label: 'alt' }
    ],
    now
  });
  assert.equal(r.doneCount, 2);
  assert.equal(r.overdue, 1);
  assert.equal(r.nextTasks, 1);
  assert.deepEqual(r.nextExams.map((e) => e.id), ['b']);
  assert.equal(r.focusMin, 75);
  assert.equal(r.topLabel, 'Diplomarbeit');
  assert.match(reviewText(r), /2 erledigt · 1,3 h Fokus · 1 überfällig\. Nächste Woche: 1 Abgabe, 1 Test \(AM\)/);
});
