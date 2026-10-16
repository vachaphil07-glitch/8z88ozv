// Tasks: Google-Tasks-Listen nebeneinander – wie in Google Tasks selbst
import { h, icon } from '../dom.js';
import * as L from '../logic.js';

function listIdOf(item) {
  const m = String(item.id).match(/^gtasks:([^:]+):/);
  return m ? m[1] : '';
}

/** Offene Aufgaben einer Liste nach Tag gruppieren: Überfällig, Heute, einzelne Tage, Kein Datum */
function groups(items, now) {
  const today = L.startOfDay(now);
  const out = new Map();
  const add = (key, label, it) => {
    if (!out.has(key)) out.set(key, { label, items: [] });
    out.get(key).items.push(it);
  };
  const sorted = [...items].sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || String(a.title).localeCompare(String(b.title), 'de'));
  for (const it of sorted) {
    if (!it.due) add('z', 'Kein Datum', it);
    else if (it.due < today) add('0', 'Überfällig', it);
    else if (it.due < L.addDays(today, 1)) add('1', 'Heute', it);
    else if (it.due < L.addDays(today, 2)) add('2', 'Morgen', it);
    else add(`3${it.due}`, L.fmtDateShort(it.due), it);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, g]) => g);
}

function taskRow(ctx, it, done) {
  const expanded = ctx.ui.expanded === it.id;
  return h(
    'div',
    { class: `gt-task ${done ? 'is-done' : ''}` },
    h(
      'button',
      {
        class: `gt-check ${done ? 'is-checked' : ''}`,
        title: done ? 'Wieder als offen markieren' : 'Als erledigt abhaken',
        'aria-pressed': done ? 'true' : 'false',
        onclick: () => ctx.actions.toggleDone(it, !done)
      },
      icon('check')
    ),
    h(
      'div',
      { class: 'gt-body', role: 'button', tabindex: '0', onclick: () => ctx.actions.toggleExpand(it.id) },
      h('div', { class: 'gt-title' }, it.title),
      it.description ? h('div', { class: `gt-notes ${expanded ? 'is-open' : ''}` }, it.description) : null,
      done && it.completedAt ? h('div', { class: 'gt-meta' }, `Erledigt ${L.timeAgo(it.completedAt, ctx.now())}`) : null,
      expanded && it.url
        ? h('button', { class: 'btn btn-small btn-ghost', onclick: (e) => (e.stopPropagation(), ctx.api.openUrl(it.url, true)) }, icon('external'), 'In Google Tasks öffnen')
        : null,
      expanded ? h('button', { class: 'btn btn-small btn-ghost', onclick: (e) => (e.stopPropagation(), ctx.actions.newNote({ itemId: it.id })) }, icon('note'), 'Notiz') : null
    )
  );
}

function addForm(ctx, list) {
  const open = ctx.ui.gtAdd === list.id;
  if (!open) {
    return h('button', { class: 'gt-add', onclick: () => ctx.actions.setUi({ gtAdd: list.id }) }, icon('plus'), 'Aufgabe hinzufügen');
  }
  return h(
    'form',
    {
      class: 'gt-add-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const title = f.title.value.trim();
        if (!title) return;
        let due = null;
        if (f.date.value) {
          const [y, m, d] = f.date.value.split('-').map(Number);
          due = new Date(y, m - 1, d).getTime();
        }
        e.target.querySelector('button[type=submit]').disabled = true;
        const res = await ctx.api.gtasksAdd({ listId: list.id, title, due, notes: f.notes.value });
        if (res && res.ok) {
          ctx.ui.gtAdd = null;
          ctx.toast('In Google Tasks angelegt.', 'ok');
          ctx.rerender();
        } else {
          e.target.querySelector('button[type=submit]').disabled = false;
          ctx.toast((res && res.error) || 'Konnte nicht anlegen.', 'error');
        }
      }
    },
    h('input', { name: 'title', placeholder: 'Titel', autofocus: true, maxlength: 300, dataset: { focusKey: `gt.${list.id}.title` } }),
    h('input', { name: 'notes', placeholder: 'Details (optional)', maxlength: 2000, dataset: { focusKey: `gt.${list.id}.notes` } }),
    h(
      'div',
      { class: 'gt-add-row' },
      h('input', { type: 'date', name: 'date', class: 'select select-small' }),
      h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => ctx.actions.setUi({ gtAdd: null }) }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-small btn-primary' }, 'Speichern')
    )
  );
}

export function renderTasks(root, ctx) {
  const { state } = ctx;
  const g = state.google || {};
  const s = state.settings.platforms.gtasks;
  if (!state.demo && (!s.enabled || !g.connected)) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-icon is-neutral' }, icon('check')),
        h('h2', {}, 'Google Tasks ist noch nicht verbunden'),
        h('p', {}, 'Verbinde dein Google-Konto, dann siehst du hier alle deine Listen – wie in Google Tasks.'),
        h('button', { class: 'btn btn-primary', onclick: () => ctx.actions.go('platforms') }, 'Jetzt verbinden')
      )
    );
    return;
  }
  const now = ctx.now();
  const all = state.items.filter((i) => i.source === 'gtasks' && L.matchesSearch(i, ctx.ui.search));
  const hidden = new Set(s.hiddenLists || []);
  const lists = (state.demoTaskLists || s.knownLists || []).filter((l) => !hidden.has(l.id));
  const showDone = ctx.ui.gtDone || {};
  const isDone = (it) => it.status === 'done' || Boolean(state.local.done[it.id]);

  const columns = lists.map((list) => {
    const items = all.filter((i) => listIdOf(i) === list.id);
    const open = items.filter((i) => !isDone(i));
    const done = items.filter(isDone).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    return h(
      'section',
      { class: 'gt-list' },
      h('header', { class: 'gt-list-head' }, h('h3', {}, list.title), h('span', { class: 'muted' }, String(open.length))),
      addForm(ctx, list),
      open.length
        ? groups(open, now).map((grp) =>
            h('div', { class: 'gt-group' }, h('div', { class: `gt-group-label ${grp.label === 'Überfällig' ? 'is-danger' : ''}` }, grp.label), grp.items.map((it) => taskRow(ctx, it, false)))
          )
        : h('p', { class: 'muted gt-empty' }, 'Alles erledigt 🎉'),
      done.length
        ? h(
            'div',
            { class: 'gt-done' },
            h(
              'button',
              { class: 'gt-done-toggle', onclick: () => ctx.actions.setUi({ gtDone: { ...showDone, [list.id]: !showDone[list.id] } }) },
              icon(showDone[list.id] ? 'chevronDown' : 'chevronRight'),
              `Erledigt (${done.length})`
            ),
            showDone[list.id] ? done.map((it) => taskRow(ctx, it, true)) : null
          )
        : null
    );
  });

  root.append(
    lists.length
      ? h('div', { class: 'gt-board' }, columns)
      : h('div', { class: 'empty' }, h('p', {}, (state.sourceState.gtasks || {}).lastSync ? 'Keine Listen gefunden.' : 'Wird abgerufen …'))
  );
}
