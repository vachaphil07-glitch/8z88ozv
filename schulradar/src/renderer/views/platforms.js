// Plattformen verbinden & verwalten
import { h, icon } from '../dom.js';
import * as L from '../logic.js';

const STATUS_TEXT = {
  ok: 'Verbunden',
  login: 'Anmeldung nötig',
  config: 'Einrichtung unvollständig',
  error: 'Fehler beim Abrufen',
  new: 'Noch nicht verbunden'
};

function draft(ctx, source) {
  return ctx.ui.drafts[source] || (ctx.ui.drafts[source] = {});
}

function field(ctx, source, name, { label, type = 'text', placeholder = '', value = '', hint = '', autocomplete = 'off' }) {
  const d = draft(ctx, source);
  const current = name in d ? d[name] : value;
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('input', {
      type,
      value: current,
      placeholder,
      autocomplete,
      spellcheck: 'false',
      dataset: { focusKey: `${source}.${name}` },
      oninput: (e) => {
        d[name] = e.target.value;
      }
    }),
    hint ? h('span', { class: 'field-hint' }, hint) : null
  );
}

function radio(ctx, source, name, options, current, onChange) {
  return h(
    'div',
    { class: 'radio-group', role: 'radiogroup' },
    options.map(([value, label, hint]) =>
      h(
        'label',
        { class: `radio ${current === value ? 'is-active' : ''}` },
        h('input', { type: 'radio', name: `${source}-${name}`, value, checked: current === value, onchange: () => onChange(value) }),
        h('span', { class: 'radio-dot' }),
        h('span', { class: 'radio-text' }, h('strong', {}, label), hint ? h('small', {}, hint) : null)
      )
    )
  );
}

function steps(...lines) {
  return h('ol', { class: 'steps' }, lines.map((l) => h('li', {}, l)));
}

function advanced(title, ...children) {
  return h('details', { class: 'advanced' }, h('summary', {}, title), h('div', { class: 'advanced-body' }, children));
}

function statusLine(ctx, p) {
  const s = ctx.state.sourceState[p.id] || {};
  const syncing = ctx.state.syncing.includes(p.id);
  const enabled = ctx.state.settings.platforms[p.id].enabled;
  let cls = s.status || 'new';
  if (!s.lastSync && (cls === 'login' || cls === 'config')) cls = 'new';
  let text = STATUS_TEXT[cls] || cls;
  if (!enabled) {
    cls = 'off';
    text = 'Ausgeschaltet';
  } else if (syncing) {
    cls = 'syncing';
    text = 'Wird abgerufen …';
  }
  const bits = [];
  if (enabled && s.lastSync) bits.push(`aktualisiert ${L.timeAgo(s.lastSync, ctx.now())}`);
  if (enabled && s.status === 'ok' && s.count !== undefined) bits.push(`${s.count} Einträge`);
  return h(
    'div',
    { class: `p-status p-status-${cls}` },
    h('span', { class: 'p-status-dot' }),
    h('strong', {}, text),
    bits.length ? h('span', { class: 'muted' }, ` · ${bits.join(' · ')}`) : null,
    enabled && s.message && s.status !== 'ok' && !syncing ? h('div', { class: 'p-status-msg' }, s.message) : null
  );
}

function saveButton(label, onclick, primary = true) {
  return h('button', { class: `btn ${primary ? 'btn-primary' : ''}`, onclick }, label);
}

// ---------------------------------------------------------------- Plattform-spezifische Bereiche

