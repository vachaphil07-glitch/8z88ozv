// Schulradar – Oberfläche
import { h, clear, icon } from './dom.js';
import * as L from './logic.js';
import { renderList } from './views/list.js';
import { renderWeek } from './views/week.js';
import { renderMonth } from './views/month.js';
import { renderPlatforms } from './views/platforms.js';
import { renderSettings } from './views/settings.js';
import { openTaskDialog, openItemDialog, openOnboarding, confirmDialog, closeModal, toast } from './views/dialogs.js';

const api = window.schulradar;

const VIEWS = {
  list: { title: 'Übersicht', icon: 'list', render: renderList, search: true },
  week: { title: 'Woche', icon: 'week', render: renderWeek, search: true },
  month: { title: 'Monat', icon: 'month', render: renderMonth, search: true },
  platforms: { title: 'Plattformen', icon: 'plug', render: renderPlatforms },
  settings: { title: 'Einstellungen', icon: 'settings', render: renderSettings }
};

// Ansicht & Filter merken (nur Komfort – funktioniert auch ohne Speicher)
const PREF_KEY = 'schulradar.ui';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}
function savePrefs() {
  try {
    const { view, kind, showDone, hiddenSources, collapsed } = ui;
    localStorage.setItem(PREF_KEY, JSON.stringify({ view: view === 'platforms' || view === 'settings' ? 'list' : view, kind, showDone, hiddenSources, collapsed }));
  } catch (_) {
    /* egal */
  }
}

const prefs = loadPrefs();
const ui = {
  view: VIEWS[prefs.view] ? prefs.view : 'list',
  search: '',
  kind: prefs.kind || 'all',
  showDone: Boolean(prefs.showDone),
  hiddenSources: Array.isArray(prefs.hiddenSources) ? prefs.hiddenSources : [],
  collapsed: Array.isArray(prefs.collapsed) ? prefs.collapsed : [],
  expanded: null,
  weekStart: null,
  monthStart: null,
  selectedDay: null,
  timetable: {},
  drafts: {},
  graph: {}
};

let state = null;
let onboardingShown = false;

const ctx = {
  api,
  ui,
  get state() {
    return state;
  },
  now: () => Date.now(),
  rerender: () => render(),
  toast,
  actions: {}
};

const actions = ctx.actions;

actions.go = (view) => {
  if (!VIEWS[view]) return;
  ui.view = view;
  ui.expanded = null;
  savePrefs();
  render({ resetScroll: true });
};

actions.setUi = (patch) => {
  Object.assign(ui, patch);
  savePrefs();
  render();
};

actions.toggleExpand = (id) => {
  ui.expanded = ui.expanded === id ? null : id;
  render();
};

actions.toggleGroup = (key) => {
  ui.collapsed = ui.collapsed.includes(key) ? ui.collapsed.filter((k) => k !== key) : [...ui.collapsed, key];
  savePrefs();
  render();
};

actions.toggleSource = (source) => {
  ui.hiddenSources = ui.hiddenSources.includes(source) ? ui.hiddenSources.filter((s) => s !== source) : [...ui.hiddenSources, source];
  savePrefs();
  render();
};

actions.toggleDone = (item, done) => {
  // sofort anzeigen, der Hauptprozess bestätigt kurz danach
  if (done) state.local.done[item.id] = Date.now();
  else delete state.local.done[item.id];
  render();
  api.setDone(item.id, done);
  if (done) toast(`„${shorten(item.title)}“ abgehakt`, 'ok');
};

actions.dismiss = (item, dismissed) => {
  api.setDismissed(item.id, dismissed);
  if (dismissed) toast('Ausgeblendet. Wiederherstellen unter Einstellungen → Ausgeblendete Einträge.');
  ui.expanded = null;
};

actions.newTask = (preset = {}) => openTaskDialog(ctx, preset);
actions.editTask = (task) => openTaskDialog(ctx, task);
actions.deleteTask = async (task) => {
  const ok = await confirmDialog('Aufgabe löschen?', `„${shorten(task.title, 80)}“ wird endgültig gelöscht.`, 'Löschen', true);
  if (ok) {
    await api.deleteOwnTask(task.id);
    toast('Gelöscht.');
  }
};
actions.showItem = (item) => openItemDialog(ctx, item);

actions.updateSettings = (patch) => api.updateSettings(patch).then(applyState);
actions.updatePlatform = (id, patch) => actions.updateSettings({ platforms: { [id]: patch } });
actions.setDemo = (on) => {
  actions.updateSettings({ demo: on, onboarded: true });
  if (on) toast('Demo-Modus eingeschaltet.');
};

actions.sync = (source) => {
  if (state.demo) {
    toast('Demo-Modus: Es werden keine echten Daten abgerufen.');
    return;
  }
  api.sync(source || null);
};

