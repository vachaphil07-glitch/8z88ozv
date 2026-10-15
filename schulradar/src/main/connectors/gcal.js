'use strict';
// Google Kalender (und jeder andere Kalender mit iCal-Abo, z. B. Outlook oder iCloud).
//
// Verbunden wird über die „Geheime Adresse im iCal-Format“ eines Kalenders. Dafür braucht es keine
// Google-Anmeldung in der App und keine Freigabe – die Adresse wirkt aber wie ein Passwort und wird
// deshalb verschlüsselt bei den Zugangsdaten gespeichert. Termine werden nur gelesen.
const { httpFetch } = require('../platform');
const { ConfigError, hashId } = require('./base');
const { parseCalendar, eventsInRange } = require('../util/ical');

const MAX_CALENDARS = 12;

/** webcal:// -> https://, Leerzeichen weg; liefert null, wenn es keine Web-Adresse ist */
function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) return null;
  url = url.replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

function describeUrl(url) {
  try {
    const u = new URL(url);
    if (/calendar\.google\.com$/i.test(u.host)) {
      const m = u.pathname.match(/\/ical\/([^/]+)\//);
      return m ? decodeURIComponent(m[1]) : 'Google Kalender';
    }
    return u.host;
  } catch (_) {
    return 'Kalender';
  }
}

/** Kalender-Termine -> Schulradar-Einträge */
function toItems(cal, { calId, calName, from, to }) {
  return eventsInRange(cal, from, to).map((ev) => ({
    id: `gcal:${hashId(calId, ev.uid || ev.summary, String(ev.start))}`,
    type: 'event',
    title: ev.summary || '(ohne Titel)',
    course: calName,
    room: ev.location,
    description: ev.description,
    due: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    days: ev.days > 1 ? ev.days : undefined,
    url: /^https?:\/\//.test(ev.url) ? ev.url : '',
    status: 'open'
  }));
}

function calendars(ctx) {
  const urls = ctx.secrets.get('urls') || {};
  return (ctx.settings.calendars || []).filter((c) => urls[c.id]).map((c) => ({ ...c, url: urls[c.id] }));
}

const connector = {
  id: 'gcal',
  name: 'Google Kalender',
  color: '#1A73E8',
  description: 'Termine aus deinem Google Kalender (oder einem anderen Kalender mit iCal-Adresse)',

  origins() {
    return [];
  },

  isConfigured(s, secrets) {
    const urls = secrets.get('urls') || {};
    return (s.calendars || []).some((c) => urls[c.id]);
  },

  async sync(ctx) {
    const list = calendars(ctx);
    if (!list.length) throw new ConfigError('Noch kein Kalender hinzugefügt.');
    const items = [];
    const errors = [];
    for (const c of list) {
      try {
        const res = await httpFetch(c.url, { credentials: 'omit', headers: { Accept: 'text/calendar, */*' } });
        const text = await res.text();
        if (res.status === 404 || res.status === 401 || res.status === 403) {
          throw new Error('Adresse ungültig oder zurückgesetzt – bitte neu kopieren.');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Das ist keine iCal-Adresse (Datei beginnt nicht mit BEGIN:VCALENDAR).');
        const cal = parseCalendar(text);
        const found = toItems(cal, { calId: c.id, calName: c.name || cal.name, from: ctx.range.from, to: ctx.range.to });
        ctx.log(`${c.name}: ${cal.events.length} Einträge in der Datei, ${found.length} im Zeitraum`);
        ctx.sample(`kalender_${c.id}`, { name: cal.name, events: cal.events.slice(0, 5) });
        if (cal.name && !c.name) {
          ctx.saveSettings({ calendars: ctx.settings.calendars.map((x) => (x.id === c.id ? { ...x, name: cal.name } : x)) });
        }
        items.push(...found);
      } catch (err) {
        errors.push(`${c.name || 'Kalender'}: ${err.message}`);
      }
    }
    if (errors.length === list.length) throw new Error(errors.join(' · '));
    if (errors.length) ctx.log(`Teilweise fehlgeschlagen: ${errors.join(' · ')}`);
    return { items };
  },

  /** Kalender hinzufügen: liefert die neuen Einstellungen oder wirft einen verständlichen Fehler */
  addCalendar(ctx, { url, name }) {
    const clean = normalizeUrl(url);
    if (!clean) throw new ConfigError('Bitte die vollständige Adresse einfügen (beginnt mit https://).');
    const urls = { ...(ctx.secrets.get('urls') || {}) };
    if (Object.values(urls).includes(clean)) throw new ConfigError('Dieser Kalender ist schon eingetragen.');
    const list = ctx.settings.calendars || [];
    if (list.length >= MAX_CALENDARS) throw new ConfigError(`Höchstens ${MAX_CALENDARS} Kalender.`);
    const id = hashId(clean).slice(0, 8);
    urls[id] = clean;
    ctx.secrets.set('urls', urls);
    ctx.saveSettings({ calendars: [...list, { id, name: String(name || '').trim().slice(0, 60), host: describeUrl(clean) }] });
    return id;
  },

  removeCalendar(ctx, id) {
    const urls = { ...(ctx.secrets.get('urls') || {}) };
    delete urls[id];
    ctx.secrets.set('urls', Object.keys(urls).length ? urls : null);
    ctx.saveSettings({ calendars: (ctx.settings.calendars || []).filter((c) => c.id !== id) });
  },

  async logout(ctx) {
    ctx.secrets.set('urls', null);
    ctx.saveSettings({ calendars: [] });
  }
};

module.exports = connector;
module.exports.normalizeUrl = normalizeUrl;
module.exports.toItems = toItems;
module.exports.describeUrl = describeUrl;
