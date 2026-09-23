'use strict';
const crypto = require('crypto');

class LoginRequiredError extends Error {
  constructor(message = 'Anmeldung erforderlich') {
    super(message);
    this.code = 'LOGIN';
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CONFIG';
  }
}

function hashId(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

/** Erste sinnvolle Zeile als Titel, Rest als Beschreibung. */
function splitTitle(text, max = 110) {
  const clean = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .trim();
  if (!clean) return { title: '', rest: '' };
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  let title = lines[0] || '';
  if (title.length > max) title = title.slice(0, max - 1).trimEnd() + '…';
  return { title, rest: clean };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { LoginRequiredError, ConfigError, hashId, splitTitle, stripHtml };
