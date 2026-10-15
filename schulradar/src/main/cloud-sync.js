'use strict';
// Abgleich PC ↔ Handy über Google Drive.
//
// Beide Geräte legen ihren Stand in EINER Datei im versteckten App-Ordner von Google Drive ab
// („appDataFolder“ – nur Schulradar sieht ihn, nicht im normalen Drive sichtbar). Bei jedem Abgleich:
// Datei laden → mit dem eigenen Stand zusammenführen (cloud-merge.js) → lokal übernehmen → wenn sich
// etwas geändert hat, Datei aktualisieren.
const { snapshotForSync, mergeSync, applySync, contentKey } = require('./cloud-merge');

const FILE_NAME = 'schulradar-abgleich.json';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

class CloudSync {
  constructor({ store, google, onChange = () => {}, log = () => {}, isDemo = () => false }) {
    this.store = store;
    this.google = google;
    this.onChange = onChange;
    this.log = log;
    this.isDemo = isDemo;
    this.running = null;
    this.timer = null;
    this.again = false;
  }

  enabled() {
    const info = this.google.info();
    return Boolean(this.store.settings.sync.enabled && info.connected && info.scopes.drive && !this.isDemo());
  }

  /** Nach einer Änderung in der App: kurz warten (mehrere Klicks sammeln), dann abgleichen */
  schedule(delayMs = 8000) {
    if (!this.enabled()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run({ reason: 'änderung' }), delayMs);
  }

  run({ reason = '' } = {}) {
    if (!this.enabled()) return Promise.resolve({ skipped: true });
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.doRun(reason)
      .catch((err) => {
        this.store.data.cloud = { ...this.store.data.cloud, lastError: err.message, lastErrorAt: Date.now() };
        this.store.save();
        this.log(`Abgleich fehlgeschlagen: ${err.message}`);
        return { error: err.message };
      })
      .finally(() => {
        this.running = null;
        this.onChange();
        if (this.again) {
          this.again = false;
          this.schedule(1000);
        }
      });
    return this.running;
  }

  async findFile() {
    const cloud = this.store.data.cloud;
    if (cloud.fileId) return cloud.fileId;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await this.google.request(`${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    const file = (res.files || [])[0];
    return file ? file.id : '';
  }

  async download(fileId) {
    try {
      const text = await this.google.request(`${FILES}/${encodeURIComponent(fileId)}?alt=media`, { raw: true });
      return text ? JSON.parse(text) : null;
    } catch (err) {
      if (err.status === 404) {
        this.store.data.cloud.fileId = '';
        return undefined; // Datei wurde gelöscht → neu anlegen
      }
      throw err;
    }
  }

  async upload(fileId, payload) {
    const json = JSON.stringify(payload);
    if (fileId) {
      await this.google.request(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media`, {
        method: 'PATCH',
        body: json,
        headers: { 'Content-Type': 'application/json' }
      });
      return fileId;
    }
    const boundary = `schulradar${Date.now().toString(36)}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await this.google.request(`${UPLOAD}?uploadType=multipart&fields=id`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }
    });
    return res.id;
  }

  async doRun(reason) {
    const store = this.store;
    let fileId = await this.findFile();
    let remote = fileId ? await this.download(fileId) : null;
    if (remote === undefined) {
      fileId = '';
      remote = null;
    }
    const local = snapshotForSync(store.data);
    const merged = remote ? mergeSync(local, remote) : local;
    const changedLocal = remote ? applySync(store.data, merged) : false;
    let uploaded = false;
    if (!remote || contentKey(merged) !== contentKey(remote)) {
      fileId = await this.upload(fileId, { ...merged, updated: Date.now(), device: store.settings.deviceName || '' });
      uploaded = true;
    }
    store.data.cloud = { ...store.data.cloud, fileId, lastRun: Date.now(), lastError: '' };
    store.save();
    this.log(`Abgleich (${reason || 'manuell'}): ${changedLocal ? 'Änderungen übernommen' : 'lokal unverändert'}${uploaded ? ', hochgeladen' : ''}`);
    return { changedLocal, uploaded };
  }
}

module.exports = { CloudSync, FILE_NAME };
