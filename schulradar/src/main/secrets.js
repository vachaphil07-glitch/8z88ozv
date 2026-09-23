'use strict';
// Zugangsdaten (Passwörter, Schlüssel, Tokens) werden mit der Windows-Verschlüsselung (DPAPI)
// über Electron safeStorage abgelegt. Nur der angemeldete Windows-Benutzer kann sie wieder lesen.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

class Secrets {
  constructor(dir) {
    this.file = path.join(dir, 'zugangsdaten.bin');
    this.cache = null;
  }

  available() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch (_) {
      return false;
    }
  }

  read() {
    if (this.cache) return this.cache;
    try {
      const buf = fs.readFileSync(this.file);
      if (buf.subarray(0, 6).toString() === 'PLAIN:') {
        this.cache = JSON.parse(Buffer.from(buf.subarray(6).toString(), 'base64').toString('utf8'));
      } else {
        this.cache = JSON.parse(safeStorage.decryptString(buf));
      }
    } catch (_) {
      this.cache = {};
    }
    return this.cache;
  }

  write() {
    const json = JSON.stringify(this.cache || {});
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (this.available()) {
      fs.writeFileSync(this.file, safeStorage.encryptString(json));
    } else {
      // Fallback (z. B. Linux ohne Schlüsselbund): nur verschleiert, nicht verschlüsselt.
      fs.writeFileSync(this.file, Buffer.concat([Buffer.from('PLAIN:'), Buffer.from(Buffer.from(json).toString('base64'))]));
    }
  }

  get(key) {
    return this.read()[key];
  }

  set(key, value) {
    this.read();
    if (value === undefined || value === null || value === '') delete this.cache[key];
    else this.cache[key] = value;
    this.write();
  }

  removePrefix(prefix) {
    this.read();
    for (const k of Object.keys(this.cache)) if (k.startsWith(prefix)) delete this.cache[k];
    this.write();
  }

  has(key) {
    const v = this.get(key);
    return v !== undefined && v !== null && v !== '';
  }
}

module.exports = { Secrets };
