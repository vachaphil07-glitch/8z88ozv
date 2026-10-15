// Lernen: Fokus-Timer (Pomodoro), Lernplan vor Tests und Wochenrückblick
import { h, icon } from '../dom.js';
import * as L from '../logic.js';

// ---------------------------------------------------------------- Fokus-Timer
// Der Timer läuft über Zeitstempel (endAt) – er stimmt also auch, wenn das Fenster zu war oder das
// Handy gesperrt. Zustand im localStorage, damit er einen Neustart der Oberfläche übersteht.

const KEY = 'schulradar.focus';
const SUGGESTED = ['Diplomarbeit'];
let timer = load();
let watcher = null;
let ctxRef = null;

function load() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (t && typeof t === 'object') return t;
  } catch (_) {
    /* egal */
  }
  return { phase: 'idle', label: '' };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(timer));
  } catch (_) {
    /* egal */
  }
}

function lengths(ctx) {
  const f = (ctx.state.settings.focus || {});
  return { focus: (Number(f.focusMin) || 25) * 60000, rest: (Number(f.breakMin) || 5) * 60000 };
}

function remaining(now = Date.now()) {
  if (timer.paused) return timer.remaining || 0;
  return timer.endAt ? timer.endAt - now : 0;
}

function alarm(ctx) {
  if (timer.phase === 'idle' || timer.paused || !timer.endAt) ctx.api.focusAlarm(null);
  else if (timer.phase === 'focus') ctx.api.focusAlarm({ at: timer.endAt, title: 'Fokus-Einheit geschafft 🎉', body: `${timer.label || 'Fokus'} – Zeit für eine Pause.` });
  else ctx.api.focusAlarm({ at: timer.endAt, title: 'Pause vorbei', body: `Weiter mit ${timer.label || 'deiner Arbeit'}?` });
}

function logFocus(ctx, minutes) {
  if (minutes >= 1) ctx.api.logFocus({ label: timer.label, start: timer.phaseStart || Date.now() - minutes * 60000, minutes });
}

function startFocus(ctx) {
  const { focus } = lengths(ctx);
  timer = { ...timer, phase: 'focus', endAt: Date.now() + focus, length: focus, phaseStart: Date.now(), paused: false, remaining: 0 };
  save();
  alarm(ctx);
  ctx.rerender();
}

function pause(ctx) {
  if (timer.paused) {
    timer = { ...timer, paused: false, endAt: Date.now() + (timer.remaining || 0), remaining: 0 };
  } else {
    timer = { ...timer, paused: true, remaining: remaining(), endAt: null };
  }
  save();
  alarm(ctx);
  ctx.rerender();
}

function stop(ctx) {
  if (timer.phase === 'focus') {
    const done = Math.floor(((timer.length || 0) - remaining()) / 60000);
    logFocus(ctx, done);
    if (done >= 1) ctx.toast(`${L.fmtMinutes(done)} Fokus gespeichert.`, 'ok');
  }
  timer = { phase: 'idle', label: timer.label };
  save();
  alarm(ctx);
  ctx.rerender();
}

/** Phase zu Ende? (läuft jede Sekunde, egal welche Ansicht offen ist) */
function check(ctx) {
  if (timer.phase === 'idle' || timer.paused || !timer.endAt) return;
  const now = Date.now();
  if (now < timer.endAt) {
    const el = document.getElementById('focus-clock');
    if (el) el.textContent = L.fmtClock(timer.endAt - now);
    return;
  }
  if (timer.phase === 'focus') {
    logFocus(ctx, Math.round((timer.length || 0) / 60000));
    const { rest } = lengths(ctx);
    // war die App lange zu, ist auch die Pause schon vorbei
    if (now - timer.endAt > rest) timer = { phase: 'idle', label: timer.label };
    else timer = { ...timer, phase: 'break', endAt: timer.endAt + rest, length: rest, phaseStart: timer.endAt };
    ctx.toast('Fokus-Einheit geschafft – Zeit für eine Pause.', 'ok');
  } else {
    timer = { phase: 'idle', label: timer.label };
    ctx.toast('Pause vorbei.');
  }
  save();
  alarm(ctx);
  if (ctx.ui.view === 'learn') ctx.rerender();
}

