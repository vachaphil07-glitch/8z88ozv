// Darstellung eines einzelnen Eintrags (Liste, Tagesansicht, Detail-Dialog)
import { h, icon } from '../dom.js';
import * as L from '../logic.js';
import { calendarButton } from './calendar-menu.js';

export function sourceBadge(source) {
  const meta = L.SOURCE_META[source] || L.SOURCE_META.own;
  return h('span', { class: 'src-badge', style: { '--c': meta.color } }, h('span', { class: 'src-dot' }), meta.name);
}

export function statusPill(item, status) {
  if (status === 'upcoming') {
    const cls = L.isExamLike(item) ? 'pill pill-exam' : 'pill pill-event';
    return h('span', { class: cls }, L.typeLabel(item));
  }
  return h('span', { class: `pill pill-${status}` }, L.STATUS_LABELS[status] || status);
}

function metaLine(item) {
  const bits = [];
  const place = item.subject || item.course;
  if (place) bits.push(place);
  if (item.course && item.subject && item.course !== item.subject) bits.push(item.course);
  if (!(item.type === 'exam' && L.isAppointment(item))) bits.push(L.typeLabel(item));
  if (item.room) bits.push(item.room);
  return bits;
}

export function progressBar(value) {
  if (value === null || value === undefined) return null;
  const v = Math.max(0, Math.min(100, Number(value)));
  return h(
    'span',
    { class: 'progress', title: `Fortschritt ${v} %` },
    h('span', { class: 'progress-track' }, h('span', { class: 'progress-fill', style: { width: `${v}%` } })),
    h('span', { class: 'progress-text' }, `${v} %`)
  );
}

/** Kästchen zum Abhaken bzw. Symbol bei Terminen */
function leading(item, status, ctx) {
  if (L.isAppointment(item)) {
    return h('span', { class: `lead-icon ${L.isExamLike(item) ? 'is-exam' : ''}` }, icon(L.isExamLike(item) ? 'exam' : 'calendar'));
  }
  const platformDone = item.status === 'submitted' || item.status === 'graded' || item.status === 'done';
  const locallyDone = Boolean(ctx.state.local.done[item.id]);
  const checked = platformDone || locallyDone;
  const title = platformDone && !locallyDone ? 'Auf der Plattform bereits abgegeben' : checked ? 'Wieder als offen markieren' : 'Als erledigt abhaken';
  return h(
    'button',
    {
      class: `check ${checked ? 'is-checked' : ''} ${status === 'overdue' ? 'is-overdue' : ''}`,
      title,
      'aria-label': title,
      'aria-pressed': checked ? 'true' : 'false',
      disabled: platformDone && !locallyDone,
      onclick: (e) => {
        e.stopPropagation();
        ctx.actions.toggleDone(item, !locallyDone);
      }
    },
    icon('check')
  );
}

export function details(item, ctx) {
  const now = ctx.now();
  const facts = [];
  const fact = (label, value) => value && facts.push(h('div', { class: 'fact' }, h('span', {}, label), h('strong', {}, value)));
  fact('Plattform', (L.SOURCE_META[item.source] || {}).name);
  fact('Art', L.typeLabel(item));
  if (item.due) {
    const when = item.allDay ? L.fmtDateLong(item.due) : `${L.fmtDateLong(item.due)}, ${L.fmtTime(item.due)}${item.end ? `–${L.fmtTime(item.end)}` : ''}`;
    fact(L.isAppointment(item) ? 'Termin' : 'Fällig', when);
  }
  fact('Fach', item.subject);
  fact('Kurs', item.course && item.course !== item.subject ? item.course : '');
  fact('Lehrkraft', item.teacher);
  fact('Raum', item.room);
  if (item.start && !L.isAppointment(item)) fact('Freigegeben', L.fmtDateShort(item.start));
  if (item.assigned) fact('Aufgegeben', L.fmtDateShort(item.assigned));
  if (item.grade) fact('Note', item.grade);
  if (item.attachments) fact('Anhänge', `${item.attachments}`);

  const actions = [];
  const cal = calendarButton(item, ctx);
  if (cal) actions.push(cal);
  if (item.url) {
    actions.push(
      h('button', { class: 'btn', onclick: () => ctx.api.openUrl(item.url, false) }, icon('open'), 'Öffnen'),
      h('button', { class: 'btn btn-ghost', onclick: () => ctx.api.openUrl(item.url, true) }, icon('external'), 'Im Browser')
    );
  }
  if (item.source === 'own') {
    actions.push(
      h('button', { class: 'btn btn-ghost', onclick: () => ctx.actions.editTask(item) }, icon('edit'), 'Bearbeiten'),
      h('button', { class: 'btn btn-ghost btn-danger', onclick: () => ctx.actions.deleteTask(item) }, icon('trash'), 'Löschen')
    );
  } else if (!item.demo) {
    const dismissed = Boolean(ctx.state.local.dismissed[item.id]);
    actions.push(
      h(
        'button',
        { class: 'btn btn-ghost', title: 'Eintrag in der Übersicht nicht mehr anzeigen', onclick: () => ctx.actions.dismiss(item, !dismissed) },
        icon(dismissed ? 'eye' : 'eyeOff'),
        dismissed ? 'Wieder anzeigen' : 'Ausblenden'
      )
    );
  }

  return h(
    'div',
    { class: 'details' },
    item.description ? h('p', { class: 'desc' }, item.description) : null,
    item.note ? h('p', { class: 'note' }, icon('info'), item.note) : null,
    h('div', { class: 'facts' }, facts),
    actions.length ? h('div', { class: 'detail-actions' }, actions) : null,
    item.fetched ? h('div', { class: 'fetched' }, `Stand: ${L.timeAgo(item.fetched, now)}`) : null
  );
}

export function renderItem(item, ctx, { expandable = true, showDate = true } = {}) {
  const now = ctx.now();
  const status = L.effectiveStatus(item, ctx.state.local, now);
  const expanded = ctx.ui.expanded === item.id;
  const meta = L.SOURCE_META[item.source] || L.SOURCE_META.own;
  const finished = L.isFinished(status);

  const row = h(
    'div',
    {
      class: `item status-${status} ${finished ? 'is-finished' : ''} ${expanded ? 'is-expanded' : ''} ${L.isExamLike(item) && !finished ? 'is-exam' : ''}`,
      style: { '--c': meta.color },
      dataset: { id: item.id }
    },
    h(
      'div',
      {
        class: 'item-main',
        role: expandable ? 'button' : null,
        tabindex: expandable ? '0' : null,
        onclick: expandable ? () => ctx.actions.toggleExpand(item.id) : null,
        onkeydown: expandable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                ctx.actions.toggleExpand(item.id);
              }
            }
          : null
      },
      leading(item, status, ctx),
      h(
        'div',
        { class: 'item-body' },
        h('div', { class: 'item-title' }, L.displayTitle(item)),
        h(
          'div',
          { class: 'item-meta' },
          sourceBadge(item.source),
          metaLine(item).map((b) => h('span', { class: 'meta-bit' }, b)),
          progressBar(item.progress)
        )
      ),
      h(
        'div',
        { class: 'item-side' },
        showDate ? h('div', { class: 'due' }, L.fmtDue(item, now)) : item.due && !item.allDay ? h('div', { class: 'due' }, L.fmtTime(item.due)) : null,
        h('div', { class: 'side-bottom' }, !finished && showDate ? h('span', { class: 'rel' }, L.fmtRelative(item, now)) : null, statusPill(item, status))
      )
    ),
    expanded ? details(item, ctx) : null
  );
  return row;
}
