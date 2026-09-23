import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/renderer/logic.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 9, 23, 12, 0); // Mittwoch

test('Status: offen, überfällig, abgegeben, lokal erledigt, Termin', () => {
  const task = { id: 'a', source: 'teams', type: 'assignment', due: at(2026, 9, 23, 10, 0), status: 'open' };
  assert.equal(L.effectiveStatus(task, {}, NOW), 'overdue');
  assert.equal(L.effectiveStatus({ ...task, due: at(2026, 9, 23, 23, 59) }, {}, NOW), 'open');
  assert.equal(L.effectiveStatus({ ...task, status: 'submitted' }, {}, NOW), 'submitted');
  assert.equal(L.effectiveStatus(task, { done: { a: 1 } }, NOW), 'done');
  const allDay = { id: 'h', source: 'webuntis', type: 'homework', due: at(2026, 9, 23), allDay: true, status: 'open' };
  assert.equal(L.effectiveStatus(allDay, {}, NOW), 'open', 'ganztägig heute ist noch nicht überfällig');
  const exam = { id: 'e', source: 'webuntis', type: 'exam', due: at(2026, 9, 25, 8, 0), status: 'open' };
  assert.equal(L.effectiveStatus(exam, {}, NOW), 'upcoming');
  assert.equal(L.effectiveStatus({ ...exam, due: at(2026, 9, 22, 8, 0) }, {}, NOW), 'past');
});

test('Gruppierung nach Fälligkeit', () => {
  const items = [
    { id: '1', source: 'teams', type: 'assignment', title: 'überfällig', due: at(2026, 9, 22, 10), status: 'open' },
    { id: '2', source: 'teams', type: 'assignment', title: 'heute', due: at(2026, 9, 23, 23, 59), status: 'open' },
    { id: '3', source: 'webuntis', type: 'homework', title: 'morgen', due: at(2026, 9, 24), allDay: true, status: 'open' },
    { id: '4', source: 'letto', type: 'exercise', title: 'freitag', due: at(2026, 9, 25), allDay: true, status: 'open' },
    { id: '5', source: 'letto', type: 'exercise', title: 'nächste woche', due: at(2026, 9, 30), allDay: true, status: 'open' },
    { id: '6', source: 'own', kind: 'task', title: 'später', due: at(2026, 11, 1), status: 'open' },
    { id: '7', source: 'own', kind: 'task', title: 'ohne datum', due: null, status: 'open' },
    { id: '8', source: 'teams', type: 'assignment', title: 'fertig', due: at(2026, 9, 24, 12), status: 'submitted' }
  ];
  const groups = L.groupItems(items, { local: {}, now: NOW, showDone: true });
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((i) => i.id)]),
    [
      ['overdue', ['1']],
      ['today', ['2']],
      ['tomorrow', ['3']],
      ['week', ['4']],
      ['nextweek', ['5']],
      ['later', ['6']],
      ['nodate', ['7']],
      ['done', ['8']]
    ]
  );
  assert.equal(L.groupItems(items, { local: {}, now: NOW }).some((g) => g.key === 'done'), false);
  const s = L.stats(items, { local: {}, now: NOW });
  assert.equal(s.overdue, 1);
  assert.equal(s.dueToday, 1);
  assert.equal(s.open, 7);
});

test('Filter nach Plattform, Art und Suche', () => {
  const items = [
    { id: '1', source: 'teams', type: 'assignment', title: 'Doku SEW', status: 'open' },
    { id: '2', source: 'webuntis', type: 'exam', title: 'Schularbeit', subject: 'AM', status: 'open' },
    { id: '3', source: 'eduvidual', type: 'quiz', title: 'Selbsttest', status: 'open' }
  ];
  assert.deepEqual(L.filterItems(items, { sources: new Set(['teams']) }).map((i) => i.id), ['1']);
  assert.deepEqual(L.filterItems(items, { kind: 'tasks' }).map((i) => i.id), ['1', '3']);
  assert.deepEqual(L.filterItems(items, { kind: 'appointments' }).map((i) => i.id), ['2', '3']);
  assert.deepEqual(L.filterItems(items, { query: 'am schul' }).map((i) => i.id), ['2']);
  assert.deepEqual(L.filterItems(items, { local: { dismissed: { 1: 1 } } }).map((i) => i.id), ['2', '3']);
});

