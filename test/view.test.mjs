/**
 * Tests der Sichten-Filterung: node --test test/*.test.mjs
 *
 * Geprüft wird nicht Feld für Feld, sondern über eine Umkehrung: In der
 * fertigen Sicht wird nach Karten-IDs gesucht (sie sehen aus wie `v7-1` und
 * verraten schon in der ID ihren Wert), und jede gefundene muss der
 * Zuschauer sehen dürfen – egal, in welchem Feld sie steckt.
 *
 * Der Maßstab dafür ist `secretHands`: eine zweite, aus dem Zustand
 * hergeleitete Antwort auf die Frage „welche Karten liegen gerade verdeckt
 * in einer Hand, die dieser Zuschauer nicht kennen darf?“. Sie ist bewusst
 * unabhängig von view.js formuliert, sonst prüfte der Test nur sich selbst.
 * `assertHandsSecret` steht deshalb in jedem Test, nicht nur in den
 * offensichtlichen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CaboGame, PHASE, GameError } from '../js/engine.js';
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

/** Nimmt eine Karte aus Stapel oder Ablage – damit sie nicht doppelt existiert. */
function lift(state, id) {
  for (const pile of [state.deck, state.discard]) {
    const at = pile.indexOf(id);
    if (at >= 0) return pile.splice(at, 1)[0];
  }
  for (const p of state.players) {
    const at = p.hand.indexOf(id);
    if (at >= 0) {
      p.hand[at] = null;
      return id;
    }
  }
  throw new Error(`Karte ${id} liegt nirgends`);
}

/** Setzt eine Hand; die verdrängten Karten wandern zurück in den Stapel. */
function setHand(game, playerId, ids) {
  const s = game.state;
  for (const id of ids) lift(s, id);
  for (const old of s.players[playerId].hand) if (old != null) s.deck.unshift(old);
  s.players[playerId].hand = ids.slice();
  s.knowledge[playerId] = {};
}

/** Legt eine bestimmte Karte oben auf den Nachziehstapel. */
function stackDeck(game, id) {
  lift(game.state, id);
  game.state.deck.push(id);
}

/** Alle Karten-IDs, die irgendwo in der Sicht auftauchen. */
function idsIn(view) {
  return new Set(JSON.stringify(view).match(/v\d+-\d+/g) ?? []);
}

/**
 * Welche Handkarten dieser Zuschauer *nicht* kennen darf – unabhängig von
 * view.js aus dem Zustand hergeleitet.
 */
function secretHands(state, audience) {
  const secret = new Set();
  if (state.roundResult) return secret; // Rundenende: alles liegt offen

  const allowed = new Set();
  const r = state.reveal;
  if (r && (r.isPublic || (audience !== TABLE && r.viewer === audience))) {
    for (const c of r.cards) allowed.add(c.cardId);
  }
  if (audience !== TABLE && state.rules.memoryAid) {
    for (const [slot, id] of Object.entries(state.knowledge[audience] ?? {})) {
      if (state.players[audience].hand[Number(slot)] === id) allowed.add(id);
    }
  }
  // Karten, die der ganze Tisch legitim kennt, aus dem Verlauf hergeleitet –
  // absichtlich nicht aus `state.publicCards`, denn genau diese Buchführung
  // der Engine soll der Test ja prüfen und nicht nur nachplappern.
  for (const e of state.log) {
    if (e.round !== state.round) continue;
    if (e.type === 'swapDrawn') {
      allowed.delete(e.cardOut); // verlässt die Hand
      if (e.from === 'discard') allowed.add(e.cardIn); // offen hineingelegt
    }
    // Misslungene Ansage: die Karten bleiben liegen, gesehen hat sie jeder.
    if (e.type === 'multiClaim' && !e.hit) for (const id of e.cards) allowed.add(id);
    if (e.type === 'multiResolve' && e.hit) for (const d of e.dropped) allowed.delete(d.card);
  }

  for (const p of state.players) {
    for (const id of p.hand) if (id != null && !allowed.has(id)) secret.add(id);
  }
  return secret;
}

