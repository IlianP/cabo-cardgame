/**
 * Cabo – Spiellogik.
 *
 * Diese Datei kennt keine Oberfläche: sie hält den Spielzustand, prüft
 * Züge und schaltet die Zustandsmaschine weiter. Der Zustand ist bewusst
 * frei von Funktionen und Klassen, damit er sich mit JSON.stringify
 * speichern und später wieder laden lässt (siehe toJSON/fromJSON).
 *
 * Ablauf einer Runde:
 *
 *   handoff -> peek (je Spieler)          Startkarten ansehen
 *   handoff -> turn -> drawn -> power     ein Zug
 *           -> snapWindow -> snapPick     optionales Einwerfen
 *   ... bis jemand Cabo ruft und alle anderen noch je einen Zug hatten
 *   roundEnd -> nächste Runde oder gameEnd
 *
 * Jede Aufdeckung läuft über die Phase `reveal`. Die Oberfläche zeigt die
 * Karte dann hinter dem Sichtschutz an und meldet sich mit ackReveal()
 * zurück – so kann der Sichtschutz nie versehentlich übersprungen werden.
 */

import { createDeck, shuffle, POWER } from './deck.js';
import { DEFAULT_RULES } from './rules.js';

export const PHASE = {
  HANDOFF: 'handoff',
  PEEK: 'peek',
  TURN: 'turn',
  DRAWN: 'drawn',
  POWER: 'power',
  REVEAL: 'reveal',
  SNAP_WINDOW: 'snapWindow',
  SNAP_PICK: 'snapPick',
  ROUND_END: 'roundEnd',
  GAME_END: 'gameEnd',
};

export class GameError extends Error {}

const fail = (msg) => {
  throw new GameError(msg);
};

export class CaboGame {
  /**
   * @param {{players: {name: string, pin?: string}[], rules?: object, rng?: () => number}} config
   */
  constructor({ players, rules = {}, rng = Math.random } = {}) {
    this.rng = rng;
    this.listeners = new Set();

    if (players) {
      if (players.length < 2) fail('Es braucht mindestens zwei Spieler.');
      this.state = {
        rules: { ...DEFAULT_RULES, ...rules },
        players: players.map((p, i) => ({
          id: i,
          name: p.name?.trim() || `Spieler ${i + 1}`,
          pin: p.pin || '',
          hand: [],
          score: 0,
          usedReset: false,
        })),
        round: 0,
        startPlayer: 0,
        current: 0,
        phase: PHASE.ROUND_END,
        cards: {},
        deck: [],
        discard: [],
        handoff: null,
        peek: null,
        drawn: null,
        drawnFrom: null,
        power: null,
        reveal: null,
        snap: null,
        cabo: null,
        discardTouched: false,
        pendingRoundOver: false,
        roundResult: null,
        gameOver: false,
        log: [],
      };
      this.startRound();
    }
  }

  // ---------------------------------------------------------------- Zustand

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  card(id) {
    return id == null ? null : this.state.cards[id];
  }

  get rules() {
    return this.state.rules;
  }

  get currentPlayer() {
    return this.state.players[this.state.current];
  }

  /** Der Spieler, der das Gerät gerade in der Hand hält (oder null). */
  get viewer() {
    const s = this.state;
    if (s.phase === PHASE.HANDOFF) return null;
    if (s.phase === PHASE.PEEK) return s.peek.order[s.peek.index];
    if (s.phase === PHASE.SNAP_PICK) return s.snap.claimer;
    if (s.phase === PHASE.REVEAL) return s.reveal.viewer;
    if (s.phase === PHASE.ROUND_END || s.phase === PHASE.GAME_END) return null;
    if (s.phase === PHASE.SNAP_WINDOW) return null;
    return s.current;
  }

  toJSON() {
    return JSON.stringify(this.state);
  }

