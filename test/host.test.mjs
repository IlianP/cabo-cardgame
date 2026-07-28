/**
 * Tests des Mehrgeräte-Modus: node --test test/*.test.mjs
 *
 * Gespielt wird über den Speicher-Transport – Gastgeber und Geräte laufen
 * im selben Prozess, aber sie reden ausschließlich über Nachrichten
 * miteinander. Damit lässt sich alles prüfen, was sonst erst am
 * Küchentisch auffällt: doppelte Tipps, veraltete Nachrichten, ein Handy,
 * das mitten im Zug verschwindet und wiederkommt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CaboGame, PHASE, legalActions, canSelectCard } from '../js/engine.js';
import { mulberry32 } from '../js/deck.js';
import { TABLE } from '../js/view.js';
import { CaboHost } from '../js/host.js';
import { CaboClient } from '../js/client.js';
import { MemoryHub } from '../js/transport.js';

// ------------------------------------------------------------- Hilfsmittel

/** Partie mit Gastgeber, Tisch-Gerät und einem Handy je Spieler. */
function newTable(names = ['Anna', 'Bea', 'Cem'], rules = {}, seed = 7) {
  const hub = new MemoryHub();
  const game = new CaboGame({
    players: names.map((name) => ({ name })),
    rules,
    rng: mulberry32(seed),
  });
  const host = new CaboHost(game, { transport: hub.connect('host') });

  const errors = [];
  const make = (id, audience) => {
    const client = new CaboClient(hub.connect(id), { onError: (m) => errors.push([id, m]) });
    client.join(audience);
    return client;
  };
  const table = make('tisch', TABLE);
  const phones = names.map((_, i) => make(`handy-${i}`, i));
  return { hub, game, host, table, phones, errors, state: game.state };
}

/** Führt den Zug aus, für den gerade jemand dran ist. */
function actWhoever(t, action, ...args) {
  const phone = t.phones.find((p) => p.can.includes(action));
  assert.ok(phone, `niemand darf gerade ${action}`);
  phone.act(action, ...args);
  return phone;
}

/** Anfangsphase über die Geräte durchspielen. */
function completeInitialPeeks(t) {
  let guard = 0;
  while (t.state.phase !== PHASE.TURN) {
    if (guard++ > 200) throw new Error('Anfangsphase endet nicht');
    const s = t.state;
    if (s.phase === PHASE.HANDOFF) actWhoever(t, 'confirmHandoff');
    else if (s.phase === PHASE.PEEK) {
      const me = s.peek.order[s.peek.index];
      const slot = s.players[me].hand.findIndex((_, i) => !s.peek.taken.includes(i));
      t.phones[me].act('selectCard', me, slot);
    } else if (s.phase === PHASE.REVEAL) actWhoever(t, 'ackReveal');
    else throw new Error(`unerwartete Phase: ${s.phase}`);
  }
}

// -------------------------------------------------------------- Beitreten

test('Jedes Gerät bekommt beim Beitreten seine eigene Sicht', () => {
  const t = newTable();

  assert.equal(t.table.audience, TABLE);
  assert.equal(t.table.view.you, null);
  assert.equal(t.phones[1].view.you.id, 1);
  assert.equal(t.phones[1].view.players[1].mine, true);
  assert.deepEqual(t.errors, []);
});

test('Ein unbekannter Platz wird abgelehnt', () => {
  const t = newTable();
  const extra = new CaboClient(t.hub.connect('fremd'), {
    onError: (m) => t.errors.push(['fremd', m]),
  });
  extra.join(9);
  assert.match(t.errors.at(-1)[1], /Diesen Platz gibt es nicht/);
  assert.equal(extra.view, null);
});

test('Ein zweites Gerät am selben Platz übernimmt ihn', () => {
  const t = newTable();
  const ersatz = new CaboClient(t.hub.connect('handy-1b'), {});
  ersatz.join(1);

  assert.equal(t.host.devices.has('handy-1'), false, 'das alte Gerät verliert den Platz');
  assert.equal(t.host.devices.get('handy-1b').audience, 1);
  assert.equal(ersatz.view.you.id, 1);
});

