// Übersicht: alle Aufgaben und Termine nach Fälligkeit gruppiert
import { h, icon } from '../dom.js';
import * as L from '../logic.js';
import { renderItem } from './item.js';

function statCard(label, value, tone, hint) {
  return h(
    'div',
    { class: `stat ${tone ? `stat-${tone}` : ''} ${value ? '' : 'is-zero'}` },
    h('div', { class: 'stat-value' }, String(value)),
    h('div', { class: 'stat-label' }, label),
    hint ? h('div', { class: 'stat-hint' }, hint) : null
  );
}

function neverConnected(state) {
  if (state.demo) return false;
  return state.platforms.every((p) => !(state.sourceState[p.id] || {}).lastSync);
}

export function banners(ctx) {
  const out = [];
  const { state } = ctx;
  if (state.demo) {
    out.push(
      h(
        'div',
        { class: 'banner banner-info' },
        icon('sparkle'),
        h('div', { class: 'banner-text' }, h('strong', {}, 'Demo-Modus'), ' – das sind Beispieldaten, damit du die App ausprobieren kannst.'),
        state.forcedDemo ? null : h('button', { class: 'btn btn-small', onclick: () => ctx.actions.setDemo(false) }, 'Demo beenden')
      )
    );
    return out;
  }
  const enabled = state.platforms.filter((p) => state.settings.platforms[p.id].enabled);
  if (neverConnected(state)) {
    out.push(
      h(
        'div',
        { class: 'banner banner-accent' },
        icon('plug'),
        h('div', { class: 'banner-text' }, h('strong', {}, 'Noch keine Plattform verbunden. '), 'Melde dich einmal bei WebUntis, Teams, Letto und Eduvidual an – danach sammelt Schulradar alles automatisch.'),
        h('button', { class: 'btn btn-primary btn-small', onclick: () => ctx.actions.go('platforms') }, 'Plattformen verbinden')
      )
    );
    return out;
  }
  for (const p of enabled) {
    const s = state.sourceState[p.id] || {};
    // Hinweise nur für Plattformen, die schon einmal verbunden waren
    if (!s.lastSync) continue;
    if (s.status !== 'login' && s.status !== 'error' && s.status !== 'config') continue;
    if (state.syncing.includes(p.id)) continue;
    out.push(
      h(
        'div',
        { class: `banner ${s.status === 'error' ? 'banner-error' : 'banner-warn'}` },
        icon('alert'),
        h('div', { class: 'banner-text' }, h('strong', {}, `${p.name}: `), s.message || 'Bitte anmelden.'),
        h(
          'button',
          { class: 'btn btn-small', onclick: () => (s.status === 'login' && p.id !== 'webuntis' ? ctx.api.login(p.id) : ctx.actions.go('platforms')) },
          s.status === 'login' && p.id !== 'webuntis' ? 'Anmelden' : 'Beheben'
        )
      )
    );
  }
  return out;
}

function filterBar(ctx) {
  const { ui } = ctx;
  const counts = {};
  for (const it of ctx.state.items) counts[it.source] = (counts[it.source] || 0) + 1;
  const chips = L.SOURCE_ORDER.filter((s) => counts[s] || s === 'own').map((s) => {
    const meta = L.SOURCE_META[s];
    const active = !ui.hiddenSources.includes(s);
    return h(
      'button',
      {
        class: `chip ${active ? 'is-active' : ''}`,
        style: { '--c': meta.color },
        'aria-pressed': active ? 'true' : 'false',
        title: active ? `${meta.name} ausblenden` : `${meta.name} anzeigen`,
        onclick: () => ctx.actions.toggleSource(s)
      },
      h('span', { class: 'src-dot' }),
      meta.name
    );
  });
  const seg = (value, label) =>
    h('button', { class: ui.kind === value ? 'is-active' : '', onclick: () => ctx.actions.setUi({ kind: value }) }, label);
  return h(
    'div',
    { class: 'filterbar' },
    h('div', { class: 'chips' }, chips),
    h('div', { class: 'filter-right' },
      h('div', { class: 'segmented' }, seg('all', 'Alle'), seg('tasks', 'Aufgaben'), seg('appointments', 'Tests & Termine')),
      h(
        'label',
        { class: 'toggle-inline' },
        h('input', { type: 'checkbox', checked: ui.showDone, onchange: (e) => ctx.actions.setUi({ showDone: e.target.checked }) }),
        h('span', { class: 'switch' }),
        'Erledigte'
      )
    )
  );
}

export function renderList(root, ctx) {
  const now = ctx.now();
  const { state, ui } = ctx;
  const visible = L.filterItems(state.items, {
    local: state.local,
    sources: new Set(L.SOURCE_ORDER.filter((s) => !ui.hiddenSources.includes(s))),
    kind: ui.kind,
    query: ui.search
  });
  const st = L.stats(state.items, { local: state.local, now });

  root.append(
    h(
      'div',
      { class: 'stats' },
      statCard('offen', st.open, '', st.open ? 'Aufgaben & Abgaben' : 'alles erledigt'),
      statCard('heute fällig', st.dueToday, st.dueToday ? 'warn' : ''),
      statCard('überfällig', st.overdue, st.overdue ? 'danger' : ''),
      statCard('Tests in 7 Tagen', st.exams, st.exams ? 'exam' : '')
    ),
    ...banners(ctx),
    filterBar(ctx)
  );

  const groups = L.groupItems(visible, { local: state.local, now, showDone: ui.showDone });
  if (!groups.length) {
    const searching = ui.search.trim();
    if (!searching && neverConnected(state)) {
      root.append(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-icon is-neutral' }, icon('plug')),
          h('h2', {}, 'Noch keine Aufgaben geladen'),
          h('p', {}, 'Sobald du eine Plattform verbunden hast, erscheinen hier alle Aufgaben, Abgaben und Tests.'),
          h('div', { class: 'empty-actions' },
            h('button', { class: 'btn btn-primary', onclick: () => ctx.actions.go('platforms') }, 'Plattformen verbinden'),
            h('button', { class: 'btn', onclick: () => ctx.actions.setDemo(true) }, 'Demo ansehen')
          )
        )
      );
      return;
    }
    root.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-icon' }, icon(searching ? 'search' : 'check')),
        h('h2', {}, searching ? 'Nichts gefunden' : 'Nichts offen – alles erledigt!'),
        h('p', {}, searching ? `Keine Einträge passen zu „${ui.search.trim()}“.` : 'Neue Aufgaben erscheinen hier automatisch, sobald sie auf einer Plattform auftauchen.')
      )
    );
    return;
  }
  for (const g of groups) {
    const collapsed = ui.collapsed.includes(g.key);
    root.append(
      h(
        'section',
        { class: `group group-${g.key}` },
        h(
          'button',
          { class: `group-head ${collapsed ? 'is-collapsed' : ''}`, onclick: () => ctx.actions.toggleGroup(g.key) },
          icon('chevronDown', 'group-chevron'),
          h('span', { class: 'group-label' }, g.label),
          h('span', { class: 'group-count' }, String(g.items.length))
        ),
        collapsed ? null : h('div', { class: 'group-items' }, g.items.map((it) => renderItem(it, ctx)))
      )
    );
  }
}
