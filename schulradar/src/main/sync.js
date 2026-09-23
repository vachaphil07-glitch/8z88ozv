'use strict';
// Steuert das Abrufen der Plattformen und sammelt Protokolle für die Diagnose.
const { connectors } = require('./connectors');
const { startOfDay, addDays, toIsoDate } = require('./util/dates');

const MAX_SAMPLE = 150 * 1024;

function shrink(value, depth = 0) {
  if (Array.isArray(value)) return value.slice(0, 25).map((v) => shrink(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 12) return '…';
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|password|passwort|secret|cookie|authorization/i.test(k) ? '***' : shrink(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '…';
  return value;
}

class SyncManager {
  constructor({ store, secrets, onChange, onLoginNeeded, isDemo }) {
    this.store = store;
    this.isDemo = isDemo || (() => store.settings.demo);
    this.secrets = secrets;
    this.onChange = onChange;
    this.onLoginNeeded = onLoginNeeded || (() => {});
    this.running = new Map();
    this.logs = {};
    this.samples = {};
    this.timer = null;
  }

  scopedSecrets(id) {
    const s = this.secrets;
    return {
      get: (k) => s.get(`${id}.${k}`),
      set: (k, v) => s.set(`${id}.${k}`, v),
      has: (k) => s.has(`${id}.${k}`)
    };
  }

  context(id) {
    const store = this.store;
    const g = store.settings;
    const today = startOfDay(Date.now());
    return {
      id,
      get settings() {
        return store.settings.platforms[id];
      },
      global: g,
      secrets: this.scopedSecrets(id),
      range: { from: addDays(today, -g.lookbackDays), to: addDays(today, g.lookaheadDays) },
      log: (msg) => this.log(id, msg),
      sample: (name, data) => this.sample(id, name, data),
      saveSettings: (patch) => {
        store.updateSettings({ platforms: { [id]: patch } });
        this.onChange();
      }
    };
  }

  log(id, msg) {
    const list = this.logs[id] || (this.logs[id] = []);
    list.push(`${new Date().toISOString()}  ${msg}`);
    if (process.env.SCHULRADAR_DEBUG) console.log(`[${id}] ${msg}`);
    if (list.length > 300) list.splice(0, list.length - 300);
  }

  sample(id, name, data) {
    let s = shrink(data);
    if (JSON.stringify(s).length > MAX_SAMPLE) s = JSON.stringify(s).slice(0, MAX_SAMPLE) + '…';
    (this.samples[id] || (this.samples[id] = {}))[name] = s;
  }

  isRunning(id) {
    return this.running.has(id);
  }

  syncOne(id) {
    if (this.running.has(id)) return this.running.get(id);
    const settings = this.store.settings.platforms[id];
    if (!settings || !settings.enabled || this.isDemo()) return Promise.resolve();
    const promise = this.run(id).finally(() => {
      this.running.delete(id);
      this.onChange();
    });
    this.running.set(id, promise);
    this.onChange();
    return promise;
  }

  async run(id) {
    const connector = connectors[id];
    const prevStatus = (this.store.data.sourceState[id] || {}).status;
    this.log(id, 'Abruf gestartet');
    try {
      const res = await connector.sync(this.context(id));
      this.store.setItems(id, res.items || [], { pendingOnly: Boolean(res.pendingOnly) });
      if (res.timetable) {
        for (const [week, lessons] of Object.entries(res.timetable)) {
          this.store.data.timetable[week] = { fetched: Date.now(), lessons };
        }
      }
      this.store.setSourceState(id, { status: 'ok', lastSync: Date.now(), message: '', count: (res.items || []).length });
      this.log(id, `Fertig: ${(res.items || []).length} Einträge`);
    } catch (err) {
      const status = err.code === 'LOGIN' ? 'login' : err.code === 'CONFIG' ? 'config' : 'error';
      this.store.setSourceState(id, { status, message: err.message, lastError: Date.now() });
      this.log(id, `Fehler: ${err.stack || err.message}`);
      if (status === 'login' && prevStatus === 'ok') this.onLoginNeeded(id, err.message);
    }
  }

  /**
   * Alle Plattformen abrufen. Automatisch (manual = false) nur die, die schon einmal
   * erfolgreich verbunden waren – noch nie eingerichtete Plattformen erzeugen sonst nur Fehler.
   */
  async syncAll({ manual = false } = {}) {
    if (this.isDemo()) return;
    const enabled = (id) => {
      const s = this.store.settings.platforms[id];
      if (!s || !s.enabled) return false;
      return manual || Boolean((this.store.data.sourceState[id] || {}).lastSync);
    };
    // Teams und Letto öffnen unsichtbare Browserfenster – nacheinander, um den PC zu schonen
    const browserBased = (async () => {
      if (enabled('teams')) await this.syncOne('teams');
      if (enabled('letto')) await this.syncOne('letto');
      if (enabled('lms')) await this.syncOne('lms');
    })();
    await Promise.all([enabled('webuntis') && this.syncOne('webuntis'), enabled('eduvidual') && this.syncOne('eduvidual'), browserBased]);
    this.store.prune();
  }

  schedule() {
    clearInterval(this.timer);
    const minutes = Math.max(5, Number(this.store.settings.syncIntervalMin) || 30);
    this.timer = setInterval(() => this.syncAll(), minutes * 60 * 1000);
  }

  lastSyncAge() {
    const times = Object.values(this.store.data.sourceState)
      .map((s) => s.lastSync || 0)
      .filter(Boolean);
    return times.length ? Date.now() - Math.max(...times) : Infinity;
  }

  async timetable(weekStart) {
    const key = toIsoDate(weekStart);
    const cached = this.store.data.timetable[key];
    const fresh = cached && Date.now() - cached.fetched < 6 * 3600 * 1000;
    const s = this.store.settings.platforms.webuntis;
    if (fresh || !s.enabled) return { lessons: cached ? cached.lessons : [], cached: Boolean(cached) };
    try {
      const lessons = await connectors.webuntis.timetable(this.context('webuntis'), weekStart);
      this.store.data.timetable[key] = { fetched: Date.now(), lessons };
      // nur die letzten 12 Wochen behalten
      const keys = Object.keys(this.store.data.timetable).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete this.store.data.timetable[k];
      this.store.save();
      return { lessons, cached: false };
    } catch (err) {
      this.log('webuntis', `Stundenplan ${key}: ${err.message}`);
      return { lessons: cached ? cached.lessons : [], cached: Boolean(cached), error: err.message };
    }
  }

  diagnostics(ids) {
    const out = {};
    for (const id of ids) {
      out[id] = {
        einstellungen: this.store.settings.platforms[id],
        status: this.store.data.sourceState[id],
        anzahlEintraege: (this.store.data.items[id] || []).length,
        protokoll: this.logs[id] || [],
        beispiele: this.samples[id] || {}
      };
    }
    return out;
  }
}

module.exports = { SyncManager, shrink };
