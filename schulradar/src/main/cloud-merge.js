'use strict';
// Zusammenführen der Daten von PC und Handy (reine Funktionen, testbar).
//
// Abgeglichen wird, was man selbst in der App macht: Abhaken, Ausblenden, eigene Aufgaben, Notizen,
// eigene Noten und Fokus-Zeiten. Die Daten der Plattformen holt jedes Gerät selbst ab.
//
// Regel: Die jüngste Änderung gewinnt.
//  - Abhaken/Ausblenden: Zeitpunkt des Abhakens (done) gegen Zeitpunkt des Wieder-Öffnens (undone).
//  - Sammlungen: Jeder Eintrag hat eine ID und "updated". Gelöschte Einträge hinterlassen einen
//    Grabstein (deleted[id] = Zeitpunkt), damit sie nicht vom anderen Gerät zurückkommen.

const FORMAT = 1;
const COLLECTIONS = ['ownTasks', 'notes', 'manualGrades', 'focusSessions'];
const FLAGS = [
  ['done', 'undone'],
  ['dismissed', 'undismissed']
];
const KEEP_TOMBSTONES = 365 * 24 * 3600 * 1000;

function stamp(rec) {
  return Number(rec && (rec.updated || rec.created)) || 0;
}

function maxMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (!(Number(out[k]) >= Number(v))) out[k] = v;
  return out;
}

/** Was von diesem Gerät abgeglichen wird */
function snapshotForSync(data, now = Date.now()) {
  const local = data.local || {};
  return {
    format: FORMAT,
    updated: now,
    done: { ...(local.done || {}) },
    undone: { ...(local.undone || {}) },
    dismissed: { ...(local.dismissed || {}) },
    undismissed: { ...(local.undismissed || {}) },
    deleted: { ...(data.deleted || {}) },
    collections: Object.fromEntries(COLLECTIONS.map((c) => [c, (data[c] || []).map((r) => ({ ...r }))]))
  };
}

function mergeFlags(a, b, onKey, offKey) {
  const on = maxMap(a[onKey], b[onKey]);
  const off = maxMap(a[offKey], b[offKey]);
  for (const id of Object.keys(on)) {
    if (off[id] === undefined) continue;
    if (Number(off[id]) >= Number(on[id])) delete on[id];
    else delete off[id];
  }
  return [on, off];
}

/** Zwei Stände zusammenführen – die Reihenfolge der Argumente spielt keine Rolle. */
function mergeSync(a, b, now = Date.now()) {
  if (!b || b.format !== FORMAT) return { ...a };
  if (!a || a.format !== FORMAT) return { ...b };
  const out = { format: FORMAT, updated: Math.max(a.updated || 0, b.updated || 0), collections: {} };
  for (const [on, off] of FLAGS) [out[on], out[off]] = mergeFlags(a, b, on, off);

  const deleted = maxMap(a.deleted, b.deleted);
  for (const [id, ts] of Object.entries(deleted)) if (now - ts > KEEP_TOMBSTONES) delete deleted[id];
  // sehr alte Markierungen fallen weg (wie beim Aufräumen in store.prune)
  for (const flag of ['done', 'undone', 'dismissed', 'undismissed']) {
    for (const [id, ts] of Object.entries(out[flag])) if (now - ts > KEEP_TOMBSTONES) delete out[flag][id];
  }
  out.deleted = deleted;

  for (const c of COLLECTIONS) {
    const byId = new Map();
    for (const rec of [...((a.collections || {})[c] || []), ...((b.collections || {})[c] || [])]) {
      if (!rec || !rec.id) continue;
      const prev = byId.get(rec.id);
      if (!prev || stamp(rec) > stamp(prev)) byId.set(rec.id, rec);
    }
    out.collections[c] = [...byId.values()].filter((r) => !(deleted[r.id] >= stamp(r))).sort((x, y) => String(x.id).localeCompare(String(y.id)));
  }
  return out;
}

/** Vergleichbarer Inhalt (ohne Zeitstempel des Abgleichs) */
function contentKey(snap) {
  if (!snap) return '';
  const norm = (m) => Object.keys(m || {}).sort().map((k) => [k, m[k]]);
  const coll = Object.fromEntries(
    COLLECTIONS.map((c) => [c, [...((snap.collections || {})[c] || [])].sort((x, y) => String(x.id).localeCompare(String(y.id)))])
  );
  return JSON.stringify([norm(snap.done), norm(snap.undone), norm(snap.dismissed), norm(snap.undismissed), norm(snap.deleted), coll]);
}

/** Zusammengeführten Stand in die lokalen Daten übernehmen. Liefert true, wenn sich etwas geändert hat. */
function applySync(data, merged) {
  const before = contentKey(snapshotForSync(data, 0));
  data.local.done = { ...merged.done };
  data.local.undone = { ...merged.undone };
  data.local.dismissed = { ...merged.dismissed };
  data.local.undismissed = { ...merged.undismissed };
  data.deleted = { ...merged.deleted };
  for (const c of COLLECTIONS) data[c] = (merged.collections[c] || []).map((r) => ({ ...r }));
  return contentKey(snapshotForSync(data, 0)) !== before;
}

module.exports = { FORMAT, COLLECTIONS, snapshotForSync, mergeSync, applySync, contentKey };
