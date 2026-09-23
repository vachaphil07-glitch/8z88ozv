# Schulradar

**Alle Aufgaben, Abgaben und Tests aus WebUntis, MS Teams, Letto, Eduvidual und LMS.at in einer Übersicht.**

Bei uns in der Schule kommen Aufgaben, Aufträge und Testtermine über mehrere verschiedene Plattformen.
Um sicher zu sein, dass wirklich alles erledigt ist, musste man bisher alle einzeln durchsehen.
Schulradar ist eine App für Windows und Android, die das automatisch erledigt: Sie holt alle Einträge ab,
zeigt sie in **einer** Liste sortiert nach Fälligkeit, erkennt, was schon abgegeben ist, und erinnert
rechtzeitig an Abgaben und Tests.

Voreingestellt für die **HTL Hollabrunn**; für andere Schulen lassen sich alle Adressen ändern.

![Übersicht](docs/uebersicht.png)

| Wochenansicht mit Stundenplan (dunkles Design) | Plattformen verbinden |
|---|---|
| ![Woche](docs/woche-dunkel.png) | ![Plattformen](docs/plattformen.png) |

## Was Schulradar kann

- **Eine Liste für alles**: Überfällig, Heute, Morgen, Diese Woche, Nächste Woche, Später, jeweils mit
  Plattform, Fach bzw. Kurs, Art (Hausübung, Abgabe, Übung, Test …) und Status
  (*offen*, *überfällig*, *abgegeben*, *bewertet*, *erledigt*)
- **Abgabestatus automatisch**: Was in Teams oder Eduvidual abgegeben ist, wird automatisch als erledigt
  angezeigt. Verschwindet eine Übung aus dem Letto-Dashboard, gilt sie als erledigt.
- **Selbst abhaken**: Alles lässt sich zusätzlich in der App abhaken.
- **Tests & Schularbeiten** aus WebUntis werden hervorgehoben (auch „Tests in 7 Tagen“ oben).
- **Wochen- und Monatsansicht**, in der Woche auf Wunsch mit dem Stundenplan aus WebUntis
  als Zeitraster wie in WebUntis (Doppelstunden, Gruppen, Entfall, Änderung, Prüfung).
- **Eigene Aufgaben** für Dinge, die nur mündlich angesagt wurden.
- **In den Kalender übernehmen**: Bei jedem Eintrag unter **Kalender** → Google Kalender, Outlook
  (Schulkonto), Yahoo, Kalenderdatei (.ics) oder am Handy direkt die Kalender-App. Unter
  *Einstellungen → Kalender* lassen sich alle kommenden Tests und Schularbeiten auf einmal exportieren.
- **Erinnerungen** als Windows-Benachrichtigung: am Vorabend von Tests und ganztägigen Abgaben,
  1 Tag und 3 Stunden vor Abgaben mit Uhrzeit, jeden Morgen eine kurze Übersicht. Alles einstellbar.
- **Läuft im Hintergrund**: startet mit Windows, ruft alle 30 Minuten ab und sitzt als Symbol im Infobereich.
- Suche (Strg+F), Filter nach Plattform und Art, helles und dunkles Design.

## Installation

1. Den Installer **`Schulradar-Setup-x.y.z.exe`** herunterladen: unter *Releases* bzw. im neuesten Lauf
   von *Actions → Schulradar* das Artefakt „Schulradar-Windows“.
   Es gibt auch **`Schulradar-x.y.z-portable.exe`**, eine Version ohne Installation, etwa für einen USB-Stick.
   Windows-Benachrichtigungen funktionieren aber am zuverlässigsten mit der installierten Version.
2. Doppelklick. Es sind **keine Administratorrechte** nötig, installiert wird nur für den eigenen Benutzer.
3. Kommt die Meldung *„Der Computer wurde durch Windows geschützt“*: auf **Weitere Informationen → Trotzdem
   ausführen** klicken. Die Meldung erscheint, weil die App nicht mit einem kostenpflichtigen Zertifikat
   signiert ist.

Beim ersten Start erklärt eine kurze Einführung alles. Mit **„Erst mal Demo ansehen“** kann man die App
mit Beispieldaten ausprobieren, ohne sich irgendwo anzumelden.

## Am Handy (Android)

Schulradar gibt es auch als Android-App – mit allem wie am PC: eigene Anmeldung bei allen Plattformen,
Liste, Tagesansicht mit Stundenplan, Monat, eigene Aufgaben, Abhaken und Erinnerungen.

<p>
  <img src="docs/handy-uebersicht.png" alt="Übersicht am Handy" width="240" />
  <img src="docs/handy-tag.png" alt="Tag mit Stundenplan am Handy" width="240" />
  <img src="docs/handy-monat-dunkel.png" alt="Monat am Handy (dunkel)" width="240" />
