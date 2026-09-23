'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, mergeDefaults, defaultData } = require('../src/main/store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-test-'));
  return { store: new Store(dir), dir };
}

test('Fehlende Einstellungen werden nach Updates ergänzt', () => {
  const old = { settings: { theme: 'dark', platforms: { webuntis: { username: 'max' } } } };
  const merged = mergeDefaults(defaultData(), old);
  assert.equal(merged.settings.theme, 'dark');
  assert.equal(merged.settings.platforms.webuntis.username, 'max');
  assert.equal(merged.settings.platforms.webuntis.server, 'htl-hl.webuntis.com');
  assert.equal(merged.settings.reminders.enabled, true);
  assert.deepEqual(merged.settings.reminders.leadHours, [24, 3]);
});

test('Alte Teams-Adresse wird auf teams.cloud.microsoft umgestellt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-test-'));
  fs.writeFileSync(
    path.join(dir, 'schulradar-daten.json'),
    JSON.stringify({ settings: { platforms: { teams: { url: 'https://teams.microsoft.com/l/app/66aeee93-507d-479a-a3ef-8f494af43945' } } } })
  );
  assert.equal(new Store(dir).settings.platforms.teams.url, 'https://teams.cloud.microsoft/');
});

test('Speichern und Laden', () => {
  const { store, dir } = tempStore();
  store.updateSettings({ theme: 'light', platforms: { letto: { dashboardUrl: 'https://x/dashboard' } } });
  store.setDone('a', true);
  store.saveOwnTask({ title: 'Referat', kind: 'task', due: null });
  store.saveNow();
  const again = new Store(dir);
  assert.equal(again.settings.theme, 'light');
  assert.equal(again.settings.platforms.letto.dashboardUrl, 'https://x/dashboard');
  assert.equal(again.settings.platforms.letto.url, 'https://letto.htl-hl.ac.at/');
  assert.ok(again.data.local.done.a);
  assert.equal(again.data.ownTasks[0].title, 'Referat');
  assert.match(again.data.ownTasks[0].id, /^own:/);
});

test('Nur-offene Plattformen: verschwundene Einträge gelten als erledigt', () => {
  const { store } = tempStore();
  const future = Date.now() + 3 * 86400000;
  const past = Date.now() - 30 * 86400000;
  store.setItems('letto', [
    { id: 'l1', title: 'HÜ 1', due: future, progress: 40 },
    { id: 'l2', title: 'HÜ 2', due: future },
    { id: 'l3', title: 'uralt', due: past }
  ], { pendingOnly: true });
  store.setItems('letto', [{ id: 'l2', title: 'HÜ 2', due: future }], { pendingOnly: true });
  const items = store.data.items.letto;
  const l1 = items.find((i) => i.id === 'l1');
  assert.equal(items.length, 2);
  assert.equal(l1.status, 'done');
  assert.equal(l1.progress, 100);
  assert.ok(l1.vanished);
  assert.ok(!items.find((i) => i.id === 'l3'));
});

test('Normale Plattformen ersetzen ihre Einträge vollständig', () => {
  const { store } = tempStore();
  store.setItems('webuntis', [{ id: 'w1', title: 'a' }]);
  store.setItems('webuntis', [{ id: 'w2', title: 'b' }]);
  assert.deepEqual(store.data.items.webuntis.map((i) => i.id), ['w2']);
  const snap = store.snapshot();
  assert.equal(snap.items[0].source, 'webuntis');
});