/** Die Kernzusicherung: keine verdeckte Handkarte steht in der Sicht. */
function assertHandsSecret(view, state, msg = 'Sicht') {
  const secret = secretHands(state, view.audience);
  const found = [...idsIn(view)].filter((id) => secret.has(id));
  assert.deepEqual(found, [], `${msg}: ${found.join(', ')} durchgesickert`);
}

/** Beide Sichten auf einmal prüfen. */
function assertAllViewsSecret(state, msg) {
  assertHandsSecret(tableView(state), state, `${msg} (Tisch)`);
  for (const p of state.players) {
    assertHandsSecret(playerView(state, p.id), state, `${msg} (${p.name})`);
  }
}

/** Gezielte Prüfung, wenn eine ganz bestimmte Karte draußen bleiben muss. */
function assertNoLeak(view, forbidden, msg) {
  const found = [...idsIn(view)].filter((id) => [...forbidden].includes(id));
  assert.deepEqual(found, [], `${msg}: ${found.join(', ')} durchgesickert`);
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
    [0, 1, 2, 3].map(() => ({ filled: true, known: false, open: false, cardId: null })),
  );
  assertHandsSecret(view, s);
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
    assertHandsSecret(view, s, `Sicht von ${p.name}`);
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
  assertHandsSecret(view, s);
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
  assertAllViewsSecret(s, 'Merkhilfe');
});

test('Veraltetes Wissen fällt aus Markierung und Werten heraus', () => {
  const game = newGame(['Anna', 'Bea'], { memoryAid: true });
  completeInitialPeeks(game);
  const s = game.state;

  // Wissen auf einen Platz setzen, der inzwischen etwas anderes trägt.
  const stale = s.deck[0];
  s.knowledge[0][0] = stale;
  const view = playerView(s, 0);

  assert.equal(view.you.knowledge['0'], undefined);
  // Markierung und Werte müssen sich einig sein: keine Marke ohne Karte.
  assert.equal(view.players[0].slots[0].known, false);
  assertNoLeak(view, [stale], 'veraltetes Wissen');
});

test('Jede Marke am Platz hat auch einen Wert dabei', () => {
  const game = newGame(['Anna', 'Bea'], { memoryAid: true });
  completeInitialPeeks(game);
  const s = game.state;

  for (const p of s.players) {
    const view = playerView(s, p.id);
    view.players[p.id].slots.forEach((slot, i) => {
      if (!slot.known) return;
      const id = view.you.knowledge[i];
      assert.ok(id != null, `Platz ${i} ist markiert, aber ohne Karte`);
      assert.ok(view.cards[id], `Platz ${i} nennt eine Karte, die nicht mitkommt`);
    });
  }
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
  assertAllViewsSecret(s, 'nach dem Ziehen');
});

test('turn.mine gilt auch, bevor gezogen wurde', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;

  const mine = playerView(s, actor);
  assert.equal(mine.turn.drawn, null);
  assert.equal(mine.turn.mine, true, 'wer am Zug ist, muss das auch im Zug-Feld sehen');
  assert.equal(mine.you.isCurrent, true);

  const other = playerView(s, (actor + 1) % 3);
  assert.equal(other.turn.mine, false);
  assert.equal(tableView(s).turn.mine, false);
});

test('Eine Karte aus der Ablage ist für alle offen', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.takeDiscard();
  const s = game.state;

  const view = tableView(s);
  assert.equal(view.turn.drawn, s.drawn);
  assert.equal(view.cards[s.drawn].value, s.cards[s.drawn].value);
  assertHandsSecret(view, s);
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
  assertAllViewsSecret(s, 'Anfangsphase');
});

test('Spy zeigt die fremde Karte nur dem Spion', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;
  const victim = (actor + 1) % 3;

  stackDeck(game, 'v9-0'); // Spy
  game.drawFromDeck();
  game.discardDrawn();
  assert.equal(s.power.type, POWER.SPY);
  game.selectCard(victim, 0);

  const spied = s.players[victim].hand[0];
  assert.equal(playerView(s, actor).reveal.cards[0].cardId, spied);
  assertNoLeak(tableView(s), [spied], 'Spy am Tisch');
  assertNoLeak(playerView(s, victim), [spied], 'Spy beim Ausspionierten');
  assertHandsSecret(tableView(s), s, 'Spy');
  assertHandsSecret(playerView(s, victim), s, 'Spy');
});

