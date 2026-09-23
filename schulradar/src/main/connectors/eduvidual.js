'use strict';
// Eduvidual (Moodle): Abgaben, Tests (Quiz) und Kalendertermine aus allen Kursen.
//
// Nach der Anmeldung im Anmeldefenster (egal ob eduvidual-Konto, Microsoft oder Google) holt sich
// die App über den offiziellen "Moodle-App"-Zugang (launch.php) einen langlebigen Token.
// Klappt das nicht, wird die normale Browser-Sitzung verwendet.
const { fetchJson, httpFetch, requestManual, clearOrigins } = require('../web');
const { LoginRequiredError, ConfigError, stripHtml } = require('./base');

// ---------------------------------------------------------------- Parser (testbar)

const DONE_NAME_SUFFIX =
  /\s*(?:ist\s+)?(?:fällig|faellig|is due|schließt|schliesst|closes|endet|ends|sollte abgeschlossen werden|should be completed)\s*\.?$/i;

function cleanEventName(name) {
  return String(name || '')
    .replace(DONE_NAME_SUFFIX, '')
    .replace(/^(?:Abgabe|Fälligkeit|Due)\s*:\s*/i, '')
    .replace(/^["'„“](.*)["'“”]$/, '$1')
    .trim();
}

function moduleOf(e) {
  if (e.modulename) return e.modulename;
  if (e.component && /^mod_/.test(e.component)) return e.component.slice(4);
  return '';
}

/**
 * pending: Ereignisse aus core_calendar_get_action_events_by_timesort (= noch zu erledigen)
 * events:  alle Kalenderereignisse (Monatsansichten)
 */
function parseMoodleEvents({ pending = [], events = [], base = '', from = 0 } = {}) {
  const pendingIds = new Set(pending.map((e) => e.id));
  const byId = new Map();
  for (const e of events) byId.set(e.id, e);
  for (const e of pending) byId.set(e.id, { ...(byId.get(e.id) || {}), ...e });

  const items = [];
  for (const e of byId.values()) {
    const mod = moduleOf(e);
    const etype = e.eventtype || '';
    const isPending = pendingIds.has(e.id);
    if (mod && etype === 'open' && !isPending) continue; // "… öffnet" ist kein Abgabetermin
    if (etype === 'expectcompletionon' && !isPending) continue;
    const time = (e.timesort || e.timestart || 0) * 1000;
    if (!time || time < from) continue;

    const course = e.course || {};
    let type = 'event';
    if (mod === 'assign') type = 'assignment';
    else if (mod === 'quiz') type = 'quiz';
    else if (mod) type = 'activity';

    let status = 'open';
    if (mod && !isPending) status = 'submitted';

    const action = e.action || null;
    items.push({
      id: `eduvidual:ev:${e.id}`,
      type,
      module: mod,
      title: cleanEventName(e.activityname || e.name) || e.name || 'Aktivität',
      description: stripHtml(e.description || ''),
      course: course.fullname || course.fullnamedisplay || '',
      subject: course.shortname || '',
      due: time,
      allDay: false,
      status,
      actionName: action && action.name ? action.name : '',
      url: (action && action.url) || e.url || (course.id && base ? `${base}/course/view.php?id=${course.id}` : base)
    });
  }
  return items;
}

/** Wandelt verschachtelte Parameter in das Moodle-Formularformat (a[b][0]=1). */
function flattenParams(obj, prefix = '', out = new URLSearchParams()) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== 'object') {
    out.append(prefix, typeof obj === 'boolean' ? (obj ? '1' : '0') : String(obj));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) flattenParams(v, prefix ? `${prefix}[${k}]` : k, out);
  return out;
}

function decodeLaunchToken(url) {
  const m = String(url || '').match(/token=([A-Za-z0-9+/=_%-]+)/);
  if (!m) return null;
  const decoded = Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8');
  const parts = decoded.split(':::');
  return parts.length >= 2 && /^[0-9a-f]{32}$/i.test(parts[1]) ? parts[1] : null;
}

// ---------------------------------------------------------------- Netzwerk

function siteBase(s) {
  const url = String(s.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new ConfigError('Eduvidual-Adresse fehlt (Plattformen → Eduvidual).');
  return url;
}

async function obtainToken(ctx) {
  const base = siteBase(ctx.settings);
  const passport = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const isApp = (u) => /^moodlemobile:/i.test(u);
  const isLogin = (u) => /\/login\/index\.php/i.test(u);
  let url = `${base}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`;
  for (let i = 0; i < 2; i++) {
    const res = await requestManual(url, { stopAt: (u) => isApp(u) || isLogin(u) });
    if (res.stopped && isApp(res.stopped)) return decodeLaunchToken(res.stopped);
    if (res.stopped && isLogin(res.stopped)) throw new LoginRequiredError('Eduvidual: Bitte anmelden.');
    const inBody = res.body.match(/moodlemobile:\/\/token=[A-Za-z0-9+/=_%-]+/);
    if (inBody) return decodeLaunchToken(inBody[0]);
    // Manche Moodle-Versionen zeigen zuerst eine Bestätigungsseite
    const confirm = res.body.match(/href="([^"]*launch\.php[^"]*confirmed=1[^"]*)"/i);
    if (!confirm) break;
    url = confirm[1].replace(/&amp;/g, '&');
  }
  return null;
}

