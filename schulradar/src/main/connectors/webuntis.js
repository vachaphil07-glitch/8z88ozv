'use strict';
// WebUntis: Hausübungen, Prüfungen (Tests/Schularbeiten) und Stundenplan.
//
// Anmeldung (in dieser Reihenfolge):
//  1. Benutzername + "Untis Mobile"-Schlüssel (empfohlen, funktioniert auch bei Microsoft-Login)
//  2. Benutzername + Passwort (nur bei eigenem WebUntis-Passwort)
//  3. Vorhandene Browser-Sitzung aus dem Anmeldefenster (läuft nach kurzer Zeit ab)
const { webSession, fetchJson, HttpError, clearOrigins } = require('../web');
const { LoginRequiredError, ConfigError, splitTitle, stripHtml } = require('./base');
const { untisToMs, toUntisDate, toIsoDate, addDays, startOfWeek, DAY } = require('../util/dates');
const { totp } = require('../util/totp');

const PERSON_TYPES = { KLASSE: 1, TEACHER: 2, SUBJECT: 3, ROOM: 4, STUDENT: 5 };

// ---------------------------------------------------------------- Parser (ohne Netzwerk, testbar)

function parseHomeworks(json) {
  const d = (json && json.data) || json || {};
  const lessons = new Map((d.lessons || []).map((l) => [l.id, l]));
  const teachers = new Map((d.teachers || []).map((t) => [t.id, t.name]));
  const records = new Map((d.records || []).map((r) => [r.homeworkId, r]));
  return (d.homeworks || []).map((hw) => {
    const lesson = lessons.get(hw.lessonId) || {};
    const rec = records.get(hw.id) || {};
    const text = stripHtml(hw.text || '');
    const { title } = splitTitle(text);
    const description = [text, stripHtml(hw.remark || '')].filter(Boolean).join('\n\n');
    return {
      id: `webuntis:hw:${hw.id}`,
      type: 'homework',
      title: title || 'Hausübung',
      description: description !== title ? description : '',
      subject: lesson.subject || '',
      teacher: teachers.get(rec.teacherId) || '',
      due: untisToMs(hw.dueDate),
      allDay: true,
      assigned: untisToMs(hw.date),
      status: hw.completed ? 'done' : 'open',
      attachments: Array.isArray(hw.attachments) ? hw.attachments.length : 0
    };
  });
}

function parseExams(json, { personId } = {}) {
  const list = (json && json.data && json.data.exams) || (json && json.exams) || [];
  return list
    .filter((e) => {
      if (!personId || !Array.isArray(e.assignedStudents) || e.assignedStudents.length === 0) return true;
      return e.assignedStudents.some((s) => s.id === personId);
    })
    .map((e) => {
      const hasTime = e.startTime !== undefined && e.startTime !== null && e.startTime !== 0;
      const name = String(e.name || '').trim();
      const title = name || [e.examType || 'Prüfung', e.subject].filter(Boolean).join(' ');
      return {
        id: `webuntis:exam:${e.id}`,
        type: 'exam',
        title,
        examType: e.examType || '',
        subject: e.subject || '',
        teacher: (e.teachers || []).join(', '),
        room: (e.rooms || []).join(', '),
        start: untisToMs(e.examDate, hasTime ? e.startTime : undefined),
        end: hasTime && e.endTime ? untisToMs(e.examDate, e.endTime) : null,
        due: untisToMs(e.examDate, hasTime ? e.startTime : undefined),
        allDay: !hasTime,
        description: stripHtml(e.text || ''),
        grade: e.grade ? String(e.grade) : '',
        status: 'open'
      };
    });
}

