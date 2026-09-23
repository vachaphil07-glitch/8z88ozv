'use strict';
// Ende-zu-Ende-Test: startet die echte App (Electron) gegen nachgebaute Plattformen
// und prüft, ob alle vier Anbindungen Daten liefern.
// Aufruf: npm run test:e2e   (unter Linux wird automatisch xvfb-run verwendet)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { start, WEBUNTIS, LETTO, LMS } = require('./mock-server');

const ROOT = path.join(__dirname, '..', '..');
const electron = require('electron'); // Pfad zur Electron-Programmdatei

async function main() {
  const server = await start(0);
  const base = `http://localhost:${server.port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'schulradar-e2e-'));
  const out = path.join(userData, 'ergebnis.json');

  fs.writeFileSync(
    path.join(userData, 'schulradar-daten.json'),
    JSON.stringify({
      settings: {
        onboarded: true,
        platforms: {
          webuntis: { server: base, school: WEBUNTIS.school, username: WEBUNTIS.user, authMode: 'key' },
          eduvidual: { url: `${base}/moodle` },
          letto: { url: `${base}/letto/`, username: LETTO.user },
          teams: { url: `${base}/teams/app` },
          lms: { url: `${base}/lms/`, username: LMS.user }
        }
      }
    })
  );
  const secrets = { 'webuntis.key': WEBUNTIS.secret, 'letto.password': LETTO.pass, 'lms.password': LMS.pass };
  fs.writeFileSync(path.join(userData, 'zugangsdaten.bin'), 'PLAIN:' + Buffer.from(JSON.stringify(secrets)).toString('base64'));

  const env = {
    ...process.env,
    SCHULRADAR_USERDATA: userData,
    SCHULRADAR_E2E: out,
    SCHULRADAR_E2E_COOKIES: JSON.stringify([{ url: `${base}/moodle`, name: 'MoodleSession', value: 'ok', path: '/moodle' }]),
    NO_PROXY: [process.env.NO_PROXY, 'localhost', '127.0.0.1'].filter(Boolean).join(',')
  };
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && spawnSync('which', ['xvfb-run']).status === 0;
  const args = [ROOT, '--no-sandbox', '--disable-gpu'];
  const cmd = useXvfb ? 'xvfb-run' : electron;
  const cmdArgs = useXvfb ? ['-a', electron, ...args] : args;

  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { env, stdio: ['ignore', process.env.SCHULRADAR_DEBUG ? 'inherit' : 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    // bei Zeitüberschreitung die ganze Prozessgruppe (xvfb-run + Electron) beenden
    const timer = setTimeout(() => {
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
      } catch (_) {
        child.kill('SIGKILL');
      }
    }, 240000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      if (c !== 0) console.error(stderr.split('\n').filter((l) => !/dbus|Gtk|gpu|viz_main/.test(l)).join('\n'));
      resolve(c);
    });
  });
  server.close();
  console.log(`App lief ${Math.round((Date.now() - started) / 1000)} s (Exit-Code ${code}).`);

  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (result.error) throw new Error(result.error);
  const { state, timetable, logs } = result;
  const bySource = (s) => state.items.filter((i) => i.source === s);
  const report = (s) => `${s}: ${state.sourceState[s].status} ${state.sourceState[s].message || ''} (${bySource(s).length} Einträge)`;
  for (const s of ['webuntis', 'eduvidual', 'letto', 'teams', 'lms']) console.log('  ' + report(s));

  try {
    // WebUntis: Anmeldung mit Untis-Mobile-Schlüssel, Hausübungen, nur eigene Prüfung, Stundenplan
    assert.equal(state.sourceState.webuntis.status, 'ok', report('webuntis'));
    const wu = bySource('webuntis');
    assert.ok(wu.find((i) => i.title === 'Buch S. 84, Aufgaben 3–7' && i.subject === 'AM' && i.status === 'open'));
    assert.ok(wu.find((i) => i.title === 'Vokabeln Unit 4' && i.status === 'done'));
    assert.ok(wu.find((i) => i.type === 'exam' && i.title === 'Schularbeit AM' && i.room === 'R204'));
    assert.ok(!wu.find((i) => i.title === 'Fremde Prüfung'), 'fremde Prüfungen werden gefiltert');
    assert.equal(timetable.lessons.length, 5, 'Stundenplan der Woche');
    assert.equal(timetable.lessons.filter((l) => l.cancelled).length, 1);

    // Eduvidual: Token über launch.php (Weiterleitung auf moodlemobile://), dann Webservice
    assert.equal(state.sourceState.eduvidual.status, 'ok', report('eduvidual'));
    assert.equal(state.platforms.find((p) => p.id === 'eduvidual').hasToken, true, 'Moodle-Token gespeichert');
    const ed = bySource('eduvidual');
    assert.ok(ed.find((i) => i.title === 'SQL-Übungsblatt 2' && i.status === 'open' && i.subject === 'DBI'));
    assert.ok(ed.find((i) => i.title === 'Lesetagebuch' && i.status === 'submitted'));
    assert.ok(ed.find((i) => i.title === 'Exkursion' && i.type === 'event'));

    // Letto: automatische Anmeldung, Dashboard lädt verzögert, zweite Liste per Knopf
    assert.equal(state.sourceState.letto.status, 'ok', report('letto'));
    const lt = bySource('letto');
    assert.equal(lt.length, 3);
    assert.ok(lt.find((i) => i.title === '16. Hausübung - Mag. Feld Grundlagen' && i.progress === 45 && i.started === true));
    assert.ok(lt.find((i) => i.title === '1. Übung' && i.started === false && i.subject === 'AM'));
    assert.ok(state.settings.platforms.letto.dashboardUrl.endsWith('/letto/dashboard') || lt[0].url.endsWith('/letto/dashboard'));

    // Teams: Aufgaben-JSON aus einem fremden iframe mitgeschnitten
    assert.equal(state.sourceState.teams.status, 'ok', report('teams'));
    const tm = bySource('teams');
    assert.ok(tm.find((i) => i.title === 'Projektdokumentation Kapitel 2' && i.status === 'open' && i.course === '4AHIT SEW'));
    assert.ok(tm.find((i) => i.title === 'Präsentation Datenbanken' && i.status === 'submitted'));

    // LMS.at: automatische Anmeldung, Seiten „Aufgaben“ und „Termine“ selbst gefunden und gemerkt
    assert.equal(state.sourceState.lms.status, 'ok', report('lms'));
    const lm = bySource('lms');
    assert.equal(lm.length, 5, JSON.stringify(lm.map((i) => i.title)));
    const ref = lm.find((i) => i.title === 'Referat Energiewende – Handout');
    assert.ok(ref && ref.type === 'assignment' && ref.status === 'open' && ref.subject === '4AHIT GGP' && !ref.allDay && new Date(ref.due).getHours() === 23);
    assert.ok(lm.find((i) => i.title === 'Protokoll Messtechnik' && i.status === 'submitted' && i.allDay));
    const sa = lm.find((i) => i.title === 'Schularbeit Mathematik');
    assert.ok(sa && sa.type === 'exam' && sa.examType === 'Schularbeit' && sa.end - sa.due === 100 * 60000);
    assert.ok(lm.find((i) => i.title === 'Test Wirtschaft' && i.type === 'exam' && i.examType === 'Test'));
    assert.ok(lm.find((i) => i.title === 'Exkursion Technisches Museum' && i.type === 'event' && i.allDay));
    assert.equal(state.settings.platforms.lms.pages.length, 2, 'Aufgaben- und Termine-Seite gemerkt');
  } catch (err) {
    console.error('\nProtokolle:', JSON.stringify(logs, null, 1));
    console.error('Server:', server.log.slice(-40).join('\n'));
    throw err;
  }
  console.log('Ende-zu-Ende-Test bestanden.');
  if (process.env.SCHULRADAR_KEEP) console.log(`Daten behalten in ${userData}`);
  else fs.rmSync(userData, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('Ende-zu-Ende-Test fehlgeschlagen:', err.message);
  process.exit(1);
});