test('Öffentliche Aufdeckung der Mehrfach-Ablage geht an alle', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: true });
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;
  setHand(game, actor, ['v4-0', 'v4-1', 'v9-0', 'v11-0']);

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
  assertAllViewsSecret(s, 'Mehrfach-Ablage');
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
  assertAllViewsSecret(s, 'Verlauf');
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

test('Nach dem Nachmischen ist eine abgelegte Karte wieder geheim', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: false });
  completeInitialPeeks(game);
  const s = game.state;

  // Eine Karte ohne Kraft offen abwerfen – ab hier ist sie öffentlich.
  stackDeck(game, 'v0-0');
  game.drawFromDeck();
  game.discardDrawn();
  assert.ok(s.discard.includes('v0-0'));
  assert.ok(tableView(s).cards['v0-0'], 'auf der Ablage muss sie sichtbar sein');

  // Stapel leerräumen und nachmischen lassen: die Ablage wandert zurück.
  if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
  s.deck = [];
  game.drawFromDeck();
  assert.ok(
    s.log.some((e) => e.type === 'reshuffle'),
    'für diesen Test muss nachgemischt worden sein',
  );

  // Die Karte landet verdeckt in einer Hand – niemand darf sie mehr sehen.
  s.drawn = null;
  s.drawnFrom = null;
  s.phase = PHASE.TURN;
  lift(s, 'v0-0');
  s.players[1].hand[0] = 'v0-0';

  assertNoLeak(tableView(s), ['v0-0'], 'nachgemischte Karte am Tisch');
  assertNoLeak(playerView(s, 0), ['v0-0'], 'nachgemischte Karte beim Mitspieler');
  assertAllViewsSecret(s, 'nach dem Nachmischen');
});

// Die Ereignisarten stehen hier fest aufgeschrieben, nicht aus einer
// Beispielpartie eingesammelt: sonst prüft der Test nur, was diese eine
// Partie zufällig auslöst, und ein vergessener Fall fällt nicht auf.
const ENGINE_EVENTS = [
  'roundStart',
  'reshuffle',
  'draw',
  'cabo',
  'swapDrawn',
  'discardDrawn',
  'multiStart',
  'multiCancel',
  'multiSelect',
  'multiClaim',
  'multiResolve',
  'powerSkip',
  'initialPeek',
  'powerPeek',
  'powerSpy',
  'powerSwap',
  'turnEnd',
  'roundEnd',
];

/** Ein Beispiel-Ereignis je Art, mit allen Feldern, die der Text braucht. */
const SAMPLE_EVENT = {
  roundStart: { startPlayer: 1, hands: [['v1-0'], ['v2-0']] },
  reshuffle: { actor: 0, deckLeft: 12 },
  draw: { actor: 0, from: 'deck', card: 'v5-0' },
  cabo: { actor: 1, turnsRemaining: 1 },
  swapDrawn: { actor: 0, from: 'deck', slot: 2, cardIn: 'v5-0', cardOut: 'v6-0' },
  discardDrawn: { actor: 0, card: 'v7-0', power: 'peek' },
  multiStart: { actor: 1, drawn: 'v5-0' },
  multiCancel: { actor: 1, slots: [0, 1] },
  multiSelect: { actor: 1, slot: 0, picked: true },
  multiClaim: { actor: 0, slots: [0, 1], cards: ['v4-0', 'v4-1'], values: [4, 4], hit: true },
  multiResolve: {
    actor: 0,
    hit: true,
    dropped: [{ slot: 0, card: 'v4-0' }],
    targetSlot: 0,
    drawn: 'v5-0',
  },
  powerSkip: { actor: 0, power: 'peek' },
  initialPeek: { actor: 1, slot: 3, card: 'v8-0' },
  powerPeek: { actor: 0, owner: 0, slot: 1, card: 'v8-0' },
  powerSpy: { actor: 0, owner: 1, slot: 2, card: 'v9-0' },
  powerSwap: {
    actor: 0,
    own: { owner: 0, slot: 0, card: 'v1-0' },
    target: { owner: 1, slot: 1, card: 'v2-0' },
  },
  turnEnd: { actor: 0, next: 1 },
  roundEnd: { reason: 'cabo', sums: [4, 9], points: [0, 9], caller: 0 },
};

