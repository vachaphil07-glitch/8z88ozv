'use strict';
// Google Tasks: Aufgaben aus allen (oder ausgewählten) Google-Tasks-Listen – in beide Richtungen.
//  - Abruf: offene und kürzlich erledigte Aufgaben mit Fälligkeitsdatum und Notizen.
//  - Abhaken in Schulradar hakt die Aufgabe auch in Google Tasks ab (und umgekehrt).
//  - Eigene Aufgaben können direkt in Google Tasks angelegt werden.
//
// Google erlaubt den Zugriff nur über eine eigene OAuth-Client-ID (Typ „Desktop-App“) aus der
// Google Cloud Console. Die Anmeldung läuft im normalen Browser; zurück kommt nur ein Schlüssel,
// der verschlüsselt bei den Zugangsdaten liegt. Derzeit nur in der PC-Version.
const { fetchJson, httpFetch, oauthLoopback, HttpError } = require('../platform');
const { LoginRequiredError, ConfigError } = require('./base');
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://tasks.googleapis.com/tasks/v1';
const SCOPE = 'https://www.googleapis.com/auth/tasks';

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

// ---------------------------------------------------------------- Anmeldung

function clientId(ctx) {
  const id = String(ctx.settings.clientId || '').trim();
  if (!id) throw new ConfigError('Client-ID fehlt – siehe Anleitung bei Google Tasks.');
  return id;
}

async function postForm(params) {
  try {
    return await fetchJson(TOKEN_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    });
  } catch (err) {
    if (err.body) {
      try {
        return JSON.parse(err.body);
      } catch (_) {
        /* weiter werfen */
      }
    }
    throw err;
  }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function connect(ctx) {
  const id = clientId(ctx);
  // PKCE-Werte erst hier erzeugen: buildUrl läuft nur dort, wo die Browser-Anmeldung möglich ist (PC)
  let verifier = '';
  const { code, redirectUri } = await oauthLoopback({
    buildUrl: (redirect) => {
      verifier = base64url(crypto.randomBytes(48));
      const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
      const state = base64url(crypto.randomBytes(12));
      return `${AUTH_URL}?${new URLSearchParams({
        client_id: id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state
      })}`;
    },
    doneText: 'Google Tasks ist mit Schulradar verbunden. Du kannst dieses Fenster schließen.'
  });
  const params = { client_id: id, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' };
  const secret = ctx.secrets.get('clientSecret');
  if (secret) params.client_secret = secret;
  const tok = await postForm(params);
  if (!tok.access_token) throw new Error(`Google lehnt ab: ${tok.error_description || tok.error || 'unbekannter Fehler'}`);
  ctx.secrets.set('oauth', {
    access: tok.access_token,
    refresh: tok.refresh_token,
    expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60000
  });
  ctx.log('Mit Google verbunden.');
}

async function accessToken(ctx) {
  const saved = ctx.secrets.get('oauth');
  if (!saved || !saved.refresh) throw new LoginRequiredError('Bitte mit Google verbinden.');
  if (saved.access && saved.expires > Date.now()) return saved.access;
  const params = { client_id: clientId(ctx), refresh_token: saved.refresh, grant_type: 'refresh_token' };
  const secret = ctx.secrets.get('clientSecret');
  if (secret) params.client_secret = secret;
  const tok = await postForm(params);
  if (!tok.access_token) {
    if (tok.error === 'invalid_grant') {
      ctx.secrets.set('oauth', null);
      throw new LoginRequiredError('Google-Anmeldung abgelaufen – bitte neu verbinden.');
    }
    throw new Error(`Google: ${tok.error_description || tok.error || 'Token konnte nicht erneuert werden'}`);
  }
  ctx.secrets.set('oauth', { ...saved, access: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60000 });
  return tok.access_token;
}

async function api(ctx, path, { method = 'GET', body } = {}) {
  const token = await accessToken(ctx);
  const opts = { method, credentials: 'omit', headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    if (method === 'DELETE') {
      const res = await httpFetch(`${API}${path}`, opts);
      if (!res.ok && res.status !== 404) throw new HttpError(res.status, API, await res.text());
      return null;
    }
    return await fetchJson(`${API}${path}`, opts);
  } catch (err) {
    if (err.status === 401) {
      ctx.secrets.set('oauth', { ...(ctx.secrets.get('oauth') || {}), access: null, expires: 0 });
      throw new LoginRequiredError('Google-Anmeldung abgelaufen – bitte neu verbinden.');
    }
    if (err.status === 403) throw new Error('Google verweigert den Zugriff. Ist die „Google Tasks API“ im Cloud-Projekt aktiviert?');
    throw err;
  }
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

  isConfigured(s, secrets) {
    return Boolean(String(s.clientId || '').trim()) && secrets.has('oauth');
  },

  connect,

  async sync(ctx) {
    clientId(ctx);
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

  async logout(ctx) {
    const saved = ctx.secrets.get('oauth');
    ctx.secrets.set('oauth', null);
    if (saved && saved.refresh) {
      await httpFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(saved.refresh)}`, { method: 'POST', credentials: 'omit' }).catch(() => {});
    }
  }
};

module.exports = connector;
module.exports.toItems = toItems;
module.exports.dueToLocal = dueToLocal;
module.exports.localToDue = localToDue;
module.exports.parseItemId = parseItemId;
