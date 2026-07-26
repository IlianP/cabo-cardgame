/**
 * Tests der Spiellogik: node --test test/*.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CaboGame, PHASE, GameError } from '../js/engine.js';
import { createDeck, mulberry32, copiesOf, powerOf, POWER } from '../js/deck.js';

// ------------------------------------------------------------- Hilfsmittel

function newGame(names = ['Anna', 'Bea', 'Cem'], rules = {}, seed = 7) {
  return new CaboGame({
    players: names.map((name) => ({ name })),
    rules,
    rng: mulberry32(seed),
  });
}

/** Spielt die Anfangsphase durch: jeder sieht sich seine Startkarten an. */
function completeInitialPeeks(game) {
  let guard = 0;
  while (game.state.phase !== PHASE.TURN) {
    if (guard++ > 200) throw new Error('Anfangsphase endet nicht');
    const s = game.state;
    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.PEEK) {
      const me = s.peek.order[s.peek.index];
      const slot = s.players[me].hand.findIndex((_, i) => !s.peek.taken.includes(i));
      game.selectCard(me, slot);
    } else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else throw new Error(`unerwartete Phase: ${s.phase}`);
  }
}

/** Ein Zug, der die eigene Hand unverändert lässt: ziehen und abwerfen. */
function drawAndDiscard(game) {
  game.drawFromDeck();
  game.discardDrawn();
  if (game.state.phase === PHASE.POWER) game.skipPower();
}

function setHands(game, hands) {
  hands.forEach((hand, i) => {
    game.state.players[i].hand = hand.slice();
  });
}

/** Legt eine Karte mit bestimmtem Wert oben auf den Nachziehstapel. */
function stackDeck(game, value, copy = 0) {
  game.state.deck.push(`v${value}-${copy}`);
}

/** Ruft Cabo für einen Spieler und lässt alle anderen einen leeren Zug machen. */
function callCaboAndFinish(game, caller = 0) {
  game.state.current = caller;
  game.state.phase = PHASE.TURN;
  game.callCabo();
  let guard = 0;
  while (game.state.phase !== PHASE.ROUND_END) {
    if (guard++ > 50) throw new Error('Runde endet nicht');
    const phase = game.state.phase;
    if (phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (phase === PHASE.TURN) drawAndDiscard(game);
    else if (phase === PHASE.REVEAL) game.ackReveal();
    else throw new Error(`unerwartete Phase: ${phase}`);
  }
}

// ------------------------------------------------------------------ Deck

test('Deck hat 52 Karten mit den Werten 0 bis 13', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);

  const count = {};
  for (const c of deck) count[c.value] = (count[c.value] ?? 0) + 1;
  assert.equal(count[0], 2, 'die 0 liegt zweimal im Deck');
  assert.equal(count[13], 2, 'die 13 liegt zweimal im Deck');
  for (let v = 1; v <= 12; v++) assert.equal(count[v], 4, `Wert ${v} liegt viermal im Deck`);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52, 'alle Karten sind eindeutig');
});

test('Kartenkräfte hängen am Wert, die 13 hat keine', () => {
  assert.equal(powerOf(6), null);
  assert.equal(powerOf(7), POWER.PEEK);
  assert.equal(powerOf(8), POWER.PEEK);
  assert.equal(powerOf(9), POWER.SPY);
  assert.equal(powerOf(10), POWER.SPY);
  assert.equal(powerOf(11), POWER.SWAP);
  assert.equal(powerOf(12), POWER.SWAP);
  assert.equal(powerOf(13), null, 'die 13 hat keine Kartenkraft');
  assert.equal(powerOf(0), null);
  assert.equal(copiesOf(0), 2);
  assert.equal(copiesOf(5), 4);
});

// ----------------------------------------------------------------- Aufbau

test('Rundenaufbau teilt vier Karten aus und legt eine Karte ab', () => {
  const game = newGame();
  const s = game.state;
  assert.equal(s.round, 1);
  for (const p of s.players) assert.equal(p.hand.length, 4);
  assert.equal(s.discard.length, 1);
  assert.equal(s.deck.length, 52 - 3 * 4 - 1);
  assert.equal(s.phase, PHASE.HANDOFF, 'es beginnt mit einer Geräteübergabe');
});

test('alle Karten bleiben eindeutig verteilt', () => {
  const game = newGame(['A', 'B', 'C', 'D']);
  const s = game.state;
  const all = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand)];
  assert.equal(all.length, 52);
  assert.equal(new Set(all).size, 52);
});

