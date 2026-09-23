'use strict';
// MS Teams: Aufgaben aus der Teams-App "Aufgaben" (Assignments).
//
// Modus "web" (Standard): Die App öffnet Teams unsichtbar in der gemeinsamen Browser-Sitzung und liest
//   die Aufgaben-Daten mit, die die Teams-Seite selbst lädt. Braucht keine Freigabe durch die Schul-IT.
// Modus "graph": Offizielle Microsoft-Graph-Schnittstelle. Nur möglich, wenn die Schul-IT eine
//   App-Registrierung freigegeben hat (Client-ID in den Einstellungen eintragen).
const presets = require('../presets');
const { withHiddenWindow, captureJson, loadUrl, evalIn, sleep, fetchJson, clearOrigins } = require('../platform');
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
  return /assignments\.onenote\.com|\/education\/|\/edu\/|assignment|zuweisung/i.test(url);
}

/** Welche Antworten werden mitgelesen? Aufgaben-Adressen immer, sonst jedes JSON (wird danach geprüft). */
function isCandidate(url, mime) {
  if (!/^https:|^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)) return false;
  if (/\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|html?)(\?|$)/i.test(url)) return false;
  if (/telemetry|browser\.events|\/aria|collector|\/ping|\/trace|presence|\/chatsvc\/|\/messages/i.test(url)) return false;
  return isAssignmentApi(url) || /json/i.test(mime || '');
}

