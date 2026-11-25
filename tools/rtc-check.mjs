/**
 * Echter WebRTC-Handschlag zwischen zwei Browser-Seiten.
 *
 *   npx playwright@latest install chromium   # einmalig
 *   node tools/rtc-check.mjs
 *
 * Playwright muss nicht im Projekt liegen: Eine global oder anderswo
 * vorinstallierte Fassung wird ebenfalls gefunden (siehe unten).
 *
 * Warum als eigenes Werkzeug und nicht unter `npm test`: Dafür braucht es
 * einen echten Browser, und das Projekt soll ohne Abhängigkeiten
 * auskommen. `RTCPeerConnection` gibt es in Node nicht – die Teile, die
 * sich ohne Browser prüfen lassen, stehen in `test/webrtc.test.mjs`.
 *
 * Dieses Werkzeug spielt die Rolle, die später der QR-Code übernimmt: Es
 * trägt das Angebot zum Handy und die Antwort zurück zum Tisch. Mehr macht
 * ein QR-Code auch nicht – nur eben mit der Kamera.
 *
 * Geprüft wird: Verbindungsaufbau, Größe der Beschreibungen (passt das in
 * einen QR-Code?), Sichtfilterung über die echte Leitung, doppelte
 * Nachrichten und das Erkennen eines abgerissenen Geräts.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Playwright über `require` laden, nicht per `import`: ES-Module suchen nur
// in `node_modules` entlang des Pfads und ignorieren NODE_PATH und globale
// Installationen. Weil das Projekt bewusst keine Abhängigkeiten hat, liegt
// Playwright aber oft genau dort – global installiert oder in einer
// vorbereiteten Umgebung. `require` findet beides, und eine Installation
// im Projekt ebenso.
const { chromium } = createRequire(import.meta.url)('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const file = path.startsWith('/js/') ? join(ROOT, path) : join(HERE, path.slice(1) || 'rtc-check.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' });
    res.end(body);
  } catch (e) {
    res.writeHead(404).end(String(e));
  }
});
await new Promise((r) => server.listen(8095, r));

// PLAYWRIGHT_CHROMIUM erlaubt einen abweichenden Pfad; sonst der übliche.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const problems = [];
const open = async (label, query) => {
  // Eigener Kontext je Seite: getrennte Prozesse, wie zwei echte Geräte.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) problems.push(`${label}: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:8095/rtc-check.html?${query}`);
  await page.waitForFunction(() => Boolean(window.report));
  return page;
};

const table = await open('tisch', 'role=host');
const anna = await open('anna', 'role=device');
const bea = await open('bea', 'role=device');

const t0 = Date.now();

/** Ein Gerät anschließen – genau der Ablauf, den der QR-Code abbilden soll. */
async function connect(phone, seat, label) {
  const started = Date.now();
  // 1. Tisch erzeugt die Einladung (später: QR-Code auf dem Tisch)
  const invite = await table.evaluate(() => window.invite());
  // 2. Handy nimmt sie an und erzeugt die Antwort (später: QR auf dem Handy)
  const answer = await phone.evaluate((offer) => window.answerInvite(offer), invite.signal);
  // 3. Tisch nimmt die Antwort entgegen (später: Tisch scannt den QR)
  await table.evaluate(([id, a]) => window.accept(id, a), [invite.id, answer]);
  await phone.evaluate(() => window.waitOpen());
  await phone.evaluate((s) => window.join(s), seat);
  await phone.waitForFunction(() => window.report().audience !== null, null, { timeout: 8000 });
  console.log(
    `${label}: Angebot ${invite.signal.length} Zeichen, Antwort ${answer.length} Zeichen, ` +
      `verbunden nach ${Date.now() - started} ms`,
  );
  return { offer: invite.signal.length, answer: answer.length };
}

const sizeA = await connect(anna, 0, 'Anna');
const sizeB = await connect(bea, 1, 'Bea ');

console.log(`\nBeide Geräte verbunden nach ${Date.now() - t0} ms gesamt`);
console.log('Tisch sieht:', JSON.stringify(await table.evaluate(() => window.report())));

// --- Spielen: Anna bestätigt die Übergabe und sieht sich eine Karte an
const first = await table.evaluate(() => window.host.game.state.handoff.to);
const firstPhone = first === 0 ? anna : bea;
const otherPhone = first === 0 ? bea : anna;

await firstPhone.evaluate(() => window.act('confirmHandoff'));
await table.waitForFunction(() => window.report().phase === 'peek', null, { timeout: 5000 });
console.log('nach confirmHandoff:', JSON.stringify(await table.evaluate(() => window.report())));

await firstPhone.evaluate(() => window.act('selectCard', window.client.audience, 0));
await firstPhone.waitForFunction(() => window.report().phase === 'reveal', null, { timeout: 5000 });

const mine = await firstPhone.evaluate(() => window.report());
const others = await otherPhone.evaluate(() => window.report());
console.log('\n--- private Aufdeckung über die echte Verbindung');
console.log('eigene Sicht :', JSON.stringify({ phase: mine.phase, ids: mine.ids, can: mine.can }));
console.log('fremde Sicht :', JSON.stringify({ phase: others.phase, ids: others.ids, can: others.can }));

// --- Doppelter Tipp über die echte Leitung
await firstPhone.evaluate(() => {
  window.act('ackReveal');
  window.act('ackReveal');
});
await new Promise((r) => setTimeout(r, 600));
console.log('\nnach doppeltem ackReveal:', JSON.stringify(await table.evaluate(() => window.report())));
console.log('Fehler am Handy:', JSON.stringify((await firstPhone.evaluate(() => window.report())).errors));

// --- Verbindung kappen: merkt der Tisch das?
await anna.close();
const lost = Date.now();
try {
  await table.waitForFunction(() => window.report().waitingFor.includes(0), null, { timeout: 25000 });
  console.log(`\nTisch merkt den Verlust nach ${Date.now() - lost} ms:`,
    JSON.stringify(await table.evaluate(() => window.report())));
} catch {
  console.log('\nPROBLEM: Tisch merkt den Verlust nicht:',
    JSON.stringify(await table.evaluate(() => window.report())));
}

console.log(problems.length ? `\nPROBLEME:\n${problems.join('\n')}` : '\nkeine Konsolenfehler');
await browser.close();
server.close();