</p>

1. Die Datei **`Schulradar-x.y.z.apk`** aufs Handy laden: unter *Releases* bzw. im neuesten Lauf von
   *Actions → Schulradar* das Artefakt „Schulradar-Android“ (eine ZIP-Datei, darin liegt die APK).
2. Die APK antippen. Beim ersten Mal fragt Android, ob der Browser bzw. die Dateien-App
   *unbekannte Apps installieren* darf → **Zulassen**, zurück und **Installieren**.
3. Warnt Google Play Protect („Unbekannte App“): **Weitere Details → Trotzdem installieren**. Die Meldung
   kommt, weil die App nicht aus dem Play Store stammt.
4. Beim ersten Start **Benachrichtigungen erlauben** – sonst gibt es keine Erinnerungen.
5. Unter **Plattformen** wie am PC anmelden. Die Anmeldeseite öffnet sich über der App; wenn du fertig bist,
   oben rechts auf **Fertig** tippen.

**Update:** einfach die neue APK installieren. Anmeldungen, Häkchen und eigene Aufgaben bleiben erhalten.

Unterschiede zum PC:

- Abgerufen wird **beim Öffnen der App** und, solange sie offen ist, im eingestellten Abstand. Android lässt
  Apps im Hintergrund kaum laufen. Die **Erinnerungen kommen trotzdem**, auch bei geschlossener App, weil sie
  im Voraus geplant werden (auf wenige Minuten genau).
- Die Woche zeigt einen **Tag auf einmal**: oben den Tag antippen oder nach links/rechts wischen.
- Die Zurück-Taste schließt Dialoge und führt zur Übersicht zurück.
- PC und Handy haben jeweils **eigene Daten**: Was am PC abgehakt wird, erscheint (noch) nicht automatisch am
  Handy. Ein Abgleich, z. B. über OneDrive, ist noch nicht eingebaut.

## Plattformen verbinden (einmalig)

Alles passiert in der App unter **Plattformen**. Anmeldungen laufen immer über die **echte Login-Seite** der
jeweiligen Plattform in einem App-Fenster. Deshalb funktioniert auch „Mit Microsoft anmelden“ mit
Zwei-Faktor-Bestätigung. Alle Plattformen teilen sich diese Anmeldung: Wer einmal bei Microsoft angemeldet
ist, muss das meist nicht noch einmal tun.

### WebUntis: Hausübungen, Prüfungen, Stundenplan
Am zuverlässigsten ist der **Untis-Mobile-Schlüssel**. Er funktioniert auch, wenn man sich sonst mit
Microsoft anmeldet:
1. **WebUntis öffnen** klicken und anmelden.
2. Links unten auf das eigene Profil klicken, dann den Reiter **Freigaben** öffnen.
3. Bei **Zugriff über Untis Mobile** auf **Anzeigen** klicken.
4. Benutzername und Schlüssel in Schulradar eintragen und **Speichern & verbinden** klicken.
   Wird der QR-Code angezeigt, übernimmt Schulradar die Daten meist von selbst.

Wer ein eigenes WebUntis-Passwort hat, kann stattdessen Benutzername und Passwort verwenden.

### Eduvidual: Abgaben, Tests (Quiz), Kurstermine
**Anmelden** klicken und wie gewohnt einloggen, egal ob mit eduvidual-Konto, Microsoft oder Google. Schulradar
richtet danach selbst den offiziellen Moodle-App-Zugang ein und schließt das Fenster. Danach ist keine
erneute Anmeldung nötig.

### MS Teams: Aufgaben mit Abgabestatus
**Anmelden** klicken, mit dem Schulkonto anmelden und „Angemeldet bleiben“ bestätigen. Danach in Teams
links auf **Zuweisungen** klicken. Sobald die Aufgaben erkannt sind, erscheint eine Meldung, dann das Fenster schließen. Schulradar öffnet Teams ab dann unsichtbar im
Hintergrund und liest die Aufgabenliste mit, die Teams selbst lädt.

*Optional:* Hat die Schul-IT eine App-Registrierung für Microsoft Graph freigegeben, kann man stattdessen
„Über Microsoft Graph“ wählen und die Client-ID eintragen. Die Schul-IT braucht dafür eine App-Registrierung als
öffentlicher Client mit Gerätecode-Fluss und den delegierten Berechtigungen `EduAssignments.ReadBasic`
und `EduRoster.ReadBasic` samt Administratorzustimmung.

### Letto: Übungen mit Abgabefrist
1. **Anmelden** klicken und bei Letto einloggen.
2. Einmal das **Dashboard** öffnen. Schulradar merkt sich die Seite.
3. Fenster schließen.

