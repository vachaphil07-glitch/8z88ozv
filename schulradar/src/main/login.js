'use strict';
// Anmeldefenster: zeigt die echte Login-Seite der Plattform (auch "Mit Microsoft anmelden").
// Die Anmeldung landet in der gemeinsamen Browser-Sitzung der App.
const { BrowserWindow, shell } = require('electron');
const { webSession, wrap } = require('./web');
const { startLoginFlow } = require('./login-flow');

const open = new Map();

function openLoginWindow({ connector, ctx, icon, onMessage, onClosed }) {
  const existing = open.get(connector.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  const title = `${connector.name} – Anmelden (Fenster schließen, wenn du fertig bist)`;
  const win = new BrowserWindow({
    width: 1040,
    height: 800,
    title,
    icon,
    autoHideMenuBar: true,
    webPreferences: { session: webSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  open.set(connector.id, win);

  // Popups (z. B. Microsoft-Anmeldung) im selben Sitzungskontext erlauben
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 620, height: 720, parent: win } };
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  // Links, die Programme starten wollen (msteams:, moodlemobile: …), nicht ausführen
  win.webContents.on('will-navigate', (e, url) => {
    if (!/^(https?|about|data):/i.test(url)) e.preventDefault();
  });

  const flow = startLoginFlow({ connector, ctx, win: wrap(win), onMessage, close: () => win.close() });
  win.webContents.on('did-navigate', flow.check);
  win.webContents.on('did-navigate-in-page', flow.check);
  win.webContents.on('did-finish-load', flow.check);

  win.on('closed', () => {
    flow.stop();
    open.delete(connector.id);
    onClosed();
  });
  win.loadURL(connector.loginUrl(ctx.settings)).catch(() => {});
  return win;
}

/** Link in einem App-Fenster öffnen (mit bestehender Anmeldung) */
function openViewer(url, icon) {
  if (!/^https?:\/\//i.test(url)) return;
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    icon,
    autoHideMenuBar: true,
    webPreferences: { session: webSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/i.test(u)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => {
    if (!/^(https?|about|data):/i.test(u)) {
      e.preventDefault();
      if (/^msteams:/i.test(u)) shell.openExternal(u);
    }
  });
  win.loadURL(url).catch(() => {});
  return win;
}

function closeAll() {
  for (const win of open.values()) if (!win.isDestroyed()) win.close();
}

module.exports = { openLoginWindow, openViewer, closeAll };