function parseTimetable(json, personId) {
  const data = json && json.data && json.data.result && json.data.result.data;
  if (!data) return [];
  const elements = new Map((data.elements || []).map((el) => [`${el.type}:${el.id}`, el]));
  const periodsById = data.elementPeriods || {};
  const periods = periodsById[personId] || periodsById[String(personId)] || Object.values(periodsById)[0] || [];
  return periods
    .map((p) => {
      const named = (type) =>
        (p.elements || [])
          .filter((e) => e.type === type)
          .map((e) => elements.get(`${type}:${e.id}`))
          .filter(Boolean);
      const subject = named(PERSON_TYPES.SUBJECT)[0];
      const state = String(p.cellState || '');
      return {
        id: p.id,
        start: untisToMs(p.date, p.startTime),
        end: untisToMs(p.date, p.endTime),
        subject: (subject && subject.name) || p.lessonText || '',
        subjectLong: (subject && subject.longName) || '',
        teacher: named(PERSON_TYPES.TEACHER).map((t) => t.name).join(', '),
        room: named(PERSON_TYPES.ROOM).map((r) => r.name).join(', '),
        cancelled: /CANCEL/i.test(state) || Boolean(p.is && p.is.cancelled),
        changed: /SUBST|ADDITIONAL|SHIFT|ROOMSUBST/i.test(state),
        exam: /EXAM/i.test(state) || Boolean(p.is && p.is.exam),
        info: [p.lessonText, p.substText, p.periodText].filter(Boolean).join(' · ')
      };
    })
    .filter((l) => l.start)
    .sort((a, b) => a.start - b.start);
}

/** Liest den Link aus dem Untis-Mobile-QR-Code: untis://setschool?url=…&school=…&user=…&key=… */
function parseUntisLink(text) {
  const m = String(text || '').match(/untis:\/\/setschool\?([^\s"'<>]+)/i);
  if (!m) return null;
  const p = new URLSearchParams(m[1].replace(/&amp;/g, '&'));
  const key = p.get('key');
  if (!key) return null;
  return { server: p.get('url') || '', school: p.get('school') || '', user: p.get('user') || '', key };
}

// ---------------------------------------------------------------- Netzwerk

function baseUrl(s) {
  const raw = String(s.server || '').trim();
  // "http://" nur für lokale Testserver, sonst immer https
  const scheme = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(raw) ? 'http' : 'https';
  const server = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!server || !s.school) throw new ConfigError('WebUntis-Server oder Schulname fehlt (Plattformen → WebUntis).');
  return { server, origin: `${scheme}://${server}`, base: `${scheme}://${server}/WebUntis`, school: String(s.school).trim() };
}

async function setCookie(cfg, name, value) {
  const secure = cfg.origin.startsWith('https:');
  await webSession().cookies.set({ url: `${cfg.origin}/WebUntis`, name, value, path: '/WebUntis', secure });
}

function rpcBody(method, params) {
  return JSON.stringify({ id: 'schulradar', method, params, jsonrpc: '2.0' });
}

async function loginWithKey(ctx, cfg, username, key) {
  const { base, school } = cfg;
  const url = `${base}/jsonrpc_intern.do?m=getUserData2017&school=${encodeURIComponent(school)}&v=i2.2`;
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rpcBody('getUserData2017', [{ auth: { clientTime: Date.now(), user: username, otp: totp(key) } }])
  });
  if (res.error) {
    ctx.log(`Schlüssel-Anmeldung abgelehnt: ${res.error.message || JSON.stringify(res.error)}`);
    throw new LoginRequiredError('WebUntis: Benutzername oder Schlüssel stimmt nicht.');
  }
  const ud = (res.result && res.result.userData) || {};
  ctx.sample('getUserData2017', { userData: { elemType: ud.elemType, elemId: ud.elemId, klassenIds: ud.klassenIds } });
  return {
    personId: ud.elemId || null,
    personType: ud.elemType === 'STUDENT' ? PERSON_TYPES.STUDENT : null,
    klasseId: Array.isArray(ud.klassenIds) && ud.klassenIds.length ? ud.klassenIds[0] : null,
    server: cfg.server
  };
}

