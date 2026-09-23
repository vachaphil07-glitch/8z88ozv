'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMoodleEvents, cleanEventName, flattenParams, decodeLaunchToken } = require('../src/main/connectors/eduvidual');

const course = { id: 42, fullname: 'Datenbanken 4AHIT', shortname: 'DBI' };
const t = (iso) => Math.floor(Date.parse(iso) / 1000);

test('Offene Abgaben, erledigte Abgaben und Termine werden unterschieden', () => {
  const pending = [
    { id: 1, name: 'SQL-Übungsblatt 2 ist fällig', activityname: 'SQL-Übungsblatt 2', modulename: 'assign', eventtype: 'due', timesort: t('2026-09-24T16:00:00Z'), course, action: { name: 'Abgabe hinzufügen', url: 'https://www.eduvidual.at/mod/assign/view.php?id=9', actionable: true } }
  ];
  const events = [
    { id: 1, name: 'SQL-Übungsblatt 2 ist fällig', modulename: 'assign', eventtype: 'due', timestart: t('2026-09-24T16:00:00Z'), course, url: 'https://www.eduvidual.at/mod/assign/view.php?id=9' },
    { id: 2, name: 'Lesetagebuch ist fällig', modulename: 'assign', eventtype: 'due', timestart: t('2026-09-30T21:59:00Z'), course },
    { id: 3, name: 'Quiz öffnet', modulename: 'quiz', eventtype: 'open', timestart: t('2026-09-26T06:00:00Z'), course },
    { id: 4, name: 'Exkursion', eventtype: 'course', timestart: t('2026-10-02T06:00:00Z'), course },
    { id: 5, name: 'Alte Abgabe ist fällig', modulename: 'assign', eventtype: 'due', timestart: t('2026-01-01T10:00:00Z'), course }
  ];
  const items = parseMoodleEvents({ pending, events, base: 'https://www.eduvidual.at', from: Date.parse('2026-09-01T00:00:00Z') });
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(items.length, 3);
  assert.equal(byId['eduvidual:ev:1'].status, 'open');
  assert.equal(byId['eduvidual:ev:1'].title, 'SQL-Übungsblatt 2');
  assert.equal(byId['eduvidual:ev:1'].type, 'assignment');
  assert.equal(byId['eduvidual:ev:1'].subject, 'DBI');
  assert.equal(byId['eduvidual:ev:1'].url, 'https://www.eduvidual.at/mod/assign/view.php?id=9');
  assert.equal(byId['eduvidual:ev:2'].status, 'submitted');
  assert.equal(byId['eduvidual:ev:2'].title, 'Lesetagebuch');
  assert.equal(byId['eduvidual:ev:4'].type, 'event');
  assert.equal(byId['eduvidual:ev:4'].url, 'https://www.eduvidual.at/course/view.php?id=42');
  assert.equal(byId['eduvidual:ev:3'], undefined);
});

test('Ereignisnamen bereinigen', () => {
  assert.equal(cleanEventName('Hausübung 3 ist fällig'), 'Hausübung 3');
  assert.equal(cleanEventName('Test 1 schließt'), 'Test 1');
  assert.equal(cleanEventName('Essay is due'), 'Essay');
  assert.equal(cleanEventName('„Projekt“'), 'Projekt');
});

test('Parameter im Moodle-Format', () => {
  const p = flattenParams({ timesortfrom: 5, options: { userevents: true }, ids: [3, 4] });
  assert.equal(p.toString(), 'timesortfrom=5&options%5Buserevents%5D=1&ids%5B0%5D=3&ids%5B1%5D=4');
});

test('Token aus moodlemobile://-Link', () => {
  const token = '0123456789abcdef0123456789abcdef';
  const url = `moodlemobile://token=${Buffer.from(`abc123:::${token}:::private`).toString('base64')}`;
  assert.equal(decodeLaunchToken(url), token);
  assert.equal(decodeLaunchToken('moodlemobile://token=' + Buffer.from('kaputt').toString('base64')), null);
});