test('Der Gastgeber weiß, welche Plätze noch kein Gerät haben', () => {
  const t = newTable();
  assert.deepEqual(t.host.missingSeats(), []);
  t.host.detach('handy-2');
  assert.deepEqual(t.host.missingSeats(), [2]);
});

// ------------------------------------------------------------------ Züge

test('Ein Zug vom Handy verändert die Partie und erreicht alle Geräte', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const actor = t.state.current;

  const before = t.state.version;
  t.phones[actor].act('drawFromDeck');

  assert.equal(t.state.phase, PHASE.DRAWN);
  assert.ok(t.state.version > before);
  // Alle Geräte sind auf demselben Stand …
  for (const client of [t.table, ...t.phones]) {
    assert.equal(client.view.version, t.state.version);
  }
  // … aber nur der Ziehende sieht die Karte.
  assert.equal(t.phones[actor].view.turn.drawn, t.state.drawn);
  assert.equal(t.table.view.turn.drawn, null);
  assert.equal(t.phones[(actor + 1) % 3].view.turn.drawn, null);
  assert.deepEqual(t.errors, []);
});

test('Wer nicht dran ist, wird abgewiesen – ohne dass etwas passiert', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const other = (t.state.current + 1) % 3;
  const before = t.state.version;

  t.phones[other].act('drawFromDeck');

  assert.equal(t.state.version, before, 'der Zustand darf sich nicht ändern');
  assert.equal(t.errors.at(-1)[0], `handy-${other}`);
  assert.match(t.errors.at(-1)[1], /geht gerade nicht/);
});

test('Der Gastgeber glaubt einem Gerät nichts, das mehr behauptet als es darf', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const spy = (t.state.current + 1) % 3;

  // Handy schickt einen fremden Platz als Argument mit.
  t.phones[spy].act('selectCard', t.state.current, 0);
  assert.match(t.errors.at(-1)[1], /geht gerade nicht/);

  // Und ein Zug, den es gar nicht gibt.
  t.phones[spy].act('spielGewinnen');
  assert.match(t.errors.at(-1)[1], /geht gerade nicht|Unbekannter Zug/);
});

// ------------------------------------------------- Doppelt und veraltet

test('Zweimal getippt ist kein Fehler – die zweite Nachricht wird geschluckt', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const actor = t.state.current;

  // Beide Nachrichten tragen dieselbe Version: der zweite Tipp kam, bevor
  // die neue Sicht ankommen konnte.
  const release = t.hub.hold();
  t.phones[actor].act('drawFromDeck');
  t.phones[actor].act('drawFromDeck');
  release();

  assert.equal(t.state.phase, PHASE.DRAWN, 'nur der erste Tipp zählt');
  assert.deepEqual(t.errors, [], 'für den zweiten darf es keine Meldung geben');
});

test('Zwei Geräte gleichzeitig auf „weiter“: einer wirkt, keiner bekommt Ärger', () => {
  const t = newTable(['Anna', 'Bea'], { multiDiscard: true });
  completeInitialPeeks(t);
  const actor = t.state.current;
  t.state.players[actor].hand = ['v4-0', 'v4-1', 'v9-0', 'v11-0'];

  t.phones[actor].act('drawFromDeck');
  t.phones[actor].act('startMultiDiscard');
  t.phones[actor].act('selectCard', actor, 0);
  t.phones[actor].act('selectCard', actor, 1);
  t.phones[actor].act('confirmMultiDiscard');
  assert.equal(t.state.phase, PHASE.REVEAL);
  assert.equal(t.state.reveal.isPublic, true);

  // Beide Handys und der Tisch dürfen bestätigen – alle tippen gleichzeitig.
  assert.ok(t.phones[0].can.includes('ackReveal'));
  assert.ok(t.phones[1].can.includes('ackReveal'));
  const release = t.hub.hold();
  t.phones[0].act('ackReveal');
  t.phones[1].act('ackReveal');
  t.table.act('ackReveal');
  release();

  assert.notEqual(t.state.phase, PHASE.REVEAL, 'die Aufdeckung ist durch');
  assert.deepEqual(t.errors, []);
});

