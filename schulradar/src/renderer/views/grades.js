// Noten: eigene Noten (mit Schnitt und „was brauche ich noch“) und Bewertungen aus Eduvidual
import { h, icon } from '../dom.js';
import * as L from '../logic.js';
import { openModal, closeModal, confirmDialog } from './dialogs.js';

const DEFAULT_WEIGHT = { sa: 2, test: 1, muendlich: 1, mitarbeit: 1, hue: 0.5, sonst: 1 };

function dateValue(ms) {
  const d = new Date(ms || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function openGradeDialog(ctx, grade = {}) {
  const isEdit = Boolean(grade.id);
  const subjects = [...new Set((ctx.state.manualGrades || []).map((g) => g.subject).filter(Boolean))].sort();
  const weightSelect = h(
    'select',
    { name: 'weight', class: 'select' },
    [
      [0.5, '½ – zählt halb'],
      [1, '1 – normal'],
      [2, '2 – doppelt (z. B. Schularbeit)'],
      [3, '3 – dreifach']
    ].map(([v, label]) => h('option', { value: v, selected: Number(grade.weight ?? DEFAULT_WEIGHT[grade.kind || 'test']) === v }, label))
  );
  const form = h(
    'form',
    {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const [y, m, d] = (f.date.value || dateValue()).split('-').map(Number);
        const res = await ctx.api.saveGrade({
          id: grade.id,
          subject: f.subject.value,
          title: f.title.value,
          kind: f.kind.value,
          grade: f.grade.value,
          weight: f.weight.value,
          date: new Date(y, m - 1, d, 12).getTime()
        });
        if (res && res.ok) {
          closeModal();
          ctx.toast(isEdit ? 'Note gespeichert.' : 'Note eingetragen.', 'ok');
        } else ctx.toast((res && res.error) || 'Konnte nicht speichern.', 'error');
      }
    },
    h('h2', {}, isEdit ? 'Note bearbeiten' : 'Note eintragen'),
    h(
      'div',
      { class: 'form-row' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Fach'),
        h('input', { name: 'subject', value: grade.subject || '', required: true, maxlength: 60, list: 'grade-subjects', placeholder: 'z. B. AM', autofocus: !grade.subject }),
        h('datalist', { id: 'grade-subjects' }, subjects.map((s) => h('option', { value: s })))
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Art'),
        h(
          'select',
          {
            name: 'kind',
            class: 'select',
            onchange: (e) => {
              weightSelect.value = String(DEFAULT_WEIGHT[e.target.value] ?? 1);
            }
          },
          Object.entries(L.GRADE_KINDS).map(([v, label]) => h('option', { value: v, selected: (grade.kind || 'test') === v }, label))
        )
      )
    ),
    h(
      'div',
      { class: 'form-row' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Note (1–5)'),
        h('input', { name: 'grade', value: grade.grade ? String(grade.grade).replace('.', ',') : '', required: true, inputmode: 'decimal', placeholder: 'z. B. 2 oder 2,5', autofocus: Boolean(grade.subject) })
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Gewichtung'), weightSelect)
    ),
    h(
      'div',
      { class: 'form-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Bezeichnung (optional)'), h('input', { name: 'title', value: grade.title || '', maxlength: 120, placeholder: 'z. B. 1. Schularbeit' })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Datum'), h('input', { type: 'date', name: 'date', value: dateValue(grade.date) }))
    ),
    h(
      'div',
      { class: 'form-actions end' },
      isEdit
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost btn-danger',
              onclick: async () => {
                if (await confirmDialog('Note löschen?', 'Die Note wird endgültig gelöscht.', 'Löschen', true)) {
                  await ctx.api.deleteGrade(grade.id);
                  ctx.toast('Note gelöscht.');
                }
              }
            },
            icon('trash'),
            'Löschen'
          )
        : null,
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => closeModal() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Speichern')
    )
  );
  openModal(form);
}

function gradeBadge(grade) {
  return h('span', { class: `grade-badge grade-${grade || 0}` }, grade ? String(grade) : '–');
}

function neededLine(ctx, s) {
  const targets = ctx.state.settings.grades.targets || {};
  const target = Number(targets[s.subject]) || Math.max(1, (s.grade || 3) - 1);
  const res = L.neededGrade(s.entries, target, 2);
  const text =
    res.status === 'safe'
      ? `„${L.GRADE_NAMES[target]}“ ist sicher – auch mit einer 5 bei der nächsten Schularbeit.`
      : res.status === 'impossible'
        ? `„${L.GRADE_NAMES[target]}“ ist mit einer einzigen Schularbeit nicht mehr erreichbar.`
        : `Für „${L.GRADE_NAMES[target]}“ brauchst du bei der nächsten Schularbeit (doppelt gewichtet) mindestens eine ${L.fmtGrade(Math.floor(res.needed * 2) / 2, 1).replace(',0', '')}.`;
  return h(
    'div',
    { class: `grade-needed is-${res.status}` },
    h(
      'label',
      { class: 'grade-target' },
      'Ziel: ',
      h(
        'select',
        {
          class: 'select select-small',
          onchange: (e) => ctx.actions.updateSettings({ grades: { targets: { ...targets, [s.subject]: Number(e.target.value) } } })
        },
        [1, 2, 3, 4].map((n) => h('option', { value: n, selected: n === target }, `${n} – ${L.GRADE_NAMES[n]}`))
      )
    ),
    h('span', {}, text)
  );
}

