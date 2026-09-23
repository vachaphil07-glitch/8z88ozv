'use strict';
// Schulradar auf dem Handy.
// Stellt window.schulradar bereit (am PC macht das preload.js) und verbindet die gemeinsamen
// Teile aus src/main (Anbindungen, Speicher, Abruf, Erinnerungen) mit Android.
const { App } = require('@capacitor/app');
const { LocalNotifications } = require('@capacitor/local-notifications');
const { Share } = require('@capacitor/share');
const { Filesystem, Directory, Encoding } = require('@capacitor/filesystem');

const platform = require('../../src/main/platform');
const web = require('./android-web');
platform.use(web);

const { Store } = require('../../src/main/store');
const { SyncManager } = require('../../src/main/sync');
const { createController } = require('../../src/main/controller');
const { connectors } = require('../../src/main/connectors');
const { startLoginFlow } = require('../../src/main/login-flow');
const { plannedReminders, dailySummary } = require('../../src/main/reminders');
const { startOfDay, toIsoDate, DAY } = require('../../src/main/util/dates');
const { Native, SystemBars } = require('./native');
const { MobileSecrets } = require('./secrets');

const DATA_FILE = 'schulradar-daten.json';
const CHANNEL = 'erinnerungen';

// ---------------------------------------------------------------- Ereignisse an die Oberfläche

const handlers = {};
const pending = {};

function emit(channel, payload) {
  const list = handlers[channel];
  if (list && list.size) {
    for (const cb of list) {
      try {
        cb(payload);
      } catch (err) {
        console.error(err);
      }
    }
  } else if (channel === 'focus-item') {
    pending[channel] = payload; // z. B. App wurde über eine Benachrichtigung gestartet
  }
}

function on(channel) {
  return (cb) => {
    const list = handlers[channel] || (handlers[channel] = new Set());
    list.add(cb);
    if (pending[channel] !== undefined) {
      const payload = pending[channel];
      delete pending[channel];
      setTimeout(() => cb(payload), 1200);
    }
    return () => list.delete(cb);
  };
}

let backHandler = null;

// ---------------------------------------------------------------- Start

let store;
let secrets;
let sync;
let ctrl;
let pushTimer = null;
let planTimer = null;
let resetting = false;

const isDemo = () => Boolean(store && store.settings.demo);

function toast(message, kind = 'info') {
  emit('toast', { message, kind });
}

function pushState() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (resetting) return;
    emit('state', ctrl.buildState());
    planReminders();
  }, 120);
}

async function loadStore() {
  const texts = [];
  for (const name of [DATA_FILE, `${DATA_FILE}.bak`]) {
    try {
      const { text } = await Native.fileRead({ name });
      if (text) texts.push(text);
    } catch (_) {
      /* noch nicht vorhanden */
    }
  }
  let queue = Promise.resolve();
  const io = {
    readAll: () => texts,
    write: (json) => {
      if (resetting) return;
      queue = queue.then(() => Native.fileWrite({ name: DATA_FILE, text: json })).catch((err) => console.warn('Daten nicht gespeichert:', err));
    }
  };
  return new Store(null, io);
}

async function appVersion() {
  try {
    return (await App.getInfo()).version;
  } catch (_) {
    return '1.0.0';
  }
}

const ready = (async () => {
  const [loadedStore, loadedSecrets, version] = await Promise.all([loadStore(), new MobileSecrets().load(), appVersion()]);
  store = loadedStore;
  secrets = loadedSecrets;
  sync = new SyncManager({
    store,
    secrets,
    isDemo,
    onChange: pushState,
    onLoginNeeded: (id, message) => toast(message || `${connectors[id].name}: Bitte neu anmelden.`, 'warn')
  });
  ctrl = createController({
    store,
    secrets,
    sync,
    isDemo,
    host: {
      version,
      platform: 'android',
      forcedDemo: false,
      pushState,
      toast,
      openExternal: (url) => Native.openExternal({ url }).catch(() => {}),
      onSettingsChanged: (patch) => {
        if (patch.reminders) planReminders(true);
      }
    }
  });
  setupAppEvents();
  setupNotifications();
  sync.schedule();
  if (!isDemo()) setTimeout(() => sync.syncAll(), 2500);
  return ctrl;
})();

ready.catch((err) => {
  console.error('Schulradar konnte nicht starten', err);
  setTimeout(() => toast(`Start fehlgeschlagen: ${err.message}`, 'error'), 1500);
});

function setupAppEvents() {
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      pushState();
      if (!isDemo() && sync.lastSyncAge() > 10 * 60 * 1000) sync.syncAll();
    } else {
      store.saveNow();
    }
  });
  App.addListener('pause', () => store.saveNow());
  App.addListener('backButton', () => {
    let handled = false;
    try {
      handled = Boolean(backHandler && backHandler());
    } catch (_) {
      handled = false;
    }
    if (!handled) App.minimizeApp().catch(() => App.exitApp());
  });
}