test('Eine veraltete Nachricht wird geschluckt und das Gerät nachgezogen', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const actor = t.state.current;

  // Handy hängt hinterher: es schickt eine Aktion auf einem alten Stand.
  const stale = t.phones[actor].view.version - 1;
  t.phones[actor].transport.send('host', {
    type: 'action',
    action: 'drawFromDeck',
    args: [],
    version: stale,
    seq: 99,
  });

  assert.equal(t.state.phase, PHASE.TURN, 'nichts passiert');
  assert.deepEqual(t.errors, []);
  assert.equal(t.phones[actor].view.version, t.state.version, 'aber es ist wieder auf Stand');
});

// -------------------------------------------------------- Verbindungen

test('Ein Handy verschwindet und kommt zurück, ohne dass die Partie leidet', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const actor = t.state.current;

  // Verbindung weg – der Gastgeber merkt es über den Transport.
  t.phones[actor].transport.close();
  assert.equal(t.host.devices.has(`handy-${actor}`), false);

  // Die Partie läuft weiter, andere können nichts an seiner Stelle tun.
  const other = (actor + 1) % 3;
  t.phones[other].act('drawFromDeck');
  assert.equal(t.state.phase, PHASE.TURN);

  // Neues Gerät, gleicher Platz: voller Stand, Spiel geht weiter.
  const zurueck = new CaboClient(t.hub.connect('handy-neu'), {
    onError: (m) => t.errors.push(['neu', m]),
  });
  zurueck.join(actor);
  assert.equal(zurueck.view.you.id, actor);
  assert.equal(zurueck.view.version, t.state.version);

  zurueck.act('drawFromDeck');
  assert.equal(t.state.phase, PHASE.DRAWN);
  assert.equal(zurueck.view.turn.drawn, t.state.drawn);
});

test('resync holt den Stand, ohne etwas zu verändern', () => {
  const t = newTable();
  completeInitialPeeks(t);
  const before = t.state.version;
  t.phones[0].resync();
  assert.equal(t.state.version, before);
  assert.equal(t.phones[0].view.version, before);
});

test('Ein Gerät ohne Platz bekommt eine Absage', () => {
  const t = newTable();
  t.host.detach('handy-0');
  t.phones[0].view = { version: t.state.version, you: { can: [] } };
  t.phones[0].act('drawFromDeck');
  assert.match(t.errors.at(-1)[1], /sitzt an keinem Platz/);
});

// -------------------------------------------------------------- Der Tisch

test('Der Tisch spielt nicht mit, darf aber gemeinsame Schritte auslösen', () => {
  const t = newTable();

  // Ziehen darf er nicht.
  t.table.act('drawFromDeck');
  assert.match(t.errors.at(-1)[1], /Tisch kann das nicht auslösen/);

  // Eine private Aufdeckung auch nicht bestätigen – die sieht er ja nicht.
  actWhoever(t, 'confirmHandoff');
  const me = t.state.peek.order[t.state.peek.index];
  t.phones[me].act('selectCard', me, 0);
  assert.equal(t.state.phase, PHASE.REVEAL);
  assert.equal(t.table.view.reveal.forMe, false);
  t.table.act('ackReveal');
  assert.equal(t.state.phase, PHASE.REVEAL, 'die private Aufdeckung bleibt stehen');
  assert.match(t.errors.at(-1)[1], /Tisch kann das nicht auslösen/);
});

