'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLooseDate, untisToMs, toUntisDate, startOfWeek, toIsoDate } = require('../src/main/util/dates');
const { totp, base32Decode } = require('../src/main/util/totp');

test('parseLooseDate: Letto-Format "23. Feb. 2026"', () => {
  const r = parseLooseDate('23. Feb. 2026');
  assert.equal(toIsoDate(r.ms), '2026-02-23');
  assert.equal(r.hasTime, false);
});

test('parseLooseDate: deutsche Monatsnamen inkl. Umlaut und Jänner', () => {
  assert.equal(toIsoDate(parseLooseDate('4. März 2026').ms), '2026-03-04');
  assert.equal(toIsoDate(parseLooseDate('04. Okt. 2025').ms), '2025-10-04');
  assert.equal(toIsoDate(parseLooseDate('12. Jänner 2027').ms), '2027-01-12');
  assert.equal(toIsoDate(parseLooseDate('22. Nov. 2025').ms), '2025-11-22');
});

test('parseLooseDate: numerisch mit und ohne Uhrzeit', () => {
  const a = parseLooseDate('23.02.2026');
  assert.equal(toIsoDate(a.ms), '2026-02-23');
  assert.equal(a.hasTime, false);
  const b = parseLooseDate('23.02.2026 14:30');
  assert.equal(b.hasTime, true);
  assert.equal(new Date(b.ms).getHours(), 14);
  assert.equal(new Date(b.ms).getMinutes(), 30);
  const c = parseLooseDate('23.02.26');
  assert.equal(toIsoDate(c.ms), '2026-02-23');
  assert.equal(c.hasTime, false);
});

test('parseLooseDate: ISO und ungültige Werte', () => {
  assert.equal(parseLooseDate('2026-09-25T21:59:00Z').ms, Date.parse('2026-09-25T21:59:00Z'));
  assert.equal(toIsoDate(parseLooseDate('2026-09-25').ms), '2026-09-25');
  assert.equal(parseLooseDate(''), null);
  assert.equal(parseLooseDate('16. Hausübung'), null);
  assert.equal(parseLooseDate('—'), null);
});

test('Untis-Datum und -Zeit', () => {
  const ms = untisToMs(20260923, 830);
  const d = new Date(ms);
  assert.equal(toIsoDate(ms), '2026-09-23');
  assert.equal(d.getHours(), 8);
  assert.equal(d.getMinutes(), 30);
  assert.equal(toUntisDate(new Date(2026, 0, 5)), '20260105');
  assert.equal(untisToMs(null), null);
});

test('startOfWeek liefert Montag', () => {
  const sunday = new Date(2026, 8, 27, 15, 0).getTime();
  assert.equal(toIsoDate(startOfWeek(sunday)), '2026-09-21');
  const monday = new Date(2026, 8, 21, 0, 0).getTime();
  assert.equal(toIsoDate(startOfWeek(monday)), '2026-09-21');
});

test('TOTP nach RFC 6238 (Testvektoren, 6 Stellen)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totp(secret, 59 * 1000), '287082');
  assert.equal(totp(secret, 1111111109 * 1000), '081804');
  assert.equal(totp(secret, 1234567890 * 1000), '005924');
});