test('ENGINE_EVENTS deckt genau das ab, was die Engine schreibt', () => {
  const source = readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8');
  const inSource = new Set([...source.matchAll(/type: '([a-zA-Z]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...inSource].sort(), [...ENGINE_EVENTS].sort());
});

test('publicLog schreibt für jede Ereignisart einen Text', () => {
  const game = newGame(['Anna', 'Bea']);
  const s = game.state;
  s.log = ENGINE_EVENTS.map((type, i) => ({
    n: i + 1,
    round: s.round,
    phase: s.phase,
    type,
    ...SAMPLE_EVENT[type],
  }));

  const written = publicLog(s);
  assert.deepEqual(
    ENGINE_EVENTS.filter((type) => !written.some((e) => e.type === type)),
    [],
    'Ereignisart ohne Text',
  );
  for (const entry of written) {
    assert.equal(/undefined|NaN/.test(entry.text), false, `${entry.type}: „${entry.text}“`);
    assert.equal(/v\d+-\d+/.test(entry.text), false, `${entry.type} nennt eine Karten-ID`);
  }
});

test('Auch multiCancel und powerSkip landen im öffentlichen Verlauf', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: true });
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;

  stackDeck(game, 'v7-0'); // Peek
  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(actor, 0);
  game.cancelMultiDiscard();
  game.discardDrawn();
  game.skipPower();

  const texts = publicLog(s).map((e) => e.text);
  assert.ok(texts.some((t) => /bricht die Mehrfach-Ablage ab/.test(t)));
  assert.ok(texts.some((t) => /lässt die Kraft \(Peek\) verfallen/.test(t)));
  assertAllViewsSecret(s, 'nach Abbruch und Verfall');
});

test('Ein ganzer Zugdurchlauf hält alle Hände dicht', () => {
  const game = newGame(['Anna', 'Bea', 'Cem'], { multiDiscard: true }, 3);
  completeInitialPeeks(game);
  const s = game.state;

  let guard = 0;
  while (s.phase !== PHASE.ROUND_END && guard++ < 300) {
    assertAllViewsSecret(s, `Zug ${guard}`);
    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else if (s.phase === PHASE.TURN) {
      if (guard % 7 === 0 && s.discard.length) game.takeDiscard();
      else game.drawFromDeck();
    } else if (s.phase === PHASE.DRAWN) {
      if (guard % 3 === 0 && s.drawnFrom === 'deck') game.discardDrawn();
      else game.swapDrawnWith(guard % 4);
    } else if (s.phase === PHASE.POWER) {
      const p = s.power;
      if (p.type === POWER.PEEK) game.selectCard(s.current, 0);
      else if (p.type === POWER.SPY) game.selectCard((s.current + 1) % 3, 0);
      else if (p.step === 'own') game.selectCard(s.current, 0);
      else game.selectCard((s.current + 1) % 3, 1);
    } else throw new Error(`unerwartete Phase: ${s.phase}`);
  }
  assert.ok(guard > 20, 'die Partie sollte über etliche Züge laufen');
});

// ------------------------------------------------------------------ Rest

test('viewFor wählt zwischen Tisch und Spieler', () => {
  const game = newGame();
  const s = game.state;
  assert.equal(viewFor(s, TABLE).audience, TABLE);
  assert.equal(viewFor(s, 1).audience, 1);
  assert.throws(() => playerView(s, 9), GameError);
});

test('Sichten sind reines JSON und ändern den Zustand nicht', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const before = game.toJSON();
  const view = playerView(game.state, 0);
  assert.equal(game.toJSON(), before);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});

// ------------------------------------------------- Öffentlich bekannt

test('Aus der Ablage getauschte Karte bleibt für alle sichtbar', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;

  game.takeDiscard();
  const taken = s.drawn;
  game.swapDrawnWith(2);

  assert.deepEqual(s.publicCards, [taken]);
  const table = tableView(s);
  assert.equal(table.players[actor].slots[2].open, true);
  assert.equal(table.cards[taken].value, s.cards[taken].value);
  // Die Nachbarplätze bleiben zu.
  assert.equal(table.players[actor].slots[0].open, false);
  assertHandsSecret(table, s, 'offen getauschte Karte');
});

