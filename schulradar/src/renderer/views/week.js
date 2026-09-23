// Wochenansicht: Abgaben & Tests pro Tag, darunter (optional) der Stundenplan aus WebUntis
import { h, icon } from '../dom.js';
import * as L from '../logic.js';

function weekKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function card(item, ctx, { showTime = true } = {}) {
  const now = ctx.now();
  const status = L.effectiveStatus(item, ctx.state.local, now);
  const meta = L.SOURCE_META[item.source] || L.SOURCE_META.own;
  const finished = L.isFinished(status);
  return h(
    'button',
    {
      class: `mini status-${status} ${finished ? 'is-finished' : ''} ${L.isExamLike(item) && !finished ? 'is-exam' : ''}`,
      style: { '--c': meta.color },
      title: `${L.displayTitle(item)}\n${meta.name}${item.subject ? ` · ${item.subject}` : ''}`,
      onclick: () => ctx.actions.showItem(item)
    },
    h(
      'span',
      { class: 'mini-top' },
      L.isExamLike(item) ? icon('exam', 'mini-icon') : null,
      h('span', { class: 'mini-kind' }, L.typeLabel(item)),
      showTime && item.due && !item.allDay ? h('span', { class: 'mini-time' }, L.fmtTime(item.due)) : null
    ),
    h('span', { class: 'mini-title' }, L.displayTitle(item)),
    item.subject || item.course ? h('span', { class: 'mini-sub' }, item.subject || item.course) : null
  );
}

function ensureTimetable(ctx, weekStart) {
  const key = weekKey(weekStart);
  const tt = ctx.ui.timetable[key];
  if (tt) return tt;
  ctx.ui.timetable[key] = { loading: true, lessons: [] };
  ctx.api
    .getTimetable(weekStart)
    .then((res) => {
      ctx.ui.timetable[key] = { loading: false, lessons: (res && res.lessons) || [], error: res && res.error };
      ctx.rerender();
    })
    .catch((err) => {
      ctx.ui.timetable[key] = { loading: false, lessons: [], error: String(err && err.message) };
      ctx.rerender();
    });
  return ctx.ui.timetable[key];
}

export function periodNav(ctx, { title, onPrev, onNext, onToday, extra }) {
  return h(
    'div',
    { class: 'period-nav' },
    h('div', { class: 'period-buttons' },
      h('button', { class: 'icon-btn', title: 'Zurück', 'aria-label': 'Zurück', onclick: onPrev }, icon('chevronLeft')),
      h('button', { class: 'icon-btn', title: 'Weiter', 'aria-label': 'Weiter', onclick: onNext }, icon('chevronRight')),
      h('button', { class: 'btn btn-small', onclick: onToday }, 'Heute')
    ),
    h('h2', { class: 'period-title' }, title),
    h('div', { class: 'period-extra' }, extra || null)
  );
}

const PX_PER_MIN = 1.15;

