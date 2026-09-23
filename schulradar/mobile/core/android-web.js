'use strict';
// Android-Umsetzung der Plattform-Schnittstelle (siehe src/main/platform.js).
// Anfragen laufen nativ über den gemeinsamen Android-Cookie-Speicher, Webseiten in eigenen
// WebViews – so teilen sich alle Plattformen eine Anmeldung, wie am PC.
const { HttpError, sleep } = require('../../src/main/platform');
const { Native } = require('./native');

function host(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return String(url);
  }
}

function plainHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    const out = {};
    headers.forEach((v, k) => (out[k] = v));
    return out;
  }
  return { ...headers };
}

function bodyText(body) {
  if (body === undefined || body === null) return null;
  return typeof body === 'string' ? body : String(body);
}

/** Antwort-Objekt mit den Teilen von fetch(), die die Anbindungen nutzen. */
function response(res) {
  const headers = res.headers || {};
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    url: res.url,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => res.body || '',
    json: async () => JSON.parse(res.body || 'null')
  };
}

async function rawRequest(url, opts = {}, followRedirects = true) {
  try {
    return await Native.http({
      url,
      method: opts.method || 'GET',
      headers: plainHeaders(opts.headers),
      body: bodyText(opts.body),
      cookies: opts.credentials !== 'omit',
      followRedirects,
      timeout: opts.timeout || 30000
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/Timeout/i.test(msg)) throw new Error(`Zeitüberschreitung bei ${host(url)}`);
    throw new Error(`Keine Verbindung zu ${host(url)} (${msg})`);
  }
}

async function httpFetch(url, opts = {}) {
  return response(await rawRequest(url, opts, true));
}

async function fetchJson(url, opts = {}) {
  const res = await rawRequest(url, opts, true);
  const text = res.body || '';
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url, text.slice(0, 2000));
  try {
    return JSON.parse(text);
  } catch (_) {
    const err = new HttpError(res.status, url, text.slice(0, 2000));
    err.message = `Unerwartete Antwort (kein JSON) von ${host(url)}`;
    err.notJson = true;
    throw err;
  }
}

/** Wie am PC: Weiterleitungen einzeln verfolgen, bei stopAt(url) abbrechen (z. B. moodlemobile://…). */
async function requestManual(url, { stopAt = () => false, maxRedirects = 8, timeout = 30000 } = {}) {
  const redirects = [];
  let current = url;
  for (;;) {
    const res = await rawRequest(current, { timeout }, false);
    const location = res.status >= 300 && res.status < 400 ? res.location : null;
    if (!location) return { redirects, status: res.status, body: res.body || '' };
    redirects.push(location);
    if (stopAt(location) || redirects.length > maxRedirects || !/^https?:\/\//i.test(location)) {
      return { redirects, status: res.status, stopped: location, body: '' };
    }
    current = location;
  }
}

// ---------------------------------------------------------------- Webansichten

const listeners = { navigate: new Map(), closed: new Map() };
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  Native.addListener('webNavigate', (ev) => {
    const cb = listeners.navigate.get(ev.id);
    if (cb) cb(ev.url);
  });
  Native.addListener('webClosed', (ev) => {
    const cb = listeners.closed.get(ev.id);
    listeners.navigate.delete(ev.id);
    listeners.closed.delete(ev.id);
    const w = open.get(ev.id);
    if (w) w.destroyed = true;
    open.delete(ev.id);
    if (cb) cb();
  });
}

const open = new Map();

/**
 * Öffnet eine Webansicht. hidden: unsichtbar im Hintergrund (Abruf), sonst als Vollbild
 * über der App mit „Fertig“-Knopf (Anmeldung, Links öffnen).
 * Liefert den Fenster-Adapter aus platform.js plus onNavigate/onClosed/close.
 */
async function openWindow({ hidden = true, url = null, title = 'Schulradar' } = {}) {
  listen();
  const { id } = await Native.webOpen({ hidden, url, title });
  const win = {
    id,
    destroyed: false,
    getURL: async () => {
      if (win.destroyed) return '';
      try {
        return (await Native.webUrl({ id })).url || '';
      } catch (_) {
        return '';
      }
    },
    isDestroyed: () => win.destroyed,
    exec: async (code) => {
      if (win.destroyed) return null;
      const { result } = await Native.webEval({ id, code });
      if (result === undefined || result === null || result === 'null' || result === '') return null;
      return JSON.parse(result);
    },
    onNavigate: (cb) => listeners.navigate.set(id, cb),
    onClosed: (cb) => listeners.closed.set(id, cb),
    close: async () => {
      if (win.destroyed) return;
      win.destroyed = true;
      await Native.webClose({ id }).catch(() => {});
    }
  };
  open.set(id, win);
  return win;
}

async function closeAll() {
  for (const w of [...open.values()]) await w.close();
}

async function withHiddenWindow(fn) {
  const win = await openWindow({ hidden: true });
  try {
    return await fn(win);
  } finally {
    await win.close();
  }
}

async function loadUrl(win, url, timeout = 45000) {
  if (win.isDestroyed()) return;
  await Native.webLoad({ id: win.id, url, timeout }).catch(() => {});
}

/**
 * Liest JSON-Antworten mit, die die Seite (inkl. iframes) per fetch/XHR lädt.
 * Das Skript dafür steckt im Plugin (CAPTURE_JS) und läuft in jedem Frame ab Dokumentbeginn.
 */
async function captureJson(win, { match, onJson, onSeen = () => {} }) {
  await Native.webCapture({ id: win.id, enable: true }).catch(() => {});
  let stopped = false;
  let busy = false;
  const drain = async () => {
    if (busy || win.isDestroyed()) return;
    busy = true;
    try {
      const { items } = await Native.webCaptured({ id: win.id });
      for (const raw of items || []) {
        let entry;
        try {
          entry = JSON.parse(raw);
        } catch (_) {
          continue;
        }
        onSeen(entry.url || '', entry.mime || '');
        if (!match(entry.url || '', entry.mime || '')) continue;
        let json;
        try {
          json = JSON.parse(entry.body);
        } catch (_) {
          continue; // kein JSON
        }
        onJson(entry.url, json, entry.status);
      }
    } catch (_) {
      /* Webansicht geschlossen */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => !stopped && drain(), 600);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function setCookie({ url, name, value, path = '/', secure = true }) {
  await Native.setCookie({ url, cookie: `${name}=${value}; Path=${path}${secure ? '; Secure' : ''}` });
}

async function clearOrigins(origins) {
  await Native.clearOrigins({ origins }).catch(() => {});
}

module.exports = {
  httpFetch,
  fetchJson,
  requestManual,
  withHiddenWindow,
  loadUrl,
  captureJson,
  clearOrigins,
  setCookie,
  openWindow,
  closeAll,
  sleep
};
