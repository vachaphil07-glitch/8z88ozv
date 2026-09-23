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

  const cols = [];
  for (let i = 0; i < 7; i++) {
    const day = L.addDays(ws, i);
    const dayItems = L.itemsOnDay(items, day);
    const lessons = tt ? tt.lessons.filter((l) => l.start >= day && l.start < L.addDays(day, 1)) : [];
    const isToday = L.dayDiff(day, now) === 0;
    const weekend = i >= 5;
    if (weekend && !dayItems.length && !lessons.length) {
      cols.push(
        h('div', { class: `day-col is-weekend is-empty ${isToday ? 'is-today' : ''}` },
          h('div', { class: 'day-head' }, h('span', { class: 'day-name' }, L.WEEKDAYS_SHORT[new Date(day).getDay()]), h('span', { class: 'day-num' }, String(new Date(day).getDate())))
        )
      );
      continue;
    }
    cols.push(
      h(
        'div',
        { class: `day-col ${isToday ? 'is-today' : ''} ${weekend ? 'is-weekend' : ''} ${day < L.startOfDay(now) ? 'is-past' : ''}` },
        h(
          'div',
          { class: 'day-head' },
          h('span', { class: 'day-name' }, L.WEEKDAYS_SHORT[new Date(day).getDay()]),
          h('span', { class: 'day-num' }, String(new Date(day).getDate())),
          isToday ? h('span', { class: 'today-tag' }, 'Heute') : null
        ),
        h('div', { class: 'day-items' }, dayItems.length ? dayItems.map((it) => card(it, ctx)) : h('div', { class: 'day-empty' }, 'nichts fällig')),
        showTT && lessons.length
          ? h(
              'div',
              { class: 'lessons' },
              h('div', { class: 'lessons-label' }, 'Stundenplan'),
              lessons.map((l) =>
                h(
                  'div',
                  {
                    class: `lesson ${l.cancelled ? 'is-cancelled' : ''} ${l.changed ? 'is-changed' : ''} ${l.exam ? 'is-exam' : ''}`,
                    title: [l.subjectLong || l.subject, l.teacher, l.room, l.info].filter(Boolean).join(' · ')
                  },
                  h('span', { class: 'lesson-time' }, L.fmtTime(l.start)),
                  h('span', { class: 'lesson-subject' }, l.subject || '—'),
                  h('span', { class: 'lesson-room' }, l.cancelled ? 'entfällt' : l.room || '')
                )
              )
            )
          : null
      )
    );
  }
  root.append(h('div', { class: 'week-grid' }, cols));
  if (showTT && tt && !tt.loading && !tt.lessons.length) {
    root.append(
      h('p', { class: 'hint' }, tt.error ? `Stundenplan nicht verfügbar: ${tt.error}` : 'Kein Stundenplan für diese Woche – dafür muss WebUntis verbunden sein.')
    );
  }
}
