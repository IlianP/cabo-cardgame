/**
 * Tests der Choreografie: node --test test/*.test.mjs
 *
 * Geprüft wird vor allem eine Zusage, die für den Sichtschutz zählt:
 *
 *   Eine Animation zeigt nie eine Karte offen, die an ihrem Ausgangsort
 *   verdeckt lag.
 *
 * Ohne diese Zusage wäre eine Animation ein Leck – der Weg von der Hand
 * auf die Ablage dauert einen Moment, und in diesem Moment darf niemand
 * mehr sehen als ohne Animation. Wie in view.test.mjs steht der Maßstab
 * dafür bewusst getrennt von der geprüften Datei: `publicSource` leitet
 * selbst her, welche Ausgangsorte offen liegen, statt scenes.js zu
 * glauben.
 *
 * Die Flugebene selbst (flight.js) braucht ein DOM und wird hier nicht
 * geprüft; testbar gehalten ist genau der Teil, in dem sich ein Fehler
 * nicht als Ruckeln zeigen würde, sondern als verratene Karte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CaboGame, PHASE } from '../js/engine.js';
import { mulberry32 } from '../js/deck.js';
import { ANCHOR, scenesFor, scenesForAll, newEntries, latestSeq } from '../js/scenes.js';
import { seatAngles, withOverrides, edgePoint, edgeName, VIEWER_ANGLE } from '../js/seating.js';
import { resolveAnchor, centeredCard } from '../js/anchors.js';

// ------------------------------------------------------------- Hilfsmittel

function newGame(names = ['Anna', 'Bea', 'Cem'], rules = {}, seed = 7) {
  return new CaboGame({
    players: names.map((name) => ({ name })),
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

/**
 * Liegt an diesem Ausgangsort eine Karte offen?
 *
 * Bewusst unabhängig von scenes.js formuliert und bewusst aus dem
 * *Verlaufseintrag* hergeleitet statt aus dem Zustand: Wenn die Oberfläche
 * die Animation zeichnet, hat die Engine den Zug längst zu Ende geführt
 * und Felder wie `drawnFrom` wieder geleert. Ein Maßstab, der dort
 * nachschaut, prüfte also den falschen Augenblick.
 *
 * Offen liegt: die Ablage. Verdeckt liegen: Nachziehstapel und jede Hand.
 * Der Ablagebereich hängt daran, woher die Karte kam – und abwerfen darf
 * man nur eine frisch gezogene, eine aus der Ablage muss getauscht werden.
 */
function publicSource(anchor, entry) {
  switch (anchor.kind) {
    case ANCHOR.DISCARD:
      return true;
    case ANCHOR.DRAWN:
      return entry.type === 'swapDrawn' && entry.from === 'discard';
    case ANCHOR.DECK:
    case ANCHOR.HAND:
      return false;
    default:
      return false;
  }
}

/** Der Kern des Ganzen – steht in jedem Spieltest, nicht nur im offensichtlichen. */
function assertNoLeak(entries) {
  for (const entry of entries) {
    for (const scene of scenesFor(entry)) {
      if (!scene.faceUp) continue;
      assert.ok(
        publicSource(scene.from, entry),
        `Flug ${scene.key} zeigt eine Karte offen, die an ihrem Ausgangsort (${scene.from.kind}) verdeckt lag`,
      );
    }
  }
}

/**
 * Spielt einen kompletten Zug und sammelt dabei alle entstandenen Flüge.
 *
 * `choose(game, step)` darf mehrere Aktionen hintereinander ausführen; mit
 * `step()` dazwischen wird – wie in der Oberfläche nach jeder Aktion –
 * einmal "gezeichnet" und geerntet.
 */
function playTurn(game, choose) {
  const collected = [];
  let seq = latestSeq(game.state);
  let guard = 0;

  const harvest = () => {
    const entries = newEntries(game.state, seq);
    seq = latestSeq(game.state);
    assertNoLeak(entries);
    const scenes = scenesForAll(entries);
    // Jede Flugbahn muss sich auf dem frisch gezeichneten Tisch auflösen
    // lassen – sonst fällt sie beim Abspielen still aus.
    assertResolvable(scenes, game.state);
    collected.push(...scenes);
  };

  const startedAt = game.state.current;
  while (guard++ < 60) {
    const s = game.state;
    if (s.phase === PHASE.HANDOFF) {
      if (s.handoff.to !== startedAt) break;
      game.confirmHandoff();
    } else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else if (s.phase === PHASE.TURN) choose(game, harvest);
    else if (s.phase === PHASE.DRAWN) game.discardDrawn();
    else if (s.phase === PHASE.POWER) game.skipPower();
    else break;
    harvest();
  }
  return collected;
}