Letto meldet nach 20 Minuten automatisch ab. Damit der Abruf im Hintergrund trotzdem klappt, kann man
Benutzername und Passwort für Letto speichern. Wer sich bei Letto mit Microsoft anmeldet, lässt die Felder
leer: Schulradar nutzt dann die Microsoft-Anmeldung.

### LMS.at: Aufgaben und Termine
1. **Anmelden** klicken und bei LMS.at einloggen (LMS-Benutzername oder „Mit Microsoft anmelden“).
2. Die Seite mit den **Aufgaben** öffnen und, falls es eine gibt, auch die Seite mit den **Terminen**
   bzw. dem Kalender. Erkennt Schulradar dort Einträge mit Datum, merkt es sich die Seite (höchstens drei)
   und meldet sich unten im Fenster.
3. Fenster schließen (am Handy: **Fertig**).

Ohne gemerkte Seite sucht Schulradar selbst nach Menüpunkten wie „Aufgaben“, „Termine“ oder „Kalender“.
Tests, Schularbeiten und Lernzielkontrollen werden anhand des Titels erkannt und wie Prüfungen hervorgehoben.
Wie bei Letto kann man Benutzername und Passwort speichern, damit der Abruf nach Ablauf der Sitzung
weiterläuft. LMS.at hat keine offizielle Schnittstelle für Schüler. Klappt die Erkennung bei euch nicht,
bitte unter *Plattformen → LMS.at* die **Diagnose** speichern und schicken.

## Kalender: Tests & Schularbeiten übernehmen

- **Einzelner Termin:** Eintrag antippen → **Kalender** → **Google Kalender**, **Outlook (Schulkonto)**,
  **Yahoo Kalender** oder **Kalender (.ics)**. Google, Outlook und Yahoo öffnen sich im Browser mit
  bereits ausgefülltem Termin, man muss nur noch speichern. Am Handy trägt **Kalender-App am Handy** den
  Termin direkt in die Kalender-App ein, z. B. Google Kalender.
- **Alle auf einmal:** *Einstellungen → Kalender → Exportieren* erstellt eine Datei mit allen kommenden
  Tests, Schularbeiten und Terminen, auf Wunsch auch mit allen offenen Abgaben. In Google Kalender importiert
  man sie am PC unter *calendar.google.com → Einstellungen → Importieren & Exportieren*. Outlook öffnet
  die Datei mit einem Doppelklick.
- Tests und Schularbeiten bekommen eine Erinnerung am Vorabend um 18 Uhr (in .ics-Dateien). Abgaben
  werden als kurzer Termin eingetragen, der zur Abgabezeit endet.

## Datenschutz & Sicherheit

- Schulradar hat **keinen eigenen Server**. Die App spricht nur direkt mit WebUntis, Microsoft/Teams, Letto
  und Eduvidual.
- Alle Daten bleiben auf dem eigenen PC: `%APPDATA%\Schulradar\schulradar-daten.json`.
- Passwörter, Schlüssel und Tokens werden mit der **Windows-Verschlüsselung (DPAPI)** gespeichert
  (`zugangsdaten.bin`). Nur der eigene Windows-Benutzer kann sie entschlüsseln.
- Am Handy liegen die Daten im geschützten App-Speicher, Zugangsdaten verschlüsselt mit dem
  **Android-Schlüsselspeicher (Keystore)**.
- **Einstellungen → Alles zurücksetzen** löscht Daten, Zugangsdaten und alle Anmeldungen.

## Wenn etwas nicht klappt

- Unter **Plattformen** steht bei jeder Plattform, ob sie verbunden ist und was zuletzt schiefging.
- **Jetzt abrufen** probiert es sofort noch einmal.
- **Diagnose** speichert ein Protokoll des letzten Abrufs, ohne Passwörter, aber mit Aufgabentiteln. Bitte vor
  dem Weitergeben kurz durchsehen. Damit lassen sich Änderungen auf den Plattformen schnell nachbessern.

Gut zu wissen: Teams und Letto haben keine offizielle Schnittstelle für Schüler. Ändert Microsoft oder Letto
die Webseite, kann es sein, dass Schulradar dort angepasst werden muss. WebUntis und Eduvidual nutzen die
Schnittstellen, die auch die offiziellen Handy-Apps verwenden.

## Bedienung in Kürze

| Taste | Funktion |
|---|---|
| Strg+N | eigene Aufgabe anlegen |
| Strg+F | suchen |
| Strg+R / F5 | alle Plattformen jetzt abrufen |
| Strg+1 … 5 | Übersicht, Woche, Monat, Plattformen, Einstellungen |
| Esc | Dialog schließen |

Ein Klick auf einen Eintrag zeigt Details (Beschreibung, Lehrkraft, Raum …) und öffnet ihn auf der
Plattform, wahlweise im App-Fenster (bereits angemeldet) oder im normalen Browser.