function webuntisBody(ctx, p) {
  const s = ctx.state.settings.platforms.webuntis;
  const d = draft(ctx, 'webuntis');
  const mode = d.authMode || s.authMode || 'key';
  const save = () => {
    const creds = { authMode: mode, username: d.username !== undefined ? d.username : s.username };
    if (mode === 'key' && d.key) creds.key = d.key;
    if (mode === 'password' && d.password) creds.password = d.password;
    ctx.api.setCredentials('webuntis', creds).then(() => {
      delete d.key;
      delete d.password;
      ctx.toast('WebUntis gespeichert – wird abgerufen …', 'ok');
    });
  };
  const saveServer = () => {
    ctx.actions.updatePlatform('webuntis', { server: d.server ?? s.server, school: d.school ?? s.school });
    ctx.toast('Server gespeichert.', 'ok');
  };
  return [
    radio(
      ctx,
      'webuntis',
      'mode',
      [
        ['key', 'Untis-Mobile-Schlüssel', 'empfohlen – funktioniert auch, wenn du dich mit Microsoft anmeldest'],
        ['password', 'Benutzername + Passwort', 'nur wenn du ein eigenes WebUntis-Passwort hast']
      ],
      mode,
      (v) => {
        d.authMode = v;
        ctx.rerender();
      }
    ),
    mode === 'key'
      ? h(
          'div',
          { class: 'help' },
          h('strong', {}, 'So findest du den Schlüssel:'),
          steps(
            'Unten auf „WebUntis öffnen“ klicken und anmelden.',
            'Links unten auf dein Profil (Name) klicken → Reiter „Freigaben“.',
            'Bei „Zugriff über Untis Mobile“ auf „Anzeigen“ klicken.',
            'Benutzername und Schlüssel hier eintragen. Wird der QR-Code angezeigt, übernimmt Schulradar die Daten meistens automatisch.'
          )
        )
      : null,
    h(
      'div',
      { class: 'form-row' },
      field(ctx, 'webuntis', 'username', { label: 'Benutzername', value: s.username, placeholder: 'z. B. MusterMax' }),
      mode === 'key'
        ? field(ctx, 'webuntis', 'key', {
            label: 'Schlüssel',
            type: 'password',
            placeholder: p.hasKey ? '•••••••• (gespeichert)' : '16 Zeichen, z. B. ABCD…'
          })
        : field(ctx, 'webuntis', 'password', {
            label: 'Passwort',
            type: 'password',
            placeholder: p.hasPassword ? '•••••••• (gespeichert)' : ''
          })
    ),
    h('div', { class: 'form-actions' }, saveButton('Speichern & verbinden', save), h('button', { class: 'btn', onclick: () => ctx.api.login('webuntis') }, icon('open'), 'WebUntis öffnen')),
    advanced(
      'Server & Schule',
      h(
        'div',
        { class: 'form-row' },
        field(ctx, 'webuntis', 'server', { label: 'Server', value: s.server, placeholder: 'htl-hl.webuntis.com' }),
        field(ctx, 'webuntis', 'school', { label: 'Schulname', value: s.school, placeholder: 'htl-hl' })
      ),
      h('div', { class: 'form-actions' }, saveButton('Übernehmen', saveServer, false))
    )
  ];
}

function eduvidualBody(ctx, p) {
  const s = ctx.state.settings.platforms.eduvidual;
  const d = draft(ctx, 'eduvidual');
  return [
    steps(
      'Auf „Anmelden“ klicken und wie gewohnt einloggen (eduvidual-Konto, Microsoft oder Google).',
      'Schulradar richtet danach automatisch den Zugang ein und schließt das Fenster.'
    ),
    p.hasToken ? h('p', { class: 'ok-line' }, icon('check'), 'App-Zugang ist eingerichtet – eine erneute Anmeldung ist normalerweise nicht nötig.') : null,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', onclick: () => ctx.api.login('eduvidual') }, icon('login'), p.hasToken ? 'Neu anmelden' : 'Anmelden')),
    advanced(
      'Adresse',
      field(ctx, 'eduvidual', 'url', { label: 'Adresse', value: s.url, placeholder: 'https://www.eduvidual.at' }),
      h('div', { class: 'form-actions' }, saveButton('Übernehmen', () => ctx.actions.updatePlatform('eduvidual', { url: (d.url ?? s.url).trim() }), false))
    )
  ];
}