async function getSesskey(ctx) {
  const base = siteBase(ctx.settings);
  const res = await httpFetch(`${base}/my/`);
  const html = await res.text();
  if (/name="logintoken"|id="loginbtn"|\/login\/index\.php"\s*method/i.test(html)) throw new LoginRequiredError('Eduvidual: Bitte anmelden.');
  const m = html.match(/"sesskey":"([A-Za-z0-9]+)"/);
  if (!m) throw new LoginRequiredError('Eduvidual: Sitzung abgelaufen, bitte neu anmelden.');
  return m[1];
}

function makeCaller(ctx, transport) {
  const base = siteBase(ctx.settings);
  if (transport.token) {
    return async (fn, args = {}) => {
      const body = flattenParams(args);
      body.append('wstoken', transport.token);
      const res = await fetchJson(`${base}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=${fn}`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      if (res && res.exception) {
        if (/invalidtoken|accessexception|usernotfullysetup/i.test(res.errorcode || '')) {
          const err = new LoginRequiredError('Eduvidual: App-Zugang abgelaufen, bitte neu anmelden.');
          err.tokenInvalid = true;
          throw err;
        }
        throw new Error(`Eduvidual (${fn}): ${res.message || res.errorcode}`);
      }
      return res;
    };
  }
  return async (fn, args = {}) => {
    const res = await fetchJson(`${base}/lib/ajax/service.php?sesskey=${transport.sesskey}&info=${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname: fn, args }])
    });
    const r = Array.isArray(res) ? res[0] : res;
    if (!r || r.error) {
      const code = (r && r.exception && r.exception.errorcode) || '';
      if (/servicerequireslogin|invalidsesskey|requireloginerror/i.test(code)) throw new LoginRequiredError('Eduvidual: Sitzung abgelaufen, bitte neu anmelden.');
      throw new Error(`Eduvidual (${fn}): ${(r && r.exception && r.exception.message) || 'Fehler'}`);
    }
    return r.data;
  };
}

async function getCaller(ctx) {
  let token = ctx.secrets.get('token');
  if (!token) {
    try {
      token = await obtainToken(ctx);
      if (token) {
        ctx.secrets.set('token', token);
        ctx.log('Moodle-App-Zugang eingerichtet.');
      }
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err;
      ctx.log(`App-Zugang nicht möglich: ${err.message}`);
    }
  }
  if (token) return { call: makeCaller(ctx, { token }), mode: 'token' };
  const sesskey = await getSesskey(ctx);
  return { call: makeCaller(ctx, { sesskey }), mode: 'session' };
}

async function collect(ctx, call) {
  const base = siteBase(ctx.settings);
  const from = Math.floor(ctx.range.from / 1000);

  const pending = [];
  let after = 0;
  for (let page = 0; page < 10; page++) {
    const args = { timesortfrom: from, limitnum: 50 };
    if (after) args.aftereventid = after;
    const r = await call('core_calendar_get_action_events_by_timesort', args);
    const evs = (r && r.events) || [];
    if (page === 0) ctx.sample('action_events', r);
    pending.push(...evs);
    if (evs.length < 50) break;
    after = evs[evs.length - 1].id;
  }

  const events = [];
  const now = new Date();
  const until = ctx.range.to;
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    if (d.getTime() > until) break;
    try {
      const r = await call('core_calendar_get_calendar_monthly_view', {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        courseid: 1,
        includenavigation: false
      });
      if (i === 0) ctx.sample('monthly_view', r);
      for (const w of (r && r.weeks) || []) for (const day of w.days || []) events.push(...(day.events || []));
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err;
      ctx.log(`Monatsansicht ${d.getMonth() + 1}/${d.getFullYear()}: ${err.message}`);
      break;
    }
  }
  return parseMoodleEvents({ pending, events, base, from: ctx.range.from });
}

let lastLaunchTry = 0;

const connector = {
  id: 'eduvidual',
  name: 'Eduvidual',
  color: '#1E7FD8',
  description: 'Abgaben, Tests und Termine aus allen Eduvidual-Kursen (Moodle).',

  origins(s) {
    try {
      return [new URL(siteBase(s)).origin];
    } catch (_) {
      return [];
    }
  },

  loginUrl(s) {
    return `${siteBase(s)}/login/index.php`;
  },

  isConfigured(_s, secrets) {
    return secrets.has('token');
  },

  async sync(ctx) {
    let { call, mode } = await getCaller(ctx);
    ctx.log(`Abruf über ${mode === 'token' ? 'App-Zugang' : 'Browser-Sitzung'}`);
    try {
      return { items: await collect(ctx, call) };
    } catch (err) {
      if (err.tokenInvalid) {
        ctx.secrets.set('token', null);
        ({ call } = await getCaller(ctx));
        return { items: await collect(ctx, call) };
      }
      throw err;
    }
  },

  /** Sobald man im Anmeldefenster eingeloggt ist: App-Zugang holen und Fenster schließen. */
  async onLoginPage(ctx, win) {
    const url = win.webContents.getURL();
    let origin;
    try {
      origin = new URL(siteBase(ctx.settings)).origin;
    } catch (_) {
      return null;
    }
    if (!url.startsWith(origin) || /\/login\//.test(url)) return null;
    if (Date.now() - lastLaunchTry < 8000) return null;
    lastLaunchTry = Date.now();
    try {
      const token = await obtainToken(ctx);
      if (token) {
        ctx.secrets.set('token', token);
        return { done: true, message: 'Eduvidual verbunden.' };
      }
    } catch (_) {
      /* noch nicht angemeldet */
    }
    return null;
  },

  async logout(ctx) {
    ctx.secrets.set('token', null);
    await clearOrigins(this.origins(ctx.settings));
  }
};

module.exports = connector;
module.exports.parseMoodleEvents = parseMoodleEvents;
module.exports.cleanEventName = cleanEventName;
module.exports.flattenParams = flattenParams;
module.exports.decodeLaunchToken = decodeLaunchToken;