/** Merkt sich gesehene Adressen (ohne Parameter) für die Diagnose. */
function urlTracker() {
  const seen = new Set();
  return {
    add(url, mime) {
      if (seen.size >= 150 || !/json|javascript|text\/plain/i.test(mime || '')) return;
      if (/json/i.test(mime)) seen.add(url.split('?')[0]);
    },
    list: () => [...seen]
  };
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

/** Öffnet in Teams links die App „Zuweisungen“ (Assignments). */
function clickAssignmentsApp(appId) {
  const visible = (e) => Boolean(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const byId = Array.from(document.querySelectorAll(`[data-tid*="${appId}"],[id*="${appId}"],[data-app-id*="${appId}"],[data-appid*="${appId}"]`)).find(visible);
  if (byId) {
    (byId.closest('button,[role=button],[role=tab],a') || byId).click();
    return 'app-id';
  }
  const re = /^(zuweisungen|assignments)\b/i;
  const els = Array.from(document.querySelectorAll('button,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],a')).filter(visible);
  const el = els.find((e) => re.test((e.getAttribute('aria-label') || '').trim()) || re.test((e.innerText || '').trim()) || re.test((e.title || '').trim()));
  if (el) {
    el.click();
    return 'text';
  }
  return null;
}

function pageInfo() {
  return { url: location.href.split('?')[0], title: document.title, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 300) };
}

// Daten, die beim Anmelden im sichtbaren Teams-Fenster mitgelesen wurden
let loginCapture = null;

function isLoginUrl(url) {
  return /login\.microsoftonline\.com|login\.live\.com|login\.windows\.net|login\.microsoft\.com|\/oauth2\//i.test(url);
}

async function syncWeb(ctx) {
  const target = String(ctx.settings.url || presets.teams.url);
  const appId = presets.teams.assignmentsAppId;

  // Frisch im Anmeldefenster mitgelesene Aufgaben direkt verwenden
  if (loginCapture && Date.now() - loginCapture.at < 15 * 60 * 1000) {
    const parsed = extractAssignments(loginCapture.docs);
    if (parsed.assignments.length) {
      loginCapture = null;
      ctx.log(`${parsed.assignments.length} Aufgaben aus dem Anmeldefenster übernommen.`);
      return { items: toItems(parsed, { from: ctx.range.from, link: target }) };
    }
  }

  const docs = [];
  let lastData = 0;
  const tracker = urlTracker();
  return withHiddenWindow(async (win) => {
    const stop = await captureJson(win, {
      match: isCandidate,
      onSeen: (url, mime) => tracker.add(url, mime),
      onJson: (url, json) => {
        const hasAssignments = extractAssignments([json]).assignments.length > 0;
        if (!hasAssignments && !isAssignmentApi(url)) return;
        docs.push(json);
        lastData = Date.now();
        ctx.log(`Daten empfangen: ${url.split('?')[0]}${hasAssignments ? ' (mit Aufgaben)' : ''}`);
        if (docs.length <= 4) ctx.sample(`antwort_${docs.length}`, { url: url.split('?')[0], json });
      }
    });
    let opened = null;
    try {
      ctx.log(`Öffne Teams im Hintergrund: ${target}`);
      await loadUrl(win, target, 60000);
      ctx.log(`Seite geladen: ${(await win.getURL()).split('?')[0]}`);
      const started = Date.now();
      let loginSince = 0;
      let clicks = 0;
      let appClicks = 0;
      let lastAppClick = 0;
      while (Date.now() - started < 120000) {
        await sleep(1500);
        if (win.isDestroyed()) break;
        const url = await win.getURL();
        if (isLoginUrl(url)) {
          loginSince = loginSince || Date.now();
          if (Date.now() - loginSince > 15000) throw new LoginRequiredError('Teams: Bitte unter Plattformen → MS Teams neu anmelden.');
          continue;
        }
        loginSince = 0;
        if (clicks < 3 && (await evalIn(win, clickWebAppButton))) clicks++;
        const found = extractAssignments(docs).assignments.length;
        // Teams lädt die Aufgaben erst, wenn "Zuweisungen" geöffnet ist
        if (!found && appClicks < 6 && Date.now() - lastAppClick > 8000 && Date.now() - started > 6000) {
          const how = await evalIn(win, clickAssignmentsApp, appId);
          if (how) {
            opened = how;
            appClicks++;
            lastAppClick = Date.now();
            ctx.log(`„Zuweisungen“ geöffnet (${how}).`);
          }
        }
        if (docs.length && Date.now() - lastData > 7000 && (found || Date.now() - started > 60000)) break;
      }
    } finally {
      stop();
      ctx.sample('gesehene_adressen', tracker.list());
      ctx.sample('seite', await evalIn(win, pageInfo));
    }
    const parsed = extractAssignments(docs);
    if (!docs.length) {
      ctx.log(`Keine Aufgaben-Daten. Zuweisungen-Knopf ${opened ? 'gefunden' : 'NICHT gefunden'}.`);
      throw new Error(
        opened
          ? 'Teams: „Zuweisungen“ wurde geöffnet, aber keine Aufgaben-Daten erkannt. Bitte unter Plattformen → MS Teams „Diagnose“ speichern und schicken.'
          : 'Teams: „Zuweisungen“ nicht gefunden. Bitte unter Plattformen → MS Teams „Anmelden“ wählen, links „Zuweisungen“ öffnen und das Fenster schließen.'
      );
    }
    ctx.log(`${parsed.assignments.length} Aufgaben in ${docs.length} Antworten gefunden.`);
    return { items: toItems(parsed, { from: ctx.range.from, link: target }) };
  });
}

/** Im sichtbaren Anmeldefenster mitlesen: Sobald „Zuweisungen“ geöffnet wird, sind die Aufgaben da. */
async function onLoginWindow(ctx, win, notify) {
  const docs = [];
  let announced = false;
  const tracker = urlTracker();
  const stop = await captureJson(win, {
    match: isCandidate,
    onSeen: (url, mime) => tracker.add(url, mime),
    onJson: (url, json) => {
      const hasAssignments = extractAssignments([json]).assignments.length > 0;
      if (!hasAssignments && !isAssignmentApi(url)) return;
      docs.push(json);
      loginCapture = { docs, at: Date.now() };
      ctx.log(`Anmeldefenster: Daten von ${url.split('?')[0]}${hasAssignments ? ' (mit Aufgaben)' : ''}`);
      if (docs.length <= 4) ctx.sample(`anmeldefenster_${docs.length}`, { url: url.split('?')[0], json });
      const count = extractAssignments(docs).assignments.length;
      if (count && !announced) {
        announced = true;
        notify(`Teams: ${count} Aufgaben gefunden – du kannst das Fenster jetzt schließen.`);
      }
    }
  });
  return () => {
    stop();
    ctx.sample('anmeldefenster_adressen', tracker.list());
  };
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
  description: 'Aufgaben aus „Zuweisungen“ (Assignments) mit Abgabestatus.',

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
  onLoginWindow,

  async logout(ctx) {
    ctx.secrets.set('graph', null);
    await clearOrigins(this.origins(ctx.settings));
  }
};

module.exports = connector;
module.exports.extractAssignments = extractAssignments;
module.exports.toItems = toItems;
module.exports.isAssignmentApi = isAssignmentApi;
module.exports.isCandidate = isCandidate;
module.exports.clickAssignmentsApp = clickAssignmentsApp;
