/**
 * Tests der Sichten-Filterung: node --test test/*.test.mjs
 *
 * Der Kern dieser Datei ist `assertNoLeak`: In der fertigen Sicht wird nach
 * Karten-IDs gesucht (sie sehen aus wie `v7-1` und verraten schon in der ID
 * ihren Wert). Jede gefundene ID muss der Zuschauer sehen dürfen – egal, in
 * welchem Feld sie steckt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CaboGame, PHASE } from '../js/engine.js';
import { mulberry32, POWER } from '../js/deck.js';
import { tableView, playerView, viewFor, publicLog, TABLE } from '../js/view.js';

// ------------------------------------------------------------- Hilfsmittel

function newGame(names = ['Anna', 'Bea', 'Cem'], rules = {}, seed = 7) {
  return new CaboGame({
    players: names.map((name, i) => ({ name, pin: i === 0 ? '1234' : '' })),
    rules,
    rng: mulberry32(seed),
  });
}

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

/** Alle Karten-IDs, die irgendwo in der Sicht auftauchen. */
function idsIn(view) {
  return new Set(JSON.stringify(view).match(/v\d+-\d+/g) ?? []);
}

/**
 * Prüft, dass keine der verbotenen Karten in der Sicht steht.
 * @param {Set<string>|string[]} forbidden
 */
function assertNoLeak(view, forbidden, msg) {
  const found = [...idsIn(view)].filter((id) => [...forbidden].includes(id));
  assert.deepEqual(found, [], `${msg}: ${found.join(', ')} durchgesickert`);
}

/** Die Handkarten aller Spieler außer den genannten. */
function handsExcept(state, ...keep) {
  const out = new Set();
  for (const p of state.players) {
    if (keep.includes(p.id)) continue;
    for (const id of p.hand) if (id != null) out.add(id);
  }
  return out;
}

// ------------------------------------------------------------ Grundgerüst

test('Tischsicht kennt den öffentlichen Tisch, aber keine Hand', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const s = game.state;
  const view = tableView(s);

  assert.equal(view.audience, TABLE);
  assert.equal(view.phase, PHASE.TURN);
  assert.equal(view.deckLeft, s.deck.length);
  assert.equal(view.discardTop, s.discard[s.discard.length - 1]);
  assert.equal(view.players.length, 3);
  assert.equal(view.you, null);

  // Plätze sind da, Inhalte nicht.
  assert.deepEqual(
    view.players[0].slots,
    [0, 1, 2, 3].map(() => ({ filled: true, known: false })),
  );
  assertNoLeak(view, handsExcept(s), 'Tischsicht');
});

test('Tischsicht gibt keine PIN weiter', () => {
  const game = newGame();
  const view = tableView(game.state);
  assert.equal(view.players[0].hasPin, true);
  assert.equal(view.players[1].hasPin, false);
  assert.equal(JSON.stringify(view).includes('1234'), false);
});

test('Spielersicht verrät fremde Hände nicht', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const s = game.state;

  for (const p of s.players) {
    const view = playerView(s, p.id);
    assert.equal(view.you.id, p.id);
    assert.equal(view.players[p.id].mine, true);
    assertNoLeak(view, handsExcept(s, p.id), `Sicht von ${p.name}`);
  }
});

test('Ohne Merkhilfe bleibt auch die eigene Hand verdeckt', () => {
  const game = newGame(['Anna', 'Bea'], { memoryAid: false });
  completeInitialPeeks(game);
  const s = game.state;
  const view = playerView(s, 0);

  assert.deepEqual(view.you.knowledge, {});
  assert.equal(view.players[0].slots.some((slot) => slot.known), false);
  assertNoLeak(view, new Set(s.players[0].hand), 'eigene Hand ohne Merkhilfe');
});

test('Mit Merkhilfe kommen genau die selbst gesehenen Karten mit', () => {
  const game = newGame(['Anna', 'Bea'], { memoryAid: true });
  completeInitialPeeks(game);
  const s = game.state;
  const view = playerView(s, 0);

  const seen = Object.values(s.knowledge[0]);
  assert.equal(seen.length, 2);
  assert.deepEqual(new Set(Object.values(view.you.knowledge)), new Set(seen));
  for (const id of seen) assert.equal(view.cards[id].value, s.cards[id].value);

  // Die restlichen eigenen Karten bleiben trotzdem draußen.
  const unseen = s.players[0].hand.filter((id) => !seen.includes(id));
  assertNoLeak(view, new Set(unseen), 'ungesehene eigene Karten');
  assertNoLeak(view, handsExcept(s, 0), 'fremde Hand mit Merkhilfe');
});