export function startFocusWatcher(ctx) {
  ctxRef = ctx;
  if (watcher) return;
  watcher = setInterval(() => ctxRef && ctxRef.state && check(ctxRef), 1000);
}

export function focusRunning() {
  return timer.phase !== 'idle';
}

function timerCard(ctx) {
  const labels = [...new Set([...SUGGESTED, ...(ctx.state.focusSessions || []).map((s) => s.label).filter(Boolean)])];
  const idle = timer.phase === 'idle';
  const { focus, rest } = lengths(ctx);
  const left = idle ? focus : remaining();
  const total = idle ? focus : timer.length || focus;
  const progress = idle ? 0 : Math.min(1, Math.max(0, 1 - left / total));
  return h(
    'section',
    { class: `card focus-card phase-${timer.phase} ${timer.paused ? 'is-paused' : ''}` },
    h('h3', { class: 'settings-title' }, icon('timer'), 'Fokus-Timer'),
    h(
      'div',
      { class: 'focus-ring', style: { '--p': String(progress) } },
      h('div', { class: 'focus-inner' }, h('span', { class: 'focus-phase' }, idle ? 'Bereit' : timer.phase === 'focus' ? (timer.paused ? 'Pausiert' : 'Fokus') : 'Pause'), h('strong', { id: 'focus-clock' }, L.fmtClock(left)))
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Woran arbeitest du?'),
      h('input', {
        value: timer.label || '',
        list: 'focus-labels',
        maxlength: 80,
        placeholder: 'z. B. Diplomarbeit, AM-Schularbeit',
        dataset: { focusKey: 'focus.label' },
        oninput: (e) => {
          timer.label = e.target.value;
          save();
        }
      }),
      h('datalist', { id: 'focus-labels' }, labels.map((l) => h('option', { value: l })))
    ),
    h(
      'div',
      { class: 'focus-actions' },
      idle
        ? h('button', { class: 'btn btn-primary btn-big', onclick: () => startFocus(ctx) }, icon('play'), `${Math.round(focus / 60000)} min starten`)
        : [
            h('button', { class: 'btn btn-big', onclick: () => pause(ctx) }, icon(timer.paused ? 'play' : 'pause'), timer.paused ? 'Weiter' : 'Pause'),
            h('button', { class: 'btn btn-ghost btn-big', onclick: () => stop(ctx) }, icon('stop'), timer.phase === 'focus' ? 'Beenden' : 'Pause beenden')
          ]
    ),
    h(
      'div',
      { class: 'focus-lengths' },
      h('span', { class: 'muted' }, 'Länge:'),
      [
        [25, 5],
        [50, 10],
        [90, 15]
      ].map(([f, b]) =>
        h(
          'button',
          {
            class: `chip ${Math.round(focus / 60000) === f ? 'is-active' : ''}`,
            disabled: !idle,
            onclick: () => ctx.actions.updateSettings({ focus: { focusMin: f, breakMin: b } })
          },
          `${f} / ${b}`
        )
      ),
      h('span', { class: 'muted small' }, `Pause ${Math.round(rest / 60000)} min`)
    )
  );
}

function statsCard(ctx) {
  const st = L.focusStats(ctx.state.focusSessions || [], ctx.now());
  return h(
    'section',
    { class: 'card focus-stats' },
    h('h3', { class: 'settings-title' }, icon('chart'), 'Fokus-Zeit'),
    h('div', { class: 'stat-row' }, h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, L.fmtMinutes(st.todayMin)), h('div', { class: 'stat-label' }, 'heute')), h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, L.fmtMinutes(st.weekMin)), h('div', { class: 'stat-label' }, 'diese Woche'))),
    st.byLabel.length
      ? h(
          'ul',
          { class: 'label-stats' },
          st.byLabel.slice(0, 8).map((l) =>
            h(
              'li',
              {},
              h('span', { class: 'label-name' }, l.label),
              h('span', { class: 'label-bar' }, h('span', { style: { width: `${Math.round((l.totalMin / Math.max(...st.byLabel.map((x) => x.totalMin))) * 100)}%` } })),
              h('span', { class: 'muted' }, `${L.fmtMinutes(l.weekMin)} Woche · ${L.fmtMinutes(l.totalMin)} gesamt`)
            )
          )
        )
      : h('p', { class: 'muted' }, 'Noch keine Fokus-Einheiten. Tipp: Gib ein Thema wie „Diplomarbeit“ an – dann siehst du hier, wie viel Zeit du insgesamt hineingesteckt hast.')
  );
}

