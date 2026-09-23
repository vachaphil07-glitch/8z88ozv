// Dialoge (eigene Aufgabe, Details, Einführung) und Hinweise
import { h, clear, icon } from '../dom.js';
import * as L from '../logic.js';
import { details, statusPill, sourceBadge } from './item.js';
import { closeCalendarMenuIfDetached } from './calendar-menu.js';

const modalRoot = () => document.getElementById('modal-root');

export function closeModal() {
  clear(modalRoot());
  document.body.classList.remove('has-modal');
  closeCalendarMenuIfDetached();
}

export function openModal(content, { wide = false, onClose } = {}) {
  closeModal();
  const box = h('div', { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const overlay = h(
    'div',
    {
      class: 'overlay',
      onmousedown: (e) => {
        if (e.target === overlay) {
          closeModal();
          onClose && onClose();
        }
      }
    },
    box
  );
  modalRoot().append(overlay);
  document.body.classList.add('has-modal');
  const first = box.querySelector('[autofocus], input, textarea, select, button');
  if (first) setTimeout(() => first.focus(), 30);
  return box;
}

export function toast(message, kind = 'info') {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' || kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info'), h('span', {}, message));
  root.append(el);
  setTimeout(() => el.classList.add('is-leaving'), 4200);
  setTimeout(() => el.remove(), 4600);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function openTaskDialog(ctx, task = {}) {
  const isEdit = Boolean(task.id);
  const hasDate = Boolean(task.due);
  const hasTime = hasDate && !task.allDay;
  const form = h(
    'form',
    {
      class: 'form',
      onsubmit: (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const title = f.title.value.trim();
        if (!title) {
          f.title.focus();
          return;
        }
        let due = null;
        let allDay = true;
        if (f.date.value) {
          const [y, m, d] = f.date.value.split('-').map(Number);
          const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
          if (f.time.value) {
            const [hh, mm] = f.time.value.split(':').map(Number);
            dt.setHours(hh, mm);
            allDay = false;
          }
          due = dt.getTime();
        }
        ctx.api
          .saveOwnTask({ id: task.id, title, subject: f.subject.value.trim(), kind: f.kind.value, due, allDay, description: f.description.value.trim() })
          .then(() => {
            closeModal();
            ctx.toast(isEdit ? 'Gespeichert.' : 'Eigene Aufgabe angelegt.', 'ok');
          });
      }
    },
    h('h2', {}, isEdit ? 'Eigene Aufgabe bearbeiten' : 'Eigene Aufgabe'),
    h('p', { class: 'muted' }, 'Für alles, was auf keiner Plattform steht – z. B. mündlich angesagte Hausübungen oder Tests.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Was ist zu tun?'), h('input', { name: 'title', value: task.title || '', autofocus: true, required: true, maxlength: 300, placeholder: 'z. B. Referat vorbereiten' })),
    h(
      'div',
      { class: 'form-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fach'), h('input', { name: 'subject', value: task.subject || '', maxlength: 60, placeholder: 'z. B. AM' })),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Art'),
        h(
          'select',
          { name: 'kind', class: 'select' },
          [['task', 'Aufgabe'], ['test', 'Test / Schularbeit'], ['termin', 'Termin']].map(([v, label]) => h('option', { value: v, selected: (task.kind || 'task') === v }, label))
        )
      )
    ),
    h(
      'div',
      { class: 'form-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Datum'), h('input', { type: 'date', name: 'date', value: hasDate ? dateValue(task.due) : '' })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Uhrzeit (optional)'), h('input', { type: 'time', name: 'time', value: hasTime ? L.fmtTime(task.due) : '' }))
    ),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notiz'), h('textarea', { name: 'description', rows: 3, maxlength: 5000 }, task.description || '')),
    h(
      'div',
      { class: 'form-actions end' },
      isEdit
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost btn-danger',
              onclick: () => {
                closeModal();
                ctx.actions.deleteTask(task);
              }
            },
            icon('trash'),
            'Löschen'
          )
        : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Speichern' : 'Anlegen')
    )
  );
  openModal(form);
}

