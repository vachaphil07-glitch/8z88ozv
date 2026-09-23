'use strict';
// Speichert alles lokal in einer JSON-Datei im Benutzerordner (%APPDATA%\Schulradar).
const fs = require('fs');
const path = require('path');
const presets = require('./presets');

const SOURCES = ['webuntis', 'teams', 'letto', 'eduvidual', 'lms'];

function defaultData() {
  return {
    version: 1,
    settings: {
      theme: 'system', // system | light | dark
      syncIntervalMin: 30,
      autostart: true,
      startHidden: true,
      closeToTray: true,
      showTimetable: true,
      demo: false,
      onboarded: false,
      lookbackDays: 21,
      lookaheadDays: 120,
      reminders: {
        enabled: true,
        leadHours: [24, 3], // Abgaben mit Uhrzeit: Erinnerung 24 h und 3 h vorher
        eveningBefore: true, // Tests & ganztägige Abgaben: Erinnerung am Vorabend
        eveningTime: '18:00',
        dailySummary: true,
        summaryTime: '07:00'
      },
      platforms: {
        webuntis: {
          enabled: true,
          server: presets.webuntis.server,
          school: presets.webuntis.school,
          authMode: 'key', // key | password
          username: ''
        },
        teams: {
          enabled: true,
          mode: 'web', // web | graph
          url: presets.teams.url,
          clientId: '',
          tenant: presets.teams.tenant
        },
        letto: {
          enabled: true,
          url: presets.letto.url,
          dashboardUrl: '',
          username: ''
        },
        eduvidual: {
          enabled: true,
          url: presets.eduvidual.url
        },
        lms: {
          enabled: true,
          url: presets.lms.url,
          pages: [], // Seiten mit Aufgaben/Terminen (werden im Anmeldefenster erkannt)
          username: ''
        }
      }
    },
    items: Object.fromEntries(SOURCES.map((s) => [s, []])),
    sourceState: Object.fromEntries(SOURCES.map((s) => [s, { status: 'new', lastSync: null, message: '' }])),
    local: {
      done: {}, // id -> Zeitpunkt, an dem in der App abgehakt wurde
      dismissed: {} // id -> Zeitpunkt, an dem ein Eintrag ausgeblendet wurde
    },
    ownTasks: [],
    reminders: { fired: {}, lastSummary: '' },
    timetable: {}
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Füllt fehlende Felder aus den Standardwerten auf (wichtig nach Updates). */
function mergeDefaults(defaults, value) {
  if (!isPlainObject(defaults)) return value === undefined ? defaults : value;
  const out = {};
  const src = isPlainObject(value) ? value : {};
  for (const key of Object.keys(defaults)) out[key] = mergeDefaults(defaults[key], src[key]);
  for (const key of Object.keys(src)) if (!(key in out)) out[key] = src[key];
  return out;
}

/** Datei-Backend für den PC: schulradar-daten.json (+ .bak als Sicherung) */
function fileIo(dir) {
  const file = path.join(dir, 'schulradar-daten.json');
  return {
    file,
    readAll() {
      const out = [];
      for (const f of [file, file + '.bak']) {
        try {
          out.push(fs.readFileSync(f, 'utf8'));
        } catch (err) {
          if (err.code !== 'ENOENT') console.warn('Konnte Daten nicht lesen:', f, err.message);
        }
      }
      return out;
    },
    write(json) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, json, 'utf8');
      if (fs.existsSync(file)) {
        try {
          fs.copyFileSync(file, file + '.bak');
        } catch (_) {
          /* Sicherung ist optional */
        }
      }
      fs.renameSync(tmp, file);
    }
  };
}

/** Alte Einstellungen an neue Versionen anpassen. */
function migrate(data) {
  const teams = data.settings.platforms.teams;
  if (!teams.url || presets.teams.legacyUrls.includes(teams.url)) teams.url = presets.teams.url;
  return data;
}

