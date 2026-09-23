> **Schulradar** (Ordner [`schulradar/`](schulradar/README.md)): Alle Aufgaben, Abgaben und Tests aus WebUntis,
> MS Teams, Letto und Eduvidual in einer Windows-App, mit Erinnerungen, Wochen- und Monatsansicht.

# NOVA DECK

Ein futuristisches Desktop-Cockpit für Windows – **eine einzige Datei**, kein Setup,
keine Installation, keine Internetverbindung nötig.

`NovaDeck.hta` auf den Desktop legen, doppelklicken → das Fenster poppt auf.

## Was drin ist

| Bereich | Funktion |
|---|---|
| **Aufgaben** | To-do-Liste mit Abhaken, Priorität (★), Fälligkeitsdatum, Filter *Offen / Alle / Erledigt* |
| **Kalender** | Monatsansicht, heutiger Tag hervorgehoben, farbige Punkte an Tagen mit offenen Aufgaben |
| **Dateien** | Schnellzugriff auf Dateien, Ordner und Links – **Doppelklick öffnet** |
| **Programme** | Kacheln für die wichtigsten Programme – **Doppelklick startet** |

Oben laufen Uhr, Datum und eine Statuszeile (offen / heute fällig / überfällig / erledigt).

## Bedienung

**Aufgaben**
- Text eintippen und **Enter** → Aufgabe anlegen
- Kästchen anklicken → erledigt
- Beim Überfahren einer Zeile erscheinen rechts: ★ Priorität, ◎ Fälligkeitsdatum, ✎ bearbeiten, ✕ löschen

**Kalender**
- Tag anklicken → der Tag ist ausgewählt; **neue Aufgaben bekommen automatisch dieses Datum**
- Gleichzeitig zeigt die Aufgabenliste nur noch diesen Tag (oranger Chip oben rechts, Klick hebt es auf)
- ◀ ▶ blättern durch die Monate, **Heute** springt zurück

**Dateien**
- **+ Datei** → normaler Windows-Dateidialog (Explorer)
- **+ Ordner** → Ordnerauswahl
- **+ Pfad** → Pfad oder Internet-Adresse (`https://…`) von Hand eintragen
- Dateien/Ordner lassen sich auch aus dem Explorer **in das Fenster ziehen**
- Doppelklick öffnet die Datei mit dem Standardprogramm, ⌫-Symbol zeigt sie im Explorer

**Programme**
- **+ Programm** → `.exe` oder Verknüpfung (`.lnk`) auswählen
- **Pfad …** → Befehl von Hand eintragen, z. B. `notepad.exe` oder `ms-settings:`
- Doppelklick startet das Programm
- Beim ersten Start sucht NOVA DECK gängige Programme selbst (Explorer, Edge, Chrome, Firefox,
  Office, VS Code, Spotify, Rechner, Terminal …) und legt Kacheln für die gefundenen an

**Fenster & Menü**
- Titelleiste ziehen = verschieben, Doppelklick oder □ = maximieren, Ecke unten rechts = Größe ändern
- ◉ wechselt das Design (Cyan → Magenta → Amber)
- ☰ Menü: Desktop-Verknüpfung anlegen, mit Windows starten, Datenordner öffnen,
  erledigte Aufgaben löschen, Programme erneut suchen
- Minimieren: auf das Taskleisten-Symbol klicken

**Tastatur:** `Strg+N` neue Aufgabe · `Strg+F` Suche · `Esc` Dialog schließen / Tagesauswahl aufheben

## Wo liegen die Daten

`%APPDATA%\NovaDeck\novadeck.json` (plus `.bak`-Sicherung)

Alles wird sofort gespeichert. Die Datei kann man kopieren, sichern oder auf einen anderen
Rechner mitnehmen. Die `.hta` selbst enthält keine Daten – sie darf beliebig verschoben werden.

## Hinweise

- Läuft mit dem in Windows enthaltenen `mshta.exe` (Windows 7 bis 11). Nichts zu installieren.
- Beim ersten Öffnen fragt Windows eventuell, ob die Datei ausgeführt werden soll → **Ausführen**.
  Kommt die Datei aus dem Internet/E-Mail: Rechtsklick → *Eigenschaften* → *Zulassen* ankreuzen.
- Die Datei muss per Doppelklick als `.hta` starten. Im Browser geöffnet fehlt der Systemzugriff
  (Programme starten, Dateien öffnen, Speichern) – die Oberfläche startet dann im eingeschränkten Modus.
- In sehr streng verwalteten Firmenumgebungen kann `mshta.exe` per Richtlinie gesperrt sein.
