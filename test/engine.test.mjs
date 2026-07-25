/**
 * Tests der Spiellogik: node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CaboGame, PHASE, GameError } from '../js/engine.js';
import { createDeck, mulberry32, POWER } from '../js/deck.js';
import { DEFAULT_RULES } from '../js/rules.js';

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

// ------------------------------------------------------------------ Deck

test('Deck hat 54 Karten mit den Cabo-Werten', () => {
  const deck = createDeck(DEFAULT_RULES);
  assert.equal(deck.length, 54);

  const by = Object.fromEntries(deck.map((c) => [c.id, c]));
  assert.equal(by.SA.value, 1);
  assert.equal(by.S10.value, 10);
  assert.equal(by.SB.value, 11);
  assert.equal(by.SD.value, 12);
  assert.equal(by.SK.value, 13, 'schwarzer König zählt 13');
  assert.equal(by.HK.value, -1, 'roter König zählt -1');
  assert.equal(by.DK.value, -1);
  assert.equal(by.X0.value, 0, 'Joker zählt 0');

  assert.equal(by.S7.power, POWER.PEEK);
  assert.equal(by.S8.power, POWER.PEEK);
  assert.equal(by.S9.power, POWER.SPY);
  assert.equal(by.S10.power, POWER.SPY);
  assert.equal(by.SB.power, POWER.SWAP);
  assert.equal(by.SD.power, POWER.SWAP);
  assert.equal(by.SK.power, POWER.KING);
  assert.equal(by.HK.power, null, 'der rote König hat keine Kraft');
  assert.equal(by.S2.power, null);
});

test('roter König lässt sich auf 0 stellen und die Königskraft abschalten', () => {
  const deck = createDeck({ ...DEFAULT_RULES, redKingValue: 0, kingPower: false });
  const by = Object.fromEntries(deck.map((c) => [c.id, c]));
  assert.equal(by.HK.value, 0);
  assert.equal(by.SK.power, null);
});

// ----------------------------------------------------------------- Aufbau

test('Rundenaufbau teilt vier Karten aus und legt eine Karte ab', () => {
  const game = newGame();
  const s = game.state;
  assert.equal(s.round, 1);
  for (const p of s.players) assert.equal(p.hand.length, 4);
  assert.equal(s.discard.length, 1);
  assert.equal(s.deck.length, 54 - 3 * 4 - 1);
  assert.equal(s.phase, PHASE.HANDOFF, 'es beginnt mit einer Geräteübergabe');
});

test('alle Karten bleiben eindeutig verteilt', () => {
  const game = newGame(['A', 'B', 'C', 'D']);
  const s = game.state;
  const all = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand)];
  assert.equal(all.length, 54);
  assert.equal(new Set(all).size, 54);
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
});

test('Spähen deckt eine eigene Karte auf, Spionieren eine fremde', () => {
  const game = newGame();
  completeInitialPeeks(game);

  game.state.deck.push('S7');
  game.drawFromDeck();
  game.discardDrawn();
  assert.equal(game.state.phase, PHASE.POWER);
  assert.throws(() => game.selectCard(1, 0), GameError, 'fremde Karte ist tabu');
  game.selectCard(0, 1);
  assert.equal(game.state.phase, PHASE.REVEAL);
  assert.equal(game.state.reveal.viewer, 0);
  assert.equal(game.state.reveal.cards[0].owner, 0);
  game.ackReveal();
  assert.equal(game.state.phase, PHASE.HANDOFF, 'danach ist der nächste dran');

  game.confirmHandoff();
  game.state.deck.push('S9');
  game.drawFromDeck();
  game.discardDrawn();
  assert.throws(() => game.selectCard(1, 0), GameError, 'eigene Karte ist tabu');
  game.selectCard(2, 3);
  assert.equal(game.state.reveal.cards[0].owner, 2);
  assert.equal(game.state.reveal.viewer, 1, 'sehen darf nur, wer spioniert');
});

test('Bube tauscht blind zwei Karten', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const mine = game.state.players[0].hand[0];
  const theirs = game.state.players[2].hand[3];

  game.state.deck.push('SB');
  game.drawFromDeck();
  game.discardDrawn();
  game.selectCard(0, 0);
  assert.equal(game.state.power.step, 'target');
  game.selectCard(2, 3);

  assert.equal(game.state.players[0].hand[0], theirs);
  assert.equal(game.state.players[2].hand[3], mine);
  assert.equal(game.state.phase, PHASE.HANDOFF, 'blind heißt: nichts wird gezeigt');
});

test('König zeigt eine Karte und lässt dann entscheiden', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const mine = game.state.players[0].hand[1];
  const theirs = game.state.players[1].hand[2];

  game.state.deck.push('SK');
  game.drawFromDeck();
  game.discardDrawn();
  game.selectCard(0, 1);
  game.selectCard(1, 2);
  assert.equal(game.state.power.step, 'look');
  assert.throws(() => game.selectCard(2, 0), GameError, 'nur die beiden gewählten Karten');

  game.selectCard(1, 2);
  assert.equal(game.state.reveal.cards[0].cardId, theirs);
  game.ackReveal();
  assert.equal(game.state.power.step, 'decide');

  game.resolveKing(true);
  assert.equal(game.state.players[0].hand[1], theirs);
  assert.equal(game.state.players[1].hand[2], mine);
});

test('König kann auch liegen lassen', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const mine = game.state.players[0].hand[1];
  game.state.deck.push('SK');
  game.drawFromDeck();
  game.discardDrawn();
  game.selectCard(0, 1);
  game.selectCard(1, 2);
  game.selectCard(0, 1);
  game.ackReveal();
  game.resolveKing(false);
  assert.equal(game.state.players[0].hand[1], mine);
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

// ------------------------------------------------------------- Cabo & Punkte

/** Ruft Cabo für Spieler 0 und lässt alle anderen einen leeren Zug machen. */
function callCaboAndFinish(game) {
  game.state.current = 0;
  game.state.phase = PHASE.TURN;
  game.callCabo();
  let guard = 0;
  while (game.state.phase !== PHASE.ROUND_END) {
    if (guard++ > 50) throw new Error('Runde endet nicht');
    if (game.state.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (game.state.phase === PHASE.TURN) drawAndDiscard(game);
    else if (game.state.phase === PHASE.REVEAL) game.ackReveal();
    else throw new Error(`unerwartete Phase: ${game.state.phase}`);
  }
}

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
    ['SA', 'S2', 'S3', 'S4'], // 10
    ['S5', 'S6', 'S7', 'S8'], // 26
  ]);
  callCaboAndFinish(game);

  const r = game.state.roundResult;
  assert.equal(r.callerOk, true);
  assert.deepEqual(r.sums, [10, 26]);
  assert.deepEqual(r.points, [0, 26]);
  assert.deepEqual(game.state.players.map((p) => p.score), [0, 26]);
});

