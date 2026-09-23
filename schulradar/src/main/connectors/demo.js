'use strict';
// Beispieldaten zum Ausprobieren der App ohne Anmeldung (Einstellungen → Demo-Daten).
const { startOfDay, addDays, startOfWeek, DAY } = require('../util/dates');

function at(dayOffset, hh = 0, mm = 0, now = Date.now()) {
  const d = new Date(addDays(startOfDay(now), dayOffset));
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

function demoItems(now = Date.now()) {
  const t = (d, h, m) => at(d, h, m, now);
  return [
    // WebUntis
    { id: 'demo:wu:1', source: 'webuntis', type: 'homework', title: 'Buch S. 84, Aufgaben 3–7', subject: 'AM', teacher: 'HUB', due: t(1), allDay: true, status: 'open', description: 'Buch S. 84, Aufgaben 3–7\nLösungsweg angeben!' },
    { id: 'demo:wu:2', source: 'webuntis', type: 'homework', title: 'Erörterung „Social Media“ fertig schreiben', subject: 'D', teacher: 'MAI', due: t(4), allDay: true, status: 'open' },
    { id: 'demo:wu:3', source: 'webuntis', type: 'homework', title: 'Vokabeln Unit 4 lernen', subject: 'E', teacher: 'BAU', due: t(-1), allDay: true, status: 'open' },
    { id: 'demo:wu:4', source: 'webuntis', type: 'exam', title: 'Schularbeit', examType: 'Schularbeit', subject: 'AM', teacher: 'HUB', room: 'R 204', start: t(6, 8, 0), end: t(6, 9, 40), due: t(6, 8, 0), allDay: false, status: 'open', description: 'Stoff: Vektorrechnung, Kapitel 3–5' },
    { id: 'demo:wu:5', source: 'webuntis', type: 'exam', title: 'Test', examType: 'Test', subject: 'NVS', teacher: 'GRU', room: 'EDV 3', start: t(2, 10, 5), end: t(2, 10, 55), due: t(2, 10, 5), allDay: false, status: 'open', description: 'Subnetting, VLANs' },
    { id: 'demo:wu:6', source: 'webuntis', type: 'exam', title: 'Mündliche Wiederholung', examType: 'Wiederholung', subject: 'GGP', teacher: 'LEH', room: 'R 111', start: t(12, 11, 0), due: t(12, 11, 0), allDay: false, status: 'open' },
    // Teams
    { id: 'demo:tm:1', source: 'teams', type: 'assignment', title: 'Projektdokumentation Kapitel 2', course: '4AHIT SEW', due: t(0, 23, 59), allDay: false, status: 'open', description: 'Bitte als PDF abgeben. Umfang ca. 4 Seiten.' },
    { id: 'demo:tm:2', source: 'teams', type: 'assignment', title: 'Laborprotokoll Messung 3', course: '4AHIT ELT Labor', due: t(3, 22, 0), allDay: false, status: 'open' },
    { id: 'demo:tm:3', source: 'teams', type: 'assignment', title: 'Präsentation Datenbanken', course: '4AHIT DBI', due: t(-2, 23, 59), allDay: false, status: 'submitted' },
    { id: 'demo:tm:4', source: 'teams', type: 'assignment', title: 'Reflexion Betriebspraktikum', course: '4AHIT KSN', due: t(-3, 20, 0), allDay: false, status: 'open' },
    // Letto
    { id: 'demo:lt:1', source: 'letto', type: 'exercise', title: '16. Hausübung – Mag. Feld Grundlagen', subject: 'AT1', due: t(2), allDay: true, progress: 45, started: true, status: 'open' },
    { id: 'demo:lt:2', source: 'letto', type: 'exercise', title: '12. Hausübung – Getriebe', subject: 'AT1', due: t(9), allDay: true, progress: 5, started: true, status: 'open' },
    { id: 'demo:lt:3', source: 'letto', type: 'exercise', title: '1. Übung – Komplexe Zahlen', subject: 'AM', due: t(5), allDay: true, progress: 0, started: false, status: 'open' },
    // Eduvidual
    { id: 'demo:ed:1', source: 'eduvidual', type: 'assignment', module: 'assign', title: 'Abgabe: SQL-Übungsblatt 2', course: 'Datenbanken 4AHIT', subject: 'DBI', due: t(1, 18, 0), allDay: false, status: 'open' },
    { id: 'demo:ed:2', source: 'eduvidual', type: 'quiz', module: 'quiz', title: 'Selbsttest Kapitel 4', course: 'Englisch 4AHIT', subject: 'E', due: t(7, 23, 59), allDay: false, status: 'open' },
    { id: 'demo:ed:3', source: 'eduvidual', type: 'assignment', module: 'assign', title: 'Lesetagebuch Woche 3', course: 'Deutsch 4AHIT', subject: 'D', due: t(8, 23, 59), allDay: false, status: 'submitted' },
    { id: 'demo:ed:4', source: 'eduvidual', type: 'event', title: 'Exkursion Technisches Museum', course: 'Jahrgang 4', subject: '', due: t(10, 8, 0), allDay: false, status: 'open' }
  ].map((it) => ({ url: null, description: '', ...it, demo: true }));
}

const SUBJECTS = [
  ['AM', 'R 204'], ['D', 'R 204'], ['E', 'R 204'], ['SEW', 'EDV 2'], ['NVS', 'EDV 3'],
  ['DBI', 'EDV 2'], ['GGP', 'R 111'], ['ITP', 'Labor 1'], ['BSPK', 'R 204'], ['KSN', 'EDV 1']
];

function demoTimetable(weekStart) {
  const lessons = [];
  const starts = [[8, 0], [8, 50], [9, 55], [10, 45], [11, 35], [12, 25]];
  for (let day = 0; day < 5; day++) {
    for (let slot = 0; slot < starts.length - (day === 4 ? 2 : 0); slot++) {
      const [subject, room] = SUBJECTS[(day * 3 + slot) % SUBJECTS.length];
      const s = new Date(weekStart + day * DAY);
      s.setHours(starts[slot][0], starts[slot][1], 0, 0);
      lessons.push({
        id: `demo-${day}-${slot}`,
        start: s.getTime(),
        end: s.getTime() + 50 * 60000,
        subject,
        room,
        teacher: '',
        cancelled: day === 3 && slot === 5,
        changed: day === 1 && slot === 2,
        exam: false,
        info: day === 3 && slot === 5 ? 'Entfall' : ''
      });
    }
  }
  return lessons;
}

module.exports = { demoItems, demoTimetable, startOfWeek };
