'use strict';
// Neutrale Schnittstelle zwischen den Plattform-Anbindungen (connectors/) und dem Gerät.
// Auf dem PC liefert web.js (Electron) die Umsetzung, in der Android-App mobile/core/android-web.js.
//
// Ein "Fenster" (win) ist ein Adapter mit:
//   getURL(): Promise<string>, isDestroyed(): boolean, exec(code): Promise<any>
let impl = null;

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} bei ${safeHost(url)}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return String(url);
  }
}

function use(implementation) {
  impl = implementation;
}

function need() {
  if (!impl) throw new Error('Keine Plattform-Umsetzung gesetzt (platform.use fehlt).');
  return impl;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Führt eine Funktion (als Quelltext) in der Seite aus und liefert das Ergebnis (oder null). */
async function evalIn(win, fn, arg) {
  if (!win || win.isDestroyed()) return null;
  const code = `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`;
  try {
    return await win.exec(code);
  } catch (_) {
    return null;
  }
}

/** Wartet, bis check(win) etwas Wahres liefert. */
async function waitFor(win, check, { timeout = 30000, interval = 700 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (win.isDestroyed()) return null;
    const res = await check(win);
    if (res) return res;
    await sleep(interval);
  }
  return null;
}

module.exports = {
  use,
  HttpError,
  sleep,
  evalIn,
  waitFor,
  httpFetch: (...a) => need().httpFetch(...a),
  fetchJson: (...a) => need().fetchJson(...a),
  requestManual: (...a) => need().requestManual(...a),
  withHiddenWindow: (...a) => need().withHiddenWindow(...a),
  loadUrl: (...a) => need().loadUrl(...a),
  captureJson: (...a) => need().captureJson(...a),
  clearOrigins: (...a) => need().clearOrigins(...a),
  setCookie: (...a) => need().setCookie(...a)
};
