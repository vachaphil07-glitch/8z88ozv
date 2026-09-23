'use strict';
// Schulradar – Hauptprozess
const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
  dialog,
  powerMonitor,
  nativeTheme
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { Store } = require('./store');
const { Secrets } = require('./secrets');
const { SyncManager } = require('./sync');
const { ReminderService } = require('./reminders');
const { connectors } = require('./connectors');
const { openLoginWindow, openViewer, closeAll: closeLoginWindows } = require('./login');
const web = require('./web');
const { webSession } = web;
// Die Plattform-Anbindungen arbeiten auf dem PC mit Electron-Fenstern und -Netzwerk
require('./platform').use(web);
const { toIsoDate } = require('./util/dates');
const { isActive, effectiveStatus } = require('./status');
const { createController } = require('./controller');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const ASSETS = path.join(ROOT, 'assets');
const ICON = path.join(ASSETS, 'icon.png');

const START_HIDDEN = process.argv.includes('--hidden');
const FORCE_DEMO = process.argv.includes('--demo');
// Nur für Entwickler: Screenshots aller Ansichten speichern und beenden
const SCREENSHOT = process.env.SCHULRADAR_SCREENSHOT || '';
// Nur für Entwickler: alle Plattformen abrufen, Ergebnis als JSON speichern und beenden (Ende-zu-Ende-Test)
const E2E = process.env.SCHULRADAR_E2E || '';

if (process.env.SCHULRADAR_USERDATA) app.setPath('userData', process.env.SCHULRADAR_USERDATA);
app.setAppUserModelId('at.schulradar.app');
app.commandLine.appendSwitch('lang', 'de-AT');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let store;
let secrets;
let sync;
let reminders;
let mainWindow = null;
let tray = null;
let quitting = false;
let pushTimer = null;
const liveNotifications = new Set();

const isDemo = () => FORCE_DEMO || Boolean(store && store.settings.demo);

// ---------------------------------------------------------------- Zustand für die Oberfläche

let ctrl = null;
const currentItems = () => ctrl.currentItems();
const buildState = () => ctrl.buildState();

function pushState() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state', buildState());
    updateTrayTooltip();
  }, 120);
}

function toast(message, kind = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', { message, kind });
}

// ---------------------------------------------------------------- Fenster, Tray, Benachrichtigungen

function overlayFor(dark) {
  return dark ? { color: '#16181d', symbolColor: '#e6e8eb', height: 46 } : { color: '#f6f7f9', symbolColor: '#1f2328', height: 46 };
}

function prefersDark() {
  const t = store.settings.theme;
  return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors);
}

function createWindow() {
  const dark = prefersDark();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Schulradar',
    icon: ICON,
    backgroundColor: dark ? '#16181d' : '#f6f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayFor(dark),
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  mainWindow.loadURL('app://schulradar/index.html');
  mainWindow.once('ready-to-show', () => {
    if (SCREENSHOT) return runScreenshots();
    if (!(START_HIDDEN && store.settings.startHidden)) mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    if (quitting || !store.settings.closeToTray || !tray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!store.data.trayHintShown) {
      store.data.trayHintShown = true;
      store.save();
      notify({ title: 'Schulradar läuft im Hintergrund weiter', body: 'Du findest es im Infobereich der Taskleiste. Rechtsklick auf das Symbol → Beenden.' });
    }
  });
  mainWindow.on('show', () => {
    if (!isDemo() && sync.lastSyncAge() > 10 * 60 * 1000) sync.syncAll();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
    tray = new Tray(img);
    tray.setToolTip('Schulradar');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Schulradar öffnen', click: showWindow },
        { label: 'Jetzt aktualisieren', click: () => sync.syncAll({ manual: true }) },
        { type: 'separator' },
        {
          label: 'Beenden',
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('click', showWindow);
  } catch (_) {
    tray = null;
  }
}

function updateTrayTooltip() {
  if (!tray) return;
  const now = Date.now();
  const items = currentItems();
  const local = store.data.local;
  const active = items.filter((i) => isActive(i, local, now));
  const overdue = active.filter((i) => effectiveStatus(i, local, now) === 'overdue').length;
  const open = active.filter((i) => effectiveStatus(i, local, now) !== 'upcoming').length;
  tray.setToolTip(`Schulradar – ${open} offen${overdue ? `, ${overdue} überfällig` : ''}`);
}

function notify({ title, body, itemId }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  liveNotifications.add(n);
  const forget = () => liveNotifications.delete(n);
  n.on('click', () => {
    forget();
    showWindow();
    if (itemId && mainWindow) mainWindow.webContents.send('focus-item', itemId);
  });
  n.on('close', forget);
  setTimeout(forget, 10 * 60 * 1000);
  n.show();
}

function applyAutostart() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  // Die portable Version entpackt sich in einen Temp-Ordner – Autostart muss auf die .exe selbst zeigen
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: Boolean(store.settings.autostart), path: exe, args: ['--hidden'] });
}

