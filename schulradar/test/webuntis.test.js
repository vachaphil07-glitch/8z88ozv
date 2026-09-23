'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHomeworks, parseExams, parseTimetable, parseUntisLink } = require('../src/main/connectors/webuntis');
const { toIsoDate } = require('../src/main/util/dates');

test('Hausübungen mit Fach, Lehrkraft und Status', () => {
  const json = {
    data: {
      records: [{ homeworkId: 11, teacherId: 7, elementIds: [1] }],
      homeworks: [
        { id: 11, lessonId: 100, date: 20260921, dueDate: 20260924, text: 'Buch S. 84\nAufgaben 3–7', remark: 'mit Lösungsweg', completed: false, attachments: [{ id: 1 }] },
        { id: 12, lessonId: 101, date: 20260920, dueDate: 20260922, text: 'Vokabeln', remark: '', completed: true, attachments: [] }
      ],
      teachers: [{ id: 7, name: 'HUB' }],
      lessons: [
        { id: 100, subject: 'AM', lessonType: 'Unterricht' },
        { id: 101, subject: 'E', lessonType: 'Unterricht' }
      ]
    }
  };
  const [a, b] = parseHomeworks(json);
  assert.equal(a.id, 'webuntis:hw:11');
  assert.equal(a.title, 'Buch S. 84');
  assert.match(a.description, /Aufgaben 3–7/);
  assert.match(a.description, /mit Lösungsweg/);
  assert.equal(a.subject, 'AM');
  assert.equal(a.teacher, 'HUB');
  assert.equal(toIsoDate(a.due), '2026-09-24');
  assert.equal(a.allDay, true);
  assert.equal(a.status, 'open');
  assert.equal(a.attachments, 1);
  assert.equal(b.status, 'done');
});

test('Prüfungen: nur eigene, Titel-Ersatz und Uhrzeit', () => {
  const json = {
    data: {
      exams: [
        { id: 1, examType: 'Schularbeit', name: '', subject: 'AM', teachers: ['HUB'], rooms: ['R204'], examDate: 20260929, startTime: 800, endTime: 940, text: 'Vektoren', assignedStudents: [{ id: 5 }, { id: 6 }] },
        { id: 2, examType: 'Test', name: 'Test NVS', subject: 'NVS', examDate: 20260925, startTime: 1005, endTime: 1055, assignedStudents: [{ id: 9 }] },
        { id: 3, examType: 'Test', name: 'Wiederholung', subject: 'GGP', examDate: 20261005, startTime: 0, endTime: 0, assignedStudents: [] }
      ]
    }
  };
  const items = parseExams(json, { personId: 5 });
  assert.deepEqual(items.map((i) => i.id), ['webuntis:exam:1', 'webuntis:exam:3']);
  const [sa, wh] = items;
  assert.equal(sa.title, 'Schularbeit AM');
  assert.equal(sa.type, 'exam');
  assert.equal(sa.room, 'R204');
  assert.equal(new Date(sa.start).getHours(), 8);
  assert.equal(new Date(sa.end).getMinutes(), 40);
  assert.equal(sa.allDay, false);
  assert.equal(wh.allDay, true);
});

test('Stundenplan aus weekly/data', () => {
  const json = {
    data: {
      result: {
        data: {
          elementPeriods: {
            5: [
              { id: 2, date: 20260922, startTime: 850, endTime: 940, elements: [{ type: 1, id: 10 }, { type: 3, id: 30 }, { type: 4, id: 40 }, { type: 2, id: 20 }], cellState: 'CANCEL', lessonText: '' },
              { id: 1, date: 20260922, startTime: 800, endTime: 850, elements: [{ type: 3, id: 31 }, { type: 4, id: 41 }], cellState: 'STANDARD' }
            ]
          },
          elements: [
            { type: 3, id: 30, name: 'AM', longName: 'Angewandte Mathematik', backColor: '94D82D' },
            { type: 1, id: 10, name: '5BHME' },
            { type: 3, id: 31, name: 'D', longName: 'Deutsch' },
            { type: 4, id: 40, name: 'R204' },
            { type: 4, id: 41, name: 'R111' },
            { type: 2, id: 20, name: 'HUB' }
          ]
        }
      }
    }
  };
  const lessons = parseTimetable(json, 5);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].subject, 'D');
  assert.equal(lessons[1].subject, 'AM');
  assert.equal(lessons[1].cancelled, true);
  assert.equal(lessons[1].room, 'R204');
  assert.equal(lessons[1].teacher, 'HUB');
  assert.equal(lessons[1].klasse, '5BHME');
  assert.equal(lessons[1].color, '#94d82d');
  assert.equal(lessons[0].color, '');
  assert.deepEqual(parseTimetable({ data: { error: {} } }, 5), []);
});

test('Untis-Mobile-Link auslesen', () => {
  const info = parseUntisLink('<img alt="untis://setschool?url=htl-hl.webuntis.com&amp;school=htl-hl&amp;user=MaxM&amp;key=ABCDEFGHIJKLMNOP&amp;schoolNumber=123">');
  assert.deepEqual(info, { server: 'htl-hl.webuntis.com', school: 'htl-hl', user: 'MaxM', key: 'ABCDEFGHIJKLMNOP' });
  assert.equal(parseUntisLink('nichts'), null);
});
