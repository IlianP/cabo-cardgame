/**
 * Tests des Service Workers, soweit sie ohne Browser gehen.
 *
 * Geprüft wird die echte `sw.js`: Sie läuft in einer eigenen Sandbox, in
 * der `fetch`, `caches` und `self` nachgebaut sind. So lässt sich der
 * Seitenaufruf durchspielen – Netz da, Netz weg, Server meldet Fehler –,
 * ohne einen Browser zu starten und ohne die Datei für Tests umzubauen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const SOURCE = await readFile(new URL('sw.js', ROOT), 'utf8');
const ORIGIN = 'https://cabo.test';

/** Eine Antwort, so weit der Service Worker sie anfasst. */
function response(status, body, type = 'basic') {
  return {
    status,
    ok: status >= 200 && status < 300,
    type,
    body,
    clone() {
      return response(status, body, type);
    },
  };
}

/**
 * `sw.js` in eine frische Sandbox laden.
 *
 * @param {object} options
 * @param {(request) => Promise} options.network  was `fetch()` liefert
 * @param {Record<string, object>} [options.cached]  Cache-Inhalt vorab
 */
function loadServiceWorker({ network, cached = {} }) {
  const handlers = {};
  const store = new Map();
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, `${ORIGIN}/`).href;
  for (const [path, res] of Object.entries(cached)) store.set(key(path), res);

  const precached = [];
  const cache = {
    put: async (request, res) => void store.set(key(request), res),
    addAll: async (list) => void precached.push(...list),
  };
  const sandbox = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type, fn) => (handlers[type] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      open: async () => cache,
      match: async (request) => store.get(key(request)),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: (request) => network(request),
    URL,
  };
  vm.runInNewContext(SOURCE, sandbox);

  /** Einen Seitenaufruf durchspielen und warten, bis alles geschrieben ist. */
  async function navigate(path = './') {
    let answer;
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: key(path) },
      respondWith: (promise) => (answer = promise),
    });
    const result = await answer;
    await new Promise((r) => setImmediate(r)); // das Schreiben in den Cache läuft nebenher
    return result;
  }

  /** Installation durchspielen; liefert die Liste, die vorab in den Cache geht. */
  async function install() {
    let done;
    handlers.install({ waitUntil: (promise) => (done = promise) });
    await done;
    return precached;
  }

  return { navigate, install, store, key };
}

const GAME = response(200, 'das Spiel');

test('Ein Serverfehler ersetzt die gecachte Seite nicht', async () => {
  const sw = loadServiceWorker({
    network: async () => response(503, 'Wartungsarbeiten'),
    cached: { './': GAME },
  });

  const shown = await sw.navigate('./');
  assert.equal(shown.body, 'das Spiel', 'die funktionierende Seite geht vor');
  assert.equal(sw.store.get(sw.key('./')).body, 'das Spiel', 'sonst zeigt offline künftig den Fehler');
});

test('Ein Serverfehler bei unbekannter Seite fällt auf das Spiel zurück', async () => {
  const sw = loadServiceWorker({
    network: async () => response(404, 'Nicht gefunden'),
    cached: { 'index.html': GAME },
  });

  const shown = await sw.navigate('./?platz=2');
  assert.equal(shown.body, 'das Spiel');
  assert.equal(sw.store.has(sw.key('./?platz=2')), false, 'Fehler landen nicht im Cache');
});

test('Ohne irgendetwas im Cache kommt die Fehlerseite durch', async () => {
  const sw = loadServiceWorker({ network: async () => response(503, 'Wartungsarbeiten') });

  const shown = await sw.navigate('./');
  assert.equal(shown.status, 503, 'besser als gar nichts');
  assert.equal(sw.store.size, 0);
});

test('Eine erfolgreiche Antwort kommt frisch an und landet im Cache', async () => {
  const sw = loadServiceWorker({
    network: async () => response(200, 'neue Fassung'),
    cached: { './': GAME },
  });

  const shown = await sw.navigate('./');
  assert.equal(shown.body, 'neue Fassung', 'Seitenaufrufe kommen zuerst aus dem Netz');
  assert.equal(sw.store.get(sw.key('./')).body, 'neue Fassung');
});

test('Ohne Netz kommt die Seite aus dem Cache', async () => {
  const sw = loadServiceWorker({
    network: async () => {
      throw new TypeError('Failed to fetch');
    },
    cached: { 'index.html': GAME },
  });

  const shown = await sw.navigate('multi.html');
  assert.equal(shown.body, 'das Spiel');
});

test('Eine Weiterleitung wird durchgereicht, nicht ersetzt und nicht gecacht', async () => {
  const sw = loadServiceWorker({
    network: async () => response(0, '', 'opaqueredirect'),
    cached: { './': GAME },
  });

  const shown = await sw.navigate('./');
  assert.equal(shown.type, 'opaqueredirect', 'der Browser folgt ihr selbst');
  assert.equal(sw.store.get(sw.key('./')).body, 'das Spiel');
});

// ------------------------------------------------------- Offline-Liste

test('Jede Skript- und Stildatei liegt offline bereit', async () => {
  const assets = await loadServiceWorker({ network: async () => GAME }).install();
  for (const dir of ['js', 'css']) {
    for (const name of await readdir(new URL(`${dir}/`, ROOT))) {
      // Fehlt eine Datei, lädt die Seite offline nur halb – und zwar erst
      // dann, wenn jemand sie importiert. Das fällt sonst niemandem auf.
      assert.ok(assets.includes(`${dir}/${name}`), `${dir}/${name} fehlt in ASSETS von sw.js`);
    }
  }
});

test('Jeder Eintrag der Offline-Liste existiert', async () => {
  const assets = await loadServiceWorker({ network: async () => GAME }).install();
  // `cache.addAll` scheitert ganz, wenn auch nur eine Datei fehlt – dann
  // ist offline gar nichts im Cache.
  for (const path of assets) {
    const file = path === './' ? 'index.html' : path;
    await assert.doesNotReject(access(new URL(file, ROOT)), `${path} gibt es nicht`);
  }
});