  static fromJSON(json, rng = Math.random) {
    const game = new CaboGame({});
    game.state = typeof json === 'string' ? JSON.parse(json) : json;
    game.rng = rng;
    return game;
  }

  log(text) {
    this.state.log.push({ round: this.state.round, text });
    if (this.state.log.length > 200) this.state.log.shift();
  }

  // ------------------------------------------------------------- Rundenlauf

  startRound() {
    const s = this.state;
    const r = s.rules;
    s.round += 1;

    const deck = createDeck(r);
    shuffle(deck, this.rng);
    s.cards = {};
    for (const c of deck) s.cards[c.id] = c;
    s.deck = deck.map((c) => c.id);
    s.discard = [];

    for (const p of s.players) p.hand = [];
    for (let k = 0; k < r.handSize; k++) {
      for (const p of s.players) p.hand.push(s.deck.pop());
    }
    s.discard.push(s.deck.pop());

    s.knowledge = {};
    for (const p of s.players) s.knowledge[p.id] = {};

    s.cabo = null;
    s.drawn = null;
    s.drawnFrom = null;
    s.power = null;
    s.reveal = null;
    s.snap = null;
    s.discardTouched = false;
    s.pendingRoundOver = false;
    s.roundResult = null;

    s.startPlayer = (s.round - 1) % s.players.length;
    s.current = s.startPlayer;

    const order = s.players.map((_, i) => (s.startPlayer + i) % s.players.length);
    s.peek = { order, index: 0, taken: [] };

    this.log(`Runde ${s.round} beginnt.`);
    this._handoff(order[0], 'peek');
    this.emit();
  }

  // -------------------------------------------------------------- Übergabe

  _handoff(to, resume) {
    this.state.handoff = { to, resume };
    this.state.phase = PHASE.HANDOFF;
  }

  /**
   * Bestätigt die Geräteübergabe. Gibt bei aktivierter PIN-Sperre
   * {ok:false} zurück, wenn die PIN nicht stimmt.
   */
  confirmHandoff(pin = '') {
    const s = this.state;
    if (s.phase !== PHASE.HANDOFF) fail('Gerade ist keine Übergabe offen.');
    const player = s.players[s.handoff.to];
    if (s.rules.usePins && player.pin && pin !== player.pin) {
      return { ok: false, error: 'PIN stimmt nicht.' };
    }
    const resume = s.handoff.resume;
    s.handoff = null;
    if (resume === 'peek') s.phase = PHASE.PEEK;
    else if (resume === 'turn') s.phase = PHASE.TURN;
    else if (resume === 'snapPick') s.phase = PHASE.SNAP_PICK;
    else fail(`Unbekannte Fortsetzung: ${resume}`);
    this.emit();
    return { ok: true };
  }

  // -------------------------------------------------------------- Aufdecken

  _reveal({ cards, title, note = '', viewer, isPublic = false, next }) {
    const s = this.state;
    s.reveal = { cards, title, note, viewer: isPublic ? null : viewer, isPublic, next };
    s.phase = PHASE.REVEAL;
  }

  /** Die Oberfläche meldet: der Sichtschutz ist wieder zu. */
  ackReveal() {
    const s = this.state;
    if (s.phase !== PHASE.REVEAL) fail('Gerade ist nichts aufgedeckt.');
    const next = s.reveal.next;
    s.reveal = null;
    if (next === 'peekNext') this._peekNext();
    else if (next === 'endTurn') this._endTurn();
    else if (next === 'kingDecide') {
      s.power.step = 'decide';
      s.phase = PHASE.POWER;
    } else if (next === 'snapResolve') this._snapResolve();
    else fail(`Unbekannte Fortsetzung: ${next}`);
    this.emit();
  }

  // ------------------------------------------------------- Karten ansehen 1

