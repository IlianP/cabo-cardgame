/**
 * Tests des Debug-Zustands: node --test test/*.test.mjs
 *
 * Geprüft wird zweierlei: dass die Engine jeden Zug strukturiert
 * protokolliert, und dass der kopierbare Text die Lage vollständig
 * wiedergibt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CaboGame, PHASE } from '../js/engine.js';
import { mulberry32 } from '../js/deck.js';
import { buildDebugReport } from '../js/debug.js';

function newGame(names = ['Anna', 'Bea'], rules = {}, seed = 7) {
  return new CaboGame({ players: names.map((name) => ({ name })), rules, rng: mulberry32(seed) });
}

function completeInitialPeeks(game) {
  while (game.state.phase !== PHASE.TURN) {
    const s = game.state;
    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.PEEK) {
      const me = s.peek.order[s.peek.index];
      game.selectCard(me, s.players[me].hand.findIndex((_, i) => !s.peek.taken.includes(i)));
    } else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else throw new Error(`unerwartete Phase: ${s.phase}`);
  }
}

const typesOf = (game) => game.state.log.map((e) => e.type);
const lastOf = (game, type) => [...game.state.log].reverse().find((e) => e.type === type);

// ------------------------------------------------------------- Ereignisse

test('jeder Eintrag im Verlauf trägt Nummer, Runde und Art', () => {
  const game = newGame();
  completeInitialPeeks(game);

  const log = game.state.log;
  assert.ok(log.length > 0);
  assert.deepEqual(
    log.map((e) => e.n),
    log.map((_, i) => i + 1),
    'die Nummern laufen lückenlos',
  );
  for (const entry of log) {
    assert.equal(typeof entry.type, 'string');
    assert.equal(entry.round, 1);
    assert.equal(typeof entry.text, 'string');
  }
  assert.equal(typesOf(game)[0], 'roundStart');
});

test('Ziehen und Tauschen stehen mit Karte und Platz im Verlauf', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const before = game.state.players[0].hand[2];

  game.state.deck.push('v3-0');
  game.drawFromDeck();
  game.selectCard(0, 2);

  const draw = lastOf(game, 'draw');
  assert.equal(draw.card, 'v3-0');
  assert.equal(draw.from, 'deck');
  assert.equal(draw.actor, 0);

  const swap = lastOf(game, 'swapDrawn');
  assert.equal(swap.slot, 2);
  assert.equal(swap.cardIn, 'v3-0');
  assert.equal(swap.cardOut, before);
  assert.deepEqual(swap.hand, game.state.players[0].hand);
});

test('die Mehrfach-Ablage protokolliert Auswahl, Ansage und Auflösung', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.state.players[0].hand = ['v1-0', 'v1-1', 'v8-0', 'v9-0'];

  game.state.deck.push('v0-0');
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(0, 0);
  game.selectCard(0, 1);
  game.confirmMultiDiscard();
  game.ackReveal();

  assert.deepEqual(
    lastOf(game, 'multiSelect').slots,
    [0, 1],
    'die zuletzt gewählten Plätze stehen im Eintrag',
  );

  const claim = lastOf(game, 'multiClaim');
  assert.equal(claim.hit, true);
  assert.deepEqual(claim.slots, [0, 1]);
  assert.deepEqual(claim.cards, ['v1-0', 'v1-1']);
  assert.deepEqual(claim.values, [1, 1]);

  const resolve = lastOf(game, 'multiResolve');
  assert.equal(resolve.hit, true);
  assert.deepEqual(
    resolve.dropped,
    [
      { slot: 0, card: 'v1-0' },
      { slot: 1, card: 'v1-1' },
    ],
    'welche Karte von welchem Platz weggelegt wurde',
  );
  assert.equal(resolve.targetSlot, 0);
  assert.equal(resolve.drawn, 'v0-0');
  assert.deepEqual(resolve.hand, game.state.players[0].hand, 'die Hand danach');
});

test('der Verlauf übersteht Speichern und Laden', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const copy = CaboGame.fromJSON(game.toJSON());
  assert.deepEqual(copy.state.log, game.state.log);

  copy.drawFromDeck();
  const last = copy.state.log[copy.state.log.length - 1];
  assert.equal(last.type, 'draw');
  assert.equal(last.n, game.state.log.length + 1, 'die Nummerierung läuft weiter');
});

test('der Verlauf wächst nicht unbegrenzt', () => {
  const game = newGame();
  game.state.log = Array.from({ length: 200 }, (_, i) => ({ n: i + 1, type: 'x', text: 'x' }));
  game.state.logSeq = 200;
  game.log('noch einer', { type: 'test' });
  assert.equal(game.state.log.length, 200);
  assert.equal(game.state.log[199].text, 'noch einer');
});

// ----------------------------------------------------------------- Bericht

test('der Debug-Bericht enthält Lage, Hände, Stapel und Verlauf', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  game.state.players[0].hand = ['v1-0', 'v1-1', 'v8-0', 'v9-0'];

  const report = buildDebugReport(game);

  assert.match(report, /CABO – DEBUG-ZUSTAND/);
  assert.match(report, /Phase:\s+turn/);
  assert.match(report, /Am Zug:\s+#0 Anna/);
  assert.match(report, /#0 Anna\s+1:v1-0\(1\)\s+2:v1-1\(1\)/, 'Plätze mit Karte und Wert');
  assert.match(report, /Σ19/, 'die Handsumme steht dabei');
  assert.match(report, /Nachziehstapel: \d+ Karten/);
  assert.match(report, /VERLAUF/);
  assert.match(report, /roundStart/);
  assert.match(report, /debugState=true/, 'die Regeln stehen im Bericht');
});

test('der Bericht enthält den Rohzustand als gültiges JSON', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const report = buildDebugReport(game);
  const raw = report.slice(report.indexOf('ROHZUSTAND (JSON)') + 'ROHZUSTAND (JSON)'.length);
  const parsed = JSON.parse(raw.trim());
  assert.deepEqual(parsed.players[0].hand, game.state.players[0].hand);
  assert.equal(parsed.phase, game.state.phase);
});

test('leere Plätze und offene Phasen stehen lesbar im Bericht', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.state.players[0].hand = ['v1-0', null, 'v8-0', null];
  game.state.deck.push('v0-0');
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(0, 0);

  const report = buildDebugReport(game);
  assert.match(report, /2:leer/);
  assert.match(report, /Phase:\s+multi \(gewählte Plätze \(1-basiert\): 1\)/);
  assert.match(report, /Gezogen:\s+v0-0\(0\) \(aus: deck\)/);
});
