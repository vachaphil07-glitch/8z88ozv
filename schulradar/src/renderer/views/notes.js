// Notizen: Mitschriften, Stoff für Tests, Ideen – optional mit Fach und mit einem Eintrag verknüpft
import { h, icon } from '../dom.js';
import * as L from '../logic.js';
import { openModal, closeModal, confirmDialog } from './dialogs.js';

export const NOTE_COLORS = ['', 'yellow', 'green', 'blue', 'pink', 'violet'];

function linkedItem(ctx, note) {
  return note.itemId ? ctx.state.items.find((i) => i.id === note.itemId) : null;
}

function noteCard(ctx, note) {
  const item = linkedItem(ctx, note);
  // ohne Titel ist die erste Zeile der Titel – dann nicht doppelt anzeigen
  const text = String(note.title || '').trim() ? String(note.text || '') : String(note.text || '').trim().split('\n').slice(1).join('\n').trim();
  return h(
    'article',
    {
      class: `note-card ${note.color ? `note-${note.color}` : ''} ${note.pinned ? 'is-pinned' : ''}`,
      tabindex: '0',
      role: 'button',
      onclick: () => openNoteDialog(ctx, note),
      onkeydown: (e) => {
        if (e.key === 'Enter') openNoteDialog(ctx, note);
      }
    },
    h(
      'header',
      { class: 'note-head' },
      h('h3', {}, L.noteTitle(note)),
      h(
        'button',
        {
          class: `icon-btn ${note.pinned ? 'is-active' : ''}`,
          title: note.pinned ? 'Nicht mehr anheften' : 'Oben anheften',
          onclick: (e) => {
            e.stopPropagation();
            ctx.api.saveNote({ ...note, pinned: !note.pinned });
          }
        },
        icon('pin')
      )
    ),
    text ? h('p', { class: 'note-text' }, text.length > 600 ? `${text.slice(0, 599)}…` : text) : null,
    h(
      'footer',
      { class: 'note-foot' },
      note.subject ? h('span', { class: 'chip' }, note.subject) : null,
      item
        ? h(
            'button',
            {
              class: 'chip chip-link',
              title: 'Zum Eintrag springen',
              onclick: (e) => {
                e.stopPropagation();
                ctx.actions.showItem(item);
              }
            },
            icon('list'),
            L.displayTitle(item).slice(0, 40)
          )
        : null,
      h('span', { class: 'muted note-date' }, L.timeAgo(note.updated || note.created, ctx.now()))
    )
  );
}

export function renderNotes(root, ctx) {
  const notes = ctx.state.notes || [];
  const subjects = L.noteSubjects(notes);
  const subject = subjects.includes(ctx.ui.noteSubject) ? ctx.ui.noteSubject : '';
  const list = L.filterNotes(notes, { query: ctx.ui.search, subject });

  root.append(
    h(
      'div',
      { class: 'notes-toolbar' },
      h(
        'div',
        { class: 'chips', style: { '--c': 'var(--accent)' } },
        h('button', { class: `chip ${!subject ? 'is-active' : ''}`, onclick: () => ctx.actions.setUi({ noteSubject: '' }) }, 'Alle'),
        subjects.map((s) => h('button', { class: `chip ${subject === s ? 'is-active' : ''}`, onclick: () => ctx.actions.setUi({ noteSubject: s }) }, s))
      ),
      h('button', { class: 'btn btn-primary', onclick: () => openNoteDialog(ctx, { subject }) }, icon('plus'), 'Neue Notiz')
    )
  );

  if (!notes.length) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-icon is-neutral' }, icon('note')),
        h('h2', {}, 'Noch keine Notizen'),
        h('p', {}, 'Halte hier Stoff für Tests, Mitschriften oder Ideen fest. Notizen lassen sich auch direkt an eine Aufgabe hängen – im Eintrag auf „Notiz“ klicken.')
      )
    );
    return;
  }
  if (!list.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-icon is-neutral' }, icon('search')), h('p', {}, 'Keine Notiz passt zur Suche.')));
    return;
  }
  root.append(h('div', { class: 'note-grid' }, list.map((n) => noteCard(ctx, n))));
}

/** Notiz anlegen/bearbeiten. preset.itemId verknüpft die Notiz mit einem Eintrag. */
export function openNoteDialog(ctx, note = {}) {
  const isEdit = Boolean(note.id);
  const item = linkedItem(ctx, note);
  let color = note.color || '';
  const swatches = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Farbe' },
    NOTE_COLORS.map((c) =>
      h('button', {
        type: 'button',
        class: `swatch note-${c || 'plain'} ${color === c ? 'is-active' : ''}`,
        title: c || 'keine Farbe',
        onclick: (e) => {
          color = c;
          for (const b of swatches.children) b.classList.toggle('is-active', b === e.currentTarget);
        }
      })
    )
  );
  const subjects = L.noteSubjects(ctx.state.notes);
  const form = h(
    'form',
    {
      class: 'form',
      onsubmit: (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const payload = {
          id: note.id,
          title: f.title.value.trim(),
          text: f.text.value,
          subject: f.subject.value.trim(),
          itemId: note.itemId || '',
          pinned: Boolean(note.pinned),
          color
        };
        if (!payload.title && !payload.text.trim()) {
          f.text.focus();
          return;
        }
        ctx.api.saveNote(payload).then(() => {
          closeModal();
          ctx.toast(isEdit ? 'Notiz gespeichert.' : 'Notiz angelegt.', 'ok');
        });
      }
    },
    h('h2', {}, isEdit ? 'Notiz bearbeiten' : 'Neue Notiz'),
    item ? h('p', { class: 'muted' }, icon('list'), ` Zu: ${L.displayTitle(item)}`) : null,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Titel (optional)'), h('input', { name: 'title', value: note.title || '', maxlength: 200 })),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Notiz'),
      h('textarea', { name: 'text', rows: 10, maxlength: 50000, autofocus: true, placeholder: 'z. B. Stoff: Kapitel 3, Formeln S. 42 …' }, note.text || '')
    ),
    h(
      'div',
      { class: 'form-row' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Fach'),
        h('input', { name: 'subject', value: note.subject || (item && (item.subject || item.course)) || '', maxlength: 60, list: 'note-subjects', placeholder: 'z. B. AM' }),
        h('datalist', { id: 'note-subjects' }, subjects.map((s) => h('option', { value: s })))
      ),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Farbe'), swatches)
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
                const ok = await confirmDialog('Notiz löschen?', `„${L.noteTitle(note)}“ wird endgültig gelöscht.`, 'Löschen', true);
                if (ok) {
                  await ctx.api.deleteNote(note.id);
                  ctx.toast('Notiz gelöscht.');
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
  openModal(form, { wide: true });
}