// ---------------------------------------------------------------- Lernplan

function loadPlan(ctx, force = false) {
  const fresh = ctx.ui.plan && Date.now() - ctx.ui.planAt < 5 * 60000 && ctx.ui.planKey === planKey(ctx);
  if ((fresh && !force) || ctx.ui.planLoading) return;
  ctx.ui.planLoading = true;
  ctx.api
    .studyPlan()
    .then((plan) => {
      ctx.ui.plan = plan;
      ctx.ui.planAt = Date.now();
      ctx.ui.planKey = planKey(ctx);
    })
    .catch(() => {
      ctx.ui.plan = { plans: [], suggestions: [] };
    })
    .finally(() => {
      ctx.ui.planLoading = false;
      if (ctx.ui.view === 'learn') ctx.rerender();
    });
}

/** ändert sich, wenn Tests oder geplante Einheiten dazukommen → Plan neu berechnen */
function planKey(ctx) {
  return ctx.state.items
    .filter((i) => L.isExamLike(i) || (i.source === 'own' && i.kind === 'lernen'))
    .map((i) => `${i.id}:${i.due}:${ctx.state.local.done[i.id] ? 1 : 0}`)
    .join('|');
}

function sessionLabel(s) {
  return `${L.dayLabel(s.start, Date.now())} · ${L.fmtTime(s.start)}–${L.fmtTime(s.end)}`;
}

async function accept(ctx, sessions) {
  const res = await ctx.api.acceptStudy(sessions);
  if (res && res.ok) {
    ctx.toast(res.count === 1 ? 'Lerneinheit eingeplant.' : `${res.count} Lerneinheiten eingeplant.`, 'ok');
    loadPlan(ctx, true);
  }
}

