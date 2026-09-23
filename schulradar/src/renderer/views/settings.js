// Einstellungen
import { h, icon } from '../dom.js';

function row(title, desc, control) {
  return h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('strong', {}, title), desc ? h('span', {}, desc) : null), h('div', { class: 'set-control' }, control));
}

function toggle(checked, onChange, label) {
  return h(
    'label',
    { class: 'toggle-inline', 'aria-label': label },
    h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
    h('span', { class: 'switch' })
  );
}

function select(value, options, onChange) {
  return h(
    'select',
    { class: 'select', onchange: (e) => onChange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label))
  );
}

function timeInput(value, onChange, disabled) {
  return h('input', { type: 'time', class: 'select', value, disabled, onchange: (e) => e.target.value && onChange(e.target.value) });
}

function section(title, iconName, ...rows) {
  return h('section', { class: 'card settings-card' }, h('h3', { class: 'settings-title' }, icon(iconName), title), rows);
}

const LEAD_OPTIONS = [
  [48, '2 Tage vorher'],
  [24, '1 Tag vorher'],
  [3, '3 Stunden vorher'],
  [1, '1 Stunde vorher']
];

export function renderSettings(root, ctx) {
  const s = ctx.state.settings;
  const r = s.reminders;
  const set = (patch) => ctx.actions.updateSettings(patch);
  const setR = (patch) => set({ reminders: patch });
  const phone = ctx.state.platform === 'android';

  const leadChecks = h(
    'div',
    { class: 'check-list' },
    LEAD_OPTIONS.map(([hours, label]) =>
      h(
        'label',
        { class: 'check-row' },
        h('input', {
          type: 'checkbox',
          checked: (r.leadHours || []).includes(hours),
          disabled: !r.enabled,
          onchange: (e) => {
            const next = new Set(r.leadHours || []);
            if (e.target.checked) next.add(hours);
            else next.delete(hours);
            setR({ leadHours: [...next].sort((a, b) => b - a) });
          }
        }),
        label
      )
    )
  );

  root.append(
    h(
      'div',
      { class: 'settings' },
      section(
        'Erinnerungen',
        'bell',
        row('Erinnerungen anzeigen', phone ? 'Benachrichtigungen am Handy für Abgaben und Tests – auch wenn die App geschlossen ist.' : 'Windows-Benachrichtigungen für Abgaben und Tests.', toggle(r.enabled, (v) => setR({ enabled: v }), 'Erinnerungen')),
        row('Abgaben mit Uhrzeit', 'z. B. Teams- oder Eduvidual-Abgaben um 23:59', leadChecks),
        row(
          'Am Vorabend erinnern',
          'Bei Tests, Schularbeiten und Hausübungen, die für einen ganzen Tag gelten.',
          h('div', { class: 'inline-controls' }, toggle(r.eveningBefore, (v) => setR({ eveningBefore: v }), 'Vorabend'), timeInput(r.eveningTime, (v) => setR({ eveningTime: v }), !r.enabled || !r.eveningBefore))
        ),
        row(
          'Morgendliche Übersicht',
          'Eine Nachricht mit allem, was heute fällig ist.',
          h('div', { class: 'inline-controls' }, toggle(r.dailySummary, (v) => setR({ dailySummary: v }), 'Übersicht'), timeInput(r.summaryTime, (v) => setR({ summaryTime: v }), !r.enabled || !r.dailySummary))
        )
      ),
      section(
        'Abrufen',
        'sync',
        row(
          'Automatisch abrufen',
          phone ? 'Solange die App offen ist. Beim Öffnen der App wird immer gleich aktualisiert.' : 'Wie oft Schulradar im Hintergrund nach neuen Aufgaben sucht.',
          select(s.syncIntervalMin, [[15, 'alle 15 Minuten'], [30, 'alle 30 Minuten'], [60, 'jede Stunde'], [120, 'alle 2 Stunden'], [240, 'alle 4 Stunden']], (v) => set({ syncIntervalMin: Number(v) }))
        ),
        row('Zeitraum zurück', 'Wie weit in die Vergangenheit Einträge geladen werden.', select(s.lookbackDays, [[7, '1 Woche'], [21, '3 Wochen'], [42, '6 Wochen'], [90, '3 Monate']], (v) => set({ lookbackDays: Number(v) }))),
        row('Zeitraum voraus', 'Wie weit in die Zukunft Einträge geladen werden.', select(s.lookaheadDays, [[30, '1 Monat'], [60, '2 Monate'], [120, '4 Monate'], [240, '8 Monate']], (v) => set({ lookaheadDays: Number(v) }))),
        row('Stundenplan in der Wochenansicht', 'Zeigt die Unterrichtsstunden aus WebUntis.', toggle(s.showTimetable, (v) => set({ showTimetable: v }), 'Stundenplan'))
      ),
      section(
        'Programm',
        'settings',
        row(
          'Design',
          '',
          select(s.theme, [['system', phone ? 'wie am Handy' : 'wie Windows'], ['light', 'Hell'], ['dark', 'Dunkel']], (v) => set({ theme: v }))
        ),
        phone ? null : row('Mit Windows starten', 'Schulradar startet automatisch und erinnert dich auch ohne geöffnetes Fenster.', toggle(s.autostart, (v) => set({ autostart: v }), 'Autostart')),
        phone ? null : row('Beim Windows-Start nur im Infobereich', 'Das Fenster öffnet sich erst, wenn du auf das Symbol klickst.', toggle(s.startHidden, (v) => set({ startHidden: v }), 'Versteckt starten')),
        phone ? null : row('Schließen = im Hintergrund weiterlaufen', 'Das ✕ versteckt das Fenster nur. Beenden über das Symbol im Infobereich.', toggle(s.closeToTray, (v) => set({ closeToTray: v }), 'Im Hintergrund')),
        row('Demo-Daten anzeigen', 'Beispieldaten zum Ausprobieren – echte Daten werden dabei nicht abgerufen.', toggle(s.demo || ctx.state.forcedDemo, (v) => ctx.actions.setDemo(v), 'Demo'))
      ),
      section(
        'Kalender',
        'calendar',
        row(
          'Tests & Schularbeiten exportieren',
          phone
            ? 'Alle kommenden Tests, Schularbeiten und Termine als Kalenderdatei (.ics) teilen – z. B. an die Kalender-App oder an dich selbst.'
            : 'Alle kommenden Tests, Schularbeiten und Termine als Kalenderdatei (.ics) – zum Importieren in Outlook oder Google Kalender (calendar.google.com → Einstellungen → Importieren).',
          h('button', { class: 'btn', onclick: () => ctx.actions.exportAllToCalendar(false) }, icon('calendar'), 'Exportieren')
        ),
        row(
          'Mit allen offenen Abgaben',
          'Wie oben, zusätzlich jede offene Abgabe als kurzer Termin zur Abgabezeit.',
          h('button', { class: 'btn', onclick: () => ctx.actions.exportAllToCalendar(true) }, icon('calendar'), 'Alles exportieren')
        ),
        h('p', { class: 'muted small set-note' }, 'Einzelne Termine: Eintrag öffnen → „Kalender“ → Google Kalender, Outlook, Yahoo oder .ics.')
      ),
      section(
        'Daten & Hilfe',
        'folder',
        phone ? null : row('Datenordner', 'Hier liegen Aufgaben, Häkchen und Einstellungen (JSON-Datei).', h('button', { class: 'btn', onclick: () => ctx.api.openDataFolder() }, icon('folder'), 'Öffnen')),
        row(
          'Ausgeblendete Einträge',
          `${Object.keys(ctx.state.local.dismissed || {}).length} Einträge sind ausgeblendet.`,
          h(
            'button',
            { class: 'btn', disabled: !Object.keys(ctx.state.local.dismissed || {}).length, onclick: () => ctx.api.restoreDismissed().then(() => ctx.toast('Alle Einträge werden wieder angezeigt.', 'ok')) },
            icon('eye'),
            'Wieder anzeigen'
          )
        ),
        row(
          phone ? 'Diagnose teilen' : 'Diagnose speichern',
          'Protokoll aller Plattformen für die Fehlersuche (ohne Passwörter).',
          h('button', { class: 'btn', onclick: () => ctx.actions.exportDiagnostics(null) }, icon('download'), phone ? 'Teilen' : 'Speichern')
        ),
        row('Einführung erneut zeigen', '', h('button', { class: 'btn', onclick: () => ctx.actions.showOnboarding() }, 'Anzeigen')),
        row('Alles zurücksetzen', 'Löscht alle Daten, Zugangsdaten und Anmeldungen.', h('button', { class: 'btn btn-danger', onclick: () => ctx.api.resetData() }, icon('trash'), 'Zurücksetzen'))
      ),
      h(
        'p',
        { class: 'about' },
        `Schulradar ${ctx.state.version} · Voreingestellt für die ${ctx.state.schoolName}. `,
        phone
          ? 'Zugangsdaten werden verschlüsselt im Android-Schlüsselspeicher abgelegt.'
          : ctx.state.secureStorage
            ? 'Zugangsdaten werden mit Windows verschlüsselt gespeichert.'
            : 'Hinweis: Auf diesem System ist keine sichere Verschlüsselung verfügbar.'
      )
    )
  );
}
