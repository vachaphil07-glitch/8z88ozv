import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEvent, upcomingEvents, googleUrl, outlookUrl, yahooUrl, icsCalendar, icsFileName } from '../src/renderer/calendar.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const exam = {
  id: 'wu:exam:1',
  source: 'webuntis',
  type: 'exam',
  examType: 'Schularbeit',
  title: 'Schularbeit',
  subject: 'AM',
  room: 'R 204',
  teacher: 'HUB',
  due: at(2026, 9, 28, 8, 0),
  end: at(2026, 9, 28, 9, 40),
  allDay: false,
  status: 'open',
  description: 'Stoff: Vektorrechnung; Kapitel 3, 4 und 5'
};

test('Kalender: Schularbeit wird ein Termin mit Beginn, Ende, Raum und Erinnerung am Vorabend', () => {
  const ev = calendarEvent(exam);
  assert.equal(ev.title, 'Schularbeit AM');
  assert.equal(ev.start, exam.due);
  assert.equal(ev.end, exam.end);
  assert.equal(ev.location, 'R 204');
  assert.equal(ev.alarm, at(2026, 9, 27, 18, 0));
  assert.match(ev.description, /Schularbeit · WebUntis · AM/);
  assert.match(ev.description, /Lehrkraft: HUB/);
});

test('Kalender: Abgaben enden zur Abgabezeit, ganztägige Einträge bekommen ganze Tage', () => {
  const task = calendarEvent({ id: 't1', source: 'teams', type: 'assignment', title: 'Projektdoku', course: '4AHIT SEW', due: at(2026, 9, 23, 23, 59), status: 'open' });
  assert.equal(task.title, 'Abgabe: Projektdoku (4AHIT SEW)');
  assert.equal(task.end, at(2026, 9, 23, 23, 59));
  assert.equal(task.start, at(2026, 9, 23, 23, 29));
  assert.equal(task.alarm, null);
  const hw = calendarEvent({ id: 'h1', source: 'webuntis', type: 'homework', title: 'Buch S. 84', subject: 'AM', due: at(2026, 9, 24), allDay: true, status: 'open' });
  assert.equal(hw.allDay, true);
  assert.equal(hw.start, at(2026, 9, 24));
  assert.equal(hw.end, at(2026, 9, 25));
  assert.equal(calendarEvent({ id: 'x', title: 'ohne Datum' }), null);
});

test('Kalender: Links für Google, Outlook und Yahoo', () => {
  const ev = calendarEvent(exam);
  const g = new URL(googleUrl(ev));
  assert.equal(g.host, 'calendar.google.com');
  assert.equal(g.searchParams.get('action'), 'TEMPLATE');
  assert.equal(g.searchParams.get('text'), 'Schularbeit AM');
  assert.equal(g.searchParams.get('dates'), `${isoBasic(exam.due)}/${isoBasic(exam.end)}`);
  assert.equal(g.searchParams.get('location'), 'R 204');

  const o = new URL(outlookUrl(ev));
  assert.equal(o.host, 'outlook.office.com');
  assert.equal(o.searchParams.get('rru'), 'addevent');
  assert.equal(o.searchParams.get('startdt'), new Date(exam.due).toISOString());
  assert.equal(new URL(outlookUrl(ev, { office: false })).host, 'outlook.live.com');

  const y = new URL(yahooUrl(ev));
  assert.equal(y.searchParams.get('st'), isoBasic(exam.due));
  assert.equal(y.searchParams.get('et'), isoBasic(exam.end));

  const day = calendarEvent({ id: 'd', source: 'own', kind: 'termin', title: 'Wandertag', due: at(2026, 10, 2), allDay: true });
  assert.equal(new URL(googleUrl(day)).searchParams.get('dates'), '20261002/20261003');
  assert.equal(new URL(outlookUrl(day)).searchParams.get('allday'), 'true');
  assert.equal(new URL(yahooUrl(day)).searchParams.get('dur'), 'allday');
});

function isoBasic(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

test('Kalender: .ics-Datei nach RFC 5545 (Zeilenenden, Sonderzeichen, Umbruch, ganztägig)', () => {
  const ics = icsCalendar(
    [calendarEvent(exam), calendarEvent({ id: 'h1', source: 'webuntis', type: 'homework', title: 'Ä'.repeat(60), due: at(2026, 9, 24), allDay: true })],
    { now: at(2026, 9, 23, 12) }
  );
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /UID:wu:exam:1@schulradar/);
  assert.match(ics, new RegExp(`DTSTART:${isoBasic(exam.due)}`));
  assert.match(ics, /DTSTART;VALUE=DATE:20260924\r\nDTEND;VALUE=DATE:20260925/);
  assert.match(ics, /TRIGGER;VALUE=DATE-TIME:/);
  // keine Zeile länger als 75 Bytes, Fortsetzungszeilen beginnen mit Leerzeichen
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /Stoff: Vektorrechnung\\; Kapitel 3\\, 4 und 5/);
  assert.match(unfolded, new RegExp(`SUMMARY:Hausübung: ${'Ä'.repeat(60)}`));
});

test('Kalender: Sammel-Export nimmt nur kommende Termine (optional mit Abgaben)', () => {
  const now = at(2026, 9, 23, 12);
  const items = [
    exam,
    { id: 'old', source: 'webuntis', type: 'exam', title: 'Test', due: at(2026, 9, 1, 8), status: 'open' },
    { id: 't', source: 'teams', type: 'assignment', title: 'Doku', due: at(2026, 9, 25, 23, 59), status: 'open' },
    { id: 's', source: 'teams', type: 'assignment', title: 'Fertig', due: at(2026, 9, 26, 23, 59), status: 'submitted' },
    { id: 'hidden', source: 'lms', type: 'exam', title: 'Test', due: at(2026, 9, 30, 8), status: 'open' }
  ];
  const local = { done: {}, dismissed: { hidden: 1 } };
  assert.deepEqual(upcomingEvents(items, local, now).map((e) => e.uid), ['wu:exam:1@schulradar']);
  assert.deepEqual(upcomingEvents(items, local, now, { withTasks: true }).map((e) => e.uid), ['t@schulradar', 'wu:exam:1@schulradar']);
  assert.equal(icsFileName(calendarEvent(exam)), 'schularbeit-am-2026-09-28.ics');
});