async function runE2E() {
  try {
    for (const cookie of JSON.parse(process.env.SCHULRADAR_E2E_COOKIES || '[]')) await webSession().cookies.set(cookie);
    await sync.syncAll({ manual: true });
    const week = await sync.timetable(require('./util/dates').startOfWeek(Date.now()));
    fs.writeFileSync(E2E, JSON.stringify({ state: buildState(), timetable: week, logs: sync.logs }, null, 1));
  } catch (err) {
    fs.writeFileSync(E2E, JSON.stringify({ error: err.stack || String(err) }));
  }
  quitting = true;
  store.saveNow();
  app.exit(0);
}

async function runScreenshots() {
  const views = (process.env.SCHULRADAR_VIEWS || 'list').split(',');
  mainWindow.show();
  await new Promise((r) => setTimeout(r, 2500));
  for (const view of views) {
    mainWindow.webContents.send('navigate', view);
    await new Promise((r) => setTimeout(r, 1500));
    const img = await mainWindow.webContents.capturePage();
    fs.writeFileSync(`${SCREENSHOT}-${view.replace(/[^a-z0-9-]/gi, '_')}.png`, img.toPNG());
  }
  quitting = true;
  app.exit(0);
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('state:get', () => buildState());
  ipcMain.handle('sync', (_e, source) => ctrl.sync(source));
  ipcMain.handle('item:done', (_e, id, done) => ctrl.setDone(id, done));
  ipcMain.handle('item:dismiss', (_e, id, dismissed) => ctrl.setDismissed(id, dismissed));
  ipcMain.handle('items:restore-dismissed', () => ctrl.restoreDismissed());
  ipcMain.handle('own:save', (_e, task) => ctrl.saveOwnTask(task));
  ipcMain.handle('own:delete', (_e, id) => ctrl.deleteOwnTask(id));
  ipcMain.handle('settings:update', (_e, patch) => ctrl.updateSettings(patch || {}));
  ipcMain.handle('creds:set', (_e, source, creds) => ctrl.setCredentials(source, creds || {}));
  ipcMain.handle('platform:logout', (_e, source) => ctrl.logout(source));
  ipcMain.handle('timetable:get', (_e, weekStart) => ctrl.timetable(weekStart));
  ipcMain.handle('teams:graph-connect', () => ctrl.graphConnect((payload) => mainWindow && mainWindow.webContents.send('graph-code', payload)));

  ipcMain.handle('platform:login', (_e, source) => {
    const connector = connectors[source];
    if (!connector) return;
    try {
      openLoginWindow({
        connector,
        ctx: sync.context(source),
        icon: ICON,
        onMessage: (msg) => {
          toast(msg, 'ok');
          pushState();
        },
        onClosed: () => ctrl.afterLogin(source)
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  ipcMain.handle('open:url', (_e, url, external) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return;
    if (external) shell.openExternal(url);
    else openViewer(url, ICON);
  });

  ipcMain.handle('diag:export', async (_e, source) => {
    const data = ctrl.diagnostics(source, { betriebssystem: process.platform, electron: process.versions.electron });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Diagnose speichern',
      defaultPath: path.join(app.getPath('desktop'), `schulradar-diagnose-${source || 'alle'}-${toIsoDate(Date.now())}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  });

  ipcMain.handle('calendar:save', async (_e, name, text, open) => {
    const safe = String(name || 'schulradar.ics').replace(/[\\/:*?"<>|]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Kalenderdatei speichern',
      defaultPath: path.join(app.getPath('downloads'), safe.endsWith('.ics') ? safe : `${safe}.ics`),
      filters: [{ name: 'Kalender (iCalendar)', extensions: ['ics'] }]
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, String(text || ''), 'utf8');
    // einzelner Termin: gleich im Standard-Kalender (z. B. Outlook) öffnen
    if (open) shell.openPath(filePath);
    else shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  });

  ipcMain.handle('data:open-folder', () => shell.openPath(app.getPath('userData')));

  ipcMain.handle('data:reset', async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Abbrechen', 'Alles löschen'],
      defaultId: 0,
      cancelId: 0,
      title: 'Alle Daten löschen',
      message: 'Wirklich alle Daten löschen?',
      detail: 'Gelöscht werden: abgerufene Aufgaben, eigene Aufgaben, Häkchen, Einstellungen, gespeicherte Zugangsdaten und alle Anmeldungen. Die App startet danach neu.'
    });
    if (response !== 1) return false;
    quitting = true;
    closeLoginWindows();
    await webSession().clearStorageData();
    const dir = app.getPath('userData');
    for (const f of ['schulradar-daten.json', 'schulradar-daten.json.bak', 'zugangsdaten.bin']) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch (_) {
        /* existiert nicht */
      }
    }
    store.timer && clearTimeout(store.timer);
    store.saveNow = () => {};
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('theme:set', (_e, effective) => {
    if (mainWindow && process.platform !== 'darwin') {
      try {
        mainWindow.setTitleBarOverlay(overlayFor(effective === 'dark'));
      } catch (_) {
        /* nicht unterstützt */
      }
    }
  });
}

// ---------------------------------------------------------------- Start

async function init() {
  // Oberfläche über app:// ausliefern. Der MIME-Typ wird fest gesetzt, weil die Windows-Registry
  // auf manchen PCs für .js falsche Typen meldet – dann würden die Module nicht laden.
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
  };
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('Nicht gefunden', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const type = MIME[path.extname(file).toLowerCase()] || res.headers.get('content-type') || 'application/octet-stream';
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': type } });
  });

  store = new Store(app.getPath('userData'));
  secrets = new Secrets(app.getPath('userData'));
  nativeTheme.themeSource = store.settings.theme;
  sync = new SyncManager({
    store,
    secrets,
    isDemo,
    onChange: pushState,
    onLoginNeeded: (id, message) => toast(message || `${connectors[id].name}: Bitte neu anmelden.`, 'warn')
  });
  // Im Demo-Modus nur an eigene Aufgaben erinnern, nicht an Beispieldaten
  ctrl = createController({
    store,
    secrets,
    sync,
    isDemo,
    host: {
      version: app.getVersion(),
      platform: 'windows',
      forcedDemo: FORCE_DEMO,
      pushState,
      toast,
      openExternal: (url) => shell.openExternal(url),
      onSettingsChanged: (patch, _before, after) => {
        if ('autostart' in patch) applyAutostart();
        if ('theme' in patch) nativeTheme.themeSource = after.theme;
      }
    }
  });
  reminders = new ReminderService({
    store,
    getItems: () => (isDemo() ? store.snapshot().items.filter((i) => i.source === 'own') : currentItems()),
    notify
  });

  registerIpc();
  if (E2E) return runE2E();
  createWindow();
  if (!SCREENSHOT) createTray();
  applyAutostart();
  sync.schedule();
  reminders.start();
  nativeTheme.on('updated', pushState);
  powerMonitor.on('resume', () => setTimeout(() => sync.syncAll(), 20000));
  if (!isDemo() && !SCREENSHOT) setTimeout(() => sync.syncAll(), 4000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(init);
  app.on('before-quit', () => {
    quitting = true;
    if (store) store.saveNow();
  });
  app.on('window-all-closed', () => {
    // Unsichtbare Abruf-Fenster sollen die App im Test-Modus nicht beenden
    if (E2E) return;
    if (quitting || !tray) app.quit();
  });
}