  _peekNext() {
    const s = this.state;
    const peek = s.peek;
    if (peek.taken.length < s.rules.initialPeeks) {
      s.phase = PHASE.PEEK;
      return;
    }
    peek.index += 1;
    peek.taken = [];
    if (peek.index < peek.order.length) {
      this._handoff(peek.order[peek.index], 'peek');
    } else {
      s.peek = null;
      s.current = s.startPlayer;
      this._handoff(s.current, 'turn');
    }
  }

  // ----------------------------------------------------------------- Züge

  _drawCard() {
    const s = this.state;
    if (s.deck.length === 0) {
      // Ablagestapel bis auf die oberste Karte zurück ins Spiel.
      if (s.discard.length > 1) {
        const top = s.discard.pop();
        s.deck = shuffle(s.discard, this.rng);
        s.discard = [top];
        this.log('Nachziehstapel war leer – Ablage neu gemischt.');
      }
    }
    return s.deck.length ? s.deck.pop() : null;
  }

  drawFromDeck() {
    const s = this.state;
    if (s.phase !== PHASE.TURN) fail('Das geht gerade nicht.');
    const id = this._drawCard();
    if (id == null) {
      this._endRound('deckEmpty');
      this.emit();
      return;
    }
    s.drawn = id;
    s.drawnFrom = 'deck';
    s.phase = PHASE.DRAWN;
    this.emit();
  }

  takeDiscard() {
    const s = this.state;
    if (s.phase !== PHASE.TURN) fail('Das geht gerade nicht.');
    if (!s.discard.length) fail('Die Ablage ist leer.');
    s.drawn = s.discard.pop();
    s.drawnFrom = 'discard';
    s.phase = PHASE.DRAWN;
    this.emit();
  }

  callCabo() {
    const s = this.state;
    if (s.phase !== PHASE.TURN) fail('Das geht gerade nicht.');
    if (s.cabo) fail('Cabo wurde bereits gerufen.');
    s.cabo = { caller: s.current, turnsRemaining: s.players.length - 1 };
    this.log(`${this.currentPlayer.name} ruft Cabo!`);
    this._endTurn();
    this.emit();
  }

  /** Gezogene Karte gegen eine eigene Handkarte tauschen. */
  swapDrawnWith(slot) {
    const s = this.state;
    if (s.phase !== PHASE.DRAWN) fail('Das geht gerade nicht.');
    const hand = this.currentPlayer.hand;
    if (slot < 0 || slot >= hand.length) fail('Diesen Platz gibt es nicht.');
    if (hand[slot] == null) fail('Auf diesem Platz liegt keine Karte.');

    const outgoing = hand[slot];
    hand[slot] = s.drawn;
    s.discard.push(outgoing);
    s.discardTouched = true;
    this._forgetSlot(s.current, slot);
    // Die eingetauschte Karte kennt man selbst – man hat sie eben gesehen.
    if (s.drawnFrom === 'deck') s.knowledge[s.current][slot] = s.drawn;
    else s.knowledge[s.current][slot] = s.drawn;

    this.log(`${this.currentPlayer.name} tauscht Platz ${slot + 1}.`);
    s.drawn = null;
    this._endTurn();
    this.emit();
  }

  /** Gezogene Karte direkt abwerfen – löst gegebenenfalls die Kartenkraft aus. */
  discardDrawn() {
    const s = this.state;
    if (s.phase !== PHASE.DRAWN) fail('Das geht gerade nicht.');
    if (s.drawnFrom !== 'deck') fail('Eine Karte aus der Ablage muss getauscht werden.');

    const card = this.card(s.drawn);
    s.discard.push(s.drawn);
    s.discardTouched = true;
    s.drawn = null;
    this.log(`${this.currentPlayer.name} wirft ${card.label} ab.`);

    if (card.power) {
      s.power = { type: card.power, step: powerFirstStep(card.power), own: null, target: null };
      s.phase = PHASE.POWER;
    } else {
      this._endTurn();
    }
    this.emit();
  }

  // ------------------------------------------------------------ Kartenkraft