class Store {
  /**
   * dir: Datenordner (PC). io: optionales Speicher-Backend {readAll(): string[], write(json)} –
   * die Android-App übergibt hier ihren eigenen Dateispeicher.
   */
  constructor(dir, io = null) {
    this.io = io || fileIo(dir);
    this.timer = null;
    this.data = this.load();
  }

  load() {
    for (const raw of this.io.readAll()) {
      try {
        return migrate(mergeDefaults(defaultData(), JSON.parse(raw)));
      } catch (err) {
        console.warn('Konnte Daten nicht lesen:', err.message);
      }
    }
    return defaultData();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    this.io.write(JSON.stringify(this.data, null, 1));
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = mergeDeep(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  /**
   * Ergebnis eines Abrufs übernehmen.
   * pendingOnly: Die Plattform liefert nur offene Einträge (z. B. Letto-Dashboard).
   * Verschwindet dort ein Eintrag vor der Frist, wird er als "erledigt" behalten.
   */
  setItems(source, items, { pendingOnly = false } = {}) {
    const now = Date.now();
    const previous = this.data.items[source] || [];
    const fresh = items.map((it) => ({ ...it, source, fetched: now }));
    if (pendingOnly) {
      const ids = new Set(fresh.map((i) => i.id));
      for (const old of previous) {
        if (ids.has(old.id)) continue;
        const week = 7 * 24 * 3600 * 1000;
        const stillRelevant = old.due ? old.due > now - week : !old.vanished || old.vanished > now - 2 * week;
        if (!stillRelevant) continue;
        fresh.push({
          ...old,
          status: 'done',
          progress: old.progress !== null && old.progress !== undefined ? 100 : old.progress,
          vanished: old.vanished || now,
          note: 'Nicht mehr offen auf der Plattform – vermutlich erledigt.'
        });
      }
    }
    this.data.items[source] = fresh;
    this.save();
  }

  setSourceState(source, patch) {
    this.data.sourceState[source] = { ...(this.data.sourceState[source] || {}), ...patch };
    this.save();
  }

  clearSource(source) {
    this.data.items[source] = [];
    this.data.sourceState[source] = { status: 'new', lastSync: null, message: '' };
    this.save();
  }

  setDone(id, done) {
    if (done) this.data.local.done[id] = Date.now();
    else delete this.data.local.done[id];
    this.save();
  }

  setDismissed(id, dismissed) {
    if (dismissed) this.data.local.dismissed[id] = Date.now();
    else delete this.data.local.dismissed[id];
    this.save();
  }

  saveOwnTask(task) {
    const list = this.data.ownTasks;
    const idx = list.findIndex((t) => t.id === task.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...task, updated: Date.now() };
    else list.push({ ...task, id: task.id || `own:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now() });
    this.save();
    return list;
  }

  deleteOwnTask(id) {
    this.data.ownTasks = this.data.ownTasks.filter((t) => t.id !== id);
    delete this.data.local.done[id];
    this.save();
  }

  /** Alle Einträge für die Oberfläche, inklusive lokalem Status. */
  snapshot() {
    const items = [];
    for (const src of SOURCES) for (const it of this.data.items[src] || []) items.push(it);
    for (const t of this.data.ownTasks) {
      items.push({ type: 'task', status: 'open', ...t, source: 'own' });
    }
    return {
      items,
      local: this.data.local,
      sourceState: this.data.sourceState,
      settings: this.data.settings
    };
  }

  /** Alte lokale Markierungen aufräumen (Einträge, die es nicht mehr gibt). */
  prune() {
    const known = new Set(this.snapshot().items.map((i) => i.id));
    const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
    for (const bucket of ['done', 'dismissed']) {
      for (const [id, ts] of Object.entries(this.data.local[bucket])) {
        if (!known.has(id) && ts < cutoff) delete this.data.local[bucket][id];
      }
    }
    for (const [key, ts] of Object.entries(this.data.reminders.fired)) {
      if (ts < cutoff) delete this.data.reminders.fired[key];
    }
    this.save();
  }
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...(isPlainObject(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = mergeDeep(out[k], v);
  return out;
}

module.exports = { Store, SOURCES, defaultData, mergeDefaults, mergeDeep };
