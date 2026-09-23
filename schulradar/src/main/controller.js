'use strict';
// Gemeinsame Aktionen der Oberfläche (PC und Handy).
// main.js (Electron) und mobile/core (Android) reichen die Aufrufe der Oberfläche hierher weiter
// und kümmern sich nur noch um das, was pro Gerät anders ist (Fenster, Dialoge, Teilen …).
const { connectors, list: connectorList } = require('./connectors');
const { demoItems, demoTimetable } = require('./connectors/demo');
const presets = require('./presets');

/**
 * host: {
 *   version, platform ('windows' | 'android'), forcedDemo,
 *   pushState(), toast(message, kind), openExternal(url),
 *   onSettingsChanged(patch, before, after)   // z. B. Autostart, Design
 * }
 */
function createController({ store, secrets, sync, host, isDemo }) {
  function currentItems() {
    const snap = store.snapshot();
    if (!isDemo()) return snap.items;
    return [...demoItems(), ...snap.items.filter((i) => i.source === 'own')];
  }

  function platformInfo(c) {
    const s = store.settings.platforms[c.id];
    const sec = sync.scopedSecrets(c.id);
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      description: c.description,
      configured: c.isConfigured(s, sec),
      hasKey: sec.has('key'),
      hasPassword: sec.has('password'),
      hasToken: sec.has('token'),
      hasGraph: sec.has('graph')
    };
  }

  function buildState() {
    const snap = store.snapshot();
    const demo = isDemo();
    const items = currentItems();
    const sourceState = demo
      ? Object.fromEntries(
          connectorList.map((c) => [c.id, { status: 'ok', lastSync: Date.now(), message: 'Demo-Daten', count: items.filter((i) => i.source === c.id).length }])
        )
      : snap.sourceState;
    return {
      version: host.version,
      platform: host.platform,
      demo,
      forcedDemo: Boolean(host.forcedDemo),
      items,
      local: snap.local,
      sourceState,
      settings: snap.settings,
      syncing: demo ? [] : [...sync.running.keys()],
      platforms: connectorList.map(platformInfo),
      secureStorage: secrets.available(),
      schoolName: presets.schoolName,
      now: Date.now()
    };
  }

  const push = () => host.pushState();

  return {
    currentItems,
    buildState,

    async sync(source) {
      if (isDemo()) {
        host.toast('Demo-Modus: Es werden keine echten Daten abgerufen.');
        return buildState();
      }
      if (source) await sync.syncOne(source);
      else await sync.syncAll({ manual: true });
      return buildState();
    },

    setDone(id, done) {
      store.setDone(id, done);
      push();
    },

    setDismissed(id, dismissed) {
      store.setDismissed(id, dismissed);
      push();
    },

    restoreDismissed() {
      store.data.local.dismissed = {};
      store.save();
      push();
    },

    saveOwnTask(task = {}) {
      const clean = {
        id: task.id || undefined,
        title: String(task.title || '').slice(0, 300),
        subject: String(task.subject || '').slice(0, 60),
        kind: ['task', 'test', 'termin'].includes(task.kind) ? task.kind : 'task',
        due: Number.isFinite(task.due) ? task.due : null,
        allDay: Boolean(task.allDay),
        description: String(task.description || '').slice(0, 5000)
      };
      if (!clean.id) delete clean.id;
      store.saveOwnTask(clean);
      push();
    },

    deleteOwnTask(id) {
      store.deleteOwnTask(id);
      push();
    },

    updateSettings(patch = {}) {
      const before = store.settings;
      store.updateSettings(patch);
      const after = store.settings;
      if ('syncIntervalMin' in patch) sync.schedule();
      if ('demo' in patch && before.demo && !after.demo) setTimeout(() => sync.syncAll(), 500);
      if (patch.platforms) {
        for (const [id, p] of Object.entries(patch.platforms)) {
          if (p && p.enabled === true && !before.platforms[id].enabled) sync.syncOne(id);
        }
      }
      host.onSettingsChanged(patch, before, after);
      push();
      return buildState();
    },

    setCredentials(source, creds = {}) {
      const sec = sync.scopedSecrets(source);
      const patch = {};
      if (source === 'webuntis') {
        const link = connectors.webuntis.parseUntisLink(creds.link || creds.key || '');
        if (link) {
          creds = { ...creds, username: link.user, key: link.key };
          patch.authMode = 'key';
          if (link.server) patch.server = link.server;
          if (link.school) patch.school = link.school;
        }
        if (creds.key !== undefined) sec.set('key', String(creds.key).toUpperCase().replace(/[^A-Z2-7]/g, '') || null);
        if (creds.authMode) patch.authMode = creds.authMode === 'password' ? 'password' : 'key';
      }
      if (creds.username !== undefined) patch.username = String(creds.username).trim();
      if (creds.password !== undefined) sec.set('password', creds.password || null);
      if (Object.keys(patch).length) store.updateSettings({ platforms: { [source]: patch } });
      push();
      if (!isDemo()) sync.syncOne(source);
      return buildState();
    },

    /** Nach dem Schließen eines Anmeldefensters */
    afterLogin(source) {
      push();
      if (!isDemo()) sync.syncOne(source);
    },

    async logout(source) {
      const connector = connectors[source];
      if (!connector) return buildState();
      try {
        await connector.logout(sync.context(source));
      } catch (err) {
        host.toast(`Abmelden: ${err.message}`, 'error');
      }
      store.clearSource(source);
      push();
      return buildState();
    },

    async timetable(weekStart) {
      if (isDemo()) return { lessons: demoTimetable(weekStart) };
      if (!store.settings.showTimetable) return { lessons: [] };
      if (!(store.data.sourceState.webuntis || {}).lastSync) return { lessons: [], error: 'WebUntis ist noch nicht verbunden.' };
      return sync.timetable(weekStart);
    },

    async graphConnect(send) {
      try {
        await connectors.teams.graphConnect(sync.context('teams'), (code) => {
          send(code);
          if (/^https:\/\//.test(code.verificationUri || '')) host.openExternal(code.verificationUri);
        });
        send({ done: true });
        sync.syncOne('teams');
        return { ok: true };
      } catch (err) {
        send({ error: err.message });
        return { ok: false, error: err.message };
      }
    },

    diagnostics(source, system = {}) {
      const ids = source ? [source] : connectorList.map((c) => c.id);
      return {
        app: 'Schulradar',
        version: host.version,
        erstellt: new Date().toISOString(),
        system: { plattform: host.platform, ...system },
        hinweis: 'Enthält Aufgabentitel und Protokolle, aber keine Passwörter. Bitte vor dem Weitergeben durchsehen.',
        plattformen: sync.diagnostics(ids)
      };
    }
  };
}

module.exports = { createController };