// ------------------------------------------------------------------ Ziehen

test('vom Stapel gezogen fliegt die Karte verdeckt', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const seq = latestSeq(game.state);

  game.drawFromDeck();
  const entries = newEntries(game.state, seq);
  const scenes = scenesForAll(entries);

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].from.kind, ANCHOR.DECK);
  assert.equal(scenes[0].to.kind, ANCHOR.DRAWN);
  assert.equal(scenes[0].faceUp, false);
  assertNoLeak(entries);
});

test('aus der Ablage genommen fliegt die Karte offen', () => {
  const game = newGame();
  completeInitialPeeks(game);
  const seq = latestSeq(game.state);

  game.takeDiscard();
  const entries = newEntries(game.state, seq);
  const scenes = scenesForAll(entries);

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].from.kind, ANCHOR.DISCARD);
  assert.equal(scenes[0].faceUp, true);
  assertNoLeak(entries);
});

// ----------------------------------------------------------------- Abwerfen

test('eine abgeworfene Karte fliegt verdeckt und dreht sich erst beim Aufsetzen', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.drawFromDeck();
  const seq = latestSeq(game.state);

  game.discardDrawn();
  const entries = newEntries(game.state, seq);
  const toDiscard = scenesForAll(entries).filter((x) => x.to.kind === ANCHOR.DISCARD);

  assert.equal(toDiscard.length, 1);
  assert.equal(toDiscard[0].faceUp, false);
  assertNoLeak(entries);
});

test('abwerfen geht nur mit einer frisch gezogenen Karte', () => {
  // Diese Zusage der Engine trägt die Aussage oben: Käme eine offen
  // liegende Karte aus der Ablage in den Abwurf, müsste die Animation sie
  // offen zeigen. Bricht der Wächter weg, fällt dieser Test zuerst.
  const game = newGame();
  completeInitialPeeks(game);
  game.takeDiscard();
  assert.throws(() => game.discardDrawn(), /getauscht/);
});

/**
 * Der Bildschirm, wie flight.js ihn beim Abspielen vorfindet.
 *
 * Abgespielt wird erst *nach* dem Zeichnen des neuen Zustands. Was der Zug
 * weggeräumt hat, ist dann schon fort – allen voran die gezogene Karte im
 * Ablagebereich, sobald sie abgeworfen oder getauscht wurde. Stapel,
 * Ablage, der (womöglich leere) Ablagebereich und die Handplätze stehen
 * dagegen immer da. Die Tabelle bildet genau das nach, ohne DOM.
 */
function screenAfter(state) {
  const card = { width: 70, height: 101 };
  const rects = new Map([
    ['deck', { left: 100, top: 300, ...card }],
    ['discard', { left: 300, top: 300, ...card }],
    // Leer geschrumpft: null Breite, die Mitte bleibt.
    ['drawnSlot', centeredCard({ left: 235, top: 350, width: 0, height: 0 }, card)],
  ]);
  if (state.drawn != null) rects.set('drawn', { left: 200, top: 300, ...card });
  state.players.forEach((p, owner) =>
    p.hand.forEach((_, slot) => rects.set(`hand:${owner}:${slot}`, { left: 80 * slot, top: 600, ...card })),
  );
  return (key) => rects.get(key) ?? null;
}

function assertResolvable(scenes, state) {
  const measure = screenAfter(state);
  for (const scene of scenes) {
    assert.ok(resolveAnchor(scene.from, measure), `${scene.key}: Ausgangsort lässt sich nicht finden`);
    assert.ok(resolveAnchor(scene.to, measure), `${scene.key}: Ziel lässt sich nicht finden`);
  }
}