function teamsBody(ctx, p) {
  const s = ctx.state.settings.platforms.teams;
  const d = draft(ctx, 'teams');
  const mode = s.mode || 'web';
  const graph = ctx.ui.graph || {};
  const body = [
    radio(
      ctx,
      'teams',
      'mode',
      [
        ['web', 'Über die Teams-Webansicht', 'empfohlen – keine Freigabe durch die Schul-IT nötig'],
        ['graph', 'Über Microsoft Graph', 'nur wenn die Schul-IT eine App-Registrierung freigegeben hat']
      ],
      mode,
      (v) => ctx.actions.updatePlatform('teams', { mode: v })
    )
  ];
  if (mode === 'web') {
    body.push(
      steps(
        'Auf „Anmelden“ klicken und mit dem Schulkonto bei Microsoft anmelden („Angemeldet bleiben“ bestätigen).',
        'Warten, bis Teams geladen ist, und links auf „Zuweisungen“ klicken. Sobald die Aufgaben erkannt sind, erscheint unten eine Meldung.',
        'Fenster schließen – Schulradar liest die Aufgaben ab jetzt im Hintergrund.'
      ),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', onclick: () => ctx.api.login('teams') }, icon('login'), 'Anmelden')),
      advanced(
        'Teams-Adresse',
        field(ctx, 'teams', 'url', { label: 'Teams-Adresse', value: s.url, placeholder: 'https://teams.cloud.microsoft/' }),
        h('div', { class: 'form-actions' }, saveButton('Übernehmen', () => ctx.actions.updatePlatform('teams', { url: (d.url ?? s.url).trim() }), false))
      )
    );
  } else {
    body.push(
      h(
        'div',
        { class: 'form-row' },
        field(ctx, 'teams', 'clientId', { label: 'Client-ID (Anwendungs-ID)', value: s.clientId, placeholder: '00000000-0000-0000-0000-000000000000' }),
        field(ctx, 'teams', 'tenant', { label: 'Mandant', value: s.tenant, placeholder: 'organizations', hint: 'Domain der Schule, z. B. htl-hl.ac.at' })
      ),
      h(
        'div',
        { class: 'form-actions' },
        saveButton(
          'Speichern',
          () => ctx.actions.updatePlatform('teams', { clientId: (d.clientId ?? s.clientId).trim(), tenant: (d.tenant ?? s.tenant).trim() || 'organizations' }),
          false
        ),
        h(
          'button',
          {
            class: 'btn btn-primary',
            disabled: graph.waiting,
            onclick: () => ctx.actions.graphConnect()
          },
          icon('login'),
          p.hasGraph ? 'Neu verbinden' : 'Mit Microsoft verbinden'
        )
      ),
      graph.userCode
        ? h(
            'div',
            { class: 'code-box' },
            h('div', {}, 'Im Browser hat sich die Microsoft-Seite geöffnet. Gib dort diesen Code ein:'),
            h('div', { class: 'code' }, graph.userCode),
            h('button', { class: 'btn btn-small', onclick: () => navigator.clipboard.writeText(graph.userCode).then(() => ctx.toast('Code kopiert', 'ok')) }, 'Code kopieren'),
            graph.verificationUri ? h('div', { class: 'muted small' }, graph.verificationUri) : null
          )
        : null,
      graph.error ? h('p', { class: 'error-line' }, icon('alert'), graph.error) : null,
      p.hasGraph ? h('p', { class: 'ok-line' }, icon('check'), 'Mit Microsoft Graph verbunden.') : null,
      h('p', { class: 'muted small' }, 'Die Schul-IT legt dafür im Microsoft Entra Admin Center eine App-Registrierung (öffentlicher Client, Gerätecode-Fluss) mit den delegierten Berechtigungen EduAssignments.ReadBasic und EduRoster.ReadBasic an und erteilt die Administratorzustimmung.')
    );
  }
  return body;
}

