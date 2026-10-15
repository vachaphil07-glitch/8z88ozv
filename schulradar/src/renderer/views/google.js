// Google-Konto verbinden – gemeinsam für Google Tasks und den Abgleich PC ↔ Handy (Google Drive)
import { h, icon } from '../dom.js';

function input(ctx, name, { label, type = 'text', placeholder = '', value = '' }) {
  const d = ctx.ui.drafts.google || (ctx.ui.drafts.google = {});
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('input', {
      type,
      value: name in d ? d[name] : value,
      placeholder,
      autocomplete: 'off',
      spellcheck: 'false',
      dataset: { focusKey: `google.${name}` },
      oninput: (e) => {
        d[name] = e.target.value;
      }
    })
  );
}

export function googleAccountBox(ctx, { purpose = 'tasks' } = {}) {
  const g = ctx.state.google || {};
  const d = ctx.ui.drafts.google || (ctx.ui.drafts.google = {});
  const phone = ctx.state.platform === 'android';
  const needsDrive = purpose === 'sync' && g.connected && !g.scopes.drive;
  const needsTasks = purpose === 'tasks' && g.connected && !g.scopes.tasks;

  const connect = async () => {
    ctx.ui.googleBusy = true;
    ctx.rerender();
    ctx.toast(phone ? 'Im Browser bei Google anmelden, danach „Zurück zur App“ tippen.' : 'Im Browser bei Google anmelden und Zugriff erlauben …');
    const res = await ctx.api.googleConnect({ clientId: d.clientId ?? g.clientId, clientSecret: d.clientSecret || undefined });
    ctx.ui.googleBusy = false;
    delete d.clientSecret;
    if (res && res.ok) ctx.toast('Mit Google verbunden.', 'ok');
    else ctx.toast((res && res.error) || 'Verbinden fehlgeschlagen.', 'error');
    ctx.rerender();
  };

  const setup = h(
    'div',
    { class: 'help' },
    h('strong', {}, 'Einmalige Einrichtung (ca. 5 Minuten, am besten am PC):'),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'console.cloud.google.com öffnen, mit deinem Google-Konto anmelden und ein Projekt anlegen (z. B. „Schulradar“).'),
      h('li', {}, '„APIs & Dienste“ → „Bibliothek“: „Google Tasks API“ und „Google Drive API“ aktivieren.'),
      h('li', {}, '„OAuth-Zustimmungsbildschirm“: Typ „Extern“, App-Name eingeben, dich selbst unter „Testnutzer“ hinzufügen.'),
      h('li', {}, '„Anmeldedaten“ → „Anmeldedaten erstellen“ → „OAuth-Client-ID“ → Typ „Desktop-App“.'),
      h('li', {}, 'Client-ID und Clientschlüssel hier einfügen und verbinden. Am Handy dieselben Werte verwenden.')
    )
  );

  return h(
    'div',
    { class: 'google-box' },
    g.connected && !needsDrive && !needsTasks
      ? h('div', { class: 'help' }, icon('check'), h('strong', {}, ' Google ist verbunden. '), purpose === 'sync' ? 'Der Abgleich nutzt einen versteckten App-Ordner in deinem Google Drive.' : 'Abhaken wirkt in beide Richtungen.')
      : needsDrive
        ? h('div', { class: 'help' }, h('strong', {}, 'Neu verbinden nötig: '), 'Für den Abgleich braucht Schulradar zusätzlich Zugriff auf seinen App-Ordner in Google Drive. Vorher im Cloud-Projekt die „Google Drive API“ aktivieren.')
        : setup,
    g.connected && !needsDrive && !needsTasks
      ? null
      : h(
          'div',
          { class: 'form-row' },
          input(ctx, 'clientId', { label: 'Client-ID', value: g.clientId, placeholder: '…apps.googleusercontent.com' }),
          input(ctx, 'clientSecret', { label: 'Clientschlüssel', type: 'password', placeholder: g.hasClientSecret ? '•••••••• (gespeichert)' : 'GOCSPX-…' })
        ),
    h(
      'div',
      { class: 'form-actions' },
      h(
        'button',
        { class: `btn ${g.connected && !needsDrive && !needsTasks ? '' : 'btn-primary'}`, disabled: Boolean(ctx.ui.googleBusy), onclick: connect },
        icon('login'),
        ctx.ui.googleBusy ? 'Warte auf Google …' : g.connected ? 'Neu verbinden' : 'Mit Google verbinden'
      ),
      g.connected
        ? h(
            'button',
            {
              class: 'btn btn-ghost',
              onclick: async () => {
                await ctx.api.googleDisconnect();
                ctx.toast('Google getrennt.');
              }
            },
            icon('logout'),
            'Google trennen'
          )
        : null
    )
  );
}
