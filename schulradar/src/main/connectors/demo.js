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

// Stundenplan wie bei einer 5. Klasse der HTL: Doppelstunden, Gruppenteilung, Nachmittag
const COLORS = { ETE: '#e8590c', ETH: '#868e96', AM: '#94d82d', FTBT: '#868e96', MTSA: '#adb5bd', KOP: '#74c0fc', MEEM: '#e03131', D: '#f783ac', E: '#22b8cf', WIR: '#adb5bd', AIIT: '#51cf66', WPT3: '#40c057', LA: '#fcc419', ROBV: '#adb5bd' };
// [Tag (0 = Mo), Beginn, Ende, Lehrkraft, Fach, Raum, Klasse, Zusatz]
const DEMO_WEEK = [
  [0, '07:50', '08:40', 'MAY', 'ETE', '5BHME'],
  [0, '08:40', '09:30', 'SAL', 'ETH', '5BHME', '', 'changed'],
  [0, '09:45', '10:35', 'LAN', 'AM', '5BHME'],
  [0, '10:35', '11:25', 'HAR', 'FTBT', '5BHME'],
  [0, '11:30', '13:10', 'HOF', 'MTSA', '5BHME'],
  [1, '07:50', '11:25', 'EIS', 'KOP', 'EDV9', '5AHME'],
  [1, '07:50', '11:25', 'LAM', 'KOP', '5AHME', '5AHME'],
  [1, '07:50', '11:25', 'STO', 'KOP', 'EDV3', '5AHME'],
  [1, '11:30', '13:10', 'BOC', 'MEEM', '5BHME'],
  [1, '14:00', '16:35', 'EIS, GRA', 'LA', 'ELAE1', '5AHME'],
  [2, '07:50', '08:40', 'SCH', 'D', '5BHME'],
  [2, '08:40', '09:30', 'ROC', 'E', '2BHME', '5AHME'],
  [2, '09:45', '10:35', 'LAN', 'AM', '5BHME', '', 'exam'],
  [2, '10:35', '11:25', 'MAY', 'ETE', '5BHME'],
  [2, '11:30', '12:20', 'SAL', 'ETH', '5BHME', '', 'cancelled'],
  [3, '07:50', '08:40', 'ROC', 'E', '3AHME', '5AHME'],
  [3, '08:40', '09:30', 'HOF', 'MTSA', '5BHME'],
  [3, '09:45', '10:35', 'HUM', 'WIR', '5BHME'],
  [3, '10:35', '13:10', 'BUR, FRL', 'WPT3', '5AHME'],
  [4, '07:50', '08:40', 'HAR', 'FTBT', '5BHME'],
  [4, '08:40', '09:30', 'SCH', 'D', '5BHME'],
  [4, '09:45', '11:25', 'STE', 'AIIT', 'EDV2', '5AHME'],
  [4, '11:30', '13:10', 'HUM', 'WIR', '5BHME'],
  [4, '14:00', '15:45', 'HOE', 'ROBV', '5BHME']
];

function demoTimetable(weekStart) {
  const at = (day, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(weekStart + day * DAY);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  return DEMO_WEEK.map(([day, from, to, teacher, subject, room, klasse = '', flag = ''], i) => ({
    id: `demo-${i}`,
    lessonId: i,
    start: at(day, from),
    end: at(day, to),
    subject,
    subjectLong: '',
    teacher,
    room,
    klasse: klasse || room,
    color: COLORS[subject] || '',
    cancelled: flag === 'cancelled',
    changed: flag === 'changed',
    exam: flag === 'exam',
    info: flag === 'cancelled' ? 'Entfall' : flag === 'changed' ? 'Supplierung' : flag === 'exam' ? 'Test' : ''
  }));
}

module.exports = { demoItems, demoTimetable, startOfWeek };
