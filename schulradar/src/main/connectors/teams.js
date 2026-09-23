'use strict';
// MS Teams: Aufgaben aus der Teams-App "Aufgaben" (Assignments).
//
// Modus "web" (Standard): Die App öffnet Teams unsichtbar in der gemeinsamen Browser-Sitzung und liest
//   die Aufgaben-Daten mit, die die Teams-Seite selbst lädt. Braucht keine Freigabe durch die Schul-IT.
// Modus "graph": Offizielle Microsoft-Graph-Schnittstelle. Nur möglich, wenn die Schul-IT eine
//   App-Registrierung freigegeben hat (Client-ID in den Einstellungen eintragen).
const presets = require('../presets');
const { withHiddenWindow, captureJson, loadUrl, evalIn, sleep, fetchJson, clearOrigins } = require('../web');
const { LoginRequiredError, ConfigError, stripHtml } = require('./base');

const SUBMISSION_STATES = new Set(['working', 'submitted', 'returned', 'reassigned', 'excused']);
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPES = 'offline_access User.Read EduAssignments.ReadBasic EduRoster.ReadBasic';

// ---------------------------------------------------------------- Parser (testbar)

function firstString(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

/** Sucht in beliebigen JSON-Antworten nach Aufgaben, Klassen und Abgabe-Status. */
function extractAssignments(docs) {
  const assignments = new Map();
  const classes = new Map();
  const submissions = new Map();

  const walk = (node, parentAssignment) => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, parentAssignment);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const title = firstString(node.displayName, node.title, node.assignmentTitle);
    const due = node.dueDateTime || node.dueDate || node.dueDateTimeUtc || null;
    const id = node.id || node.assignmentId || null;
    const odataType = String(node['@odata.type'] || '');
    let current = parentAssignment;

    const looksLikeAssignment = title && due && id && !/submission/i.test(odataType);
    if (looksLikeAssignment) {
      const prev = assignments.get(id) || {};
      const instructions = node.instructions && typeof node.instructions === 'object' ? node.instructions.content : node.instructions;
      assignments.set(id, {
        ...prev,
        id,
        title,
        due,
        classId: node.classId || prev.classId || null,
        className: firstString(node.className, node.classDisplayName, prev.className),
        instructions: firstString(instructions, prev.instructions),
        webUrl: firstString(node.webUrl, prev.webUrl),
        assignStatus: firstString(node.status, prev.assignStatus),
        maxPoints: (node.grading && node.grading.maxPoints) || prev.maxPoints || null
      });
      current = id;
    } else if (id && title && !due) {
      const isClass =
        /educationClass/i.test(odataType) ||
        node.classCode !== undefined ||
        node.externalName !== undefined ||
        (node.mailNickname !== undefined && node.description !== undefined);
      if (isClass) classes.set(id, title);
    }

    const state = typeof node.status === 'string' ? node.status.toLowerCase() : '';
    const looksLikeSubmission =
      SUBMISSION_STATES.has(state) &&
      (/submission/i.test(odataType) ||
        node.submittedDateTime !== undefined ||
        node.returnedDateTime !== undefined ||
        node.recipient !== undefined ||
        node.submittedBy !== undefined);
    if (looksLikeSubmission) {
      const target = node.assignmentId || parentAssignment;
      if (target) submissions.set(target, state);
    }

    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value, current);
  };

  for (const d of docs) walk(d, null);
  return { assignments: [...assignments.values()], classes, submissions };
}

function toItems({ assignments, classes, submissions }, { from = 0, link = '' } = {}) {
  const items = [];
  for (const a of assignments) {
    if (/^draft$/i.test(a.assignStatus || '')) continue;
    const due = Date.parse(a.due);
    if (!Number.isFinite(due)) continue;
    const sub = submissions.get(a.id) || '';
    let status = 'open';
    if (sub === 'submitted') status = 'submitted';
    else if (sub === 'returned') status = 'graded';
    else if (sub === 'excused') status = 'done';
    if (due < from && status !== 'open') continue;
    items.push({
      id: `teams:${a.id}`,
      type: 'assignment',
      title: a.title,
      description: stripHtml(a.instructions || ''),
      course: a.className || classes.get(a.classId) || '',
      subject: '',
      due,
      allDay: false,
      status,
      url: a.webUrl || link
    });
  }
  return items;
}

