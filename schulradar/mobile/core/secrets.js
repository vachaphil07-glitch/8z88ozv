'use strict';
// Zugangsdaten auf dem Handy: verschlüsselt mit einem Schlüssel aus dem Android-Keystore
// (SchulradarNativePlugin.secretsRead/secretsWrite). Gleiche Schnittstelle wie src/main/secrets.js.
const { Native } = require('./native');

class MobileSecrets {
  constructor() {
    this.cache = {};
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const { json } = await Native.secretsRead();
      this.cache = JSON.parse(json || '{}') || {};
    } catch (_) {
      this.cache = {};
    }
    return this;
  }

  available() {
    return true;
  }

  write() {
    const json = JSON.stringify(this.cache);
    this.queue = this.queue.then(() => Native.secretsWrite({ json })).catch((err) => console.warn('Zugangsdaten nicht gespeichert:', err));
    return this.queue;
  }

  get(key) {
    return this.cache[key];
  }

  set(key, value) {
    if (value === undefined || value === null || value === '') delete this.cache[key];
    else this.cache[key] = value;
    this.write();
  }

  removePrefix(prefix) {
    for (const k of Object.keys(this.cache)) if (k.startsWith(prefix)) delete this.cache[k];
    this.write();
  }

  has(key) {
    const v = this.get(key);
    return v !== undefined && v !== null && v !== '';
  }
}

module.exports = { MobileSecrets };
