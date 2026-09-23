'use strict';
// Handy-Kern ohne Handy: prüft die Ersatz-Kryptografie und die Android-Anfragelogik
// (mobile/core/android-web.js) mit den echten Anbindungen gegen die nachgebauten Plattformen.
// Das native Android-Plugin wird dabei durch fetch() mit eigenem Cookie-Speicher ersetzt.
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('crypto');
const path = require('path');

const shim = require('../mobile/core/shims/crypto');

test('Handy: SHA-1 und HMAC-SHA1 rechnen wie Node', () => {
  for (const len of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 200, 1000]) {
    const data = nodeCrypto.randomBytes(len);
    assert.equal(shim.createHash('sha1').update(data).digest('hex'), nodeCrypto.createHash('sha1').update(data).digest('hex'), `SHA-1 bei ${len} Bytes`);
    for (const keyLen of [10, 20, 64, 100]) {
      const key = nodeCrypto.randomBytes(keyLen);
      assert.deepEqual(
        [...shim.createHmac('sha1', key).update(data).digest()],
        [...nodeCrypto.createHmac('sha1', key).update(data).digest()],
        `HMAC bei ${len} Bytes, Schlüssel ${keyLen}`
      );
    }
  }
  assert.equal(shim.createHash('sha1').update('webuntis|abc').digest('hex'), nodeCrypto.createHash('sha1').update('webuntis|abc').digest('hex'));
  assert.throws(() => shim.createHash('md5'));
});

// ---------------------------------------------------------------- Ersatz für SchulradarNativePlugin

function fakeNative() {
  const jar = new Map(); // host -> Map(name -> {value, path})
  const remember = (url, header) => {
    const u = new URL(url);
    const [pair, ...attrs] = header.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const pathAttr = attrs.map((a) => a.trim()).find((a) => /^path=/i.test(a));
    const cookies = jar.get(u.host) || new Map();
    jar.set(u.host, cookies);
    if (attrs.some((a) => /max-age=0/i.test(a))) cookies.delete(name);
    else cookies.set(name, { value, path: pathAttr ? pathAttr.slice(5) : '/' });
  };
  const header = (url) => {
    const u = new URL(url);
    return [...(jar.get(u.host) || new Map())]
      .filter(([, c]) => u.pathname.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join('; ');
  };
  const calls = [];
  return {
    calls,
    async http({ url, method = 'GET', headers = {}, body = null, cookies = true, followRedirects = true }) {
      let current = url;
      let m = method;
      let b = body;
      for (let hop = 0; hop < 10; hop++) {
        calls.push(`${m} ${current}`);
        const h = { ...headers };
        const c = cookies ? header(current) : '';
        if (c) h.Cookie = c;
        const res = await fetch(current, { method: m, headers: h, body: m === 'GET' ? undefined : b, redirect: 'manual' });
        if (cookies) for (const sc of res.headers.getSetCookie()) remember(current, sc);
        const loc = res.headers.get('location');
        const location = loc ? new URL(loc, current).toString() : null;
        if (followRedirects && res.status >= 300 && res.status < 400 && location && /^https?:/.test(location)) {
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === 'POST')) {
            m = 'GET';
            b = null;
          }
          current = location;
          continue;
        }
        return { status: res.status, url: current, location, headers: Object.fromEntries(res.headers), body: await res.text() };
      }
      throw new Error('Zu viele Weiterleitungen');
    },
    async setCookie({ url, cookie }) {
      remember(url, cookie);
    },
    async clearOrigins() {},
    addListener() {}
  };
}

test('Handy: WebUntis und Eduvidual über die Android-Anfragelogik', async () => {
  const native = fakeNative();
  const nativeFile = path.join(__dirname, '..', 'mobile', 'core', 'native.js');
  require.cache[nativeFile] = { id: nativeFile, filename: nativeFile, loaded: true, exports: { Native: native, SystemBars: {} } };

  const platform = require('../src/main/platform');
  platform.use(require('../mobile/core/android-web'));
  const { Store } = require('../src/main/store');
  const { SyncManager } = require('../src/main/sync');
  const { startOfWeek } = require('../src/main/util/dates');
  const { start, WEBUNTIS } = require('./e2e/mock-server');

  const server = await start(0);
  const base = `http://localhost:${server.port}`;
  try {
    const written = [];
    const store = new Store(null, { readAll: () => [], write: (json) => written.push(json) });
    store.updateSettings({
      platforms: {
        webuntis: { server: base, school: WEBUNTIS.school, username: WEBUNTIS.user, authMode: 'key' },
        eduvidual: { url: `${base}/moodle` }
      }
    });
    const values = { 'webuntis.key': WEBUNTIS.secret };
    const secrets = {
      get: (k) => values[k],
      set: (k, v) => (v ? (values[k] = v) : delete values[k]),
      has: (k) => Boolean(values[k]),
      available: () => true
    };
    await native.setCookie({ url: `${base}/moodle/`, cookie: 'MoodleSession=ok; Path=/moodle' });

    const sync = new SyncManager({ store, secrets, onChange: () => {} });
    await sync.syncOne('webuntis');
    await sync.syncOne('eduvidual');

    const state = store.data.sourceState;
    assert.equal(state.webuntis.status, 'ok', `WebUntis: ${state.webuntis.message}\n${(sync.logs.webuntis || []).join('\n')}`);
    assert.equal(state.eduvidual.status, 'ok', `Eduvidual: ${state.eduvidual.message}\n${(sync.logs.eduvidual || []).join('\n')}`);
    assert.equal(store.data.items.webuntis.length, 3);
    assert.equal(store.data.items.eduvidual.length, 3);
    // Eduvidual: App-Zugang über die moodlemobile://-Weiterleitung eingerichtet
    assert.ok(values['eduvidual.token'], 'Eduvidual-Token gespeichert');
    assert.ok(native.calls.some((c) => c.includes('/admin/tool/mobile/launch.php')));

    const week = await sync.timetable(startOfWeek(Date.now()));
    assert.ok(week.lessons.length > 0, 'Stundenplan geladen');
  } finally {
    server.close();
  }
});
