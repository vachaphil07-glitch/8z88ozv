'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCalendar, eventsInRange, parseDuration } = require('../src/main/util/ical');
const gcal = require('../src/main/connectors/gcal');
const gtasks = require('../src/main/connectors/gtasks');
const { Store } = require('../src/main/store');
const { reminderTriggers } = require('../src/main/reminders');

const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Privat',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Vienna',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:training@google.com',
  'DTSTART;TZID=Europe/Vienna:20261014T080000',
  'DTEND;TZID=Europe/Vienna:20261014T093000',
  'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=4',
  'EXDATE;TZID=Europe/Vienna:20261021T080000',
  'SUMMARY:Training',
  'LOCATION:Sporthalle\\, Hollabrunn',
  'BEGIN:VALARM',
  'TRIGGER:-PT10M',
  'DESCRIPTION:Alarm darf den Termin nicht überschreiben',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:training@google.com',
  'RECURRENCE-ID;TZID=Europe/Vienna:20261028T080000',
  'DTSTART;TZID=Europe/Vienna:20261028T100000',
  'DTEND;TZID=Europe/Vienna:20261028T113000',
  'SUMMARY:Training (verschoben)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ferien@google.com',
  'DTSTART;VALUE=DATE:20261026',
  'DTEND;VALUE=DATE:20261031',
  'SUMMARY:Herbstferien',
  'DESCRIPTION:Zeile 1\\nZeile 2 mit einem sehr langen Text der umgebroch',
  ' en wurde',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abgesagt@google.com',
  'DTSTART:20261016T150000Z',
  'DURATION:PT1H',
  'STATUS:CANCELLED',
  'SUMMARY:Abgesagt',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc@google.com',
  'DTSTART:20261016T150000Z',
  'DURATION:PT45M',
  'SUMMARY:Nachhilfe',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const FROM = Date.UTC(2026, 9, 1);
const TO = Date.UTC(2026, 11, 31);

test('iCal: Grunddaten, Zeitzone, Zeilenumbrüche, VALARM', () => {
  const cal = parseCalendar(ICS);
  assert.equal(cal.name, 'Privat');
  const events = eventsInRange(cal, FROM, TO);
  const first = events.find((e) => e.summary === 'Training');
  assert.equal(first.start, Date.UTC(2026, 9, 14, 6, 0), '08:00 Sommerzeit = 06:00 UTC');
  assert.equal(first.end - first.start, 90 * 60000);
  assert.equal(first.location, 'Sporthalle, Hollabrunn');
  const ferien = events.find((e) => e.summary === 'Herbstferien');
  assert.equal(ferien.allDay, true);
  assert.equal(ferien.days, 5);
  assert.equal(ferien.description, 'Zeile 1\nZeile 2 mit einem sehr langen Text der umgebrochen wurde');
  assert.equal(new Date(ferien.start).getDate(), 26, 'ganztägig = lokaler Tag');
  assert.ok(!events.some((e) => e.summary === 'Abgesagt'));
  const utc = events.find((e) => e.summary === 'Nachhilfe');
  assert.equal(utc.start, Date.UTC(2026, 9, 16, 15));
  assert.equal(utc.end - utc.start, 45 * 60000);
});

test('iCal: Wiederholung mit Ausnahme, verschobenem Termin und Zeitumstellung', () => {
  const training = eventsInRange(parseCalendar(ICS), FROM, TO).filter((e) => e.summary.startsWith('Training'));
  assert.deepEqual(
    training.map((e) => [e.summary, e.start]),
    [
      ['Training', Date.UTC(2026, 9, 14, 6)],
      // 21.10. per EXDATE gestrichen; 28.10. verschoben auf 10:00 (Winterzeit = 09:00 UTC)
      ['Training (verschoben)', Date.UTC(2026, 9, 28, 9)],
      // 4.11. wieder 08:00 Ortszeit – nach der Zeitumstellung 07:00 UTC
      ['Training', Date.UTC(2026, 10, 4, 7)]
    ]
  );
});

test('iCal: monatlich am zweiten Montag, täglich mit UNTIL, Zeitraum', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:m',
    'DTSTART:20261012T170000Z',
    'RRULE:FREQ=MONTHLY;BYDAY=2MO',
    'SUMMARY:Elternabend',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:d',
    'DTSTART;VALUE=DATE:20261001',
    'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261007',
    'SUMMARY:Gießen',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n');
  const events = eventsInRange(parseCalendar(ics), FROM, Date.UTC(2027, 0, 31));
  assert.deepEqual(
    events.filter((e) => e.summary === 'Elternabend').map((e) => new Date(e.start).toISOString().slice(0, 10)),
    ['2026-10-12', '2026-11-09', '2026-12-14', '2027-01-11']
  );
  assert.deepEqual(
    events.filter((e) => e.summary === 'Gießen').map((e) => new Date(e.start).getDate()),
    [1, 3, 5, 7]
  );
  assert.equal(parseDuration('P1DT2H'), 26 * 3600000);
});

test('Google Kalender: Adressen prüfen und Einträge bauen', () => {
  assert.equal(gcal.normalizeUrl('webcal://example.org/a.ics'), 'https://example.org/a.ics');
  assert.equal(gcal.normalizeUrl('kein link'), null);
  assert.equal(gcal.normalizeUrl('javascript:alert(1)'), null);
  assert.equal(gcal.describeUrl('https://calendar.google.com/calendar/ical/max%40gmail.com/private-abc/basic.ics'), 'max@gmail.com');
  const items = gcal.toItems(parseCalendar(ICS), { calId: 'c1', calName: 'Privat', from: FROM, to: TO });
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.type === 'event' && i.id.startsWith('gcal:') && i.course === 'Privat'));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'Wiederholungen haben eigene IDs');
});