test('misslungener Cabo-Ruf kostet Strafpunkte', () => {
  const game = newGame(['Anna', 'Bea'], { caboPenalty: 5 });
  completeInitialPeeks(game);
  setHands(game, [
    ['S5', 'S6', 'S7', 'S8'], // 26
    ['SA', 'S2', 'S3', 'S4'], // 10
  ]);
  callCaboAndFinish(game);

  const r = game.state.roundResult;
  assert.equal(r.callerOk, false);
  assert.deepEqual(r.points, [31, 10]);
});

test('Gleichstand zählt für den Rufer – oder eben nicht', () => {
  for (const [tie, expected] of [
    [true, 0],
    [false, 10 + 10],
  ]) {
    const game = newGame(['Anna', 'Bea'], { tieCountsForCaller: tie, caboPenalty: 10 });
    completeInitialPeeks(game);
    setHands(game, [
      ['SA', 'S2', 'S3', 'S4'],
      ['HA', 'H2', 'H3', 'H4'],
    ]);
    callCaboAndFinish(game);
    assert.equal(game.state.roundResult.points[0], expected);
  }
});

test('der rote König drückt die Summe', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [
    ['HK', 'DK', 'X0', 'SA'], // -1 -1 + 0 + 1 = -1
    ['S5', 'S6', 'S7', 'S8'],
  ]);
  callCaboAndFinish(game);
  assert.equal(game.state.roundResult.sums[0], -1);
});