test('Am Rundenende darf auch der Tisch weiterschalten', () => {
  const t = newTable(['Anna', 'Bea']);
  completeInitialPeeks(t);
  const s = t.state;
  s.current = 0;
  s.phase = PHASE.TURN;
  t.game.callCabo();
  let guard = 0;
  while (s.phase !== PHASE.ROUND_END && guard++ < 50) {
    if (s.phase === PHASE.HANDOFF) t.game.confirmHandoff();
    else if (s.phase === PHASE.REVEAL) t.game.ackReveal();
    else if (s.phase === PHASE.TURN) t.game.drawFromDeck();
    else if (s.phase === PHASE.DRAWN) t.game.swapDrawnWith(0);
    else if (s.phase === PHASE.POWER) t.game.skipPower();
  }
  t.host.broadcast();

  assert.equal(t.state.phase, PHASE.ROUND_END);
  t.table.act('nextRound');
  assert.equal(t.state.round, 2);
  assert.deepEqual(t.errors, []);
});

// ------------------------------------------------------- Ganze Partie

test('Eine ganze Runde nur über Nachrichten – und nichts sickert durch', () => {
  const t = newTable(['Anna', 'Bea', 'Cem'], { multiDiscard: true }, 5);
  completeInitialPeeks(t);
  const s = t.state;

  let guard = 0;
  while (s.phase !== PHASE.ROUND_END && guard++ < 300) {
    // Jedes Handy sieht in jedem Schritt nur seine eigene Hand.
    for (const [i, phone] of t.phones.entries()) {
      const foreign = s.players
        .filter((p) => p.id !== i)
        .flatMap((p) => p.hand)
        .filter((id) => id != null && !s.publicCards.includes(id));
      const shown = JSON.stringify(phone.view);
      for (const id of foreign) {
        if (s.reveal?.isPublic && s.reveal.cards.some((c) => c.cardId === id)) continue;
        if (s.reveal?.viewer === i && s.reveal.cards.some((c) => c.cardId === id)) continue;
        assert.equal(shown.includes(id), false, `${id} bei Handy ${i} sichtbar`);
      }
    }

    if (s.phase === PHASE.HANDOFF) actWhoever(t, 'confirmHandoff');
    else if (s.phase === PHASE.REVEAL) actWhoever(t, 'ackReveal');
    else if (s.phase === PHASE.TURN) {
      const me = s.current;
      if (guard % 5 === 0 && s.discard.length) t.phones[me].act('takeDiscard');
      else t.phones[me].act('drawFromDeck');
    } else if (s.phase === PHASE.DRAWN) {
      const me = s.current;
      if (guard % 3 === 0 && s.drawnFrom === 'deck') t.phones[me].act('discardDrawn');
      else t.phones[me].act('selectCard', me, guard % 4);
    } else if (s.phase === PHASE.POWER) {
      const me = s.current;
      const p = s.power;
      if (p.type === 'peek') t.phones[me].act('selectCard', me, 0);
      else if (p.type === 'spy') t.phones[me].act('selectCard', (me + 1) % 3, 0);
      else if (p.step === 'own') t.phones[me].act('selectCard', me, 0);
      else t.phones[me].act('selectCard', (me + 1) % 3, 1);
    } else throw new Error(`unerwartete Phase: ${s.phase}`);
  }

  assert.ok(guard > 20, 'die Runde sollte über etliche Züge laufen');
  assert.deepEqual(t.errors, []);
});

// --------------------------------------------- Engine: was gerade geht