function fakeCtx(settings) {
  const secrets = {};
  const ctx = {
    settings,
    secrets: { get: (k) => secrets[k], set: (k, v) => (v === null ? delete secrets[k] : (secrets[k] = v)), has: (k) => k in secrets },
    saveSettings: (patch) => Object.assign(settings, patch)
  };
  return { ctx, secrets };
}

test('Google Kalender: Adresse landet bei den Zugangsdaten, nicht in den Einstellungen', () => {
  const settings = { calendars: [] };
  const { ctx, secrets } = fakeCtx(settings);
  const id = gcal.addCalendar(ctx, { url: 'https://calendar.google.com/calendar/ical/x/private-geheim/basic.ics', name: 'Privat' });
  assert.ok(!JSON.stringify(settings).includes('geheim'));
  assert.ok(secrets.urls[id].includes('geheim'));
  assert.ok(gcal.isConfigured(settings, ctx.secrets));
  assert.throws(() => gcal.addCalendar(ctx, { url: 'https://calendar.google.com/calendar/ical/x/private-geheim/basic.ics' }), /schon eingetragen/);
  gcal.removeCalendar(ctx, id);
  assert.equal(settings.calendars.length, 0);
  assert.ok(!gcal.isConfigured(settings, ctx.secrets));
});

test('Google Tasks: Aufgaben, Fälligkeitstag, Status und IDs', () => {
  const items = gtasks.toItems({ id: 'L1', title: 'Schule' }, [
    { id: 't1', title: 'Vokabeln lernen', due: '2026-10-20T00:00:00.000Z', status: 'needsAction', notes: 'Unit 4', webViewLink: 'https://tasks.google.com/task/t1' },
    { id: 't2', title: 'Erledigt', status: 'completed', completed: '2026-10-10T12:00:00.000Z' },
    { id: 't3', title: '   ', status: 'needsAction' },
    { id: 't4', title: 'Gelöscht', deleted: true }
  ]);
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.id, 'gtasks:L1:t1');
  assert.deepEqual(gtasks.parseItemId(a.id), { list: 'L1', task: 't1' });
  assert.equal(a.due, new Date(2026, 9, 20).getTime(), 'Google-Datum = lokaler Tag, unabhängig von der Zeitzone');
  assert.equal(a.allDay, true);
  assert.equal(a.course, 'Schule');
  assert.equal(a.description, 'Unit 4');
  assert.equal(b.status, 'done');
  assert.equal(gtasks.localToDue(new Date(2026, 9, 20, 15, 30).getTime()), '2026-10-20T00:00:00.000Z');
});

test('Notizen speichern, ändern, löschen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-test-'));
  const store = new Store(dir);
  store.saveNote({ title: 'Stoff Mathe', text: 'Kapitel 3', subject: 'AM' });
  const [note] = store.data.notes;
  assert.ok(note.id.startsWith('note:'));
  store.saveNote({ id: note.id, pinned: true });
  assert.equal(store.data.notes[0].pinned, true);
  assert.equal(store.data.notes[0].title, 'Stoff Mathe');
  assert.equal(store.snapshot().notes.length, 1);
  store.deleteNote(note.id);
  assert.equal(store.data.notes.length, 0);
  assert.equal(store.settings.platforms.gtasks.enabled, false, 'neue Plattformen sind anfangs aus');
});

test('Erinnerungen für Google-Kalender-Termine nur, wenn eingeschaltet', () => {
  const now = new Date(2026, 9, 15, 12).getTime();
  const item = { id: 'gcal:1', source: 'gcal', type: 'event', title: 'Arzt', due: new Date(2026, 9, 17, 9).getTime(), status: 'open' };
  const settings = (remind) => ({ reminders: { enabled: true, eveningBefore: true, eveningTime: '18:00', leadHours: [] }, platforms: { gcal: { remind } } });
  assert.equal(reminderTriggers({ items: [item], local: { done: {} }, settings: settings(false), now }).length, 0);
  assert.equal(reminderTriggers({ items: [item], local: { done: {} }, settings: settings(true), now }).length, 1);
});

test('Google Tasks: offene und erledigte Aufgaben getrennt abfragen', async () => {
  const calls = [];
  const open = { id: 'o', title: 'Offen', status: 'needsAction', due: '2026-10-16T00:00:00.000Z' };
  const done = { id: 'd', title: 'Erledigt', status: 'completed', completed: '2026-10-15T08:00:00.000Z' };
  const ctx = {
    settings: { knownLists: [{ id: 'L', title: 'Schule' }], hiddenLists: [] },
    range: { from: Date.UTC(2026, 9, 1) },
    log() {},
    sample() {},
    saveSettings() {},
    google: {
      async request(url) {
        calls.push(url);
        if (url.endsWith('/users/@me/lists?maxResults=100')) return { items: [{ id: 'L', title: 'Schule' }] };
        // wie Google: mit completedMin nur Erledigte
        return { items: url.includes('completedMin') ? [done] : [open] };
      }
    }
  };
  const res = await gtasks.sync(ctx);
  assert.deepEqual(res.items.map((i) => [i.title, i.status]).sort(), [['Erledigt', 'done'], ['Offen', 'open']]);
  assert.ok(calls.some((u) => u.includes('showCompleted=false') && !u.includes('completedMin')));
});