test('jeder sieht genau zwei Startkarten, danach beginnt der erste Zug', () => {
  const game = newGame();
  completeInitialPeeks(game);
  assert.equal(game.state.phase, PHASE.TURN);
  assert.equal(game.state.current, 0);
  for (const p of game.state.players) {
    assert.equal(Object.keys(game.state.knowledge[p.id]).length, 2);
  }
});

test('eine Karte lässt sich in der Anfangsphase nicht zweimal ansehen', () => {
  const game = newGame();
  game.confirmHandoff();
  game.selectCard(0, 0);
  game.ackReveal();
  assert.throws(() => game.selectCard(0, 0), GameError);
});

// ------------------------------------------------------------------ Züge

test('Übergabe schützt den Zug: vorher geht nichts', () => {
  const game = newGame();
  assert.throws(() => game.drawFromDeck(), GameError);
});

test('PIN-Sperre lässt nur den richtigen Spieler weiter', () => {
  const game = new CaboGame({
    players: [
      { name: 'Anna', pin: '1234' },
      { name: 'Bea', pin: '9999' },
    ],
    rules: { usePins: true },
    rng: mulberry32(3),
  });
  assert.equal(game.confirmHandoff('0000').ok, false);
  assert.equal(game.state.phase, PHASE.HANDOFF);
  assert.equal(game.confirmHandoff('1234').ok, true);
  assert.equal(game.state.phase, PHASE.PEEK);
});

test('gezogene Karte tauschen: Handkarte wandert offen auf die Ablage', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const before = game.state.players[0].hand[2];
  game.drawFromDeck();
  const drawn = game.state.drawn;
  game.swapDrawnWith(2);
  assert.equal(game.state.players[0].hand[2], drawn);
  assert.equal(game.state.discard[game.state.discard.length - 1], before);
  assert.equal(game.state.knowledge[0][2], drawn, 'die eingetauschte Karte kennt man');
});

test('Karte aus der Ablage muss getauscht werden', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.takeDiscard();
  assert.equal(game.state.drawnFrom, 'discard');
  assert.throws(() => game.discardDrawn(), GameError);
  assert.throws(() => game.startMultiDiscard(), GameError, 'auch keine Mehrfach-Ablage');
});

test('Peek zeigt eine eigene Karte, Spy eine fremde', () => {
  const game = newGame();
  completeInitialPeeks(game);

  stackDeck(game, 7);
  game.drawFromDeck();
  game.discardDrawn();
  assert.equal(game.state.phase, PHASE.POWER);
  assert.throws(() => game.selectCard(1, 0), GameError, 'fremde Karte ist tabu');
  game.selectCard(0, 1);
  assert.equal(game.state.phase, PHASE.REVEAL);
  assert.equal(game.state.reveal.viewer, 0);
  game.ackReveal();
  assert.equal(game.state.phase, PHASE.HANDOFF, 'danach ist der nächste dran');

  game.confirmHandoff();
  stackDeck(game, 9);
  game.drawFromDeck();
  game.discardDrawn();
  assert.throws(() => game.selectCard(1, 0), GameError, 'eigene Karte ist tabu');
  game.selectCard(2, 3);
  assert.equal(game.state.reveal.cards[0].owner, 2);
  assert.equal(game.state.reveal.viewer, 1, 'sehen darf nur, wer spioniert');
});

test('Swap tauscht blind zwei Karten', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const mine = game.state.players[0].hand[0];
  const theirs = game.state.players[2].hand[3];

  stackDeck(game, 11);
  game.drawFromDeck();
  game.discardDrawn();
  game.selectCard(0, 0);
  assert.equal(game.state.power.step, 'target');
  game.selectCard(2, 3);

  assert.equal(game.state.players[0].hand[0], theirs);
  assert.equal(game.state.players[2].hand[3], mine);
  assert.equal(game.state.phase, PHASE.HANDOFF, 'blind heißt: nichts wird gezeigt');
});

test('die 13 löst keine Kartenkraft aus', () => {
  const game = newGame();
  completeInitialPeeks(game);
  stackDeck(game, 13);
  game.drawFromDeck();
  game.discardDrawn();
  assert.equal(game.state.phase, PHASE.HANDOFF);
});

test('leerer Nachziehstapel: die Ablage wird neu gemischt', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const parked = game.state.deck.splice(0, game.state.deck.length);
  game.state.discard = [...parked.slice(0, 5), ...game.state.discard];
  const top = game.state.discard[game.state.discard.length - 1];

  game.drawFromDeck();
  assert.ok(game.state.deck.length > 0, 'es wurde nachgemischt');
  assert.equal(game.state.discard[game.state.discard.length - 1], top, 'die oberste Karte bleibt liegen');
});