actions.logout = async (p) => {
  const ok = await confirmDialog(`${p.name} abmelden?`, 'Gespeicherte Zugangsdaten und die Anmeldung für diese Plattform werden gelöscht. Abgehakte Einträge bleiben erhalten.', 'Abmelden', true);
  if (!ok) return;
  ui.drafts[p.id] = {};
  await api.logout(p.id);
  toast(`${p.name} abgemeldet.`);
};

actions.exportDiagnostics = async (source) => {
  const res = await api.exportDiagnostics(source);
  if (res && res.ok) toast('Diagnose gespeichert.', 'ok');
};

actions.graphConnect = () => {
  ui.graph = { waiting: true };
  render();
  api.teamsGraphConnect().then((res) => {
    if (res && res.ok) toast('Teams über Microsoft Graph verbunden.', 'ok');
  });
};

actions.showOnboarding = () => openOnboarding(ctx);

function shorten(text, max = 50) {
  const t = String(text || '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------------------------------------------------------------- Design

const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  if (!state) return;
  const pref = state.settings.theme;
  const effective = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
  if (document.documentElement.dataset.theme !== effective) {
    document.documentElement.dataset.theme = effective;
    api.setTheme(effective);
  }
}
media.addEventListener('change', applyTheme);

// ---------------------------------------------------------------- Rendern

function renderNav() {
  const nav = clear(document.getElementById('nav'));
  const st = L.stats(state.items, { local: state.local, now: ctx.now() });
  const problems = state.demo
    ? 0
    : state.platforms.filter((p) => state.settings.platforms[p.id].enabled && ['login', 'error', 'config'].includes((state.sourceState[p.id] || {}).status)).length;
  for (const [key, v] of Object.entries(VIEWS)) {
    let badge = null;
    if (key === 'list' && st.open) badge = h('span', { class: `nav-badge ${st.overdue ? 'is-danger' : ''}` }, String(st.open));
    if (key === 'platforms' && problems) badge = h('span', { class: 'nav-badge is-warn', title: 'Plattform braucht Aufmerksamkeit' }, '!');
    nav.append(
      h(
        'button',
        { class: `nav-item ${ui.view === key ? 'is-active' : ''}`, onclick: () => actions.go(key), 'aria-current': ui.view === key ? 'page' : null },
        icon(v.icon),
        h('span', {}, v.title),
        badge
      )
    );
  }
}

function renderSources() {
  const list = clear(document.getElementById('source-list'));
  for (const p of state.platforms) {
    const s = state.sourceState[p.id] || {};
    const enabled = state.settings.platforms[p.id].enabled;
    const syncing = state.syncing.includes(p.id);
    let status = s.status || 'new';
    if (!s.lastSync && status !== 'ok' && status !== 'error') status = 'new';
    if (!enabled) status = 'off';
    if (syncing) status = 'syncing';
    const count = state.items.filter((i) => i.source === p.id && !L.isFinished(L.effectiveStatus(i, state.local, ctx.now()))).length;
    list.append(
      h(
        'button',
        {
          class: `source status-${status}`,
          style: { '--c': p.color },
          title: s.message || '',
          onclick: () => {
            actions.go('platforms');
            setTimeout(() => document.getElementById(`platform-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
          }
        },
        h('span', { class: 'src-dot' }),
        h('span', { class: 'source-name' }, p.name),
        syncing
          ? icon('sync', 'spin source-state')
          : status === 'ok'
            ? h('span', { class: 'source-count' }, String(count))
            : status === 'off'
              ? h('span', { class: 'source-count muted' }, 'aus')
              : status === 'new'
                ? h('span', { class: 'source-count muted', title: 'Noch nicht verbunden' }, '–')
                : icon('alert', 'source-state warn')
      )
    );
  }
}

function renderFooter() {
  const foot = clear(document.getElementById('side-footer'));
  const times = Object.values(state.sourceState).map((s) => s.lastSync || 0).filter(Boolean);
  const last = times.length ? Math.max(...times) : 0;
  const syncing = state.syncing.length > 0;
  foot.append(
    h(
      'div',
      { class: 'sync-info' },
      h('span', { class: 'muted' }, syncing ? 'Wird aktualisiert …' : state.demo ? 'Demo-Daten' : `Aktualisiert ${L.timeAgo(last, ctx.now())}`)
    )
  );
}

function renderTopbar() {
  const v = VIEWS[ui.view];
  document.getElementById('view-title').textContent = v.title;
  document.getElementById('view-subtitle').textContent = ui.view === 'list' ? L.fmtDateLong(ctx.now()) : '';
  const actionsEl = document.getElementById('topbar-actions');
  const hadFocus = document.activeElement && document.activeElement.id === 'search';
  const selStart = hadFocus ? document.activeElement.selectionStart : null;
  clear(actionsEl);
  if (v.search) {
    actionsEl.append(
      h(
        'label',
        { class: 'search' },
        icon('search'),
        h('input', {
          id: 'search',
          type: 'search',
          placeholder: 'Suchen …  (Strg+F)',
          value: ui.search,
          oninput: (e) => {
            ui.search = e.target.value;
            renderView();
          }
        })
      )
    );
  }
  const syncing = state.syncing.length > 0;
  actionsEl.append(
    h(
      'button',
      { class: 'btn btn-ghost', title: 'Jetzt alle Plattformen abrufen (Strg+R)', disabled: syncing, onclick: () => actions.sync() },
      icon('sync', syncing ? 'spin' : ''),
      h('span', { class: 'hide-narrow' }, syncing ? 'Aktualisiere …' : 'Aktualisieren')
    ),
    h('button', { class: 'btn btn-primary', title: 'Eigene Aufgabe anlegen (Strg+N)', onclick: () => actions.newTask() }, icon('plus'), h('span', { class: 'hide-narrow' }, 'Eigene Aufgabe'))
  );
  if (hadFocus) {
    const input = document.getElementById('search');
    input.focus();
    if (selStart !== null) input.setSelectionRange(selStart, selStart);
  }
}

function renderView({ resetScroll = false } = {}) {
  const view = document.getElementById('view');
  const scroll = resetScroll ? 0 : view.scrollTop;
  // Fokus in Formularfeldern erhalten (z. B. während im Hintergrund abgerufen wird)
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.focusKey : null;
  const sel = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const openDetails = [...view.querySelectorAll('details[open]')].map((d, i) => i);

  clear(view);
  view.className = `view view-${ui.view}`;
  const inner = h('div', { class: 'view-inner' });
  view.append(inner);
  VIEWS[ui.view].render(inner, ctx);

  const details = [...view.querySelectorAll('details')];
  for (const i of openDetails) if (details[i]) details[i].open = true;
  if (focusKey) {
    const el = view.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus();
      if (sel) {
        try {
          el.setSelectionRange(sel[0], sel[1]);
        } catch (_) {
          /* type=password o. Ä. */
        }
      }
    }
  }
  view.scrollTop = scroll;
}

function render(opts = {}) {
  if (!state) return;
  applyTheme();
  document.getElementById('school-name').textContent = state.schoolName;
  renderNav();
  renderSources();
  renderFooter();
  renderTopbar();
  renderView(opts);
  if (!state.settings.onboarded && !state.demo && !onboardingShown) {
    onboardingShown = true;
    openOnboarding(ctx);
  }
}

function applyState(next) {
  if (!next) return;
  // nach einem neuen WebUntis-Abruf den Stundenplan neu laden
  const lastSync = (s) => (s && s.sourceState && s.sourceState.webuntis && s.sourceState.webuntis.lastSync) || 0;
  if (state && (lastSync(next) !== lastSync(state) || next.demo !== state.demo)) ui.timetable = {};
  state = next;
  render();
}

function focusItem(id) {
  const item = state && state.items.find((i) => i.id === id);
  if (!item) return;
  ui.view = 'list';
  ui.expanded = id;
  ui.search = '';
  if (L.isFinished(L.effectiveStatus(item, state.local, ctx.now()))) ui.showDone = true;
  render();
  setTimeout(() => {
    const el = document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 1600);
    }
  }, 60);
}

// ---------------------------------------------------------------- Start

document.getElementById('brand-logo').append(icon('radar'));

api.onState(applyState);
api.onToast(({ message, kind }) => toast(message, kind));
api.onFocusItem(focusItem);
api.onNavigate((view) => {
  closeModal();
  // Befehle für automatische Screenshots (nur Entwicklung)
  if (view === 'theme:dark' || view === 'theme:light') {
    document.documentElement.dataset.theme = view.slice(6);
    state.settings.theme = view.slice(6);
    render();
  } else if (view === 'expand:first') {
    const first = document.querySelector('.item[data-id]');
    if (first) actions.toggleExpand(first.dataset.id);
  } else if (view === 'dialog:task') {
    actions.newTask();
  } else if (view === 'dialog:onboarding') {
    openOnboarding(ctx);
  } else {
    actions.go(view);
  }
});
api.onGraphCode((payload) => {
  if (payload.error) ui.graph = { error: payload.error };
  else if (payload.done) ui.graph = {};
  else ui.graph = { waiting: true, userCode: payload.userCode, verificationUri: payload.verificationUri };
  render();
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (document.body.classList.contains('has-modal')) closeModal();
    else if (ui.expanded) {
      ui.expanded = null;
      render();
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    actions.newTask();
  } else if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (!VIEWS[ui.view].search) actions.go('list');
    document.getElementById('search')?.focus();
  } else if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') {
    e.preventDefault();
    actions.sync();
  } else if (mod && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    actions.go(Object.keys(VIEWS)[Number(e.key) - 1]);
  }
});

// Minütlich neu zeichnen, damit "in 5 Min." & Co. aktuell bleiben
setInterval(() => {
  if (!document.body.classList.contains('has-modal') && !(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.focusKey)) render();
}, 60 * 1000);

api.getState().then(applyState);