test('eine abgeworfene Karte findet ihren Ausgangsort auch nach dem Neuzeichnen', () => {
  // Regression: Der Ablagebereich ist beim Abspielen schon leer, und ohne
  // Ersatzanker fiel jeder Abwurf-Flug stillschweigend aus.
  const game = newGame();
  completeInitialPeeks(game);
  game.drawFromDeck();
  const seq = latestSeq(game.state);

  game.discardDrawn();
  assert.equal(game.state.drawn, null);
  const scenes = scenesForAll(newEntries(game.state, seq));

  assert.equal(scenes.length, 1);
  assertResolvable(scenes, game.state);
  // Der Ersatz ist der Platz des Ablagebereichs, nicht etwa der Stapel –
  // die Karte soll von dort abheben, wo sie eben noch lag.
  assert.equal(scenes[0].from.fallback.kind, ANCHOR.DRAWN_SLOT);
});

test('der leere Ablagebereich liefert ein Kartenformat an seiner Mitte', () => {
  const rect = centeredCard({ left: 200, top: 100, width: 0, height: 0 }, { width: 70, height: 100 });
  assert.deepEqual(rect, { left: 165, top: 50, width: 70, height: 100 });
  assert.equal(centeredCard(null, { width: 70, height: 100 }), null);
});

// ------------------------------------------------------------------ Tausch

test('der Tausch erzeugt zwei versetzte Flüge in beide Richtungen', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.drawFromDeck();
  const seq = latestSeq(game.state);
  const actor = game.state.current;

  game.selectCard(actor, 1);
  const entries = newEntries(game.state, seq);
  const scenes = scenesForAll(entries);

  const out = scenes.find((x) => x.to.kind === ANCHOR.DISCARD);
  const into = scenes.find((x) => x.to.kind === ANCHOR.HAND);

  assert.ok(out, 'die alte Karte muss zur Ablage fliegen');
  assert.ok(into, 'die gezogene Karte muss in die Hand fliegen');

  assert.deepEqual(out.from, { kind: ANCHOR.HAND, owner: actor, slot: 1 });
  assert.equal(into.to.owner, actor);
  assert.equal(into.to.slot, 1);

  // Nacheinander, nicht gleichzeitig – sonst sieht es aus wie ein Stoß.
  assert.ok(into.delay > 0, 'die einfliegende Karte muss versetzt starten');

  // Aus der Hand kommt nie etwas offen heraus.
  assert.equal(out.faceUp, false);
  assertNoLeak(entries);
});

test('eine aus der Ablage getauschte Karte darf offen einfliegen', () => {
  // Der Gegenfall zum Test darüber: Diese Karte hat der ganze Tisch beim
  // Herausnehmen gesehen, sie verdeckt einfliegen zu lassen wäre unnötig
  // geheimniskrämerisch – und die Engine führt sie selbst als öffentlich.
  const game = newGame();
  completeInitialPeeks(game);
  game.takeDiscard();
  const seq = latestSeq(game.state);
  const actor = game.state.current;

  game.selectCard(actor, 2);
  const entries = newEntries(game.state, seq);
  const into = scenesForAll(entries).find((x) => x.to.kind === ANCHOR.HAND);

  assert.equal(into.faceUp, true);
  assert.equal(into.from.fallback.kind, ANCHOR.DISCARD);
  assert.ok(game.state.publicCards.includes(into.card));
  assertNoLeak(entries);
});

test('die einfliegende Karte weicht auf ihren Stapel aus, wenn der Ablagebereich leer ist', () => {
  const game = newGame();
  completeInitialPeeks(game);
  game.drawFromDeck();
  const seq = latestSeq(game.state);

  game.selectCard(game.state.current, 0);
  const into = scenesForAll(newEntries(game.state, seq)).find((x) => x.to.kind === ANCHOR.HAND);

  assert.equal(into.from.kind, ANCHOR.DRAWN);
  assert.equal(into.from.fallback.kind, ANCHOR.DECK);
});

// ------------------------------------------------------- Über viele Züge

