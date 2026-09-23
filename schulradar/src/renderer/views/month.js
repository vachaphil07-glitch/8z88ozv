// Monatsansicht mit Tagesliste
import { h, icon } from '../dom.js';
import * as L from '../logic.js';
import { periodNav } from './week.js';
import { renderItem } from './item.js';

export function renderMonth(root, ctx) {
  const now = ctx.now();
  const { ui, state } = ctx;
  const ms = ui.monthStart || L.startOfMonth(now);
  const month = new Date(ms).getMonth();
  const selected = ui.selectedDay || L.startOfDay(now);
  const items = L.filterItems(state.items, {
    local: state.local,
    sources: new Set(L.SOURCE_ORDER.filter((s) => !ui.hiddenSources.includes(s))),
    query: ui.search
  });

  root.append(
    periodNav(ctx, {
      title: `${L.MONTHS[month]} ${new Date(ms).getFullYear()}`,
      onPrev: () => ctx.actions.setUi({ monthStart: L.startOfMonth(L.addDays(ms, -1)) }),
      onNext: () => ctx.actions.setUi({ monthStart: L.startOfMonth(L.addDays(ms, 32)) }),
      onToday: () => ctx.actions.setUi({ monthStart: L.startOfMonth(now), selectedDay: L.startOfDay(now) })
    })
  );

  const head = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('div', { class: 'month-dow' }, d));
  const cells = L.monthGrid(ms).map((day) => {
    const dayItems = L.itemsOnDay(items, day);
    const outside = new Date(day).getMonth() !== month;
    const isToday = L.dayDiff(day, now) === 0;
    const isSelected = L.dayDiff(day, selected) === 0;
    const shown = dayItems.slice(0, 3);
    return h(
      'button',
      {
        class: `month-cell ${outside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`,
        onclick: () => ctx.actions.setUi({ selectedDay: day }),
        'aria-label': `${L.fmtDateLong(day)}: ${dayItems.length} Einträge`
      },
      h('span', { class: 'month-num' }, String(new Date(day).getDate())),
      h(
        'span',
        { class: 'month-pills' },
        shown.map((it) => {
          const status = L.effectiveStatus(it, state.local, now);
          const meta = L.SOURCE_META[it.source] || L.SOURCE_META.own;
          return h(
            'span',
            { class: `month-pill ${L.isFinished(status) ? 'is-finished' : ''} ${L.isExamLike(it) ? 'is-exam' : ''} status-${status}`, style: { '--c': meta.color } },
            L.isExamLike(it) ? icon('exam', 'pill-icon') : null,
            L.displayTitle(it)
          );
        }),
        dayItems.length > shown.length ? h('span', { class: 'month-more' }, `+${dayItems.length - shown.length} weitere`) : null
      )
    );
  });

  const dayItems = L.itemsOnDay(items, selected);
  const panel = h(
    'aside',
    { class: 'day-panel' },
    h('h3', {}, L.fmtDateLong(selected)),
    dayItems.length
      ? h('div', { class: 'day-panel-items' }, dayItems.map((it) => renderItem(it, ctx, { showDate: false })))
      : h('p', { class: 'muted' }, 'An diesem Tag ist nichts fällig.'),
    h(
      'button',
      { class: 'btn btn-ghost add-for-day', onclick: () => ctx.actions.newTask({ due: selected, allDay: true }) },
      icon('plus'),
      'Eigene Aufgabe für diesen Tag'
    )
  );

  root.append(h('div', { class: 'month-layout' }, h('div', { class: 'month-grid' }, head, cells), panel));
}