  skipPower() {
    const s = this.state;
    if (s.phase !== PHASE.POWER) fail('Gerade ist keine Kartenkraft offen.');
    s.power = null;
    this._endTurn();
    this.emit();
  }

  /**
   * Zentraler Einstieg der Oberfläche: es wurde eine Karte auf dem Tisch
   * angetippt. Je nach Phase bedeutet das etwas anderes.
   */
  selectCard(playerId, slot) {
    const s = this.state;
    switch (s.phase) {
      case PHASE.PEEK:
        return this._peekSelect(playerId, slot);
      case PHASE.DRAWN:
        if (playerId !== s.current) fail('Tausche mit einer deiner eigenen Karten.');
        return this.swapDrawnWith(slot);
      case PHASE.POWER:
        return this._powerSelect(playerId, slot);
      case PHASE.SNAP_PICK:
        return this._snapSelect(playerId, slot);
      default:
        fail('Diese Karte lässt sich gerade nicht auswählen.');
    }
  }

  _peekSelect(playerId, slot) {
    const s = this.state;
    const me = s.peek.order[s.peek.index];
    if (playerId !== me) fail('Sieh dir eine deiner eigenen Karten an.');
    if (s.peek.taken.includes(slot)) fail('Diese Karte hast du schon angesehen.');
    const id = s.players[me].hand[slot];
    if (id == null) fail('Auf diesem Platz liegt keine Karte.');

    s.peek.taken.push(slot);
    s.knowledge[me][slot] = id;
    const remaining = s.rules.initialPeeks - s.peek.taken.length;
    this._reveal({
      cards: [{ owner: me, slot, cardId: id }],
      title: 'Deine Karte',
      note: remaining > 0 ? `Danach darfst du noch ${remaining} Karte ansehen.` : 'Gut merken!',
      viewer: me,
      next: 'peekNext',
    });
    this.emit();
  }

  _powerSelect(playerId, slot) {
    const s = this.state;
    const p = s.power;
    const card = s.players[playerId].hand[slot];
    if (card == null) fail('Auf diesem Platz liegt keine Karte.');

    if (p.type === POWER.PEEK) {
      if (playerId !== s.current) fail('Diese Kraft gilt nur für deine eigenen Karten.');
      s.knowledge[s.current][slot] = card;
      s.power = null;
      this._reveal({
        cards: [{ owner: playerId, slot, cardId: card }],
        title: 'Deine Karte',
        viewer: s.current,
        next: 'endTurn',
      });
      return this.emit();
    }

    if (p.type === POWER.SPY) {
      if (playerId === s.current) fail('Diese Kraft gilt nur für fremde Karten.');
      s.power = null;
      this._reveal({
        cards: [{ owner: playerId, slot, cardId: card }],
        title: `Karte von ${s.players[playerId].name}`,
        viewer: s.current,
        next: 'endTurn',
      });
      return this.emit();
    }

    // Tauschen und König laufen beide über: erst eigene, dann fremde Karte.
    if (p.step === 'own') {
      if (playerId !== s.current) fail('Wähle zuerst eine deiner eigenen Karten.');
      p.own = { owner: playerId, slot };
      p.step = 'target';
      return this.emit();
    }

    if (p.step === 'target') {
      if (playerId === s.current) fail('Wähle jetzt die Karte eines Mitspielers.');
      p.target = { owner: playerId, slot };
      if (p.type === POWER.SWAP) {
        this._applySwap(p.own, p.target);
        s.power = null;
        this._endTurn();
        return this.emit();
      }
      p.step = 'look';
      return this.emit();
    }

    if (p.step === 'look') {
      const isOwn = playerId === p.own.owner && slot === p.own.slot;
      const isTarget = playerId === p.target.owner && slot === p.target.slot;
      if (!isOwn && !isTarget) fail('Sieh dir eine der beiden markierten Karten an.');
      if (isOwn) s.knowledge[s.current][slot] = card;
      p.looked = { owner: playerId, slot };
      this._reveal({
        cards: [{ owner: playerId, slot, cardId: card }],
        title: isOwn ? 'Deine Karte' : `Karte von ${s.players[playerId].name}`,
        note: 'Danach entscheidest du, ob getauscht wird.',
        viewer: s.current,
        next: 'kingDecide',
      });
      return this.emit();
    }

    fail('Diese Karte lässt sich gerade nicht auswählen.');
  }

