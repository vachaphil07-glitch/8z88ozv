// Reine Logik der Oberfläche (ohne DOM) – wird auch mit node:test getestet.

export const DAY = 24 * 60 * 60 * 1000;

export const SOURCE_META = {
  webuntis: { name: 'WebUntis', short: 'WU', color: '#E8710A' },
  teams: { name: 'MS Teams', short: 'T', color: '#6264A7' },
  letto: { name: 'Letto', short: 'L', color: '#0E9F6E' },
  eduvidual: { name: 'Eduvidual', short: 'E', color: '#1E7FD8' },
  lms: { name: 'LMS.at', short: 'LMS', color: '#0B7285' },
  own: { name: 'Eigene', short: '★', color: '#D6336C' }
};

export const SOURCE_ORDER = ['webuntis', 'teams', 'letto', 'eduvidual', 'lms', 'own'];

const TYPE_LABELS = {
  homework: 'Hausübung',
  exam: 'Prüfung',
  assignment: 'Abgabe',
  quiz: 'Test',
  exercise: 'Übung',
  activity: 'Aktivität',
  event: 'Termin',
  task: 'Aufgabe'
};

const OWN_KIND_LABELS = { task: 'Aufgabe', test: 'Test', termin: 'Termin' };

export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const DONE_STATES = new Set(['submitted', 'graded', 'done']);

// ---------------------------------------------------------------- Datum

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ms, n) {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function startOfMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function isoWeek(ms) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / DAY - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export function dayDiff(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY);
}

const p2 = (n) => String(n).padStart(2, '0');