function planCard(ctx) {
  loadPlan(ctx);
  const plan = ctx.ui.plan;
  const body = [];
  if (!plan) body.push(h('p', { class: 'muted' }, 'Wird berechnet …'));
  else if (!plan.plans.length) body.push(h('p', { class: 'muted' }, 'In den nächsten zwei Wochen stehen keine Tests oder Schularbeiten an. 🎉'));
  else {
    for (const p of plan.plans) {
      const planned = ctx.state.items.filter((i) => i.source === 'own' && i.kind === 'lernen' && i.examId === p.exam.id).sort((a, b) => a.due - b.due);
      body.push(
        h(
          'div',
          { class: 'plan-exam' },
          h(
            'div',
            { class: 'plan-head' },
            h('span', { class: 'lead-icon is-exam' }, icon('exam')),
            h('div', { class: 'plan-title' }, h('strong', {}, L.displayTitle(p.exam)), h('span', { class: 'muted' }, `${L.fmtDue(p.exam, ctx.now())} · ${L.fmtRelative(p.exam, ctx.now())}`)),
            h('span', { class: `pill ${p.planned >= p.wanted ? 'pill-done' : 'pill-open'}` }, `${p.planned}/${p.wanted} geplant`)
          ),
          planned.length
            ? h(
                'ul',
                { class: 'plan-list' },
                planned.map((t) => h('li', { class: ctx.state.local.done[t.id] ? 'is-done' : '' }, icon(ctx.state.local.done[t.id] ? 'check' : 'calendar'), sessionLabel({ start: t.due, end: t.end || t.due + 45 * 60000 })))
              )
            : null,
          p.suggestions.length
            ? [
                h('div', { class: 'muted small plan-sub' }, 'Vorschläge in freien Zeiten:'),
                h(
                  'ul',
                  { class: 'plan-list is-suggestion' },
                  p.suggestions.map((s) =>
                    h('li', {}, icon('sparkle'), h('span', {}, sessionLabel(s)), h('button', { class: 'btn btn-small btn-ghost', onclick: () => accept(ctx, [s]) }, icon('plus'), 'Einplanen'))
                  )
                ),
                p.suggestions.length > 1 ? h('button', { class: 'btn btn-small', onclick: () => accept(ctx, p.suggestions) }, `Alle ${p.suggestions.length} einplanen`) : null
              ]
            : null,
          p.tooLate && !p.suggestions.length && p.planned < p.wanted ? h('p', { class: 'muted small' }, 'Keine freie Zeit mehr bis zum Test gefunden – vielleicht lieber kurze Einheiten zwischendurch.') : null
        )
      );
    }
  }
  return h(
    'section',
    { class: 'card plan-card' },
    h(
      'h3',
      { class: 'settings-title' },
      icon('exam'),
      'Lernplan',
      h('button', { class: 'btn btn-small btn-ghost title-action', title: 'Neu berechnen', onclick: () => loadPlan(ctx, true) }, icon('sync', ctx.ui.planLoading ? 'spin' : ''))
    ),
    h(
      'p',
      { class: 'muted small' },
      plan && !plan.withTimetable
        ? 'Tipp: Mit verbundenem WebUntis berücksichtigt der Plan auch deinen Stundenplan.'
        : 'Verteilt Lerneinheiten auf die Tage vor dem Test – rund um Unterricht und Termine. Eingeplante Einheiten erscheinen in Übersicht und Woche und lassen sich abhaken.'
    ),
    body,
    plan && plan.suggestions.length > 1 && plan.plans.length > 1
      ? h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', onclick: () => accept(ctx, plan.suggestions) }, icon('plus'), `Alle ${plan.suggestions.length} Vorschläge einplanen`))
      : null
  );
}

// ---------------------------------------------------------------- Wochenrückblick

function reviewCard(ctx) {
  const r = ctx.state.review;
  if (!r) return null;
  const sunday = new Date(ctx.now()).getDay() === 0;
  return h(
    'section',
    { class: 'card review-card' },
    h('h3', { class: 'settings-title' }, icon('sparkle'), sunday ? 'Dein Wochenrückblick' : 'Diese Woche bisher'),
    h(
      'div',
      { class: 'stat-row' },
      h('div', { class: 'stat stat-ok' }, h('div', { class: 'stat-value' }, String(r.doneCount)), h('div', { class: 'stat-label' }, 'erledigt')),
      h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, L.fmtMinutes(r.focusMin)), h('div', { class: 'stat-label' }, 'Fokus')),
      h('div', { class: `stat ${r.overdue ? 'stat-danger' : ''}` }, h('div', { class: 'stat-value' }, String(r.overdue)), h('div', { class: 'stat-label' }, 'überfällig'))
    ),
    r.topLabel ? h('p', { class: 'small' }, `Am meisten Zeit: „${r.topLabel}“ (${L.fmtMinutes(r.topMin)}).`) : null,
    h('h4', { class: 'review-sub' }, 'Nächste Woche'),
    h(
      'p',
      { class: 'small' },
      r.nextTasks ? `${r.nextTasks} ${r.nextTasks === 1 ? 'Abgabe' : 'Abgaben'}` : 'Keine Abgaben',
      r.nextExams.length ? ` · ${r.nextExams.length} ${r.nextExams.length === 1 ? 'Test' : 'Tests'}:` : ' · keine Tests'
    ),
    r.nextExams.length ? h('ul', { class: 'plan-list' }, r.nextExams.map((e) => h('li', {}, icon('exam'), `${L.fmtDateShort(e.due)} – ${e.subject ? `${e.subject}: ` : ''}${e.title}`))) : null
  );
}

export function renderLearn(root, ctx) {
  startFocusWatcher(ctx);
  root.append(h('div', { class: 'learn-grid' }, h('div', { class: 'learn-col' }, timerCard(ctx), statsCard(ctx)), h('div', { class: 'learn-col' }, planCard(ctx), reviewCard(ctx))));
}
