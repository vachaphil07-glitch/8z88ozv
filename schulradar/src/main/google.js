'use strict';
// Gemeinsame Google-Anmeldung für Google Tasks und den Abgleich über Google Drive.
//
// Google erlaubt den Zugriff nur über eine eigene OAuth-Client-ID (Typ „Desktop-App“). Die Anmeldung
// läuft im normalen Browser (PC und Handy) mit Rückleitung auf 127.0.0.1 und PKCE. Zurück kommt ein
// Schlüssel, der verschlüsselt bei den Zugangsdaten liegt (google.oauth).
const crypto = require('crypto');
const { fetchJson, httpFetch, oauthLoopback } = require('./platform');
const { LoginRequiredError, ConfigError } = require('./connectors/base');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = {
  tasks: 'https://www.googleapis.com/auth/tasks',
  drive: 'https://www.googleapis.com/auth/drive.appdata'
};
const ALL_SCOPES = Object.values(SCOPES).join(' ');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

/**
 * store: Store, secrets: Secrets (ungescoped). Die Einstellungen liegen in settings.google.
 * Ältere Versionen (1.3.0) hatten Client-ID und Token bei Google Tasks – die werden übernommen.
 */
function createGoogleAuth({ store, secrets, log = () => {} }) {
  const settings = () => store.settings.google;

  function migrate() {
    const g = settings();
    const old = store.settings.platforms.gtasks || {};
    if (!g.clientId && old.clientId) store.updateSettings({ google: { clientId: old.clientId } });
    for (const k of ['oauth', 'clientSecret']) {
      if (!secrets.has(`google.${k}`) && secrets.has(`gtasks.${k}`)) {
        secrets.set(`google.${k}`, secrets.get(`gtasks.${k}`));
        secrets.set(`gtasks.${k}`, null);
      }
    }
  }

  function clientId() {
    const id = String(settings().clientId || '').trim();
    if (!id) throw new ConfigError('Google: Client-ID fehlt – siehe Anleitung bei Google Tasks.');
    return id;
  }

  function info() {
    const tok = secrets.get('google.oauth') || {};
    const scopes = String(tok.scope || '');
    return {
      clientId: settings().clientId || '',
      hasClientSecret: secrets.has('google.clientSecret'),
      connected: Boolean(tok.refresh),
      // vor 1.4 wurde nur Google Tasks angefragt
      scopes: { tasks: Boolean(tok.refresh) && (!scopes || scopes.includes(SCOPES.tasks)), drive: scopes.includes(SCOPES.drive) },
      email: settings().email || ''
    };
  }

  function setClient({ clientId: id, clientSecret } = {}) {
    if (id !== undefined) store.updateSettings({ google: { clientId: String(id).trim() } });
    if (clientSecret) secrets.set('google.clientSecret', String(clientSecret).trim());
  }

  async function connect() {
    const id = clientId();
    // PKCE-Werte erst in buildUrl erzeugen: läuft nur, wenn die Browser-Anmeldung möglich ist
    let verifier = '';
    const { code, redirectUri } = await oauthLoopback({
      buildUrl: (redirect) => {
        verifier = base64url(crypto.randomBytes(48));
        const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
        return `${AUTH_URL}?${new URLSearchParams({
          client_id: id,
          redirect_uri: redirect,
          response_type: 'code',
          scope: ALL_SCOPES,
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
          code_challenge: challenge,
          code_challenge_method: 'S256'
        })}`;
      },
      doneText: 'Google ist mit Schulradar verbunden. Du kannst dieses Fenster schließen.'
    });
    const params = { client_id: id, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' };
    const secret = secrets.get('google.clientSecret');
    if (secret) params.client_secret = secret;
    const tok = await postForm(params);
    if (!tok.access_token) throw new Error(`Google lehnt ab: ${tok.error_description || tok.error || 'unbekannter Fehler'}`);
    secrets.set('google.oauth', {
      access: tok.access_token,
      refresh: tok.refresh_token,
      scope: tok.scope || ALL_SCOPES,
      expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60000
    });
    log('Mit Google verbunden.');
  }

  async function accessToken() {
    const saved = secrets.get('google.oauth');
    if (!saved || !saved.refresh) throw new LoginRequiredError('Bitte mit Google verbinden.');
    if (saved.access && saved.expires > Date.now()) return saved.access;
    const params = { client_id: clientId(), refresh_token: saved.refresh, grant_type: 'refresh_token' };
    const secret = secrets.get('google.clientSecret');
    if (secret) params.client_secret = secret;
    const tok = await postForm(params);
    if (!tok.access_token) {
      if (tok.error === 'invalid_grant') {
        secrets.set('google.oauth', null);
        throw new LoginRequiredError('Google-Anmeldung abgelaufen – bitte neu verbinden.');
      }
      throw new Error(`Google: ${tok.error_description || tok.error || 'Token konnte nicht erneuert werden'}`);
    }
    secrets.set('google.oauth', { ...saved, access: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 - 60000 });
    return tok.access_token;
  }

  /** Anfrage an eine Google-Schnittstelle mit Anmeldung. raw: Antwort ohne JSON-Auswertung */
  async function request(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const token = await accessToken();
    const opts = { method, credentials: 'omit', headers: { Authorization: `Bearer ${token}`, ...headers } };
    if (body !== undefined) {
      if (typeof body === 'string') opts.body = body;
      else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await httpFetch(url, opts);
    const text = await res.text();
    if (res.status === 401) {
      secrets.set('google.oauth', { ...(secrets.get('google.oauth') || {}), access: null, expires: 0 });
      throw new LoginRequiredError('Google-Anmeldung abgelaufen – bitte neu verbinden.');
    }
    if (!res.ok) {
      const err = new Error(`Google: HTTP ${res.status}`);
      err.status = res.status;
      err.body = text.slice(0, 2000);
      if (res.status === 403) {
        err.message = /insufficient|scope/i.test(text)
          ? 'Google: Berechtigung fehlt – bitte „Neu verbinden“.'
          : /has not been used|disabled/i.test(text)
            ? 'Google: Die Schnittstelle ist im Cloud-Projekt nicht aktiviert (Google Tasks API bzw. Google Drive API).'
            : 'Google verweigert den Zugriff.';
      }
      throw err;
    }
    if (raw) return text;
    return text ? JSON.parse(text) : null;
  }

  async function disconnect() {
    const saved = secrets.get('google.oauth');
    secrets.set('google.oauth', null);
    if (saved && saved.refresh) {
      await httpFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(saved.refresh)}`, { method: 'POST', credentials: 'omit' }).catch(() => {});
    }
  }

  return { migrate, info, setClient, connect, accessToken, request, disconnect, SCOPES };
}

module.exports = { createGoogleAuth, SCOPES };
