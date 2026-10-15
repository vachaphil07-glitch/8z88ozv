'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { snapshotForSync, mergeSync, applySync } = require('../src/main/cloud-merge');
const { CloudSync } = require('../src/main/cloud-sync');
const { Store } = require('../src/main/store');

const T = Date.UTC(2026, 9, 15, 12);

function snap(patch = {}) {
  return {
    format: 1,
    updated: T,
    done: {},
    undone: {},
    dismissed: {},
    undismissed: {},
    deleted: {},
    collections: { ownTasks: [], notes: [], manualGrades: [], focusSessions: [] },
    ...patch
  };
}

test('Abgleich: jüngstes Abhaken bzw. Wieder-Öffnen gewinnt', () => {
  const pc = snap({ done: { a: T - 1000, b: T - 5000 }, undone: {} });
  const handy = snap({ done: { c: T }, undone: { a: T - 500, b: T - 9000 } });
  const m = mergeSync(pc, handy, T);
  assert.deepEqual(Object.keys(m.done).sort(), ['b', 'c'], 'a wurde am Handy später wieder geöffnet');
  assert.deepEqual(Object.keys(m.undone), ['a']);
  assert.deepEqual(mergeSync(handy, pc, T).done, m.done, 'Reihenfolge egal');
});

test('Abgleich: Sammlungen, Bearbeitung und Löschen', () => {
  const note = (id, text, updated) => ({ id, text, updated });
  const pc = snap({ collections: { ownTasks: [], notes: [note('n1', 'alt', T - 100), note('n2', 'nur PC', T)], manualGrades: [], focusSessions: [] } });
  const handy = snap({
    deleted: { n2: T + 10 },
    collections: { ownTasks: [{ id: 'o1', title: 'Handy', created: T }], notes: [note('n1', 'neu', T - 50)], manualGrades: [], focusSessions: [] }
  });
  const m = mergeSync(pc, handy, T);
  assert.deepEqual(m.collections.notes.map((n) => [n.id, n.text]), [['n1', 'neu']]);
  assert.equal(m.collections.ownTasks.length, 1);
  // nach dem Löschen wieder bearbeitet → bleibt
  const again = mergeSync(m, snap({ collections: { ownTasks: [], notes: [note('n2', 'wiederhergestellt', T + 20)], manualGrades: [], focusSessions: [] } }), T);
  assert.ok(again.collections.notes.some((n) => n.id === 'n2'));
});

test('Abgleich: übernimmt in die lokalen Daten und meldet Änderungen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-test-'));
  const store = new Store(dir);
  store.setDone('x', true);
  const remote = snap({ undone: { x: Date.now() + 1000 }, collections: { ownTasks: [], notes: [{ id: 'n', text: 'vom Handy', updated: 5 }], manualGrades: [], focusSessions: [] } });
  const merged = mergeSync(snapshotForSync(store.data), remote);
  assert.equal(applySync(store.data, merged), true);
  assert.equal(store.data.local.done.x, undefined);
  assert.equal(store.data.notes[0].text, 'vom Handy');
  assert.equal(applySync(store.data, merged), false, 'zweites Mal: nichts Neues');
});

test('Store: Häkchen entfernen und Löschen hinterlassen Spuren für den Abgleich', () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-test-')));
  store.setDone('a', true);
  store.setDone('a', false);
  assert.ok(store.data.local.undone.a);
  store.setDone('nie', false);
  assert.equal(store.data.local.undone.nie, undefined, 'nur wenn vorher abgehakt');
  store.saveOwnTask({ title: 'x' });
  const id = store.data.ownTasks[0].id;
  assert.ok(store.data.ownTasks[0].updated);
  store.deleteOwnTask(id);
  assert.ok(store.data.deleted[id]);
});

/** Google Drive im Speicher – genug für CloudSync */
function fakeDrive() {
  const files = new Map();
  let n = 0;
  const google = {
    info: () => ({ connected: true, scopes: { drive: true, tasks: true } }),
    async request(url, { method = 'GET', body, raw } = {}) {
      const u = new URL(url);
      if (u.pathname === '/drive/v3/files' && method === 'GET') {
        return { files: [...files.keys()].map((id) => ({ id })) };
      }
      let m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (m && u.searchParams.get('alt') === 'media') {
        if (!files.has(m[1])) throw Object.assign(new Error('404'), { status: 404 });
        return raw ? files.get(m[1]) : JSON.parse(files.get(m[1]));
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
        const id = `f${++n}`;
        const parts = body.split(/\r\n--schulradar[a-z0-9]+(?:--)?/);
        files.set(id, parts[1].split('\r\n\r\n')[1]);
        return { id };
      }
      m = u.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
      if (m && method === 'PATCH') {
        files.set(m[1], body);
        return { id: m[1] };
      }
      throw new Error(`unerwartet: ${method} ${url}`);
    }
  };
  return { google, files };
}

test('CloudSync: zwei Geräte gleichen über Drive ab', async () => {
  const { google, files } = fakeDrive();
  const mk = () => {
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-test-')));
    store.updateSettings({ sync: { enabled: true } });
    return { store, cloud: new CloudSync({ store, google }) };
  };
  const pc = mk();
  const handy = mk();
  pc.store.saveNote({ title: 'Stoff', text: 'Kapitel 3' });
  pc.store.setDone('teams:1', true);
  await pc.cloud.run();
  assert.equal(files.size, 1);
  handy.store.saveOwnTask({ title: 'Mündlich angesagt' });
  const res = await handy.cloud.run();
  assert.equal(res.changedLocal, true);
  assert.equal(handy.store.data.notes[0].title, 'Stoff');
  assert.ok(handy.store.data.local.done['teams:1']);
  await pc.cloud.run();
  assert.equal(pc.store.data.ownTasks[0].title, 'Mündlich angesagt');
  assert.equal(files.size, 1, 'immer dieselbe Datei');
  const quiet = await pc.cloud.run();
  assert.equal(quiet.uploaded, false, 'ohne Änderungen kein Hochladen');
});
