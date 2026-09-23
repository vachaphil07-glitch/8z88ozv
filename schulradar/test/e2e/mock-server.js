'use strict';
// Nachgebaute Schul-Plattformen für den Ende-zu-Ende-Test (nur lokal, keine echten Daten).
const http = require('http');
const crypto = require('crypto');
const { totp } = require('../../src/main/util/totp');
const { toUntisDate, addDays, startOfDay, startOfWeek } = require('../../src/main/util/dates');

const WEBUNTIS = { user: 'MaxM', secret: 'JBSWY3DPEHPK3PXP', school: 'htl-hl', session: 'wu-session-1' };
const MOODLE = { token: crypto.createHash('md5').update('moodle-token').digest('hex'), session: 'ok' };
const LETTO = { user: 'max', pass: 'geheim' };

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p[0])
      .map(([k, ...v]) => [k, v.join('=')])
  );
}

function body(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function json(res, data, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function html(res, markup, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${markup}</body></html>`);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

const log = [];

function webuntis(req, res, url, raw, now) {
  const today = startOfDay(now);
  if (url.pathname === '/WebUntis/jsonrpc_intern.do' && req.method === 'POST') {
    const rpc = JSON.parse(raw || '{}');
    const auth = (rpc.params && rpc.params[0] && rpc.params[0].auth) || {};
    const valid = [totp(WEBUNTIS.secret, now), totp(WEBUNTIS.secret, now - 30000)].includes(String(auth.otp));
    if (url.searchParams.get('school') !== WEBUNTIS.school || auth.user !== WEBUNTIS.user || !valid) {
      return json(res, { jsonrpc: '2.0', id: rpc.id, error: { code: -8504, message: 'bad credentials' } });
    }
    return json(
      res,
      { jsonrpc: '2.0', id: rpc.id, result: { userData: { elemType: 'STUDENT', elemId: 5, klassenIds: [77], displayName: 'Max M' } } },
      200,
      { 'Set-Cookie': `JSESSIONID=${WEBUNTIS.session}; Path=/WebUntis; HttpOnly` }
    );
  }
  const c = cookies(req);
  const schoolCookie = `"_${Buffer.from(WEBUNTIS.school).toString('base64')}"`;
  if (c.JSESSIONID !== WEBUNTIS.session || c.schoolname !== schoolCookie) {
    log.push(`webuntis 401 ${url.pathname} cookies=${req.headers.cookie}`);
    return json(res, { error: 'not authenticated' }, 401);
  }
  if (url.pathname === '/WebUntis/api/homeworks/lessons') {
    return json(res, {
      data: {
        records: [{ homeworkId: 1, teacherId: 7 }],
        homeworks: [
          { id: 1, lessonId: 10, date: Number(toUntisDate(addDays(today, -2))), dueDate: Number(toUntisDate(addDays(today, 1))), text: 'Buch S. 84, Aufgaben 3–7', remark: '', completed: false, attachments: [] },
          { id: 2, lessonId: 11, date: Number(toUntisDate(addDays(today, -3))), dueDate: Number(toUntisDate(addDays(today, -1))), text: 'Vokabeln Unit 4', remark: '', completed: true, attachments: [] }
        ],
        teachers: [{ id: 7, name: 'HUB' }],
        lessons: [
          { id: 10, subject: 'AM' },
          { id: 11, subject: 'E' }
        ]
      }
    });
  }
  if (url.pathname === '/WebUntis/api/exams') {
    if (url.searchParams.get('klasseId') !== '77') return json(res, { data: { exams: [] } });
    return json(res, {
      data: {
        exams: [
          { id: 900, examType: 'Schularbeit', name: '', subject: 'AM', teachers: ['HUB'], rooms: ['R204'], examDate: Number(toUntisDate(addDays(today, 6))), startTime: 800, endTime: 940, text: 'Vektoren', assignedStudents: [{ id: 5 }] },
          { id: 901, examType: 'Test', name: 'Fremde Prüfung', subject: 'D', examDate: Number(toUntisDate(addDays(today, 3))), startTime: 1000, endTime: 1050, assignedStudents: [{ id: 99 }] }
        ]
      }
    });
  }
  if (url.pathname === '/WebUntis/api/public/timetable/weekly/data') {
    const monday = startOfWeek(now);
    const periods = [];
    for (let d = 0; d < 5; d++) {
      periods.push({ id: 100 + d, date: Number(toUntisDate(addDays(monday, d))), startTime: 800, endTime: 850, elements: [{ type: 3, id: 30 }, { type: 4, id: 40 }], cellState: d === 2 ? 'CANCEL' : 'STANDARD' });
    }
    return json(res, {
      data: {
        result: {
          data: {
            elementPeriods: { [url.searchParams.get('elementId')]: periods },
            elements: [
              { type: 3, id: 30, name: 'AM', longName: 'Angewandte Mathematik' },
              { type: 4, id: 40, name: 'R204' }
            ]
          }
        }
      }
    });
  }
  return json(res, { error: 'unbekannt' }, 404);
}

function moodle(req, res, url, raw, now) {
  const p = url.pathname.replace(/^\/moodle/, '');
  if (p === '/admin/tool/mobile/launch.php') {
    if (cookies(req).MoodleSession !== MOODLE.session) return redirect(res, '/moodle/login/index.php');
    const passport = url.searchParams.get('passport');
    const sig = crypto.createHash('md5').update(`http://localhost/moodle${passport}`).digest('hex');
    const token = Buffer.from(`${sig}:::${MOODLE.token}:::privat`).toString('base64');
    res.writeHead(303, { Location: `moodlemobile://token=${token}` });
    return res.end();
  }
  if (p === '/login/index.php') return html(res, '<form method="post"><input name="username"><input type="password" name="password"><button id="loginbtn">Login</button></form>');
  if (p === '/webservice/rest/server.php' && req.method === 'POST') {
    const form = new URLSearchParams(raw);
    if (form.get('wstoken') !== MOODLE.token) return json(res, { exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
    const fn = url.searchParams.get('wsfunction');
    const course = { id: 42, fullname: 'Datenbanken 4AHIT', shortname: 'DBI' };
    const ts = (days, h) => Math.floor((startOfDay(now) + days * 86400000 + h * 3600000) / 1000);
    const pendingEvent = { id: 501, name: 'SQL-Übungsblatt 2 ist fällig', activityname: 'SQL-Übungsblatt 2', modulename: 'assign', eventtype: 'due', timesort: ts(1, 18), timestart: ts(1, 18), course, action: { name: 'Abgabe hinzufügen', url: 'http://localhost/moodle/mod/assign/view.php?id=9', actionable: true } };
    if (fn === 'core_calendar_get_action_events_by_timesort') return json(res, { events: [pendingEvent], firstid: 501, lastid: 501 });
    if (fn === 'core_calendar_get_calendar_monthly_view') {
      const month = Number(form.get('month'));
      const current = new Date(now).getMonth() + 1;
      if (month !== current) return json(res, { weeks: [] });
      return json(res, {
        weeks: [
          {
            days: [
              { events: [pendingEvent, { id: 502, name: 'Lesetagebuch ist fällig', modulename: 'assign', eventtype: 'due', timestart: ts(2, 20), course }] },
              { events: [{ id: 503, name: 'Exkursion', eventtype: 'course', timestart: ts(3, 8), course }] }
            ]
          }
        ]
      });
    }
    return json(res, { exception: 'x', errorcode: 'unknownfunction', message: fn });
  }
  return html(res, 'nicht gefunden', 404);
}

const LETTO_DASHBOARD = `
<div id="app">Lade …</div>
<script>
  const started = [
    ['16. Hausübung - Mag. Feld Grundlagen', '14. Jan. 2026', '__DUE1__', 'AT1', '45%'],
    ['12. Hausübung - Getriebe', '14. Jan. 2026', '__DUE2__', 'AT1', '5%']
  ];
  const notStarted = [['1. Übung', '14. Jan. 2026', '__DUE3__', 'AM', '0%']];
  function table(rows) {
    return '<table class="v-table"><thead><tr><th>Aktivitätsname</th><th>Start</th><th>Abgabe</th><th>Fach</th><th>%</th><th></th></tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '<td>›</td></tr>').join('') + '</tbody></table>';
  }
  function show(rows) {
    document.getElementById('app').innerHTML =
      '<button id="open">OFFENE AKTIVITÄTEN</button> <button id="new">NICHT GESTARTETE AKTIVITÄTEN</button>' + table(rows);
    document.getElementById('open').onclick = () => setTimeout(() => show(started), 300);
    document.getElementById('new').onclick = () => setTimeout(() => show(notStarted), 300);
  }
  setTimeout(() => show(started), 800);
</script>`;

function fmtLetto(ms) {
  const m = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}. ${m[d.getMonth()]} ${d.getFullYear()}`;
}

async function letto(req, res, url, raw, now) {
  const p = url.pathname.replace(/^\/letto/, '') || '/';
  const loggedIn = cookies(req).letto === 'ok';
  if (p === '/login' && req.method === 'POST') {
    const form = new URLSearchParams(raw);
    if (form.get('username') === LETTO.user && form.get('password') === LETTO.pass) {
      return redirect(res, '/letto/dashboard', { 'Set-Cookie': 'letto=ok; Path=/letto' });
    }
    return redirect(res, '/letto/');
  }
  if (p === '/dashboard') {
    if (!loggedIn) return redirect(res, '/letto/');
    const today = startOfDay(now);
    return html(
      res,
      LETTO_DASHBOARD.replace('__DUE1__', fmtLetto(addDays(today, 2))).replace('__DUE2__', fmtLetto(addDays(today, 9))).replace('__DUE3__', fmtLetto(addDays(today, 5)))
    );
  }
  if (loggedIn) return redirect(res, '/letto/dashboard');
  return html(res, '<h1>LeTTo Login</h1><form method="post" action="/letto/login"><input type="text" name="username"><input type="password" name="password"><button type="submit">Anmelden</button></form>');
}

function teams(req, res, url, raw, now, port) {
  if (url.pathname === '/teams/app') {
    return html(res, `<h1>Teams</h1><iframe src="http://127.0.0.1:${port}/assignments/app" width="800" height="400"></iframe>`);
  }
  if (url.pathname === '/assignments/app') {
    return html(res, `<div id="list">Lade Aufgaben …</div><script>
      fetch('/api/v1.0/edu/me/assignments?$expand=submissions').then(r => r.json()).then(d => {
        document.getElementById('list').textContent = d.value.length + ' Aufgaben';
      });
    </script>`);
  }
  if (url.pathname === '/api/v1.0/edu/me/assignments') {
    const iso = (days, h) => new Date(startOfDay(now) + days * 86400000 + h * 3600000).toISOString();
    return json(res, {
      value: [
        { id: 'a1', classId: 'c1', className: '4AHIT SEW', displayName: 'Projektdokumentation Kapitel 2', dueDateTime: iso(0, 23.9), status: 'assigned', submissions: [{ id: 's1', status: 'working', recipient: {} }] },
        { id: 'a2', classId: 'c2', className: '4AHIT DBI', displayName: 'Präsentation Datenbanken', dueDateTime: iso(-2, 23), status: 'assigned', submissions: [{ id: 's2', status: 'submitted', submittedDateTime: iso(-3, 12), recipient: {} }] }
      ]
    });
  }
  return null;
}

function start(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const raw = await body(req);
    const now = Date.now();
    log.push(`${req.method} ${url.pathname}`);
    try {
      if (url.pathname.startsWith('/WebUntis/')) return webuntis(req, res, url, raw, now);
      if (url.pathname.startsWith('/moodle/')) return moodle(req, res, url, raw, now);
      if (url.pathname.startsWith('/letto')) return await letto(req, res, url, raw, now);
      if (teams(req, res, url, raw, now, server.address().port) !== null) return;
      if (!res.headersSent) html(res, 'nicht gefunden', 404);
    } catch (err) {
      json(res, { error: String(err) }, 500);
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ port: server.address().port, close: () => server.close(), log })));
}

module.exports = { start, WEBUNTIS, MOODLE, LETTO };

if (require.main === module) start(Number(process.argv[2]) || 8765).then((s) => console.log(`Mock-Server auf Port ${s.port}`));