  /** König: nach dem Blick tauschen oder liegen lassen. */
  resolveKing(doSwap) {
    const s = this.state;
    if (s.phase !== PHASE.POWER || s.power?.step !== 'decide') fail('Das geht gerade nicht.');
    if (doSwap) this._applySwap(s.power.own, s.power.target);
    s.power = null;
    this._endTurn();
    this.emit();
  }

  _applySwap(a, b) {
    const s = this.state;
    const ha = s.players[a.owner].hand;
    const hb = s.players[b.owner].hand;
    [ha[a.slot], hb[b.slot]] = [hb[b.slot], ha[a.slot]];
    this._forgetSlot(a.owner, a.slot);
    this._forgetSlot(b.owner, b.slot);
    this.log(
      `${s.players[a.owner].name} tauscht Platz ${a.slot + 1} mit ${s.players[b.owner].name} (Platz ${b.slot + 1}).`,
    );
  }

  /** Wenn sich der Inhalt eines Platzes ändert, ist altes Wissen wertlos. */
  _forgetSlot(owner, slot) {
    delete this.state.knowledge[owner][slot];
  }

  // -------------------------------------------------------------- Einwerfen

  _endTurn() {
    const s = this.state;
    s.drawn = null;
    s.drawnFrom = null;
    s.power = null;

    if (s.cabo && s.cabo.caller !== s.current) s.cabo.turnsRemaining -= 1;
    s.pendingRoundOver = Boolean(s.cabo && s.cabo.turnsRemaining <= 0);

    if (!s.pendingRoundOver && s.rules.snapEnabled && s.discardTouched) {
      s.snap = { claimer: null };
      s.phase = PHASE.SNAP_WINDOW;
      return;
    }
    this._advance();
  }

  snapClaim(playerId) {
    const s = this.state;
    if (s.phase !== PHASE.SNAP_WINDOW) fail('Gerade kann nicht eingeworfen werden.');
    s.snap.claimer = playerId;
    this._handoff(playerId, 'snapPick');
    this.emit();
  }

  snapPass() {
    const s = this.state;
    if (s.phase !== PHASE.SNAP_WINDOW) fail('Gerade kann nicht eingeworfen werden.');
    s.snap = null;
    this._advance();
    this.emit();
  }

  _snapSelect(playerId, slot) {
    const s = this.state;
    if (playerId !== s.snap.claimer) fail('Wähle eine deiner eigenen Karten.');
    const id = s.players[playerId].hand[slot];
    if (id == null) fail('Auf diesem Platz liegt keine Karte.');

    s.snap.slot = slot;
    s.snap.cardId = id;
    const top = this.card(s.discard[s.discard.length - 1]);
    s.snap.hit = top && this.card(id).rank === top.rank;

    // Ein Einwurf wird immer offen gezeigt – auch der danebengegangene.
    this._reveal({
      cards: [{ owner: playerId, slot, cardId: id }],
      title: s.snap.hit ? 'Treffer!' : 'Daneben',
      note: s.snap.hit
        ? `${this.card(id).label} passt auf ${top.label}.`
        : `${this.card(id).label} passt nicht auf ${top.label} – das kostet eine Strafkarte.`,
      isPublic: true,
      next: 'snapResolve',
    });
    this.emit();
  }