test('Texte: Fälligkeit, Wochennummer, Titel', () => {
  assert.equal(L.fmtDue({ due: at(2026, 9, 24, 8, 0) }, NOW), 'Morgen 08:00');
  assert.equal(L.fmtDue({ due: at(2026, 9, 23), allDay: true }, NOW), 'Heute');
  assert.equal(L.fmtDue({ due: at(2026, 9, 28), allDay: true }, NOW), 'Mo, 28.09.');
  assert.equal(L.fmtRelative({ due: at(2026, 9, 26), allDay: true }, NOW), 'in 3 Tagen');
  assert.equal(L.fmtRelative({ due: at(2026, 9, 23, 14, 0) }, NOW), 'in 2 Std.');
  assert.equal(L.isoWeek(NOW), 39);
  assert.equal(L.isoWeek(at(2027, 1, 1)), 53);
  assert.equal(L.fmtDateLong(at(2027, 1, 12)), 'Dienstag, 12. Jänner 2027');
  assert.equal(L.displayTitle({ type: 'exam', title: 'Test', subject: 'NVS' }), 'Test NVS');
  assert.equal(L.displayTitle({ type: 'exam', title: 'Schularbeit AM', subject: 'AM' }), 'Schularbeit AM');
  assert.equal(L.monthGrid(L.startOfMonth(NOW)).length, 42);
});

test('Stundenplan: Doppelstunden werden zusammengefasst, Gruppen nebeneinander gelegt', () => {
  const l = (id, h1, m1, h2, m2, extra = {}) => ({ id, lessonId: 1, subject: 'KOP', teacher: 'EIS', room: 'EDV9', start: at(2026, 9, 22, h1, m1), end: at(2026, 9, 22, h2, m2), ...extra });
  const merged = L.mergeLessons([
    l('a', 7, 50, 8, 40),
    l('b', 8, 40, 9, 30),
    l('c', 9, 45, 10, 35), // über die Pause hinweg
    l('d', 7, 50, 8, 40, { teacher: 'LAM', room: '5AHME', lessonId: 2 }),
    l('e', 8, 40, 9, 30, { teacher: 'LAM', room: '5AHME', lessonId: 2 }),
    l('f', 11, 30, 12, 20, { lessonId: 3, subject: 'MEEM', teacher: 'BOC', room: '5BHME' }),
    l('g', 14, 0, 14, 50, { lessonId: 3, subject: 'MEEM', teacher: 'BOC', room: '5BHME' }) // Mittagspause: nicht zusammenfassen
  ]);
  const eis = merged.find((x) => x.teacher === 'EIS');
  assert.equal(L.minuteOfDay(eis.start), 7 * 60 + 50);
  assert.equal(L.minuteOfDay(eis.end), 10 * 60 + 35);
  assert.equal(merged.filter((x) => x.subject === 'MEEM').length, 2);
  const laid = L.layoutOverlaps(merged);
  const byTeacher = (t) => laid.find((x) => x.teacher === t);
  assert.equal(byTeacher('EIS').cols, 2);
  assert.equal(byTeacher('LAM').cols, 2);
  assert.notEqual(byTeacher('EIS').col, byTeacher('LAM').col);
  assert.equal(laid.filter((x) => x.subject === 'MEEM').every((x) => x.cols === 1), true);
  assert.equal(L.lessonColor({ subject: 'AM' }), L.lessonColor({ subject: 'AM' }));
  assert.equal(L.lessonColor({ subject: 'AM', color: '#94d82d' }), '#94d82d');
});