test('über eine ganze Runde verrät keine Animation eine verdeckte Karte', () => {
  const game = newGame(['Anna', 'Bea', 'Cem', 'Dana']);
  completeInitialPeeks(game);

  let seen = 0;
  for (let turn = 0; turn < 24 && !game.state.roundResult; turn += 1) {
    const scenes = playTurn(game, (g, step) => {
      // Abwechselnd ziehen und aus der Ablage nehmen, damit beide
      // Ausgangsorte vorkommen; meist tauschen, jeder vierte Zug wirft ab
      // (das übernimmt playTurn, wenn hier nichts mehr geschieht).
      if (turn % 2 === 0 || !g.state.discard.length) g.drawFromDeck();
      else g.takeDiscard();
      step();
      if (turn % 4 === 0 && g.state.drawnFrom === 'deck') return;
      const me = g.state.current;
      const slot = g.state.players[me].hand.findIndex((id) => id != null);
      if (g.state.phase === PHASE.DRAWN && slot >= 0) g.selectCard(me, slot);
    });
    seen += scenes.length;
  }

  assert.ok(seen > 20, `zu wenige Bewegungen geprüft: ${seen}`);
});

test('unbekannte Ereignisse erzeugen lieber gar keine Bewegung', () => {
  assert.deepEqual(scenesFor({ n: 1, type: 'cabo', actor: 0 }), []);
  assert.deepEqual(scenesFor({ n: 2, type: 'roundStart' }), []);
  assert.deepEqual(scenesFor(null), []);
});

test('newEntries liefert nur, was seit dem letzten Zeichnen dazukam', () => {
  const state = { log: [{ n: 1 }, { n: 2 }, { n: 3 }], logSeq: 3 };
  assert.deepEqual(newEntries(state, 1).map((e) => e.n), [2, 3]);
  assert.deepEqual(newEntries(state, 3), []);
  assert.equal(latestSeq(state), 3);
  assert.equal(latestSeq({}), 0);
});

// --------------------------------------------------------------- Sitzplätze

test('der Betrachter sitzt unten, die anderen reihum', () => {
  const state = { players: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }] };
  const angles = seatAngles(state, 2);

  assert.equal(angles[2], VIEWER_ANGLE);
  // Vier Spieler, also 90° Abstand – und gegen den Uhrzeigersinn, weil
  // y auf dem Bildschirm nach unten wächst.
  assert.equal(edgeName(angles[2]), 'bottom');
  assert.equal(edgeName(angles[3]), 'right');
  assert.equal(edgeName(angles[0]), 'top');
  assert.equal(edgeName(angles[1]), 'left');

  const all = Object.values(angles);
  assert.equal(new Set(all).size, 4, 'keine zwei Spieler auf demselben Platz');
});

test('ohne Betrachter bleibt die Sitzordnung trotzdem eindeutig', () => {
  const state = { players: [{ id: 0 }, { id: 1 }, { id: 2 }] };
  const angles = seatAngles(state, null);
  assert.equal(angles[0], VIEWER_ANGLE);
  assert.equal(new Set(Object.values(angles)).size, 3);
});

test('feste Richtungen gehen der Voreinstellung vor', () => {
  const state = { players: [{ id: 0 }, { id: 1 }] };
  const angles = withOverrides(seatAngles(state, 0), { 1: 400 });
  assert.equal(angles[1], 40, 'Winkel werden auf 0–360 normiert');
  assert.equal(angles[0], VIEWER_ANGLE);
});

test('edgePoint trifft die Kante in der gefragten Richtung', () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 };

  // Auf ~1 px genau: die Winkelrechnung geht über Sinus und Kosinus, dort
  // kommt bei 180° nie exakt null heraus.
  const near = (got, want, what) => {
    assert.ok(Math.abs(got.x - want.x) < 1e-6 && Math.abs(got.y - want.y) < 1e-6,
      `${what}: ${JSON.stringify(got)} statt ${JSON.stringify(want)}`);
  };

  near(edgePoint(0, rect), { x: 200, y: 50 }, 'rechts');
  near(edgePoint(90, rect), { x: 100, y: 100 }, 'unten');
  near(edgePoint(180, rect), { x: 0, y: 50 }, 'links');
  near(edgePoint(270, rect), { x: 100, y: 0 }, 'oben');

  // Ein Überschuss schiebt den Punkt vor die Kante – dort verschwindet
  // die Karte später zum Nachbargerät hin.
  assert.ok(edgePoint(0, rect, 1.2).x > 200);
});