// ----------------------------------------------------------- Mehrfach-Ablage

test('Mehrfach-Ablage: richtige Ansage macht Plätze frei', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [
    ['v5-0', 'v5-1', 'v5-2', 'v9-0'],
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'],
  ]);

  stackDeck(game, 0);
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(0, 0);
  game.selectCard(0, 1);
  game.selectCard(0, 2);
  assert.deepEqual(game.state.multi.slots, [0, 1, 2]);
  game.confirmMultiDiscard();
  assert.equal(game.state.reveal.isPublic, true, 'die Ansage wird offen gezeigt');
  assert.equal(game.state.reveal.cards.length, 3);
  game.ackReveal();

  assert.deepEqual(game.state.players[0].hand, ['v0-0', null, null, 'v9-0']);
  assert.equal(game.handSum(0), 9, 'nur noch die gezogene 0 und die 9');
  assert.equal(game.state.phase, PHASE.HANDOFF, 'der Zug ist vorbei');
});

test('Mehrfach-Ablage: falsche Ansage kostet den Zug', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [
    ['v5-0', 'v6-0', 'v7-0', 'v9-0'],
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'],
  ]);
  const before = game.state.players[0].hand.slice();

  stackDeck(game, 0);
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(0, 0);
  game.selectCard(0, 1);
  game.confirmMultiDiscard();
  game.ackReveal();

  assert.deepEqual(game.state.players[0].hand, before, 'die Hand bleibt unverändert');
  assert.equal(game.state.discard[game.state.discard.length - 1], 'v0-0', 'die gezogene Karte ist weg');
});

test('Mehrfach-Ablage: Auswahl lässt sich abwählen und abbrechen', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(0, 1);
  game.selectCard(0, 1);
  assert.deepEqual(game.state.multi.slots, []);
  assert.throws(() => game.confirmMultiDiscard(), GameError, 'unter zwei Karten geht nicht');
  game.cancelMultiDiscard();
  assert.equal(game.state.phase, PHASE.DRAWN);
});

test('abgeschaltete Mehrfach-Ablage lässt sich nicht starten', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: false });
  completeInitialPeeks(game);
  game.drawFromDeck();
  assert.throws(() => game.startMultiDiscard(), GameError);
});

// ------------------------------------------------------------- Cabo & Punkte

test('nach dem Cabo-Ruf hat jeder andere genau einen Zug', () => {
  const game = newGame(['Anna', 'Bea', 'Cem']);
  completeInitialPeeks(game);
  game.callCabo();
  assert.equal(game.state.cabo.caller, 0);
  assert.equal(game.state.cabo.turnsRemaining, 2);

  game.confirmHandoff();
  drawAndDiscard(game);
  assert.equal(game.state.cabo.turnsRemaining, 1);
  game.confirmHandoff();
  drawAndDiscard(game);
  assert.equal(game.state.phase, PHASE.ROUND_END);
});

test('geglückter Cabo-Ruf bringt null Punkte', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10
    ['v5-0', 'v6-0', 'v7-0', 'v8-0'], // 26
  ]);
  callCaboAndFinish(game, 0);

  const r = game.state.roundResult;
  assert.equal(r.callerOk, true);
  assert.deepEqual(r.sums, [10, 26]);
  assert.deepEqual(r.points, [0, 26]);
});

test('misslungener Cabo-Ruf: Strafpunkte für den Rufer, 0 für die niedrigste Summe', () => {
  const game = newGame(['Anna', 'Bea', 'Cem'], { caboPenalty: 5 });
  completeInitialPeeks(game);
  setHands(game, [
    ['v5-0', 'v6-0', 'v7-0', 'v8-0'], // 26 – ruft Cabo
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10 – niedrigste Summe
    ['v9-0', 'v2-1', 'v3-1', 'v4-1'], // 18
  ]);
  callCaboAndFinish(game, 0);

  const r = game.state.roundResult;
  assert.equal(r.callerOk, false);
  assert.deepEqual(r.points, [31, 0, 18], 'Bea bekommt die 0, obwohl sie nicht gerufen hat');
});

test('ohne Cabo-Ruf bekommen alle mit der niedrigsten Summe null Punkte', () => {
  const game = newGame(['Anna', 'Bea', 'Cem']);
  completeInitialPeeks(game);
  setHands(game, [
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10
    ['v1-1', 'v2-1', 'v3-1', 'v4-1'], // 10
    ['v9-0', 'v9-1', 'v3-2', 'v4-2'], // 25
  ]);
  game.state.deck = [];
  game.state.discard = [game.state.discard[0]];
  game.state.current = 0;
  game.state.phase = PHASE.TURN;
  game.drawFromDeck();

  assert.equal(game.state.phase, PHASE.ROUND_END);
  assert.equal(game.state.roundResult.reason, 'deckEmpty');
  assert.deepEqual(game.state.roundResult.points, [0, 0, 25]);
});