test('Eine misslungene Ansage macht die aufgedeckten Karten öffentlich', () => {
  const game = newGame(['Anna', 'Bea'], { multiDiscard: true });
  completeInitialPeeks(game);
  const s = game.state;
  const actor = s.current;
  setHand(game, actor, ['v4-0', 'v5-0', 'v9-0', 'v11-0']);

  game.drawFromDeck();
  game.startMultiDiscard();
  game.selectCard(actor, 0);
  game.selectCard(actor, 1);
  game.confirmMultiDiscard();
  assert.equal(s.multi.hit, false);
  game.ackReveal();

  // Die Karten liegen weiter in der Hand – aber jetzt kennt sie jeder.
  assert.deepEqual(new Set(s.publicCards), new Set(['v4-0', 'v5-0']));
  const table = tableView(s);
  assert.equal(table.players[actor].slots[0].open, true);
  assert.equal(table.players[actor].slots[2].open, false);
  assertNoLeak(table, ['v9-0', 'v11-0'], 'nach misslungener Ansage');
});

test('Was die Hand verlässt, verliert seinen öffentlichen Stand', () => {
  const game = newGame(['Anna', 'Bea']);
  completeInitialPeeks(game);
  const s = game.state;

  game.takeDiscard();
  const taken = s.drawn;
  game.swapDrawnWith(1);
  assert.ok(s.publicCards.includes(taken));

  // Nächste Runde derselben Karte: wieder verdeckt.
  s.nextStart = 0;
  game.startRound();
  assert.deepEqual(s.publicCards, []);
});

test('Die Buchführung der Engine deckt sich mit dem hergeleiteten Maßstab', () => {
  const game = newGame(['Anna', 'Bea', 'Cem'], { multiDiscard: true }, 12);
  completeInitialPeeks(game);
  const s = game.state;

  let guard = 0;
  while (s.phase !== PHASE.ROUND_END && guard++ < 300) {
    // publicCards darf nie eine Karte nennen, die gar nicht in einer Hand liegt.
    const inHands = new Set(s.players.flatMap((p) => p.hand).filter(Boolean));
    for (const id of s.publicCards) {
      assert.ok(inHands.has(id), `${id} steht in publicCards, liegt aber in keiner Hand`);
    }
    assertAllViewsSecret(s, `Schritt ${guard}`);

    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else if (s.phase === PHASE.TURN) {
      if (guard % 4 === 0 && s.discard.length) game.takeDiscard();
      else game.drawFromDeck();
    } else if (s.phase === PHASE.DRAWN) {
      if (guard % 3 === 0 && s.drawnFrom === 'deck') game.discardDrawn();
      else game.swapDrawnWith(guard % 4);
    } else if (s.phase === PHASE.POWER) {
      const p = s.power;
      if (p.type === POWER.PEEK) game.selectCard(s.current, 0);
      else if (p.type === POWER.SPY) game.selectCard((s.current + 1) % 3, 0);
      else game.selectCard(p.step === 'own' ? s.current : (s.current + 1) % 3, 0);
    }
  }
  assert.ok(guard > 20);
});

test('Ein Platz nennt seine Karte nur, wenn der Zuschauer sie sehen darf', () => {
  const game = newGame(['Anna', 'Bea'], { memoryAid: true });
  completeInitialPeeks(game);
  const s = game.state;

  for (const audience of [TABLE, 0, 1]) {
    const view = viewFor(s, audience);
    for (const seat of view.players) {
      seat.slots.forEach((slot, i) => {
        if (slot.cardId == null) return;
        // Genannt heißt: begründet genannt – und dann auch mit Wert dabei.
        assert.ok(slot.known || slot.open, `Platz ${i} nennt eine Karte ohne Grund`);
        assert.ok(view.cards[slot.cardId], `Platz ${i} nennt eine Karte ohne Wert`);
        assert.equal(slot.cardId, s.players[seat.id].hand[i]);
      });
    }
    assertHandsSecret(view, s, `Platz-IDs (${audience})`);
  }
});
