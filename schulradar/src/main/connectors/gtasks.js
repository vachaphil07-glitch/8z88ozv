'use strict';
// Google Tasks: Aufgaben aus allen (oder ausgewählten) Google-Tasks-Listen – in beide Richtungen.
//  - Abruf: offene und kürzlich erledigte Aufgaben mit Fälligkeitsdatum und Notizen.
//  - Abhaken in Schulradar hakt die Aufgabe auch in Google Tasks ab (und umgekehrt).
//  - Eigene Aufgaben können direkt in Google Tasks angelegt werden.
//
// Die Anmeldung (eigene OAuth-Client-ID) teilt sich Google Tasks mit dem Drive-Abgleich: ../google.js
const { ConfigError } = require('./base');

const API = 'https://tasks.googleapis.com/tasks/v1';

// ---------------------------------------------------------------- Parser (testbar)

/** Google speichert das Fälligkeitsdatum als "2026-10-20T00:00:00.000Z" – gemeint ist nur der Tag. */
function dueToLocal(due) {
  const m = String(due || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** lokaler Tag (ms) -> RFC 3339 wie Google es erwartet */
function localToDue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00.000Z`;
}

function itemId(listId, taskId) {
  return `gtasks:${listId}:${taskId}`;
}

function parseItemId(id) {
  const m = String(id || '').match(/^gtasks:([^:]+):(.+)$/);
  return m ? { list: m[1], task: m[2] } : null;
}

function toItems(list, tasks) {
  const out = [];
  for (const t of tasks || []) {
    if (!t || t.deleted || !String(t.title || '').trim()) continue;
    const link = (t.links || []).find((l) => /^https:\/\//.test(l.link || ''));
    out.push({
      id: itemId(list.id, t.id),
      type: 'task',
      title: String(t.title).trim(),
      course: list.title,
      description: String(t.notes || '').trim(),
      due: dueToLocal(t.due),
      allDay: true,
      status: t.status === 'completed' ? 'done' : 'open',
      completedAt: t.completed ? Date.parse(t.completed) || null : null,
      url: t.webViewLink || (link ? link.link : '')
    });
  }
  return out;
}

// ---------------------------------------------------------------- Zugriff (Anmeldung: ../google.js)

async function api(ctx, path, opts = {}) {
  if (!ctx.google) throw new ConfigError('Google-Anmeldung nicht verfügbar.');
  return ctx.google.request(`${API}${path}`, opts);
}

async function taskLists(ctx) {
  const res = await api(ctx, '/users/@me/lists?maxResults=100');
  return (res.items || []).map((l) => ({ id: l.id, title: l.title }));
}

// ---------------------------------------------------------------- Plattform

const connector = {
  id: 'gtasks',
  name: 'Google Tasks',
  color: '#2684FC',
  description: 'Aufgaben aus Google Tasks – Abhaken wirkt in beide Richtungen',

  origins() {
    return [];
  },

  isConfigured(_s, _secrets, google) {
    return Boolean(google && google.connected && google.scopes.tasks);
  },

  async sync(ctx) {
    const lists = await taskLists(ctx);
    // Listen für die Auswahl in den Einstellungen merken
    const known = JSON.stringify(ctx.settings.knownLists || []);
    if (known !== JSON.stringify(lists)) ctx.saveSettings({ knownLists: lists });
    const hidden = new Set(ctx.settings.hiddenLists || []);
    const completedMin = new Date(ctx.range.from).toISOString();
    const items = [];
    for (const list of lists) {
      if (hidden.has(list.id)) continue;
      let pageToken = '';
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true', completedMin });
        if (pageToken) q.set('pageToken', pageToken);
        const res = await api(ctx, `/lists/${encodeURIComponent(list.id)}/tasks?${q}`);
        if (page === 0) ctx.sample(`liste_${list.title}`, res);
        items.push(...toItems(list, res.items));
        pageToken = res.nextPageToken;
        if (!pageToken) break;
      }
    }
    ctx.log(`${lists.length} Listen, ${items.length} Aufgaben`);
    return { items };
  },

  /** In Google Tasks abhaken bzw. wieder öffnen */
  async setCompleted(ctx, id, done) {
    const ref = parseItemId(id);
    if (!ref) return;
    await api(ctx, `/lists/${encodeURIComponent(ref.list)}/tasks/${encodeURIComponent(ref.task)}`, {
      method: 'PATCH',
      body: done ? { status: 'completed' } : { status: 'needsAction', completed: null }
    });
  },

  /** Neue Aufgabe in Google Tasks anlegen (Standardliste oder gewählte Liste) */
  async createTask(ctx, { title, notes, due, list }) {
    const target = list || ctx.settings.defaultList || '@default';
    const body = { title, notes: notes || undefined };
    if (due) body.due = localToDue(due);
    return api(ctx, `/lists/${encodeURIComponent(target)}/tasks`, { method: 'POST', body });
  },

  async deleteTask(ctx, id) {
    const ref = parseItemId(id);
    if (ref) await api(ctx, `/lists/${encodeURIComponent(ref.list)}/tasks/${encodeURIComponent(ref.task)}`, { method: 'DELETE' });
  },

  // Abmelden trennt nur die Anzeige; die Google-Anmeldung selbst gilt auch für den Abgleich
  async logout(ctx) {
    ctx.saveSettings({ knownLists: [], hiddenLists: [] });
  }
};

module.exports = connector;
module.exports.toItems = toItems;
module.exports.dueToLocal = dueToLocal;
module.exports.localToDue = localToDue;
module.exports.parseItemId = parseItemId;