function isAssignmentApi(url) {
  if (!/^https:|^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)) return false;
  if (/\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)/i.test(url)) return false;
  if (/telemetry|browser\.events|\/aria|collector|\/ping|\/trace/i.test(url)) return false;
  return /assignments\.onenote\.com|\/education\/|\/edu\/|assignment/i.test(url);
}

// ---------------------------------------------------------------- Webansicht

/** Klickt auf "Stattdessen die Web-App verwenden" o. Ä., falls Teams danach fragt. */
function clickWebAppButton() {
  const re = /(web[- ]?app|im browser|use the web app|stattdessen)/i;
  const els = Array.from(document.querySelectorAll('a,button,[role=button]'));
  const el = els.find((e) => re.test(e.innerText || e.textContent || ''));
  if (el) {
    el.click();
    return true;
  }
  return false;
}

async function syncWeb(ctx) {
  const docs = [];
  let lastData = 0;
  const target = String(ctx.settings.url || presets.teams.url);
  return withHiddenWindow(async (win) => {
    const stop = await captureJson(win, {
      match: isAssignmentApi,
      onJson: (url, json) => {
        docs.push(json);
        lastData = Date.now();
        ctx.log(`Daten empfangen: ${url.split('?')[0]}`);
        if (docs.length <= 4) ctx.sample(`antwort_${docs.length}`, { url: url.split('?')[0], json });
      }
    });
    try {
      ctx.log('Öffne Teams im Hintergrund …');
      await loadUrl(win, target, 60000);
      ctx.log(`Seite geladen: ${win.webContents.getURL().split('?')[0]}`);
      const started = Date.now();
      let loginSince = 0;
      let clicks = 0;
      while (Date.now() - started < 100000) {
        await sleep(1500);
        if (win.isDestroyed()) break;
        const url = win.webContents.getURL();
        if (/login\.microsoftonline\.com|login\.live\.com|login\.windows\.net|\/oauth2\//i.test(url)) {
          loginSince = loginSince || Date.now();
          if (Date.now() - loginSince > 15000) throw new LoginRequiredError('Teams: Bitte bei Microsoft anmelden.');
          continue;
        }
        loginSince = 0;
        if (clicks < 3 && (await evalIn(win, clickWebAppButton))) clicks++;
        if (docs.length && Date.now() - lastData > 7000) break;
      }
    } finally {
      stop();
    }
    if (!docs.length) {
      throw new Error('Teams: Keine Aufgaben-Daten gefunden. Bitte unter Plattformen → Teams „Anmelden“ wählen und in Teams einmal „Aufgaben“ öffnen.');
    }
    const parsed = extractAssignments(docs);
    ctx.log(`${parsed.assignments.length} Aufgaben in ${docs.length} Antworten gefunden.`);
    return { items: toItems(parsed, { from: ctx.range.from, link: target }) };
  });
}

// ---------------------------------------------------------------- Microsoft Graph (optional)

