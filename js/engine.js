/**
 * Cabo – Spiellogik nach den Verlagsregeln.
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
 *                   -> multi             mehrere gleiche Karten ablegen
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
  MULTI: 'multi',
  POWER: 'power',
  REVEAL: 'reveal',
  ROUND_END: 'roundEnd',
  GAME_END: 'gameEnd',
};

export class GameError extends Error {}

/**
 * Wer gerade schauen darf – im Ein-Gerät-Modus also der Spieler, der das
 * Tablet in der Hand hält. Steht hier als eigene Funktion, damit auch
 * Aufrufer ohne CaboGame-Instanz (etwa die Sichten-Filterung) dieselbe
 * Antwort bekommen wie der Getter `game.viewer`.
 */
export function viewerOf(state) {
  switch (state.phase) {
    case PHASE.HANDOFF:
    case PHASE.ROUND_END:
    case PHASE.GAME_END:
      return null;
    case PHASE.PEEK:
      return state.peek.order[state.peek.index];
    case PHASE.REVEAL:
      return state.reveal.viewer;
    default:
      return state.current;
  }
}

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
        nextStart: 0,
        current: 0,
        phase: PHASE.ROUND_END,
        cards: {},
        deck: [],
        discard: [],
        knowledge: {},
        handoff: null,
        peek: null,
        drawn: null,
        drawnFrom: null,
        multi: null,
        power: null,
        reveal: null,
        cabo: null,
        roundResult: null,
        gameOver: false,
        log: [],
        logSeq: 0,
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
    return viewerOf(this.state);
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

  /**
   * Schreibt einen Eintrag in den Verlauf.
   *
   * Neben dem lesbaren Text steht in jedem Eintrag, *was* genau passiert
   * ist: Art des Zuges, handelnder Spieler, betroffene Plätze und
   * Karten-IDs. Der Debug-Zustand liest das aus, ohne raten zu müssen,
   * und die Einträge überleben Speichern und Laden.
   */
  log(text, event = {}) {
    const s = this.state;
    s.logSeq = (s.logSeq ?? 0) + 1;
    s.log.push({
      n: s.logSeq,
      round: s.round,
      phase: s.phase,
      actor: event.actor ?? null,
      ...event,
      text,
    });
    if (s.log.length > 200) s.log.shift();
  }

  /** Karte als kurzer Debug-Bezeichner: "v7-1(7)". */
  _tag(id) {
    const c = this.card(id);
    return c ? `${c.id}(${c.value})` : String(id);
  }

  // ------------------------------------------------------------- Rundenlauf

  startRound() {
    const s = this.state;
    const r = s.rules;
    s.round += 1;

    const deck = shuffle(createDeck(), this.rng);
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
    s.multi = null;
    s.power = null;
    s.reveal = null;
    s.roundResult = null;

    s.startPlayer = s.nextStart % s.players.length;
    s.current = s.startPlayer;

    const order = s.players.map((_, i) => (s.startPlayer + i) % s.players.length);
    s.peek = { order, index: 0, taken: [] };

    this.log(`Runde ${s.round} beginnt.`, {
      type: 'roundStart',
      startPlayer: s.startPlayer,
      hands: s.players.map((p) => p.hand.slice()),
      discardTop: s.discard[s.discard.length - 1] ?? null,
      deckLeft: s.deck.length,
    });
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
    else if (next === 'multiResolve') this._multiResolve();
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
    if (s.deck.length === 0 && s.discard.length > 1) {
      // Oberste Ablagekarte bleibt liegen, der Rest wird neu gemischt.
      const top = s.discard.pop();
      s.deck = shuffle(s.discard, this.rng);
      s.discard = [top];
      this.log('Nachziehstapel war leer – Ablage neu gemischt.', {
        type: 'reshuffle',
        actor: s.current,
        deckLeft: s.deck.length,
      });
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
    this.log(`${this.currentPlayer.name} zieht ${this._tag(id)} vom Stapel.`, {
      type: 'draw',
      actor: s.current,
      from: 'deck',
      card: id,
      deckLeft: s.deck.length,
    });
    this.emit();
  }

  takeDiscard() {
    const s = this.state;
    if (s.phase !== PHASE.TURN) fail('Das geht gerade nicht.');
    if (!s.discard.length) fail('Die Ablage ist leer.');
    s.drawn = s.discard.pop();
    s.drawnFrom = 'discard';
    s.phase = PHASE.DRAWN;
    this.log(`${this.currentPlayer.name} nimmt ${this._tag(s.drawn)} aus der Ablage.`, {
      type: 'draw',
      actor: s.current,
      from: 'discard',
      card: s.drawn,
    });
    this.emit();
  }

  callCabo() {
    const s = this.state;
    if (s.phase !== PHASE.TURN) fail('Das geht gerade nicht.');
    if (s.cabo) fail('Cabo wurde bereits gerufen.');
    s.cabo = { caller: s.current, turnsRemaining: s.players.length - 1 };
    this.log(`${this.currentPlayer.name} ruft Cabo!`, {
      type: 'cabo',
      actor: s.current,
      turnsRemaining: s.cabo.turnsRemaining,
    });
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
    this._forgetSlot(s.current, slot);
    s.knowledge[s.current][slot] = s.drawn;

    this.log(
      `${this.currentPlayer.name} tauscht Platz ${slot + 1}: ${this._tag(outgoing)} raus, ${this._tag(
        s.drawn,
      )} rein.`,
      {
        type: 'swapDrawn',
        actor: s.current,
        from: s.drawnFrom,
        slot,
        cardIn: s.drawn,
        cardOut: outgoing,
        hand: hand.slice(),
      },
    );
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
    this.log(`${this.currentPlayer.name} wirft die ${card.value} ab.`, {
      type: 'discardDrawn',
      actor: s.current,
      card: s.drawn,
      power: card.power ?? null,
    });
    s.drawn = null;

    if (card.power) {
      s.power = { type: card.power, step: card.power === POWER.SWAP ? 'own' : 'pick', own: null, target: null };
      s.phase = PHASE.POWER;
    } else {
      this._endTurn();
    }
    this.emit();
  }

  // ------------------------------------------------------- Mehrfach-Ablage

  /**
   * Mehrere eigene Karten gleichen Wertes gemeinsam abwerfen. Man sagt an,
   * deckt auf – und spielt bei richtiger Ansage mit weniger Karten weiter.
   * Bei falscher Ansage ist der Zug verloren.
   */
  startMultiDiscard() {
    const s = this.state;
    if (s.phase !== PHASE.DRAWN) fail('Das geht gerade nicht.');
    if (!s.rules.multiDiscard) fail('Die Mehrfach-Ablage ist ausgeschaltet.');
    if (s.drawnFrom !== 'deck') fail('Das geht nur mit einer frisch gezogenen Karte.');
    s.multi = { slots: [] };
    s.phase = PHASE.MULTI;
    this.log(`${this.currentPlayer.name} beginnt eine Mehrfach-Ablage.`, {
      type: 'multiStart',
      actor: s.current,
      drawn: s.drawn,
      hand: this.currentPlayer.hand.slice(),
    });
    this.emit();
  }

  cancelMultiDiscard() {
    const s = this.state;
    if (s.phase !== PHASE.MULTI) fail('Das geht gerade nicht.');
    this.log(`${this.currentPlayer.name} bricht die Mehrfach-Ablage ab.`, {
      type: 'multiCancel',
      actor: s.current,
      slots: s.multi.slots.slice(),
    });
    s.multi = null;
    s.phase = PHASE.DRAWN;
    this.emit();
  }

  _multiSelect(playerId, slot) {
    const s = this.state;
    if (playerId !== s.current) fail('Wähle deine eigenen Karten.');
    if (this.currentPlayer.hand[slot] == null) fail('Auf diesem Platz liegt keine Karte.');
    const at = s.multi.slots.indexOf(slot);
    if (at >= 0) s.multi.slots.splice(at, 1);
    else s.multi.slots.push(slot);
    this.log(
      `${this.currentPlayer.name} ${at >= 0 ? 'nimmt Platz' : 'wählt Platz'} ${slot + 1} ${
        at >= 0 ? 'wieder heraus' : 'für die Mehrfach-Ablage'
      }.`,
      {
        type: 'multiSelect',
        actor: s.current,
        slot,
        picked: at < 0,
        card: this.currentPlayer.hand[slot],
        slots: s.multi.slots.slice(),
      },
    );
    this.emit();
  }

  confirmMultiDiscard() {
    const s = this.state;
    if (s.phase !== PHASE.MULTI) fail('Das geht gerade nicht.');
    const slots = s.multi.slots;
    if (slots.length < 2) fail('Wähle mindestens zwei Karten – oder brich ab.');

    const hand = this.currentPlayer.hand;
    const values = slots.map((slot) => this.card(hand[slot]).value);
    const hit = values.every((v) => v === values[0]);
    s.multi.hit = hit;

    this.log(
      `${this.currentPlayer.name} sagt ${slots.length} gleiche an (Plätze ${slots
        .map((x) => x + 1)
        .join(', ')}): ${hit ? 'passt' : 'daneben'}.`,
      {
        type: 'multiClaim',
        actor: s.current,
        slots: slots.slice(),
        cards: slots.map((slot) => hand[slot]),
        values,
        hit,
        drawn: s.drawn,
        hand: hand.slice(),
      },
    );

    // Angesagt wird immer offen – auch die misslungene Ansage.
    this._reveal({
      cards: slots.map((slot) => ({ owner: s.current, slot, cardId: hand[slot] })),
      title: hit ? 'Passt!' : 'Nicht gleich',
      note: hit
        ? `${slots.length}× die ${values[0]} – diese Karten sind weg.`
        : 'Die Werte sind nicht alle gleich. Alles wird wieder verdeckt, der Zug ist verloren.',
      isPublic: true,
      next: 'multiResolve',
    });
    this.emit();
  }

  _multiResolve() {
    const s = this.state;
    const { slots, hit } = s.multi;
    const player = this.currentPlayer;

    if (hit) {
      const sorted = [...slots].sort((a, b) => a - b);
      const dropped = sorted.map((slot) => ({ slot, card: player.hand[slot] }));
      for (const slot of sorted) {
        s.discard.push(player.hand[slot]);
        player.hand[slot] = null;
        this._forgetSlot(s.current, slot);
      }
      // Die gezogene Karte kommt auf den ersten frei gewordenen Platz.
      const target = sorted[0];
      player.hand[target] = s.drawn;
      s.knowledge[s.current][target] = s.drawn;
      this.log(
        `${player.name} legt ${sorted.length} gleiche Karten ab (Plätze ${sorted
          .map((x) => x + 1)
          .join(', ')}); ${this._tag(s.drawn)} kommt auf Platz ${target + 1}.`,
        {
          type: 'multiResolve',
          actor: s.current,
          hit: true,
          dropped,
          targetSlot: target,
          drawn: s.drawn,
          hand: player.hand.slice(),
        },
      );
    } else {
      s.discard.push(s.drawn);
      this.log(`${player.name} sagt daneben und verliert den Zug.`, {
        type: 'multiResolve',
        actor: s.current,
        hit: false,
        slots: slots.slice(),
        drawn: s.drawn,
        hand: player.hand.slice(),
      });
    }

    s.drawn = null;
    s.multi = null;
    this._endTurn();
  }

  // ------------------------------------------------------------ Kartenkraft

  skipPower() {
    const s = this.state;
    if (s.phase !== PHASE.POWER) fail('Gerade ist keine Kartenkraft offen.');
    this.log(`${this.currentPlayer.name} lässt die Kraft (${s.power.type}) verfallen.`, {
      type: 'powerSkip',
      actor: s.current,
      power: s.power.type,
    });
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
      case PHASE.MULTI:
        return this._multiSelect(playerId, slot);
      case PHASE.POWER:
        return this._powerSelect(playerId, slot);
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
    this.log(`${s.players[me].name} sieht sich Platz ${slot + 1} an (${this._tag(id)}).`, {
      type: 'initialPeek',
      actor: me,
      slot,
      card: id,
    });
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
      if (playerId !== s.current) fail('Peek gilt nur für deine eigenen Karten.');
      s.knowledge[s.current][slot] = card;
      s.power = null;
      this.log(`${this.currentPlayer.name} sieht per Peek Platz ${slot + 1} (${this._tag(card)}).`, {
        type: 'powerPeek',
        actor: s.current,
        owner: playerId,
        slot,
        card,
      });
      this._reveal({
        cards: [{ owner: playerId, slot, cardId: card }],
        title: 'Deine Karte',
        viewer: s.current,
        next: 'endTurn',
      });
      return this.emit();
    }

    if (p.type === POWER.SPY) {
      if (playerId === s.current) fail('Spy gilt nur für fremde Karten.');
      s.power = null;
      this.log(
        `${this.currentPlayer.name} spioniert Platz ${slot + 1} von ${
          s.players[playerId].name
        } (${this._tag(card)}).`,
        { type: 'powerSpy', actor: s.current, owner: playerId, slot, card },
      );
      this._reveal({
        cards: [{ owner: playerId, slot, cardId: card }],
        title: `Karte von ${s.players[playerId].name}`,
        viewer: s.current,
        next: 'endTurn',
      });
      return this.emit();
    }

    // Swap: erst eine eigene, dann eine fremde Karte.
    if (p.step === 'own') {
      if (playerId !== s.current) fail('Wähle zuerst eine deiner eigenen Karten.');
      p.own = { owner: playerId, slot };
      p.step = 'target';
      return this.emit();
    }

    if (p.step === 'target') {
      if (playerId === s.current) fail('Wähle jetzt die Karte eines Mitspielers.');
      p.target = { owner: playerId, slot };
      this._applySwap(p.own, p.target);
      s.power = null;
      this._endTurn();
      return this.emit();
    }

    fail('Diese Karte lässt sich gerade nicht auswählen.');
  }

  _applySwap(a, b) {
    const s = this.state;
    const ha = s.players[a.owner].hand;
    const hb = s.players[b.owner].hand;
    const before = [ha[a.slot], hb[b.slot]];
    [ha[a.slot], hb[b.slot]] = [hb[b.slot], ha[a.slot]];
    this._forgetSlot(a.owner, a.slot);
    this._forgetSlot(b.owner, b.slot);
    this.log(
      `${s.players[a.owner].name} tauscht Platz ${a.slot + 1} mit ${s.players[b.owner].name} (Platz ${b.slot + 1}).`,
      {
        type: 'powerSwap',
        actor: s.current,
        own: { owner: a.owner, slot: a.slot, card: before[0] },
        target: { owner: b.owner, slot: b.slot, card: before[1] },
      },
    );
  }

  /** Wenn sich der Inhalt eines Platzes ändert, ist altes Wissen wertlos. */
  _forgetSlot(owner, slot) {
    delete this.state.knowledge[owner][slot];
  }

  // ------------------------------------------------------------ Zugwechsel

  _endTurn() {
    const s = this.state;
    s.drawn = null;
    s.drawnFrom = null;
    s.multi = null;
    s.power = null;

    if (s.cabo && s.cabo.caller !== s.current) s.cabo.turnsRemaining -= 1;
    if (s.cabo && s.cabo.turnsRemaining <= 0) return this._endRound('cabo');

    const done = s.current;
    s.current = (s.current + 1) % s.players.length;
    this.log(`Zug von ${s.players[done].name} beendet – weiter an ${this.currentPlayer.name}.`, {
      type: 'turnEnd',
      actor: done,
      next: s.current,
      hands: s.players.map((p) => p.hand.slice()),
    });
    this._handoff(s.current, 'turn');
  }

  // ------------------------------------------------------------- Abrechnung

  handSum(playerId) {
    return this.state.players[playerId].hand.reduce(
      (sum, id) => sum + (id == null ? 0 : this.card(id).value),
      0,
    );
  }

  /** Zwei Zwölfen und beide Dreizehnen. */
  _isMoonHand(playerId) {
    const values = this.state.players[playerId].hand
      .filter((id) => id != null)
      .map((id) => this.card(id).value);
    if (values.length !== 4) return false;
    return values.filter((v) => v === 12).length === 2 && values.filter((v) => v === 13).length === 2;
  }

  _endRound(reason) {
    const s = this.state;
    const r = s.rules;
    const sums = s.players.map((p) => this.handSum(p.id));
    const points = sums.slice();

    const lowest = Math.min(...sums);
    const winners = sums.map((v, i) => (v === lowest ? i : -1)).filter((i) => i >= 0);
    const moon = r.shootTheMoon ? s.players.findIndex((p) => this._isMoonHand(p.id)) : -1;
    const caller = s.cabo ? s.cabo.caller : null;
    let callerOk = null;

    if (moon >= 0) {
      s.players.forEach((p, i) => (points[i] = i === moon ? 0 : 50));
    } else if (caller != null) {
      // Bei Gleichstand gewinnt der Cabo-Sager.
      callerOk = sums[caller] === lowest;
      if (callerOk) {
        points[caller] = 0;
      } else {
        points[caller] = sums[caller] + r.caboPenalty;
        for (const w of winners) points[w] = 0;
      }
    } else {
      // Ohne Cabo-Ruf bekommen alle Gleichstands-Beteiligten null Punkte.
      for (const w of winners) points[w] = 0;
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

    s.gameOver = s.players.some((p) => p.score > r.targetScore);

    s.roundResult = {
      reason,
      sums,
      points,
      before,
      after: s.players.map((p) => p.score),
      resets,
      moon: moon >= 0 ? moon : null,
      caller,
      callerOk,
      hands: s.players.map((p) => p.hand.slice()),
      winners,
    };

    s.nextStart = r.winnerStarts
      ? this._roundWinner(winners)
      : (s.startPlayer + 1) % s.players.length;

    s.phase = PHASE.ROUND_END;
    this.log(`Runde ${s.round} beendet (${reason}).`, {
      type: 'roundEnd',
      reason,
      sums,
      points,
      caller,
      hands: s.players.map((p) => p.hand.slice()),
    });
  }

  /** Startspieler der nächsten Runde: Sieger, bei Patt der mit weniger Gesamtpunkten. */
  _roundWinner(winners) {
    const s = this.state;
    if (winners.length === 1) return winners[0];
    const best = Math.min(...winners.map((i) => s.players[i].score));
    const tied = winners.filter((i) => s.players[i].score === best);
    return tied.length === 1 ? tied[0] : tied[Math.floor(this.rng() * tied.length)];
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