function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function lessonBlock(l, startMin) {
  const top = (L.minuteOfDay(l.start) - startMin) * PX_PER_MIN;
  const height = Math.max(18, (l.end - l.start) / 60000 * PX_PER_MIN - 2);
  const width = 100 / (l.cols || 1);
  const state = l.cancelled ? 'Entfall' : l.exam ? 'Prüfung' : l.changed ? 'Änderung' : '';
  const klasse = l.klasse && l.klasse !== l.room ? l.klasse : '';
  return h(
    'div',
    {
      class: `tt-lesson ${l.cancelled ? 'is-cancelled' : ''} ${l.changed ? 'is-changed' : ''} ${l.exam ? 'is-exam' : ''} ${height < 44 ? 'is-small' : ''} ${(l.cols || 1) >= 3 ? 'is-narrow' : ''}`,
      style: {
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${(l.col || 0) * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        '--lc': L.lessonColor(l)
      },
      title: [
        `${L.fmtTime(l.start)}–${L.fmtTime(l.end)}`,
        l.subjectLong ? `${l.subject} – ${l.subjectLong}` : l.subject,
        l.teacher,
        l.room,
        l.klasse,
        state,
        l.info
      ]
        .filter(Boolean)
        .join('\n')
    },
    l.teacher ? h('span', { class: 'tt-teacher' }, l.teacher) : null,
    h('span', { class: 'tt-subject' }, l.subject || '—'),
    l.room ? h('span', { class: 'tt-room' }, l.room) : null,
    klasse ? h('span', { class: 'tt-class' }, klasse) : null,
    state ? h('span', { class: 'tt-state' }, state) : null
  );
}

/** Stundenplan als Zeitraster wie in WebUntis */
function timetableGrid(lessons, days, now) {
  const merged = L.mergeLessons(lessons);
  if (!merged.length) return null;
  const startMin = Math.min(...merged.map((l) => L.minuteOfDay(l.start)));
  const endMin = Math.max(...merged.map((l) => L.minuteOfDay(l.end)));
  const height = (endMin - startMin) * PX_PER_MIN;
  const marks = [...new Set(merged.map((l) => L.minuteOfDay(l.start)))].sort((a, b) => a - b);
  const nowMin = L.minuteOfDay(now);
  const nowInRange = nowMin >= startMin && nowMin <= endMin;
  const todayInWeek = days.some((d) => L.dayDiff(d, now) === 0);

  const axis = h(
    'div',
    { class: 'tt-axis', style: { height: `${height}px` } },
    marks.map((m) => h('span', { class: 'tt-label', style: { top: `${(m - startMin) * PX_PER_MIN}px` } }, fmtMin(m))),
    h('span', { class: 'tt-label is-end', style: { top: `${height}px` } }, fmtMin(endMin)),
    todayInWeek && nowInRange ? h('span', { class: 'tt-now-label', style: { top: `${(nowMin - startMin) * PX_PER_MIN}px` } }, fmtMin(nowMin)) : null
  );

  const cols = days.map((day, i) => {
    const dayLessons = L.layoutOverlaps(merged.filter((l) => l.start >= day && l.start < L.addDays(day, 1)));
    const isToday = L.dayDiff(day, now) === 0;
    // Wochenende ohne Unterricht bleibt leer (wie in WebUntis)
    if (i >= 5 && !dayLessons.length) return h('div', { class: 'tt-day is-free', style: { height: `${height}px` } });
    return h(
      'div',
      { class: `tt-day ${i >= 5 ? 'is-weekend' : ''} ${isToday ? 'is-today' : ''}`, style: { height: `${height}px` } },
      marks.map((m) => h('div', { class: 'tt-line', style: { top: `${(m - startMin) * PX_PER_MIN}px` } })),
      dayLessons.map((l) => lessonBlock(l, startMin)),
      isToday && nowInRange ? h('div', { class: 'tt-now', style: { top: `${(nowMin - startMin) * PX_PER_MIN}px` } }) : null
    );
  });

  return h('section', { class: 'tt' }, h('div', { class: 'week-cols tt-grid' }, axis, cols));
}

export function renderWeek(root, ctx) {
  const now = ctx.now();
  const { ui, state } = ctx;
  const ws = ui.weekStart || L.startOfWeek(now);
  const we = L.addDays(ws, 6);
  const items = L.filterItems(state.items, {
    local: state.local,
    sources: new Set(L.SOURCE_ORDER.filter((s) => !ui.hiddenSources.includes(s))),
    query: ui.search
  });
  const showTT = state.settings.showTimetable;
  const tt = showTT ? ensureTimetable(ctx, ws) : null;

  const sameMonth = new Date(ws).getMonth() === new Date(we).getMonth();
  const range = sameMonth
    ? `${new Date(ws).getDate()}.–${L.fmtDayMonth(we)} ${new Date(we).getFullYear()}`
    : `${L.fmtDayMonth(ws)} – ${L.fmtDayMonth(we)} ${new Date(we).getFullYear()}`;

  root.append(
    periodNav(ctx, {
      title: `KW ${L.isoWeek(ws)} · ${range}`,
      onPrev: () => ctx.actions.setUi({ weekStart: L.addDays(ws, -7) }),
      onNext: () => ctx.actions.setUi({ weekStart: L.addDays(ws, 7) }),
      onToday: () => ctx.actions.setUi({ weekStart: L.startOfWeek(now) }),
      extra: h(
        'label',
        { class: 'toggle-inline' },
        h('input', { type: 'checkbox', checked: showTT, onchange: (e) => ctx.actions.updateSettings({ showTimetable: e.target.checked }) }),
        h('span', { class: 'switch' }),
        'Stundenplan'
      )
    })
  );

  const days = Array.from({ length: 7 }, (_, i) => L.addDays(ws, i));
  const lessons = tt ? tt.lessons.filter((l) => l.start >= ws && l.start < L.addDays(ws, 7)) : [];

  // Oben: Abgaben & Tests pro Tag (Karten)
  const cols = [h('div', { class: 'week-gutter' }, h('span', {}, 'Fällig'))];
  days.forEach((day, i) => {
    const dayItems = L.itemsOnDay(items, day);
    const isToday = L.dayDiff(day, now) === 0;
    const weekend = i >= 5;
    cols.push(
      h(
        'div',
        { class: `day-col ${isToday ? 'is-today' : ''} ${weekend ? 'is-weekend' : ''} ${weekend && !dayItems.length ? 'is-empty' : ''} ${day < L.startOfDay(now) ? 'is-past' : ''}` },
        h(
          'div',
          { class: 'day-head' },
          h('span', { class: 'day-name' }, L.WEEKDAYS_SHORT[new Date(day).getDay()]),
          h('span', { class: 'day-num' }, String(new Date(day).getDate())),
          isToday ? h('span', { class: 'today-tag' }, 'Heute') : null
        ),
        dayItems.length || !weekend
          ? h('div', { class: 'day-items' }, dayItems.length ? dayItems.map((it) => card(it, ctx)) : h('div', { class: 'day-empty' }, 'nichts fällig'))
          : null
      )
    );
  });

  const grid = showTT ? timetableGrid(lessons, days, now) : null;
  root.append(h('div', { class: 'week-wrap' }, h('div', { class: 'week-cols week-grid' }, cols), grid));

  if (showTT && tt && !tt.loading && !lessons.length) {
    root.append(
      h('p', { class: 'hint' }, tt.error ? `Stundenplan nicht verfügbar: ${tt.error}` : 'Kein Stundenplan für diese Woche – dafür muss WebUntis verbunden sein.')
    );
  }
}