test('Veraltetes Wissen fällt aus der Sicht heraus', () => {
  const game = newGame(['Anna', 'Bea'], { memoryAid: true });
  completeInitialPeeks(game);
  const s = game.state;

  // Wissen auf einen Platz setzen, der inzwischen etwas anderes trägt.
  const stale = s.deck[0];
  s.knowledge[0][0] = stale;
  const view = playerView(s, 0);

  assert.equal(view.you.knowledge['0'], undefined);
  assertNoLeak(view, [stale], 'veraltetes Wissen');
});

// -------------------------------------------------------------------- Zug

test('Die gezogene Karte sieht nur, wer am Zug ist', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.drawFromDeck();
  const s = game.state;
  const actor = s.current;

  const mine = playerView(s, actor);
  assert.equal(mine.turn.mine, true);
  assert.equal(mine.turn.drawn, s.drawn);
  assert.equal(mine.cards[s.drawn].value, s.cards[s.drawn].value);

  for (const other of [tableView(s), playerView(s, (actor + 1) % 3)]) {
    assert.equal(other.turn.drawn, null);
    assert.equal(other.turn.drawnFrom, 'deck');
    assertNoLeak(other, [s.drawn], 'gezogene Karte');
  }
});

test('Eine Karte aus der Ablage ist für alle offen', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.takeDiscard();
  const s = game.state;

  const view = tableView(s);
  assert.equal(view.turn.drawn, s.drawn);
  assert.equal(view.cards[s.drawn].value, s.cards[s.drawn].value);
});

test('Erlaubte Aktionen hängen an Phase und Spieler', () => {
  const game = newGame();
  const s = game.state;
  const first = s.handoff.to;

  assert.deepEqual(playerView(s, first).you.can, ['confirmHandoff']);
  assert.deepEqual(playerView(s, (first + 1) % 3).you.can, []);

  completeInitialPeeks(game);
  const actor = game.state.current;
  assert.deepEqual(playerView(game.state, actor).you.can, [
    'drawFromDeck',
    'takeDiscard',
    'callCabo',
  ]);
  assert.deepEqual(playerView(game.state, (actor + 1) % 3).you.can, []);

  game.drawFromDeck();
  assert.deepEqual(playerView(game.state, actor).you.can, [
    'selectCard',
    'discardDrawn',
    'startMultiDiscard',
  ]);
});

// -------------------------------------------------------------- Aufdecken

test('Private Aufdeckung geht nur an ihren Zuschauer', () => {
  const game = newGame();
  const s = game.state;
  game.confirmHandoff();
  const me = s.peek.order[s.peek.index];
  game.selectCard(me, 0);

  const shown = s.reveal.cards[0].cardId;
  const mine = playerView(s, me);
  assert.equal(mine.reveal.forMe, true);
  assert.equal(mine.reveal.cards[0].cardId, shown);
  assert.equal(mine.cards[shown].value, s.cards[shown].value);
  assert.ok(mine.you.can.includes('ackReveal'));

  const table = tableView(s);
  assert.equal(table.reveal.forMe, false);
  assert.equal(table.reveal.cards[0].cardId, null);
  assert.equal(table.reveal.cards[0].slot, 0);
  assertNoLeak(table, [shown], 'private Aufdeckung');

  const other = playerView(s, s.peek.order[1]);
  assert.equal(other.reveal.forMe, false);
  assert.deepEqual(other.you.can, []);
  assertNoLeak(other, [shown], 'private Aufdeckung beim Mitspieler');
});

test('Spy zeigt die fremde Karte nur dem Spion', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;
  const victim = (actor + 1) % 3;

  s.deck.push('v9-0'); // Spy
  game.drawFromDeck();
  game.discardDrawn();
  assert.equal(s.power.type, POWER.SPY);
  game.selectCard(victim, 0);

  const spied = s.players[victim].hand[0];
  assert.equal(playerView(s, actor).reveal.cards[0].cardId, spied);
  assertNoLeak(tableView(s), [spied], 'Spy am Tisch');
  assertNoLeak(playerView(s, victim), [spied], 'Spy beim Ausspionierten');
});