---

## Für Entwickler

Electron-App ohne Frontend-Framework (reines HTML/CSS/JS), Node ≥ 22.

```bash
cd schulradar
npm install
npm start          # App starten
npm run demo       # mit Beispieldaten starten (ohne Anmeldung)
npm test           # Unit-Tests (Parser, Datum, Status, Erinnerungen, Speicher)
npm run test:e2e   # startet die echte App gegen nachgebaute Plattformen (unter Linux mit xvfb)
npm run dist       # Windows-Installer + portable Version nach dist/ (unter Windows)
npm run icons      # App-Symbole neu erzeugen
```

Den Windows-Installer und die Android-APK baut GitHub Actions (`.github/workflows/schulradar.yml`) bei jedem
Push. Ein Tag `schulradar-vX.Y.Z` erzeugt zusätzlich ein Release mit Installer, portabler Version und APK.

Die Android-App (`mobile/`, Capacitor) verwendet **dieselbe Oberfläche und dieselben Anbindungen**:
`mobile/build.mjs` kopiert `src/renderer` und bündelt `src/main` samt `mobile/core` (Android-Umsetzung von
`platform.js`: Anfragen, Webansichten, JSON-Mitschnitt, Keystore) zu `mobile/www/core.js`.

```bash
cd schulradar/mobile
npm install
npm run preview    # Handy-Oberfläche im Browser ansehen: danach z. B. python3 -m http.server -d preview 8080
npm run apk        # APK bauen (Android SDK + JDK 21) → android/app/build/outputs/apk/release/
```

Die Versionsnummer der APK kommt aus `schulradar/package.json`. Signiert wird mit
`mobile/android/app/schulradar.keystore`. Der Schlüssel liegt absichtlich im Repository, damit jede neue
Version über die alte installiert werden kann. Wer eine eigene Variante verteilt, sollte einen eigenen
Schlüssel erzeugen.

```
src/main/            Hauptprozess (Node)
  main.js            Fenster, Infobereich, IPC, Autostart
  controller.js      Aktionen der Oberfläche (gemeinsam für PC und Handy)
  platform.js        Schnittstelle Anbindungen ↔ Gerät (PC: web.js, Handy: mobile/core/android-web.js)
  sync.js            Abruf aller Plattformen, Zeitplan, Diagnose
  store.js           lokale JSON-Datei
  secrets.js         Zugangsdaten (Electron safeStorage / DPAPI)
  reminders.js       Erinnerungen & Morgen-Übersicht
  web.js             gemeinsame Browser-Sitzung, unsichtbare Fenster, JSON-Mitschnitt (DevTools-Protokoll)
  login.js           Anmeldefenster (Ablauf gemeinsam mit dem Handy: login-flow.js)
  connectors/        webuntis.js, eduvidual.js, teams.js, letto.js, lms.js (+ demo.js, webpage.js)
src/preload/         sichere Brücke zur Oberfläche
src/renderer/        Oberfläche (ES-Module): app.js, logic.js, calendar.js (Kalender-Export), views/*
mobile/              Android-App: core/ (Handy-Kern), android/ (Projekt + SchulradarNativePlugin.java)
test/                node:test-Tests, test/e2e/ mit Mock-Server
```

| Plattform | Anmeldung | Datenquelle |
|---|---|---|
| WebUntis | Untis-Mobile-Schlüssel (TOTP) oder Passwort | `/WebUntis/api/homeworks/lessons`, `/api/exams`, `/api/public/timetable/weekly/data` |
| Eduvidual | Browser-Login → Moodle-App-Token über `admin/tool/mobile/launch.php` | Moodle-Webservice: `core_calendar_get_action_events_by_timesort`, `core_calendar_get_calendar_monthly_view` (Fallback: Browser-Sitzung + `lib/ajax/service.php`) |
| MS Teams | Browser-Login (Microsoft) | Aufgaben-App unsichtbar laden und JSON-Antworten mitlesen; optional Microsoft Graph `education/me/assignments` |
| Letto | Browser-Login, optional gespeichertes Passwort / Microsoft | Schüler-Dashboard („Offene“ und „Nicht gestartete Aktivitäten“) auslesen |
| LMS.at | Browser-Login, optional gespeichertes Passwort / Microsoft | gemerkte Seiten mit Aufgaben/Terminen auslesen (Tabellen und Listen mit Datum) |

Nur für Tests gibt es die Umgebungsvariablen `SCHULRADAR_USERDATA` (anderer Datenordner),
`SCHULRADAR_SCREENSHOT` / `SCHULRADAR_VIEWS` (Screenshots speichern) und `SCHULRADAR_E2E` (Abruf ausführen
und Ergebnis speichern).