function tokenUrl(s, kind) {
  const tenant = String(s.tenant || presets.teams.tenant || 'organizations').trim();
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/${kind}`;
}

async function postForm(url, params) {
  return fetchJson(url, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  }).catch((err) => {
    if (err.body) {
      try {
        return JSON.parse(err.body);
      } catch (_) {
        /* weiter werfen */
      }
    }
    throw err;
  });
}

async function graphToken(ctx) {
  const clientId = String(ctx.settings.clientId || '').trim();
  if (!clientId) throw new ConfigError('Teams (Graph): Client-ID fehlt.');
  const saved = ctx.secrets.get('graph') || {};
  if (saved.access && saved.expires > Date.now() + 60000) return saved.access;
  if (!saved.refresh) throw new LoginRequiredError('Teams: Bitte „Mit Microsoft verbinden“ wählen.');
  const res = await postForm(tokenUrl(ctx.settings, 'token'), {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: saved.refresh,
    scope: GRAPH_SCOPES
  });
  if (!res.access_token) {
    ctx.secrets.set('graph', null);
    throw new LoginRequiredError(`Teams: Verbindung abgelaufen (${res.error || 'unbekannt'}).`);
  }
  ctx.secrets.set('graph', {
    access: res.access_token,
    refresh: res.refresh_token || saved.refresh,
    expires: Date.now() + (res.expires_in || 3600) * 1000
  });
  return res.access_token;
}

/** Startet die Anmeldung mit Gerätecode. onCode({userCode, verificationUri, message}) */
async function graphConnect(ctx, onCode) {
  const clientId = String(ctx.settings.clientId || '').trim();
  if (!clientId) throw new ConfigError('Bitte zuerst die Client-ID eintragen.');
  const dc = await postForm(tokenUrl(ctx.settings, 'devicecode'), { client_id: clientId, scope: GRAPH_SCOPES });
  if (!dc.device_code) throw new Error(`Microsoft lehnt ab: ${dc.error_description || dc.error || 'unbekannter Fehler'}`);
  onCode({ userCode: dc.user_code, verificationUri: dc.verification_uri, message: dc.message });
  const until = Date.now() + (dc.expires_in || 900) * 1000;
  let interval = (dc.interval || 5) * 1000;
  while (Date.now() < until) {
    await sleep(interval);
    const res = await postForm(tokenUrl(ctx.settings, 'token'), {
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: dc.device_code
    });
    if (res.access_token) {
      ctx.secrets.set('graph', {
        access: res.access_token,
        refresh: res.refresh_token,
        expires: Date.now() + (res.expires_in || 3600) * 1000
      });
      return true;
    }
    if (res.error === 'slow_down') interval += 5000;
    else if (res.error !== 'authorization_pending') {
      throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${res.error_description || res.error}`);
    }
  }
  throw new Error('Der Code ist abgelaufen. Bitte erneut verbinden.');
}

async function syncGraph(ctx) {
  const token = await graphToken(ctx);
  const get = async (url) => {
    try {
      return await fetchJson(url, { credentials: 'omit', headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      if (err.status === 401) throw new LoginRequiredError('Teams: Verbindung abgelaufen.');
      if (err.status === 403) throw new Error('Teams (Graph): Zugriff verweigert – die Schul-IT muss die App freigeben.');
      throw err;
    }
  };
  const docs = [];
  let url = `${GRAPH}/education/me/assignments?$expand=submissions&$top=100`;
  let triedPlain = false;
  for (let page = 0; url && page < 20; page++) {
    let res;
    try {
      res = await get(url);
    } catch (err) {
      if (!triedPlain && err.status === 400) {
        triedPlain = true;
        url = `${GRAPH}/education/me/assignments?$top=100`;
        continue;
      }
      throw err;
    }
    if (page === 0) ctx.sample('graph_assignments', res);
    docs.push(res);
    url = res['@odata.nextLink'];
  }
  try {
    docs.push(await get(`${GRAPH}/education/me/classes`));
  } catch (err) {
    if (err instanceof LoginRequiredError) throw err;
    ctx.log(`Klassen: ${err.message}`);
  }
  return { items: toItems(extractAssignments(docs), { from: ctx.range.from, link: 'https://teams.microsoft.com/' }) };
}

const connector = {
  id: 'teams',
  name: 'MS Teams',
  color: '#6264A7',
  description: 'Aufgaben aus der Teams-App „Aufgaben“ mit Abgabestatus.',

  origins() {
    return ['https://teams.microsoft.com', 'https://teams.cloud.microsoft', 'https://assignments.onenote.com'];
  },

  loginUrl(s) {
    return String(s.url || presets.teams.url);
  },

  isConfigured(s, secrets) {
    return s.mode === 'graph' ? secrets.has('graph') : true;
  },

  async sync(ctx) {
    if (ctx.settings.mode === 'graph') return syncGraph(ctx);
    return syncWeb(ctx);
  },

  graphConnect,

  async logout(ctx) {
    ctx.secrets.set('graph', null);
    await clearOrigins(this.origins(ctx.settings));
  }
};

module.exports = connector;
module.exports.extractAssignments = extractAssignments;
module.exports.toItems = toItems;
module.exports.isAssignmentApi = isAssignmentApi;