  _snapResolve() {
    const s = this.state;
    const { claimer, slot, hit } = s.snap;
    const player = s.players[claimer];

    if (hit) {
      s.discard.push(player.hand[slot]);
      player.hand[slot] = null;
      this._forgetSlot(claimer, slot);
      this.log(`${player.name} wirft erfolgreich ein.`);
    } else {
      const penalty = this._drawCard();
      if (penalty != null) {
        const empty = player.hand.indexOf(null);
        if (empty >= 0) {
          player.hand[empty] = penalty;
          this._forgetSlot(claimer, empty);
        } else {
          player.hand.push(penalty);
        }
      }
      this.log(`${player.name} greift daneben und bekommt eine Strafkarte.`);
    }
    s.snap = null;
    this._advance();
  }

  _advance() {
    const s = this.state;
    s.snap = null;
    s.discardTouched = false;
    if (s.pendingRoundOver) {
      s.pendingRoundOver = false;
      return this._endRound('cabo');
    }
    s.current = (s.current + 1) % s.players.length;
    this._handoff(s.current, 'turn');
  }

  // ------------------------------------------------------------- Abrechnung

  handSum(playerId) {
    return this.state.players[playerId].hand.reduce(
      (sum, id) => sum + (id == null ? 0 : this.card(id).value),
      0,
    );
  }

  _isMoonHand(playerId) {
    const cards = this.state.players[playerId].hand.filter((id) => id != null).map((id) => this.card(id));
    if (cards.length !== 4) return false;
    const queens = cards.filter((c) => c.rank === 'D').length;
    const blackKings = cards.filter((c) => c.rank === 'K' && c.color === 'black').length;
    return queens === 2 && blackKings === 2;
  }

  _endRound(reason) {
    const s = this.state;
    const r = s.rules;
    const sums = s.players.map((p) => this.handSum(p.id));
    const points = sums.slice();

    const moon = r.shootTheMoon ? s.players.findIndex((p) => this._isMoonHand(p.id)) : -1;
    let callerOk = null;

    if (moon >= 0) {
      s.players.forEach((p, i) => (points[i] = i === moon ? 0 : 50));
    } else if (s.cabo) {
      const caller = s.cabo.caller;
      const best = Math.min(...sums.filter((_, i) => i !== caller));
      callerOk = r.tieCountsForCaller ? sums[caller] <= best : sums[caller] < best;
      points[caller] = callerOk ? 0 : sums[caller] + r.caboPenalty;
    }

    const before = s.players.map((p) => p.score);
    const resets = [];
    s.players.forEach((p, i) => {
      p.score += points[i];
      if (r.resetAtHundred && !p.usedReset && p.score === r.targetScore) {
        p.score = Math.floor(r.targetScore / 2);
        p.usedReset = true;
        resets.push(i);
      }
    });

    s.gameOver = s.players.some((p) => p.score >= r.targetScore);

    s.roundResult = {
      reason,
      sums,
      points,
      before,
      after: s.players.map((p) => p.score),
      resets,
      moon: moon >= 0 ? moon : null,
      caller: s.cabo ? s.cabo.caller : null,
      callerOk,
      hands: s.players.map((p) => p.hand.slice()),
      winners: lowestIndices(sums),
    };
    s.phase = PHASE.ROUND_END;
    this.log(`Runde ${s.round} beendet.`);
  }

  nextRound() {
    const s = this.state;
    if (s.phase !== PHASE.ROUND_END) fail('Die Runde läuft noch.');
    if (s.gameOver) {
      s.phase = PHASE.GAME_END;
      this.emit();
      return;
    }
    this.startRound();
  }

  /** Endstand, sortiert – niedrigste Punktzahl gewinnt. */
  standings() {
    return this.state.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => a.score - b.score);
  }
}

function powerFirstStep(type) {
  return type === POWER.PEEK || type === POWER.SPY ? 'pick' : 'own';
}

function lowestIndices(values) {
  const min = Math.min(...values);
  return values.map((v, i) => (v === min ? i : -1)).filter((i) => i >= 0);
}