test('Was legalActions verspricht, nimmt die Engine auch an', () => {
  // Die Richtung, auf die es ankommt: Ein Handy darf nie einen Knopf zeigen,
  // der beim Gastgeber in einer Absage endet. Umgekehrt ist "nicht erlaubt"
  // für Methoden ohne Spieler-Argument gar nicht prüfbar – `drawFromDeck()`
  // kennt keinen Absender, es zieht immer für den, der dran ist.
  const methods = {
    confirmHandoff: (g) => g.confirmHandoff(),
    drawFromDeck: (g) => g.drawFromDeck(),
    takeDiscard: (g) => g.takeDiscard(),
    callCabo: (g) => g.callCabo(),
    discardDrawn: (g) => g.discardDrawn(),
    startMultiDiscard: (g) => g.startMultiDiscard(),
    cancelMultiDiscard: (g) => g.cancelMultiDiscard(),
    confirmMultiDiscard: (g) => g.confirmMultiDiscard(),
    skipPower: (g) => g.skipPower(),
    ackReveal: (g) => g.ackReveal(),
    nextRound: (g) => g.nextRound(),
  };

  let checked = 0;
  let guard = 0;
  const game = new CaboGame({
    players: [{ name: 'Anna' }, { name: 'Bea' }, { name: 'Cem' }],
    rules: { multiDiscard: true },
    rng: mulberry32(4),
  });
  const s = game.state;

  while (s.phase !== PHASE.ROUND_END && guard++ < 200) {
    for (const p of s.players) {
      for (const action of legalActions(s, p.id)) {
        if (action === 'selectCard') {
          // Mindestens eine Karte muss anfassbar sein, sonst ist die
          // Freigabe eine Lüge.
          const any = s.players.some((owner) =>
            owner.hand.some((_, slot) => canSelectCard(s, p.id, owner.id, slot)),
          );
          assert.ok(any, `selectCard freigegeben, aber nichts wählbar (${s.phase})`);
          continue;
        }
        // Auf einer Kopie ausprobieren, damit die Partie weiterläuft.
        const probe = CaboGame.fromJSON(game.toJSON(), mulberry32(4));
        assert.doesNotThrow(
          () => methods[action](probe),
          `${action} war freigegeben, wurde aber abgelehnt (${s.phase})`,
        );
        checked++;
      }
    }

    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.PEEK) {
      const me = s.peek.order[s.peek.index];
      const slot = s.players[me].hand.findIndex((_, i) => !s.peek.taken.includes(i));
      game.selectCard(me, slot);
    } else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else if (s.phase === PHASE.TURN) game.drawFromDeck();
    else if (s.phase === PHASE.DRAWN) game.swapDrawnWith(0);
    else if (s.phase === PHASE.POWER) game.skipPower();
  }
  assert.ok(checked > 30, `zu wenig geprüft: ${checked}`);
});

test('canSelectCard stimmt mit selectCard überein', () => {
  const game = new CaboGame({
    players: [{ name: 'Anna' }, { name: 'Bea' }],
    rng: mulberry32(9),
  });
  const s = game.state;

  let guard = 0;
  let accepted = 0;
  while (s.phase !== PHASE.ROUND_END && guard++ < 200) {
    for (const p of s.players) {
      for (const owner of s.players) {
        for (let slot = 0; slot < owner.hand.length; slot++) {
          if (!canSelectCard(s, p.id, owner.id, slot)) continue;
          const probe = CaboGame.fromJSON(game.toJSON(), mulberry32(9));
          assert.doesNotThrow(
            () => probe.selectCard(owner.id, slot),
            `Platz ${slot} von ${owner.name} galt als wählbar (${s.phase})`,
          );
          accepted++;
        }
      }
    }
    if (s.phase === PHASE.HANDOFF) game.confirmHandoff();
    else if (s.phase === PHASE.PEEK) {
      const me = s.peek.order[s.peek.index];
      const slot = s.players[me].hand.findIndex((_, i) => !s.peek.taken.includes(i));
      game.selectCard(me, slot);
    } else if (s.phase === PHASE.REVEAL) game.ackReveal();
    else if (s.phase === PHASE.TURN) game.drawFromDeck();
    else if (s.phase === PHASE.DRAWN) game.discardDrawn();
    else if (s.phase === PHASE.POWER) {
      const pw = s.power;
      const other = (s.current + 1) % 2;
      if (pw.type === 'spy') game.selectCard(other, 0);
      else if (pw.type === 'peek') game.selectCard(s.current, 0);
      else game.selectCard(pw.step === 'own' ? s.current : other, 0);
    }
  }
  assert.ok(accepted > 10, `zu wenig geprüft: ${accepted}`);
});