function subjectCard(ctx, s) {
  return h(
    'section',
    { class: 'card grade-card' },
    h(
      'header',
      { class: 'grade-head' },
      gradeBadge(s.grade),
      h('div', { class: 'grade-title' }, h('h3', {}, s.subject), h('span', { class: 'muted' }, `Schnitt ${L.fmtGrade(s.average)} · ${s.entries.length} ${s.entries.length === 1 ? 'Note' : 'Noten'}`)),
      h('button', { class: 'icon-btn', title: 'Note in diesem Fach eintragen', onclick: () => openGradeDialog(ctx, { subject: s.subject }) }, icon('plus'))
    ),
    h(
      'ul',
      { class: 'grade-list' },
      s.entries.map((g) =>
        h(
          'li',
          { tabindex: '0', role: 'button', onclick: () => openGradeDialog(ctx, g), onkeydown: (e) => e.key === 'Enter' && openGradeDialog(ctx, g) },
          h('strong', { class: 'grade-value' }, L.fmtGrade(g.grade, Number.isInteger(g.grade) ? 0 : 1)),
          h('span', { class: 'grade-name' }, g.title || L.GRADE_KINDS[g.kind] || 'Note'),
          h('span', { class: 'muted' }, `${L.fmtDateShort(g.date)}${Number(g.weight) !== 1 ? ` · ×${String(g.weight).replace('.', ',')}` : ''}`)
        )
      )
    ),
    neededLine(ctx, s)
  );
}

function moodleCourse(ctx, c) {
  const open = ctx.ui.gradeOpen === c.courseId;
  return h(
    'section',
    { class: `card grade-card moodle ${open ? 'is-open' : ''}` },
    h(
      'header',
      { class: 'grade-head', role: 'button', tabindex: '0', onclick: () => ctx.actions.setUi({ gradeOpen: open ? null : c.courseId }) },
      h('span', { class: 'grade-badge grade-moodle' }, c.percent !== null && c.percent !== undefined ? `${Math.round(c.percent)}%` : c.total || '–'),
      h('div', { class: 'grade-title' }, h('h3', {}, c.course), h('span', { class: 'muted' }, `${c.total ? `Gesamt ${c.total} · ` : ''}${c.items.length} Bewertungen`)),
      icon(open ? 'chevronDown' : 'chevronRight')
    ),
    open
      ? h(
          'ul',
          { class: 'grade-list' },
          c.items.map((it) =>
            h(
              'li',
              {},
              h('strong', { class: 'grade-value' }, it.grade),
              h('span', { class: 'grade-name' }, it.name, it.feedback ? h('small', { class: 'muted grade-feedback' }, it.feedback) : null),
              h('span', { class: 'muted' }, [it.percent !== null && it.percent !== undefined ? `${Math.round(it.percent)} %` : '', it.graded ? L.fmtDateShort(it.graded) : ''].filter(Boolean).join(' · '))
            )
          )
        )
      : null
  );
}

export function renderGrades(root, ctx) {
  const query = String(ctx.ui.search || '').trim().toLowerCase();
  const match = (text) => !query || String(text).toLowerCase().includes(query);
  const summary = L.gradeSummary(ctx.state.manualGrades || []).filter((s) => match(s.subject));
  const moodle = ((ctx.state.grades || {}).eduvidual || []).filter((c) => match(c.course));
  const all = L.gradeSummary(ctx.state.manualGrades || []);
  const overall = L.weightedAverage(all.filter((s) => s.grade).map((s) => ({ grade: s.grade, weight: 1 })));

  root.append(
    h(
      'div',
      { class: 'notes-toolbar' },
      h(
        'div',
        { class: 'grade-overall' },
        all.length ? [h('strong', {}, `Gesamtschnitt ${L.fmtGrade(overall)}`), h('span', { class: 'muted' }, ` aus ${all.length} ${all.length === 1 ? 'Fach' : 'Fächern'}`)] : h('span', { class: 'muted' }, 'Trag deine Noten ein – Schulradar rechnet den Schnitt und sagt dir, was du noch brauchst.')
      ),
      h('button', { class: 'btn btn-primary', onclick: () => openGradeDialog(ctx) }, icon('plus'), 'Note eintragen')
    ),
    h('h2', { class: 'section-title' }, 'Eigene Noten'),
    summary.length
      ? h('div', { class: 'grade-grid' }, summary.map((s) => subjectCard(ctx, s)))
      : h('div', { class: 'empty small' }, h('p', {}, query ? 'Kein Fach passt zur Suche.' : 'Noch keine eigenen Noten eingetragen.')),
    h('h2', { class: 'section-title' }, 'Eduvidual'),
    moodle.length
      ? h('div', { class: 'grade-grid' }, moodle.map((c) => moodleCourse(ctx, c)))
      : h(
          'div',
          { class: 'empty small' },
          h('p', {}, (ctx.state.sourceState.eduvidual || {}).lastSync ? 'In Eduvidual sind noch keine Bewertungen sichtbar.' : 'Sobald Eduvidual verbunden ist, erscheinen hier die Bewertungen aus deinen Kursen.')
        )
  );
}