export function fmtTime(ms) {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function fmtDateShort(ms) {
  const d = new Date(ms);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`;
}

export function fmtDateLong(ms) {
  const d = new Date(ms);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDayMonth(ms) {
  const d = new Date(ms);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

export function dayLabel(ms, now) {
  const diff = dayDiff(ms, now);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  if (diff === 2) return 'Übermorgen';
  return fmtDateShort(ms);
}

/** Fälligkeit als kurzer Text, z. B. "Morgen 08:00" */
export function fmtDue(item, now) {
  if (!item.due) return 'ohne Datum';
  const label = dayLabel(item.due, now);
  return item.allDay ? label : `${label} ${fmtTime(item.due)}`;
}

/** Relativer Hinweis, z. B. "in 3 Tagen" oder "seit 2 Tagen" */
export function fmtRelative(item, now) {
  if (!item.due) return '';
  if (!item.allDay) {
    const mins = Math.round((item.due - now) / 60000);
    if (mins >= 0 && mins < 60) return `in ${mins} Min.`;
    if (mins >= 60 && mins < 12 * 60) return `in ${Math.round(mins / 60)} Std.`;
    if (mins < 0 && mins > -12 * 60) return mins > -60 ? `seit ${-mins} Min.` : `seit ${Math.round(-mins / 60)} Std.`;
  }
  const diff = dayDiff(item.due, now);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'seit gestern';
  if (diff > 1) return `in ${diff} Tagen`;
  return `seit ${-diff} Tagen`;
}

export function timeAgo(ms, now) {
  if (!ms) return 'noch nie';
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}

// ---------------------------------------------------------------- Status

export function isAppointment(item) {
  return item.type === 'exam' || item.type === 'event' || (item.source === 'own' && (item.kind === 'test' || item.kind === 'termin'));
}

export function isExamLike(item) {
  return item.type === 'exam' || item.type === 'quiz' || (item.source === 'own' && item.kind === 'test');
}

export function typeLabel(item) {
  if (item.source === 'own') return OWN_KIND_LABELS[item.kind || 'task'] || 'Aufgabe';
  if (item.type === 'exam') return item.examType || 'Prüfung';
  return TYPE_LABELS[item.type] || 'Eintrag';
}

/** Titel für die Anzeige – bei Prüfungen wie "Test" wird das Fach ergänzt. */
export function displayTitle(item) {
  const title = String(item.title || '').trim() || '(ohne Titel)';
  if (item.type === 'exam' && item.subject && !title.toLowerCase().includes(String(item.subject).toLowerCase()) && title.length < 30) {
    return `${title} ${item.subject}`;
  }
  return title;
}

export function effectiveStatus(item, local = {}, now = Date.now()) {
  if (local.done && local.done[item.id]) return 'done';
  if (DONE_STATES.has(item.status)) return item.status;
  if (isAppointment(item)) {
    if (!item.due) return 'upcoming';
    const end = item.end || item.due;
    const past = item.allDay ? startOfDay(item.due) < startOfDay(now) : end < now;
    return past ? 'past' : 'upcoming';
  }
  if (item.due) {
    const overdue = item.allDay ? startOfDay(item.due) < startOfDay(now) : item.due < now;
    if (overdue) return 'overdue';
  }
  return 'open';
}

export function isFinished(status) {
  return status === 'done' || status === 'submitted' || status === 'graded' || status === 'past';
}

export const STATUS_LABELS = {
  open: 'offen',
  overdue: 'überfällig',
  submitted: 'abgegeben',
  graded: 'bewertet',
  done: 'erledigt',
  upcoming: 'Termin',
  past: 'vorbei'
};

// ---------------------------------------------------------------- Filtern & Gruppieren

export function matchesSearch(item, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [item.title, item.subject, item.course, item.description, item.teacher, item.room, typeLabel(item), SOURCE_META[item.source]?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function filterItems(items, { local = {}, sources = null, kind = 'all', query = '' } = {}) {
  return items.filter((it) => {
    if (local.dismissed && local.dismissed[it.id]) return false;
    if (sources && !sources.has(it.source)) return false;
    if (kind === 'tasks' && isAppointment(it)) return false;
    if (kind === 'appointments' && !isAppointment(it) && !isExamLike(it)) return false;
    return matchesSearch(it, query);
  });
}

function compareItems(a, b) {
  const da = a.due ?? Infinity;
  const db = b.due ?? Infinity;
  if (startOfDay(da) !== startOfDay(db) || !Number.isFinite(da) || !Number.isFinite(db)) return da - db;
  // am selben Tag: Termine/Tests zuerst, dann ganztägige, dann nach Uhrzeit
  const ra = isAppointment(a) ? 0 : a.allDay ? 1 : 2;
  const rb = isAppointment(b) ? 0 : b.allDay ? 1 : 2;
  if (ra !== rb) return ra - rb;
  return da - db || String(a.title).localeCompare(String(b.title), 'de');
}

export function groupItems(items, { local = {}, now = Date.now(), showDone = false } = {}) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const nextWeek = addDays(startOfWeek(now), 7);
  const weekAfter = addDays(nextWeek, 7);
  const groups = {
    overdue: { key: 'overdue', label: 'Überfällig', items: [] },
    today: { key: 'today', label: 'Heute', items: [] },
    tomorrow: { key: 'tomorrow', label: 'Morgen', items: [] },
    week: { key: 'week', label: 'Diese Woche', items: [] },
    nextweek: { key: 'nextweek', label: 'Nächste Woche', items: [] },
    later: { key: 'later', label: 'Später', items: [] },
    nodate: { key: 'nodate', label: 'Ohne Datum', items: [] },
    done: { key: 'done', label: 'Erledigt & vorbei', items: [] }
  };
  for (const it of items) {
    const st = effectiveStatus(it, local, now);
    if (isFinished(st)) {
      groups.done.items.push(it);
      continue;
    }
    if (st === 'overdue') groups.overdue.items.push(it);
    else if (!it.due) groups.nodate.items.push(it);
    else if (it.due < tomorrow) groups.today.items.push(it);
    else if (it.due < dayAfter) groups.tomorrow.items.push(it);
    else if (it.due < nextWeek) groups.week.items.push(it);
    else if (it.due < weekAfter) groups.nextweek.items.push(it);
    else groups.later.items.push(it);
  }
  for (const g of Object.values(groups)) g.items.sort(compareItems);
  groups.done.items.reverse();
  return Object.values(groups).filter((g) => g.items.length && (g.key !== 'done' || showDone));
}

export function stats(items, { local = {}, now = Date.now() } = {}) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const in7 = addDays(today, 7);
  let open = 0;
  let overdue = 0;
  let dueToday = 0;
  let exams = 0;
  let done = 0;
  for (const it of items) {
    if (local.dismissed && local.dismissed[it.id]) continue;
    const st = effectiveStatus(it, local, now);
    if (st === 'overdue') {
      overdue++;
      open++;
    } else if (st === 'open') {
      open++;
      if (it.due && it.due < tomorrow) dueToday++;
    } else if (st === 'upcoming') {
      if (isExamLike(it) && it.due && it.due < in7) exams++;
    } else if ((st === 'done' || st === 'submitted' || st === 'graded') && !isAppointment(it)) {
      done++;
    }
  }
  return { open, overdue, dueToday, exams, done };
}

export function itemsOnDay(items, dayStart) {
  const end = addDays(dayStart, 1);
  return items.filter((it) => it.due && it.due >= dayStart && it.due < end).sort(compareItems);
}

export function monthGrid(monthStart) {
  const first = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

// ---------------------------------------------------------------- Stundenplan (Zeitraster wie in WebUntis)

export function minuteOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Fasst aufeinanderfolgende Einheiten derselben Stunde zu einem Block zusammen
 * (z. B. Doppelstunden über eine Pause hinweg), wie WebUntis es anzeigt.
 */
export function mergeLessons(lessons, maxGapMin = 20) {
  const sorted = [...lessons].filter((l) => l.start && l.end).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const l of sorted) {
    const key = [l.lessonId ?? '', l.subject, l.teacher, l.room, l.klasse || '', Boolean(l.cancelled), Boolean(l.changed), Boolean(l.exam)].join('|');
    let prev = null;
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      if (o.key === key && startOfDay(o.start) === startOfDay(l.start) && l.start >= o.end && l.start - o.end <= maxGapMin * 60000) {
        prev = o;
        break;
      }
    }
    if (prev) prev.end = Math.max(prev.end, l.end);
    else out.push({ ...l, key });
  }
  return out;
}

/** Verteilt gleichzeitige Stunden (z. B. Gruppenteilung) nebeneinander: col / cols */
export function layoutOverlaps(lessons) {
  const sorted = [...lessons].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const columns = [];
    for (const ev of cluster) {
      let c = columns.findIndex((end) => end <= ev.start);
      if (c < 0) {
        c = columns.length;
        columns.push(0);
      }
      columns[c] = ev.end;
      ev.col = c;
    }
    for (const ev of cluster) ev.cols = columns.length;
    result.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const l of sorted) {
    if (cluster.length && l.start >= clusterEnd) flush();
    cluster.push({ ...l });
    clusterEnd = Math.max(clusterEnd, l.end);
  }
  if (cluster.length) flush();
  return result;
}

const LESSON_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#e64980', '#5c940d', '#4263eb', '#d6336c', '#868e96', '#f59f00'];

/** Farbe eines Fachs: aus WebUntis, sonst immer dieselbe Farbe pro Fachkürzel */
export function lessonColor(lesson) {
  if (lesson.color) return lesson.color;
  let hash = 0;
  for (const ch of String(lesson.subject || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LESSON_COLORS[hash % LESSON_COLORS.length];
}