async function loginWithPassword(ctx, cfg, username, password) {
  const { base, school } = cfg;
  const res = await fetchJson(`${base}/jsonrpc.do?school=${encodeURIComponent(school)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rpcBody('authenticate', { user: username, password, client: 'Schulradar' })
  });
  const r = res.result || {};
  if (res.error || !r.sessionId) {
    ctx.log(`Passwort-Anmeldung abgelehnt: ${JSON.stringify(res.error || r)}`);
    throw new LoginRequiredError('WebUntis: Benutzername oder Passwort stimmt nicht.');
  }
  await setCookie(cfg, 'JSESSIONID', r.sessionId);
  return { personId: r.personId || null, personType: r.personType || null, klasseId: r.klasseId || null, server: cfg.server };
}

async function personFromSession(ctx, base) {
  const out = {};
  try {
    const cfg = await fetchJson(`${base}/api/app/config`);
    const user = cfg && cfg.data && cfg.data.loginServiceConfig && cfg.data.loginServiceConfig.user;
    if (user) {
      out.personId = user.personId;
      const p = (user.persons || []).find((x) => x.id === user.personId);
      out.personType = p ? p.type : null;
    }
  } catch (err) {
    ctx.log(`app/config: ${err.message}`);
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) throw new LoginRequiredError();
  }
  try {
    const dt = await fetchJson(`${base}/api/daytimetable/config`);
    if (dt && dt.data && dt.data.klasseId) out.klasseId = dt.data.klasseId;
  } catch (_) {
    /* optional */
  }
  return out;
}

async function ensureSession(ctx) {
  const cfg = baseUrl(ctx.settings);
  await setCookie(cfg, 'schoolname', `"_${Buffer.from(cfg.school).toString('base64')}"`);
  const username = String(ctx.settings.username || '').trim();
  const key = ctx.secrets.get('key');
  const password = ctx.secrets.get('password');
  let info = {};
  if (ctx.settings.authMode === 'password' && username && password) {
    info = await loginWithPassword(ctx, cfg, username, password);
  } else if (username && key) {
    info = await loginWithKey(ctx, cfg, username, key);
  } else if (username && password) {
    info = await loginWithPassword(ctx, cfg, username, password);
  }
  if (!info.personId || !info.klasseId) info = { ...(await personFromSession(ctx, cfg.base)), ...stripEmpty(info) };
  if (!info.personId) {
    throw new LoginRequiredError('WebUntis: Bitte Benutzername und Untis-Mobile-Schlüssel eintragen (Plattformen → WebUntis).');
  }
  return { ...cfg, ...info };
}

function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

async function getRest(ctx, url) {
  try {
    return await fetchJson(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) throw new LoginRequiredError();
    throw err;
  }
}

async function fetchTimetableWeek(ctx, sess, weekStart) {
  const type = sess.personType || PERSON_TYPES.STUDENT;
  const url = `${sess.base}/api/public/timetable/weekly/data?elementType=${type}&elementId=${sess.personId}&date=${toIsoDate(weekStart)}&formatId=1`;
  const json = await getRest(ctx, url);
  return parseTimetable(json, sess.personId);
}

let cachedSession = null;

const connector = {
  id: 'webuntis',
  name: 'WebUntis',
  color: '#E8710A',
  description: 'Hausübungen und Prüfungstermine (Tests, Schularbeiten) – auf Wunsch mit Stundenplan.',

  origins(s) {
    try {
      return [baseUrl(s).origin];
    } catch (_) {
      return [];
    }
  },

  loginUrl(s) {
    const { origin, school } = baseUrl(s);
    return `${origin}/WebUntis/?school=${encodeURIComponent(school)}`;
  },

  isConfigured(s, secrets) {
    return Boolean(s.username && (secrets.has('key') || secrets.has('password')));
  },

  async sync(ctx) {
    const sess = await ensureSession(ctx);
    cachedSession = { sess, at: Date.now() };
    ctx.log(`Angemeldet (Person ${sess.personId}, Klasse ${sess.klasseId || '?'})`);
    const items = [];

    // Hausübungen – in 4-Wochen-Blöcken abfragen, lange Zeiträume lehnen manche Server ab
    const homeworks = new Map();
    for (let from = ctx.range.from; from < ctx.range.to; from = addDays(from, 28)) {
      const to = Math.min(addDays(from, 27), ctx.range.to);
      const json = await getRest(ctx, `${sess.base}/api/homeworks/lessons?startDate=${toUntisDate(from)}&endDate=${toUntisDate(to)}`);
      if (from === ctx.range.from) ctx.sample('homeworks', json);
      for (const hw of parseHomeworks(json)) homeworks.set(hw.id, hw);
    }
    items.push(...homeworks.values());

    // Prüfungen
    try {
      const klasse = sess.klasseId || -1;
      const json = await getRest(
        ctx,
        `${sess.base}/api/exams?startDate=${toUntisDate(ctx.range.from)}&endDate=${toUntisDate(ctx.range.to)}&klasseId=${klasse}&withGrades=true`
      );
      ctx.sample('exams', json);
      items.push(...parseExams(json, { personId: sess.personId }));
    } catch (err) {
      if (err instanceof LoginRequiredError) throw err;
      ctx.log(`Prüfungen konnten nicht geladen werden: ${err.message}`);
    }

    const link = `${sess.origin}/WebUntis/?school=${encodeURIComponent(sess.school)}`;
    for (const it of items) it.url = link;

    // Stundenplan dieser und nächster Woche vorab laden
    const timetable = {};
    if (ctx.global.showTimetable) {
      for (const offset of [0, 7]) {
        const ws = startOfWeek(Date.now() + offset * DAY);
        try {
          timetable[toIsoDate(ws)] = await fetchTimetableWeek(ctx, sess, ws);
        } catch (err) {
          ctx.log(`Stundenplan ${toIsoDate(ws)}: ${err.message}`);
        }
      }
    }
    return { items, timetable };
  },

  async timetable(ctx, weekStart) {
    // Beim Blättern in der Wochenansicht nicht jedes Mal neu anmelden
    const cfg = baseUrl(ctx.settings);
    const fresh = cachedSession && Date.now() - cachedSession.at < 4 * 60 * 1000 && cachedSession.sess.base === cfg.base;
    if (fresh) {
      try {
        return await fetchTimetableWeek(ctx, cachedSession.sess, weekStart);
      } catch (err) {
        if (!(err instanceof LoginRequiredError)) throw err;
      }
    }
    const sess = await ensureSession(ctx);
    cachedSession = { sess, at: Date.now() };
    return fetchTimetableWeek(ctx, sess, weekStart);
  },

  /** Im Anmeldefenster nach dem Untis-Mobile-QR-Link suchen und Schlüssel automatisch übernehmen. */
  async onLoginPage(ctx, win) {
    const text = await win.webContents
      .executeJavaScript(
        `(() => { const h = document.documentElement.innerHTML; const m = h.match(/untis:\\/\\/setschool\\?[^"'<>\\s]+/); return m ? m[0] : null; })()`,
        true
      )
      .catch(() => null);
    const info = parseUntisLink(text);
    if (!info) return null;
    ctx.saveSettings({ username: info.user, authMode: 'key', ...(info.server ? { server: info.server } : {}), ...(info.school ? { school: info.school } : {}) });
    ctx.secrets.set('key', info.key);
    return { done: true, message: 'Untis-Mobile-Schlüssel übernommen.' };
  },

  async logout(ctx) {
    cachedSession = null;
    ctx.secrets.set('key', null);
    ctx.secrets.set('password', null);
    await clearOrigins(this.origins(ctx.settings));
  }
};

module.exports = connector;
module.exports.parseHomeworks = parseHomeworks;
module.exports.parseExams = parseExams;
module.exports.parseTimetable = parseTimetable;
module.exports.parseUntisLink = parseUntisLink;