function lettoBody(ctx, p) {
  const s = ctx.state.settings.platforms.letto;
  const d = draft(ctx, 'letto');
  const saveCreds = () => {
    const creds = { username: d.username !== undefined ? d.username : s.username };
    if (d.password) creds.password = d.password;
    ctx.api.setCredentials('letto', creds).then(() => {
      delete d.password;
      ctx.toast('Letto-Anmeldedaten gespeichert.', 'ok');
    });
  };
  return [
    steps(
      'Auf „Anmelden“ klicken und bei Letto einloggen.',
      'Einmal das „Dashboard“ öffnen – Schulradar merkt sich die Seite.',
      'Fenster schließen.'
    ),
    s.dashboardUrl ? h('p', { class: 'ok-line' }, icon('check'), 'Dashboard gefunden.') : null,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', onclick: () => ctx.api.login('letto') }, icon('login'), 'Anmelden')),
    h(
      'div',
      { class: 'help' },
      h('strong', {}, 'Automatisch anmelden (empfohlen): '),
      'Letto meldet dich nach 20 Minuten ab. Damit Schulradar trotzdem im Hintergrund abrufen kann, kannst du hier deine Letto-Zugangsdaten speichern. Meldest du dich bei Letto mit Microsoft an, lass die Felder leer – dann nutzt Schulradar die Microsoft-Anmeldung.'
    ),
    h(
      'div',
      { class: 'form-row' },
      field(ctx, 'letto', 'username', { label: 'Benutzername', value: s.username }),
      field(ctx, 'letto', 'password', { label: 'Passwort', type: 'password', placeholder: p.hasPassword ? '•••••••• (gespeichert)' : '' })
    ),
    h('div', { class: 'form-actions' }, saveButton('Speichern', saveCreds, false)),
    advanced(
      'Adressen',
      field(ctx, 'letto', 'url', { label: 'Letto-Adresse', value: s.url }),
      field(ctx, 'letto', 'dashboardUrl', { label: 'Dashboard-Adresse (wird automatisch erkannt)', value: s.dashboardUrl }),
      h(
        'div',
        { class: 'form-actions' },
        saveButton('Übernehmen', () => ctx.actions.updatePlatform('letto', { url: (d.url ?? s.url).trim(), dashboardUrl: (d.dashboardUrl ?? s.dashboardUrl).trim() }), false)
      )
    )
  ];
}

const BODIES = { webuntis: webuntisBody, eduvidual: eduvidualBody, teams: teamsBody, letto: lettoBody };

export function renderPlatforms(root, ctx) {
  const { state } = ctx;
  root.append(
    h(
      'p',
      { class: 'lead' },
      'Hier verbindest du Schulradar mit deinen Schul-Plattformen. Zugangsdaten werden nur auf diesem PC gespeichert (mit Windows verschlüsselt) und nur an die jeweilige Plattform gesendet.'
    )
  );
  if (state.demo) {
    root.append(
      h('div', { class: 'banner banner-info' }, icon('sparkle'), h('div', { class: 'banner-text' }, 'Im Demo-Modus werden keine echten Daten abgerufen.'),
        state.forcedDemo ? null : h('button', { class: 'btn btn-small', onclick: () => ctx.actions.setDemo(false) }, 'Demo beenden'))
    );
  }
  const cards = state.platforms.map((p) => {
    const s = state.settings.platforms[p.id];
    const syncing = state.syncing.includes(p.id);
    return h(
      'section',
      { class: `card platform ${s.enabled ? '' : 'is-disabled'}`, id: `platform-${p.id}`, style: { '--c': p.color } },
      h(
        'header',
        { class: 'platform-head' },
        h('span', { class: 'platform-icon' }, (L.SOURCE_META[p.id] || {}).short || p.name[0]),
        h('div', { class: 'platform-title' }, h('h3', {}, p.name), h('p', {}, p.description)),
        h(
          'label',
          { class: 'toggle-inline', title: s.enabled ? 'Plattform ausschalten' : 'Plattform einschalten' },
          h('input', { type: 'checkbox', checked: s.enabled, onchange: (e) => ctx.actions.updatePlatform(p.id, { enabled: e.target.checked }) }),
          h('span', { class: 'switch' })
        )
      ),
      statusLine(ctx, p),
      s.enabled ? h('div', { class: 'platform-body' }, BODIES[p.id](ctx, p)) : null,
      s.enabled
        ? h(
            'footer',
            { class: 'platform-foot' },
            h('button', { class: 'btn btn-ghost', disabled: syncing || state.demo, onclick: () => ctx.actions.sync(p.id) }, icon('sync', syncing ? 'spin' : ''), 'Jetzt abrufen'),
            h('button', { class: 'btn btn-ghost', onclick: () => ctx.actions.logout(p) }, icon('logout'), 'Abmelden'),
            h('button', { class: 'btn btn-ghost', title: 'Protokoll für die Fehlersuche speichern', onclick: () => ctx.actions.exportDiagnostics(p.id) }, icon('download'), 'Diagnose')
          )
        : null
    );
  });
  root.append(h('div', { class: 'platform-grid' }, cards));
}
