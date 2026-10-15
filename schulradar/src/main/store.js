'use strict';
// Speichert alles lokal in einer JSON-Datei im Benutzerordner (%APPDATA%\Schulradar).
const fs = require('fs');
const path = require('path');
const presets = require('./presets');

const SOURCES = ['webuntis', 'teams', 'letto', 'eduvidual', 'lms', 'gcal', 'gtasks'];

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
        summaryTime: '07:00',
        weeklyReview: true, // Sonntag: Rückblick auf die Woche und Ausblick
        weeklyTime: '18:00'
      },
      google: {
        clientId: '' // eigene OAuth-Client-ID (Desktop-App) für Google Tasks und den Abgleich
      },
      sync: {
        enabled: false // Abgleich PC ↔ Handy über Google Drive
      },
      grades: {
        targets: {} // Fach -> Ziel-Note (1–4)
      },
      study: {
        horizonDays: 14,
        sessionMin: 45,
        sessionsPerExam: 3,
        sessionsPerSchularbeit: 4,
        spreadDays: 7,
        weekdayFrom: '15:00',
        weekdayTo: '20:00',
        weekendFrom: '10:00',
        weekendTo: '18:00',
        bufferMin: 15
      },
      focus: {
        focusMin: 25,
        breakMin: 5
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
        },
        gcal: {
          enabled: false,
          calendars: [], // [{id, name, host}] – die geheimen Adressen liegen bei den Zugangsdaten
          remind: false // Erinnerungen auch für diese Termine
        },
        gtasks: {
          enabled: false,
          knownLists: [], // [{id, title}] – vom letzten Abruf, für die Auswahl
          hiddenLists: [], // Listen, die nicht angezeigt werden
          defaultList: '' // Liste für neue Aufgaben ('' = Standardliste)
        }
      }
    },
    items: Object.fromEntries(SOURCES.map((s) => [s, []])),
    sourceState: Object.fromEntries(SOURCES.map((s) => [s, { status: 'new', lastSync: null, message: '' }])),
    local: {
      done: {}, // id -> Zeitpunkt, an dem in der App abgehakt wurde
      undone: {}, // id -> Zeitpunkt, an dem das Häkchen wieder entfernt wurde (für den Abgleich)
      dismissed: {}, // id -> Zeitpunkt, an dem ein Eintrag ausgeblendet wurde
      undismissed: {}
    },
    ownTasks: [],
    notes: [], // [{id, title, text, subject, itemId, pinned, color, created, updated}]
    manualGrades: [], // [{id, subject, title, kind, grade, weight, date, updated}]
    focusSessions: [], // [{id, label, itemId, start, minutes, updated}]
    deleted: {}, // id -> Zeitpunkt des Löschens (Grabsteine für den Abgleich)
    grades: { eduvidual: [] }, // von Plattformen abgerufene Noten
    cloud: { lastRun: null, lastError: '', fileId: '' },
    reminders: { fired: {}, lastSummary: '', lastWeekly: '' },
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
    const fresh = uniqueIds(items).map((it) => ({ ...it, source, fetched: now }));
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
    if (this.data.grades[source]) this.data.grades[source] = [];
    this.data.sourceState[source] = { status: 'new', lastSync: null, message: '' };
    this.save();
  }

  setDone(id, done) {
    this.setFlag('done', 'undone', id, done);
  }

  setDismissed(id, dismissed) {
    this.setFlag('dismissed', 'undismissed', id, dismissed);
  }

  /** Markierung setzen; das Gegenteil wird mit Zeitpunkt gemerkt, damit der Abgleich weiß, was neuer ist. */
  setFlag(onKey, offKey, id, on) {
    const local = this.data.local;
    const had = Boolean(local[onKey][id]);
    if (on) {
      local[onKey][id] = Date.now();
      delete local[offKey][id];
    } else {
      delete local[onKey][id];
      if (had) local[offKey][id] = Date.now();
    }
    this.save();
  }

  /** Eintrag einer abgeglichenen Sammlung anlegen oder ändern */
  saveRecord(collection, record, prefix) {
    const list = this.data[collection];
    const now = Date.now();
    const idx = record.id ? list.findIndex((r) => r.id === record.id) : -1;
    if (idx >= 0) list[idx] = { ...list[idx], ...record, updated: now };
    else list.push({ ...record, id: record.id || `${prefix}:${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: now, updated: now });
    this.save();
    return idx >= 0 ? list[idx] : list[list.length - 1];
  }

  deleteRecord(collection, id) {
    this.data[collection] = this.data[collection].filter((r) => r.id !== id);
    this.data.deleted[id] = Date.now();
    this.save();
  }

  saveOwnTask(task) {
    this.saveRecord('ownTasks', task, 'own');
    return this.data.ownTasks;
  }

  deleteOwnTask(id) {
    this.deleteRecord('ownTasks', id);
    delete this.data.local.done[id];
    this.save();
  }

  saveNote(note) {
    this.saveRecord('notes', note, 'note');
    return this.data.notes;
  }

  deleteNote(id) {
    this.deleteRecord('notes', id);
  }

  /** Eintrag einer Plattform kurz lokal ändern (z. B. sofort nach dem Abhaken in Google Tasks) */
  patchItem(source, id, patch) {
    const it = (this.data.items[source] || []).find((i) => i.id === id);
    if (it) {
      Object.assign(it, patch);
      this.save();
    }
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
      notes: this.data.notes,
      manualGrades: this.data.manualGrades,
      focusSessions: this.data.focusSessions,
      grades: this.data.grades,
      cloud: this.data.cloud,
      sourceState: this.data.sourceState,
      settings: this.data.settings
    };
  }

  /** Alte lokale Markierungen aufräumen (Einträge, die es nicht mehr gibt). */
  prune() {
    const known = new Set(this.snapshot().items.map((i) => i.id));
    const cutoff = Date.now() - 365 * 24 * 3600 * 1000;
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

/**
 * Jeder Eintrag braucht eine eigene ID – sonst gehen z. B. beim Aufklappen oder Abhaken mehrere
 * Einträge gleichzeitig auf. Doppelte IDs bekommen einen Zusatz aus Titel und Datum.
 */
function uniqueIds(items) {
  const seen = new Set();
  return items.map((it) => {
    if (!seen.has(it.id)) {
      seen.add(it.id);
      return it;
    }
    const text = `${it.title}|${it.due}|${it.end}|${it.subject || it.course || ''}`;
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
    let id = `${it.id}~${(h >>> 0).toString(36)}`;
    for (let n = 2; seen.has(id); n++) id = `${it.id}~${(h >>> 0).toString(36)}-${n}`;
    seen.add(id);
    return { ...it, id };
  });
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...(isPlainObject(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = mergeDeep(out[k], v);
  return out;
}

module.exports = { Store, SOURCES, defaultData, mergeDefaults, mergeDeep, uniqueIds };
