'use strict';
// Gemeinsame Browser-Sitzung für alle Plattformen.
// Alle Plattformen teilen sich EINE Sitzung: Wer sich einmal mit dem Microsoft-Schulkonto anmeldet,
// ist dadurch meist auch bei den anderen Plattformen mit "Mit Microsoft anmelden" sofort drin.
const { session, net, BrowserWindow } = require('electron');
const { HttpError, evalIn, waitFor, sleep } = require('./platform');

const PARTITION = 'persist:schulradar-web';
let initialized = false;

function chromeUserAgent() {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function webSession() {
  const ses = session.fromPartition(PARTITION);
  if (!initialized) {
    initialized = true;
    ses.setUserAgent(chromeUserAgent());
    // Benachrichtigungen, Kamera usw. brauchen die Plattform-Seiten in der App nicht.
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  }
  return ses;
}

async function httpFetch(url, opts = {}) {
  const { timeout = 30000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await webSession().fetch(url, { credentials: 'include', ...rest, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Zeitüberschreitung bei ${new URL(url).host}`);
    throw new Error(`Keine Verbindung zu ${new URL(url).host} (${err.message})`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}) {
  const res = await httpFetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 2000));
  try {
    return JSON.parse(text);
  } catch (_) {
    const err = new HttpError(res.status, url, text.slice(0, 2000));
    err.message = `Unerwartete Antwort (kein JSON) von ${new URL(url).host}`;
    err.notJson = true;
    throw err;
  }
}

/**
 * Anfrage ohne automatisches Folgen von Weiterleitungen.
 * Liefert {redirects: [...], status, body}. Mit stopAt(url) kann bei einer Weiterleitung
 * (z. B. auf moodlemobile://…) abgebrochen werden.
 */
function requestManual(url, { stopAt = () => false, maxRedirects = 8, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const redirects = [];
    const req = net.request({ url, session: webSession(), credentials: 'include', redirect: 'manual' });
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error(`Zeitüberschreitung bei ${new URL(url).host}`));
    }, timeout);
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    req.on('redirect', (status, _method, redirectUrl) => {
      redirects.push(redirectUrl);
      if (stopAt(redirectUrl) || redirects.length > maxRedirects) {
        req.abort();
        finish({ redirects, status, stopped: redirectUrl, body: '' });
      } else {
        req.followRedirect();
      }
    });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish({ redirects, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      if (redirects.length && stopAt(redirects[redirects.length - 1])) return;
      reject(e);
    });
    req.end();
  });
}

/** Unsichtbares Browserfenster in der gemeinsamen Sitzung. */
async function withHiddenWindow(fn, { width = 1280, height = 900 } = {}) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      session: webSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    return await fn(wrap(win));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Macht aus einem BrowserWindow den Fenster-Adapter, den die Anbindungen erwarten (siehe platform.js). */
function wrap(bw) {
  return {
    bw,
    getURL: async () => (bw.isDestroyed() ? '' : bw.webContents.getURL()),
    isDestroyed: () => bw.isDestroyed(),
    exec: (code) => (bw.isDestroyed() ? Promise.resolve(null) : bw.webContents.executeJavaScript(code, true))
  };
}

async function loadUrl(win, url, timeout = 45000) {
  await Promise.race([
    win.bw.loadURL(url).catch((err) => {
      // ERR_ABORTED tritt bei Weiterleitungen auf und ist harmlos
      if (!/ERR_ABORTED|-3/.test(String(err && err.message))) throw err;
    }),
    sleep(timeout)
  ]);
}

/**
 * Schneidet JSON-Antworten mit, die eine Seite (inkl. eingebetteter iframes) lädt.
 * Nutzt das Chrome DevTools Protocol, damit auch Tokens mit Sonderschutz funktionieren.
 */
async function captureJson(win, { match, onJson, onSeen = () => {} }) {
  const dbg = win.bw.webContents.debugger;
  try {
    dbg.attach('1.3');
  } catch (_) {
    return () => {};
  }
  const pending = new Map();
  const withTimeout = (promise) => Promise.race([promise, sleep(3000)]);
  const enable = async (sessionId) => {
    try {
      await withTimeout(dbg.sendCommand('Network.enable', {}, sessionId));
    } catch (_) {
      /* Ziel unterstützt kein Network */
    }
    try {
      await withTimeout(dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId));
    } catch (_) {
      /* ignorieren */
    }
  };
  dbg.on('message', (_e, method, params, sessionId) => {
    if (method === 'Target.attachedToTarget') {
      enable(params.sessionId);
    } else if (method === 'Network.responseReceived') {
      const r = params.response || {};
      onSeen(r.url || '', r.mimeType || '');
      if (match(r.url || '', r.mimeType || '')) {
        pending.set(`${sessionId || ''}|${params.requestId}`, { url: r.url, sessionId, status: r.status });
      }
    } else if (method === 'Network.loadingFinished') {
      const key = `${sessionId || ''}|${params.requestId}`;
      const p = pending.get(key);
      if (!p) return;
      pending.delete(key);
      dbg
        .sendCommand('Network.getResponseBody', { requestId: params.requestId }, p.sessionId || undefined)
        .then((res) => {
          const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
          let json;
          try {
            json = JSON.parse(text);
          } catch (_) {
            return; // kein JSON
          }
          onJson(p.url, json, p.status);
        })
        .catch(() => {});
    }
  });
  await enable(undefined);
  return () => {
    try {
      dbg.detach();
    } catch (_) {
      /* schon getrennt */
    }
  };
}

async function setCookie({ url, name, value, path = '/', secure = true }) {
  await webSession().cookies.set({ url, name, value, path, secure });
}

/** Löscht Cookies & Speicher einer Plattform (nur deren Adressen). */
async function clearOrigins(origins) {
  const ses = webSession();
  for (const origin of origins) {
    try {
      await ses.clearStorageData({ origin });
    } catch (_) {
      /* ignorieren */
    }
    try {
      const host = new URL(origin).hostname;
      const cookies = await ses.cookies.get({});
      for (const c of cookies) {
        const domain = (c.domain || '').replace(/^\./, '');
        if (domain && (host === domain || host.endsWith('.' + domain) || domain.endsWith('.' + host))) {
          const url = `${c.secure ? 'https' : 'http'}://${domain}${c.path || '/'}`;
          await ses.cookies.remove(url, c.name);
        }
      }
    } catch (_) {
      /* ignorieren */
    }
  }
}

module.exports = {
  PARTITION,
  webSession,
  chromeUserAgent,
  wrap,
  HttpError,
  httpFetch,
  fetchJson,
  requestManual,
  withHiddenWindow,
  evalIn,
  loadUrl,
  waitFor,
  sleep,
  captureJson,
  setCookie,
  clearOrigins
};