test('Öffentliche Aufdeckung der Mehrfach-Ablage geht an alle', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: true });
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;
  s.players[actor].hand = ['v4-0', 'v4-1', 'v9-0', 'v11-0'];

  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(actor, 0);
  game.selectCard(actor, 1);
  game.confirmMultiDiscard();

  const table = tableView(s);
  assert.equal(table.reveal.isPublic, true);
  assert.deepEqual(
    table.reveal.cards.map((c) => c.cardId),
    ['v4-0', 'v4-1'],
  );
  assert.equal(table.cards['v4-0'].value, 4);
  // Die übrigen Karten der Hand bleiben verdeckt.
  assertNoLeak(table, ['v9-0', 'v11-0'], 'Mehrfach-Ablage');
});

test('Am Rundenende liegen alle Hände offen', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  const s = game.state;
  s.current = 0;
  s.phase = PHASE.TURN;
  game.callCabo();
  while (s.phase !== PHASE.ROUND_END) {
    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else if (s.phase === PHASE.TURN) game.drawFromDeck();
    else if (s.phase === PHASE.DRAWN) game.swapDrawnWith(0);
    else if (s.phase === PHASE.POWER) game.skipPower();
    else throw new Error(`unerwartete Phase: ${s.phase}`);
  }

  const view = tableView(s);
  assert.equal(view.phase, PHASE.ROUND_END);
  assert.deepEqual(view.roundResult.hands, s.roundResult.hands);
  for (const hand of s.roundResult.hands) {
    for (const id of hand) assert.equal(view.cards[id].value, s.cards[id].value);
  }
  assert.deepEqual(playerView(s, 0).you.can, ['nextRound']);
});

// ---------------------------------------------------------------- Verlauf

test('Der öffentliche Verlauf schreibt keine geheimen Werte mit', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;
  const secret = s.players[actor].hand[0];

  game.drawFromDeck();
  const drawn = s.drawn;
  game.swapDrawnWith(0);

  const view = tableView(s);
  const texts = view.log.map((e) => e.text);
  assert.ok(texts.some((t) => /zieht vom Stapel/.test(t)));
  assert.ok(texts.some((t) => t.includes(`die ${s.cards[secret].value} kommt auf die Ablage`)));
  // Weder die frisch eingetauschte Karte noch die Startkarten stehen drin.
  assert.equal(texts.some((t) => /v\d+-\d+/.test(t)), false);
  assertNoLeak(view, [drawn], 'Verlauf nach Tausch');
  assertNoLeak(view, handsExcept(s), 'Verlauf');
});

test('Verlauf aus früheren Runden gibt keine Karten der laufenden Runde frei', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  const s = game.state;

  // Eine Karte in Runde 1 öffentlich machen …
  game.log('alt', { type: 'draw', actor: 0, from: 'discard', card: 'v3-0' });
  // … und sie dann in der neuen Runde auf eine Hand legen.
  s.round = 2;
  s.players[1].hand[0] = 'v3-0';

  assertNoLeak(tableView(s), ['v3-0'], 'alter Verlauf');
});

test('publicLog kennt alle Ereignisarten der Engine', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: true, shootTheMoon: false });
  completeInitialPeeks(game);
  const s = game.state;

  // Ein paar Züge, die möglichst viele Ereignisarten auslösen.
  const actor = s.current;
  s.players[actor].hand = ['v4-0', 'v4-1', 'v2-0', 'v5-0'];
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(actor, 0);
  game.selectCard(actor, 1);
  game.selectCard(actor, 1);
  game.selectCard(actor, 1);
  game.confirmMultiDiscard();
  game.ackReveal();
  if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
  s.deck.push('v11-0'); // Swap
  game.drawFromDeck();
  game.discardDrawn();
  game.selectCard(s.current, 0);
  game.selectCard((s.current + 1) % 2, 0);

  const seen = new Set(s.log.map((e) => e.type));
  const written = new Set(publicLog(s).map((e) => e.type));
  assert.deepEqual([...seen].filter((t) => !written.has(t)), [], 'Ereignisart ohne Text');
  assertNoLeak(tableView(s), handsExcept(s), 'Verlauf über mehrere Züge');
});

// ------------------------------------------------------------------ Rest

test('viewFor wählt zwischen Tisch und Spieler', () => {
  const game = newGame();
  const s = game.state;
  assert.equal(viewFor(s, TABLE).audience, TABLE);
  assert.equal(viewFor(s, 1).audience, 1);
  assert.throws(() => playerView(s, 9), /Diesen Spieler gibt es nicht/);
});

test('Sichten sind reines JSON und ändern den Zustand nicht', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const before = game.toJSON();
  const view = playerView(game.state, 0);
  assert.equal(game.toJSON(), before);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});