// ---------------------------------------------------------------- Erinnerungen
// Android stellt vorgeplante Benachrichtigungen auch bei geschlossener App zu. Geplant wird neu,
// sobald sich etwas ändert (Abruf, Häkchen, Einstellungen).

function notificationId(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

function parseTime(hhmm, fallback) {
  const m = String(hhmm || fallback).match(/^(\d{1,2}):(\d{2})$/);
  return m ? [Number(m[1]), Number(m[2])] : parseTime(fallback, '07:00');
}

async function setupNotifications() {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL,
      name: 'Erinnerungen',
      description: 'Abgaben, Tests und die morgendliche Übersicht',
      importance: 4,
      visibility: 1,
      vibration: true
    });
  } catch (_) {
    /* ältere Android-Versionen */
  }
  LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const itemId = notification && notification.extra && notification.extra.itemId;
    if (itemId) emit('focus-item', itemId);
  });
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted' && store.settings.reminders.enabled) await LocalNotifications.requestPermissions();
  } catch (_) {
    /* ignorieren */
  }
  planReminders(true);
}

function planReminders(now = false) {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => doPlanReminders().catch((err) => console.warn('Erinnerungen:', err)), now ? 50 : 3000);
}

function reminderItems() {
  // Im Demo-Modus nur an eigene Aufgaben erinnern, nicht an Beispieldaten (wie am PC)
  return isDemo() ? store.snapshot().items.filter((i) => i.source === 'own') : ctrl.currentItems();
}

async function doPlanReminders() {
  if (!store || resetting) return;
  const perm = await LocalNotifications.checkPermissions();
  const settings = store.settings;
  const items = reminderItems();
  const local = store.data.local;
  const now = Date.now();
  const notes = [];

  if (perm.display === 'granted') {
    for (const r of plannedReminders({ items, local, settings, now, horizonDays: 21 }).slice(0, 60)) {
      notes.push({ id: notificationId(r.key), title: r.title, body: r.body, largeBody: r.body, at: r.at, extra: { itemId: r.itemId } });
    }
    const rs = settings.reminders || {};
    if (rs.enabled && rs.dailySummary) {
      const [hh, mm] = parseTime(rs.summaryTime, '07:00');
      for (let d = 0; d < 7; d++) {
        const at = new Date(startOfDay(now) + d * DAY);
        at.setHours(hh, mm, 0, 0);
        if (at.getTime() <= now) continue;
        const s = dailySummary({ items, local, settings, lastSummary: '', now: at.getTime() + 1000 });
        if (s && !s.silent) notes.push({ id: notificationId(`summary|${toIsoDate(at.getTime())}`), title: s.title, body: s.body, at: at.getTime() });
      }
    }
  }

  const planned = await LocalNotifications.getPending();
  if (planned.notifications && planned.notifications.length) {
    await LocalNotifications.cancel({ notifications: planned.notifications.map((n) => ({ id: n.id })) });
  }
  if (!notes.length) return;
  await LocalNotifications.schedule({
    notifications: notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      largeBody: n.largeBody,
      channelId: CHANNEL,
      smallIcon: 'ic_stat_schulradar',
      iconColor: '#3B5BDB',
      extra: n.extra || null,
      // ungefähr genügt: sonst verlangt Android die Sonderberechtigung „Wecker & Erinnerungen“
      isExactNotification: false,
      schedule: { at: new Date(n.at), allowWhileIdle: true }
    }))
  });
}

// ---------------------------------------------------------------- Anmelden & Links

const loginWindows = new Map();

async function login(source) {
  await ready;
  const connector = connectors[source];
  if (!connector || loginWindows.has(source)) return;
  loginWindows.set(source, true);
  try {
    const ctx = sync.context(source);
    const win = await web.openWindow({ hidden: false, url: connector.loginUrl(ctx.settings), title: `${connector.name} – anmelden, dann „Fertig“` });
    const flow = startLoginFlow({
      connector,
      ctx,
      win,
      onMessage: (msg) => {
        toast(msg, 'ok');
        pushState();
      },
      close: () => win.close()
    });
    win.onNavigate(() => flow.check());
    win.onClosed(() => {
      flow.stop();
      loginWindows.delete(source);
      ctrl.afterLogin(source);
    });
  } catch (err) {
    loginWindows.delete(source);
    toast(err.message, 'error');
  }
}

async function openUrl(url, external) {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  if (external) return Native.openExternal({ url }).catch(() => {});
  let title = 'Schulradar';
  try {
    title = new URL(url).host;
  } catch (_) {
    /* egal */
  }
  await web.openWindow({ hidden: false, url, title });
}

// ---------------------------------------------------------------- Diagnose & Zurücksetzen