test('Punktlandung halbiert den Stand – aber nur einmal', () => {
  const game = newGame(['Anna', 'Bea'], { targetScore: 100, resetAtHundred: true });
  completeInitialPeeks(game);
  game.state.players[0].score = 90;
  setHands(game, [
    ['S5', 'S5'.replace('S', 'H'), 'X0', 'X0'.replace('0', '1')], // 5 + 5 + 0 + 0 = 10
    ['SA', 'S2', 'S3', 'S4'],
  ]);
  game.state.current = 1;
  game.state.phase = PHASE.TURN;
  game.callCabo(); // Bea ruft und gewinnt, Anna kassiert ihre 10
  game.confirmHandoff();
  drawAndDiscard(game);

  assert.equal(game.state.players[0].score, 50, '100 wird zu 50');
  assert.equal(game.state.players[0].usedReset, true);
  assert.equal(game.state.gameOver, false);
});

test('Spiel endet, sobald jemand die Zielpunktzahl erreicht', () => {
  const game = newGame(['Anna', 'Bea'], { targetScore: 100, resetAtHundred: false });
  completeInitialPeeks(game);
  game.state.players[1].score = 95;
  setHands(game, [
    ['SA', 'S2', 'S3', 'S4'], // 10
    ['S9', 'S10', 'SB', 'SD'], // 42
  ]);
  callCaboAndFinish(game);
  assert.equal(game.state.gameOver, true);
  game.nextRound();
  assert.equal(game.state.phase, PHASE.GAME_END);
  assert.equal(game.standings()[0].name, 'Anna');
});

test('Shoot the Moon dreht die Abrechnung um', () => {
  const game = newGame(['Anna', 'Bea'], { shootTheMoon: true });
  completeInitialPeeks(game);
  setHands(game, [
    ['SD', 'HD', 'SK', 'CK'], // zwei Damen + beide schwarzen Könige
    ['SA', 'S2', 'S3', 'S4'],
  ]);
  game.state.current = 1;
  game.state.phase = PHASE.TURN;
  game.callCabo();
  game.confirmHandoff();
  drawAndDiscard(game);
  assert.deepEqual(game.state.roundResult.points, [0, 50]);
});

// -------------------------------------------------------------- Einwerfen

test('Einwerfen: Treffer wird man los, daneben kostet eine Strafkarte', () => {
  const game = newGame(['Anna', 'Bea'], { snapEnabled: true });
  completeInitialPeeks(game);

  // Anna wirft eine Sieben ab, Bea hat ebenfalls eine Sieben.
  game.state.deck.push('S7');
  game.state.players[1].hand[0] = 'H7';
  game.drawFromDeck();
  game.discardDrawn();
  game.skipPower();
  assert.equal(game.state.phase, PHASE.SNAP_WINDOW);

  game.snapClaim(1);
  game.confirmHandoff();
  game.selectCard(1, 0);
  assert.equal(game.state.reveal.isPublic, true, 'ein Einwurf wird offen gezeigt');
  game.ackReveal();
  assert.equal(game.state.players[1].hand[0], null, 'der Platz bleibt leer');
  assert.equal(game.state.discard[game.state.discard.length - 1], 'H7');

  // Zweiter Durchgang: daneben gegriffen.
  game.confirmHandoff();
  game.state.deck.push('S2');
  game.state.players[0].hand[1] = 'H5';
  game.drawFromDeck();
  game.discardDrawn();
  game.snapClaim(0);
  game.confirmHandoff();
  const handSizeBefore = game.state.players[0].hand.filter(Boolean).length;
  game.selectCard(0, 1);
  game.ackReveal();
  assert.equal(game.state.players[0].hand[1], 'H5', 'die Karte bleibt liegen');
  assert.equal(game.state.players[0].hand.filter(Boolean).length, handSizeBefore + 1);
});

test('leere Plätze zählen nicht mit und lassen sich nicht wählen', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  setHands(game, [[null, 'S3', null, 'S4'], ['S5', 'S6', 'S7', 'S8']]);
  assert.equal(game.handSum(0), 7);
  game.drawFromDeck();
  assert.throws(() => game.swapDrawnWith(0), GameError);
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

test('die Runden wechseln den Startspieler', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  assert.equal(game.state.startPlayer, 0);
  callCaboAndFinish(game);
  game.nextRound();
  assert.equal(game.state.round, 2);
  assert.equal(game.state.startPlayer, 1);
});