test('bei Gleichstand gewinnt der Cabo-Sager', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10 – ruft Cabo
    ['v1-1', 'v2-1', 'v3-1', 'v4-1'], // 10
  ]);
  callCaboAndFinish(game, 0);

  const r = game.state.roundResult;
  assert.equal(r.callerOk, true);
  assert.deepEqual(r.points, [0, 10], 'der Gleichstands-Partner zahlt seine Summe');
});

test('Shoot the Moon dreht die Abrechnung um', () => {
  const game = newGame(['Anna', 'Bea'], { shootTheMoon: true });
  completeInitialPeeks(game);
  setHands(game, [
    ['v12-0', 'v12-1', 'v13-0', 'v13-1'],
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'],
  ]);
  callCaboAndFinish(game, 1);
  assert.deepEqual(game.state.roundResult.points, [0, 50]);
});

test('Punktlandung halbiert den Stand – aber nur einmal', () => {
  const game = newGame(['Anna', 'Bea'], { targetScore: 100 });
  completeInitialPeeks(game);
  game.state.players[0].score = 90;
  setHands(game, [
    ['v5-0', 'v5-1', 'v0-0', 'v0-1'], // 10
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10 – ruft Cabo und gewinnt den Gleichstand
  ]);
  callCaboAndFinish(game, 1);

  assert.equal(game.state.players[0].score, 50, '100 wird zu 50');
  assert.equal(game.state.players[0].usedReset, true);
  assert.equal(game.state.gameOver, false);
});

test('Spiel endet, sobald jemand über der Zielpunktzahl liegt', () => {
  const game = newGame(['Anna', 'Bea'], { targetScore: 100, resetAtHundred: false });
  completeInitialPeeks(game);
  game.state.players[1].score = 95;
  setHands(game, [
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10
    ['v9-0', 'v10-0', 'v11-0', 'v12-0'], // 42
  ]);
  callCaboAndFinish(game, 0);
  assert.equal(game.state.gameOver, true);
  game.nextRound();
  assert.equal(game.state.phase, PHASE.GAME_END);
  assert.equal(game.standings()[0].name, 'Anna');
});

// ------------------------------------------------------------- Startspieler

test('der Gewinner der Vorrunde beginnt die nächste', () => {
  const game = newGame(['Anna', 'Bea', 'Cem'], { winnerStarts: true });
  completeInitialPeeks(game);
  setHands(game, [
    ['v9-0', 'v9-1', 'v8-0', 'v8-1'], // 34 – ruft Cabo, liegt daneben
    ['v7-0', 'v7-1', 'v6-0', 'v6-1'], // 26
    ['v1-0', 'v2-0', 'v3-0', 'v4-0'], // 10 – Sieger
  ]);
  callCaboAndFinish(game, 0);
  assert.deepEqual(game.state.roundResult.winners, [2]);
  game.nextRound();
  assert.equal(game.state.startPlayer, 2, 'Cem beginnt Runde 2');
});

test('ohne die Regel wechselt der Startspieler einfach reihum', () => {
  const game = newGame(['Anna', 'Bea'], { winnerStarts: false });
  completeInitialPeeks(game);
  assert.equal(game.state.startPlayer, 0);
  callCaboAndFinish(game, 0);
  game.nextRound();
  assert.equal(game.state.startPlayer, 1);
});

// ------------------------------------------------------------- Speichern

test('Spielstand übersteht Speichern und Laden', () => {
  const game = newGame(['Anna', 'Bea', 'Cem']);
  completeInitialPeeks(game);
  game.drawFromDeck();

  const copy = CaboGame.fromJSON(game.toJSON());
  assert.deepEqual(copy.state, game.state);

  copy.swapDrawnWith(1);
  assert.equal(copy.state.phase, PHASE.HANDOFF);
  assert.equal(copy.state.current, 1);
});

test('leere Plätze zählen nicht mit und lassen sich nicht wählen', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [[null, 'v3-0', null, 'v4-0'], ['v5-0', 'v6-0', 'v7-0', 'v8-0']]);
  assert.equal(game.handSum(0), 7);
  game.drawFromDeck();
  assert.throws(() => game.swapDrawnWith(0), GameError);
});