async function exportDiagnostics(source) {
  await ready;
  const data = ctrl.diagnostics(source, { geraet: navigator.userAgent });
  const name = `schulradar-diagnose-${source || 'alle'}-${toIsoDate(Date.now())}.json`;
  try {
    const { uri } = await Filesystem.writeFile({ path: name, data: JSON.stringify(data, null, 2), directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Schulradar-Diagnose', dialogTitle: 'Diagnose teilen', files: [uri] });
    return { ok: true, path: name };
  } catch (err) {
    if (/cancel/i.test(String(err && err.message))) return { ok: false };
    toast(`Diagnose: ${err.message}`, 'error');
    return { ok: false };
  }
}

// ---------------------------------------------------------------- Kalender

/** .ics-Datei im Cache ablegen und über das Teilen-Menü anbieten (Kalender-App, Mail, Drive …) */
async function saveCalendarFile(name, text) {
  const file = String(name || 'schulradar.ics').replace(/[^A-Za-z0-9._-]/g, '_');
  try {
    const { uri } = await Filesystem.writeFile({ path: file, data: String(text || ''), directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Termine für den Kalender', dialogTitle: 'In Kalender übernehmen', files: [uri] });
    return { ok: true, path: file };
  } catch (err) {
    if (/cancel/i.test(String(err && err.message))) return { ok: false };
    toast(`Kalender: ${err.message}`, 'error');
    return { ok: false };
  }
}

/** Termin in der Kalender-App des Handys anlegen (öffnet die App mit ausgefüllten Feldern) */
async function addToDeviceCalendar(ev) {
  try {
    await Native.calendarInsert({
      title: ev.title,
      description: ev.description || '',
      location: ev.location || '',
      start: ev.start,
      end: ev.end,
      allDay: Boolean(ev.allDay)
    });
    return { ok: true };
  } catch (err) {
    toast(String((err && err.message) || err) || 'Keine Kalender-App gefunden.', 'error');
    return { ok: false };
  }
}

async function resetData() {
  await ready;
  const ok = window.confirm(
    'Wirklich alle Daten löschen?\n\nGelöscht werden: abgerufene Aufgaben, eigene Aufgaben, Häkchen, Einstellungen, gespeicherte Zugangsdaten und alle Anmeldungen.'
  );
  if (!ok) return false;
  resetting = true;
  clearTimeout(store.timer);
  store.save = () => {};
  store.saveNow = () => {};
  await web.closeAll();
  try {
    const planned = await LocalNotifications.getPending();
    if (planned.notifications.length) await LocalNotifications.cancel({ notifications: planned.notifications.map((n) => ({ id: n.id })) });
  } catch (_) {
    /* egal */
  }
  await Native.fileDelete({ name: DATA_FILE }).catch(() => {});
  await Native.clearAllData().catch(() => {});
  try {
    localStorage.clear();
  } catch (_) {
    /* egal */
  }
  location.reload();
  return true;
}

// ---------------------------------------------------------------- Schnittstelle für die Oberfläche

const call =
  (fn) =>
  async (...args) => {
    await ready;
    return fn(...args);
  };

window.schulradar = {
  getState: call(() => ctrl.buildState()),
  sync: call((source) => ctrl.sync(source || null)),
  setDone: call((id, done) => ctrl.setDone(id, done)),
  setDismissed: call((id, dismissed) => ctrl.setDismissed(id, dismissed)),
  restoreDismissed: call(() => ctrl.restoreDismissed()),
  saveOwnTask: call((task) => ctrl.saveOwnTask(task)),
  deleteOwnTask: call((id) => ctrl.deleteOwnTask(id)),
  updateSettings: call((patch) => ctrl.updateSettings(patch || {})),
  setCredentials: call((source, creds) => ctrl.setCredentials(source, creds || {})),
  login,
  logout: call((source) => ctrl.logout(source)),
  openUrl,
  getTimetable: call((weekStart) => ctrl.timetable(weekStart)),
  teamsGraphConnect: call(() => ctrl.graphConnect((payload) => emit('graph-code', payload))),
  exportDiagnostics,
  saveCalendarFile,
  addToDeviceCalendar,
  openDataFolder: async () => toast('Auf dem Handy liegen die Daten im geschützten App-Speicher.'),
  resetData,
  setTheme: async (effective) => {
    try {
      await SystemBars.setStyle({ style: effective === 'dark' ? 'DARK' : 'LIGHT' });
    } catch (_) {
      /* ältere Version */
    }
  },
  onState: on('state'),
  onToast: on('toast'),
  onFocusItem: on('focus-item'),
  onGraphCode: on('graph-code'),
  onNavigate: on('navigate'),
  /** Zurück-Taste: cb() liefert true, wenn die Oberfläche selbst etwas geschlossen hat. */
  onBack: (cb) => {
    backHandler = cb;
    return () => {
      if (backHandler === cb) backHandler = null;
    };
  }
};