export function openItemDialog(ctx, item) {
  const status = L.effectiveStatus(item, ctx.state.local, ctx.now());
  const canCheck = !L.isAppointment(item) && !['submitted', 'graded'].includes(item.status);
  const locallyDone = Boolean(ctx.state.local.done[item.id]);
  openModal(
    h(
      'div',
      { class: 'item-dialog', style: { '--c': (L.SOURCE_META[item.source] || L.SOURCE_META.own).color } },
      h('div', { class: 'dialog-head' }, sourceBadge(item.source), statusPill(item, status), h('button', { class: 'icon-btn close-btn', 'aria-label': 'Schließen', onclick: closeModal }, icon('close'))),
      h('h2', {}, L.displayTitle(item)),
      details(item, ctx),
      canCheck
        ? h(
            'div',
            { class: 'form-actions end' },
            h(
              'button',
              {
                class: `btn ${locallyDone ? '' : 'btn-primary'}`,
                onclick: () => {
                  ctx.actions.toggleDone(item, !locallyDone);
                  closeModal();
                }
              },
              icon('check'),
              locallyDone ? 'Wieder offen' : 'Als erledigt abhaken'
            )
          )
        : null
    ),
    { wide: true }
  );
}

export function confirmDialog(title, text, confirmLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const done = (v) => {
      closeModal();
      resolve(v);
    };
    openModal(
      h(
        'div',
        { class: 'form' },
        h('h2', {}, title),
        h('p', {}, text),
        h(
          'div',
          { class: 'form-actions end' },
          h('button', { class: 'btn', onclick: () => done(false) }, 'Abbrechen'),
          h('button', { class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, onclick: () => done(true) }, confirmLabel)
        )
      ),
      { onClose: () => resolve(false) }
    );
  });
}

export function openOnboarding(ctx) {
  const finish = (go) => {
    ctx.actions.updateSettings({ onboarded: true });
    closeModal();
    if (go === 'platforms') ctx.actions.go('platforms');
    if (go === 'demo') ctx.actions.setDemo(true);
  };
  const step = (n, title, text) => h('li', {}, h('span', { class: 'step-num' }, String(n)), h('div', {}, h('strong', {}, title), h('p', {}, text)));
  openModal(
    h(
      'div',
      { class: 'onboarding' },
      h('div', { class: 'onb-logo' }, icon('radar')),
      h('h2', {}, 'Willkommen bei Schulradar'),
      h('p', { class: 'lead' }, 'Alle Aufgaben, Abgaben und Tests aus WebUntis, MS Teams, Letto, Eduvidual und LMS.at – in einer Liste. Nie wieder alle Plattformen einzeln durchklicken.'),
      h(
        'ol',
        { class: 'onb-steps' },
        step(1, 'Plattformen verbinden', 'Einmal bei jeder Plattform anmelden – so wie im Browser, auch mit „Mit Microsoft anmelden“.'),
        ctx.state.platform === 'android'
          ? step(2, 'Zurücklehnen', 'Beim Öffnen holt Schulradar neue Aufgaben und erkennt, was schon abgegeben ist.')
          : step(2, 'Zurücklehnen', 'Schulradar holt alle 30 Minuten neue Aufgaben und erkennt, was schon abgegeben ist.'),
        step(3, 'Erinnert werden', `Am Vorabend von Tests und vor Abgaben kommt eine ${ctx.state.platform === 'android' ? 'Benachrichtigung aufs Handy' : 'Windows-Benachrichtigung'}.`)
      ),
      h(
        'div',
        { class: 'form-actions end' },
        h('button', { class: 'btn', onclick: () => finish('demo') }, 'Erst mal Demo ansehen'),
        h('button', { class: 'btn btn-primary', onclick: () => finish('platforms') }, 'Plattformen verbinden')
      )
    ),
    { onClose: () => ctx.actions.updateSettings({ onboarded: true }) }
  );
}
