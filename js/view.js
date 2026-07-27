/**
 * Sichten – was ein einzelnes Gerät vom Spielzustand erfahren darf.
 *
 * Für den Mehrgeräte-Modus (Tablet in der Mitte, je ein Handy pro Spieler)
 * hält ein Gerät den vollen Zustand, alle anderen bekommen nur eine
 * beschnittene Fassung. Beschneiden heißt hier wirklich weglassen: eine
 * fremde Handkarte darf nicht als Wert und nicht als Karten-ID über die
 * Leitung gehen, sonst steht sie in den Entwicklerwerkzeugen.
 *
 * Zwei Zuschauer gibt es:
 *
 *   tableView(state)             der öffentliche Tisch – Stapel, Ablage,
 *                                wer am Zug ist, Punkte, Verlauf
 *   playerView(state, playerId)  eine Hand – zusätzlich das, was genau
 *                                dieser Spieler sehen darf
 *
 * Beide Funktionen sind rein: Zustand rein, einfaches JSON raus. Sie
 * verändern nichts und kennen keine Oberfläche. Der Ein-Gerät-Modus
 * benutzt sie nicht – dort sieht die Oberfläche ohnehin alles und regelt
 * den Sichtschutz über Sperrbildschirm und Halten.
 *
 * Grundsatz beim Zusammenstellen: erst wird gesammelt, *welche* Karten
 * dieser Zuschauer sehen darf (`allowed`), und nur diese landen am Ende in
 * `cards`. Alles andere ist nur eine ID-lose Angabe „hier liegt eine
 * Karte“.
 */

import { PHASE } from './engine.js';
import { POWER_NAME } from './deck.js';

export const TABLE = 'table';

/** Der öffentliche Tisch: alles, was jeder im Raum ohnehin sieht. */
export function tableView(state) {
  return buildView(state, TABLE);
}

/** Die Sicht eines einzelnen Spielers auf dem eigenen Handy. */
export function playerView(state, playerId) {
  if (!state.players.some((p) => p.id === playerId)) {
    throw new Error(`Diesen Spieler gibt es nicht: ${playerId}`);
  }
  return buildView(state, playerId);
}

/** @param {'table'|number} audience */
export function viewFor(state, audience) {
  return audience === TABLE ? tableView(state) : playerView(state, audience);
}

// --------------------------------------------------------------- Aufbau

function buildView(state, audience) {
  const me = audience === TABLE ? null : audience;
  const allowed = new Set();
  const allow = (id) => {
    if (id != null) allowed.add(id);
  };

  // Die oberste Ablagekarte liegt offen – die darunter interessiert nicht.
  const discardTop = state.discard[state.discard.length - 1] ?? null;
  allow(discardTop);

  const log = publicLog(state, allow);
  const reveal = revealFor(state, me, allow);
  const roundResult = roundResultFor(state, allow);
  const you = me == null ? null : selfFor(state, me, allow);

  return {
    audience,
    round: state.round,
    phase: state.phase,
    rules: { ...state.rules },
    players: state.players.map((p) => seatFor(state, p, me)),
    current: state.current,
    startPlayer: state.startPlayer,
    deckLeft: state.deck.length,
    discardCount: state.discard.length,
    discardTop,
    cabo: state.cabo ? { ...state.cabo } : null,
    handoff: state.handoff ? { ...state.handoff } : null,
    peek: peekFor(state),
    turn: turnFor(state, me, allow),
    multi: state.multi ? { slots: state.multi.slots.slice(), hit: state.multi.hit ?? null } : null,
    power: powerFor(state),
    reveal,
    roundResult,
    gameOver: state.gameOver,
    you,
    log,
    cards: pickCards(state, allowed),
  };
}

/**
 * Ein Platz am Tisch. Namen und Punkte sind öffentlich, die PIN ist es
 * nie – von ihr geht nur weiter, *dass* es eine gibt.
 */
function seatFor(state, player, me) {
  const mine = player.id === me;
  const known = mine ? state.knowledge[player.id] ?? {} : {};
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    usedReset: player.usedReset,
    hasPin: Boolean(player.pin),
    mine,
    slots: player.hand.map((id, slot) => ({
      filled: id != null,
      // Nur für die eigene Hand und nur mit Merkhilfe: „die kennst du schon“.
      known: Boolean(mine && state.rules.memoryAid && known[slot] != null),
    })),
  };
}

/** Anfangsphase: wer sich gerade Karten ansieht und wie viele noch fehlen. */
function peekFor(state) {
  const peek = state.peek;
  if (!peek) return null;
  const player = peek.order[peek.index] ?? null;
  return {
    player,
    taken: peek.taken.slice(),
    remaining: Math.max(0, state.rules.initialPeeks - peek.taken.length),
  };
}

/**
 * Der laufende Zug. Dass jemand gezogen hat, ist öffentlich – *was*, nur
 * dann, wenn es aus der offenen Ablage kam oder wenn der Zuschauer selbst
 * am Zug ist.
 */
function turnFor(state, me, allow) {
  if (state.drawn == null) return { drawn: null, drawnFrom: state.drawnFrom ?? null, mine: false };
  const mine = me != null && me === state.current;
  const open = state.drawnFrom === 'discard'; // lag offen, alle haben sie gesehen
  if (mine || open) allow(state.drawn);
  return {
    drawn: mine || open ? state.drawn : null,
    drawnFrom: state.drawnFrom,
    mine,
  };
}

/** Kartenkraft: Art und Schritt sind öffentlich, die Karten dahinter nicht. */
function powerFor(state) {
  const p = state.power;
  if (!p) return null;
  return {
    type: p.type,
    name: POWER_NAME[p.type] ?? p.type,
    step: p.step,
    own: p.own ? { owner: p.own.owner, slot: p.own.slot } : null,
    target: p.target ? { owner: p.target.owner, slot: p.target.slot } : null,
  };
}

/**
 * Aufdeckung. Öffentliche Aufdeckungen (Mehrfach-Ablage) gehen an alle,
 * private nur an das Gerät des Zuschauers – für alle anderen bleibt
 * stehen, *dass* jemand etwas ansieht.
 */
function revealFor(state, me, allow) {
  const r = state.reveal;
  if (!r) return null;
  const forMe = r.isPublic || (me != null && r.viewer === me);
  if (forMe) for (const c of r.cards) allow(c.cardId);
  return {
    title: forMe ? r.title : 'Verdeckt',
    note: forMe ? r.note : 'Ein Mitspieler sieht sich eine Karte an.',
    isPublic: r.isPublic,
    viewer: r.viewer,
    forMe,
    cards: r.cards.map((c) => ({
      owner: c.owner,
      slot: c.slot,
      cardId: forMe ? c.cardId : null,
    })),
  };
}

/** Am Rundenende liegt alles offen – da darf jedes Gerät jede Karte kennen. */
function roundResultFor(state, allow) {
  const r = state.roundResult;
  if (!r) return null;
  for (const hand of r.hands) for (const id of hand) allow(id);
  return JSON.parse(JSON.stringify(r));
}

/**
 * Der Zuschauer selbst: was er gerade tun darf und welche seiner eigenen
 * Karten er kennt. Ohne Merkhilfe bleibt auch die eigene Hand verdeckt –
 * das Vergessen ist der Kern des Spiels und soll nicht am Handy scheitern.
 */
function selfFor(state, me, allow) {
  const player = state.players[me];
  const knowledge = {};
  if (state.rules.memoryAid) {
    for (const [slot, id] of Object.entries(state.knowledge[me] ?? {})) {
      if (player.hand[Number(slot)] !== id) continue; // veraltet: Platz hat gewechselt
      knowledge[slot] = id;
      allow(id);
    }
  }
  return {
    id: me,
    name: player.name,
    isCurrent: state.current === me,
    isViewer: viewerOf(state) === me,
    knowledge,
    can: actionsFor(state, me),
  };
}

/** Wer das Gerät im Ein-Gerät-Modus halten würde – hier: wer dran ist. */
function viewerOf(state) {
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

/**
 * Welche Aktionen dieses Gerät gerade schicken darf. Der Gastgeber prüft
 * ohnehin noch einmal alles – das hier ist nur für die Oberfläche, damit
 * ein Handy nicht Knöpfe zeigt, die zu einer Absage führen.
 */
function actionsFor(state, me) {
  const can = [];
  switch (state.phase) {
    case PHASE.HANDOFF:
      if (state.handoff.to === me) can.push('confirmHandoff');
      break;
    case PHASE.PEEK:
      if (state.peek.order[state.peek.index] === me) can.push('selectCard');
      break;
    case PHASE.TURN:
      if (state.current === me) {
        can.push('drawFromDeck');
        if (state.discard.length) can.push('takeDiscard');
        if (!state.cabo) can.push('callCabo');
      }
      break;
    case PHASE.DRAWN:
      if (state.current === me) {
        can.push('selectCard');
        if (state.drawnFrom === 'deck') {
          can.push('discardDrawn');
          if (state.rules.multiDiscard) can.push('startMultiDiscard');
        }
      }
      break;
    case PHASE.MULTI:
      if (state.current === me) {
        can.push('selectCard', 'cancelMultiDiscard');
        if (state.multi.slots.length >= 2) can.push('confirmMultiDiscard');
      }
      break;
    case PHASE.POWER:
      if (state.current === me) can.push('selectCard', 'skipPower');
      break;
    case PHASE.REVEAL:
      if (state.reveal.isPublic || state.reveal.viewer === me) can.push('ackReveal');
      break;
    case PHASE.ROUND_END:
      can.push('nextRound');
      break;
    default:
      break;
  }
  return can;
}

/** Aus dem vollen Kartenverzeichnis nur die freigegebenen Karten kopieren. */
function pickCards(state, allowed) {
  const out = {};
  for (const id of allowed) {
    const card = state.cards[id];
    if (card) out[id] = { ...card };
  }
  return out;
}

// ---------------------------------------------------------------- Verlauf

/**
 * Öffentlicher Verlauf.
 *
 * Der Verlauf der Engine ist zum Fehlersuchen gedacht und schreibt Karten
 * im Klartext mit – der darf so nirgendwohin. Statt den fertigen Text zu
 * säubern, wird er hier aus den Ereignisdaten neu geschrieben: pro
 * Ereignisart ist einzeln entschieden, was öffentlich ist. Was nicht
 * aufgeführt ist, fällt heraus.
 */
export function publicLog(state, allow = () => {}) {
  const name = (id) => state.players[id]?.name ?? `Spieler ${id + 1}`;
  const value = (id) => state.cards[id]?.value;
  const slotList = (slots) => slots.map((s) => s + 1).join(', ');
  const open = (id) => {
    allow(id);
    return value(id);
  };

  const out = [];
  for (const e of state.log ?? []) {
    // Karten-IDs bleiben stabil, der Verlauf überlebt die Runde: nur was in
    // dieser Runde offengelegt wurde, darf auch jetzt noch mitgeschickt werden.
    const openHere = e.round === state.round ? open : value;
    const text = publicText(e, { name, value, slotList, open: openHere });
    if (text) out.push({ n: e.n, round: e.round, type: e.type, actor: e.actor ?? null, text });
  }
  return out;
}

function publicText(e, h) {
  const { name, slotList, open } = h;
  const who = e.actor != null ? name(e.actor) : '';

  switch (e.type) {
    case 'roundStart':
      return `Runde ${e.round} beginnt – ${name(e.startPlayer)} fängt an.`;
    case 'reshuffle':
      return 'Nachziehstapel war leer – die Ablage wurde neu gemischt.';
    case 'draw':
      return e.from === 'discard'
        ? `${who} nimmt die ${open(e.card)} aus der Ablage.`
        : `${who} zieht vom Stapel.`;
    case 'cabo':
      return `${who} ruft Cabo!`;
    case 'swapDrawn':
      // Die abgelegte Karte landet offen auf der Ablage, die neue nicht.
      return `${who} tauscht Platz ${e.slot + 1} – die ${open(e.cardOut)} kommt auf die Ablage.`;
    case 'discardDrawn':
      return `${who} wirft die ${open(e.card)} ab.`;
    case 'multiStart':
      return `${who} beginnt eine Mehrfach-Ablage.`;
    case 'multiCancel':
      return `${who} bricht die Mehrfach-Ablage ab.`;
    case 'multiSelect':
      return e.picked
        ? `${who} wählt Platz ${e.slot + 1} für die Mehrfach-Ablage.`
        : `${who} nimmt Platz ${e.slot + 1} wieder heraus.`;
    case 'multiClaim':
      // Angesagt wird offen – hier werden die Karten für alle sichtbar.
      return `${who} sagt ${e.slots.length} gleiche an (Plätze ${slotList(e.slots)}): ${
        e.hit ? `${e.cards.map(open).join(', ')} – passt` : `${e.cards.map(open).join(', ')} – daneben`
      }.`;
    case 'multiResolve':
      return e.hit
        ? `${who} legt ${e.dropped.length} Karten ab; die gezogene Karte kommt auf Platz ${
            e.targetSlot + 1
          }.`
        : `${who} sagt daneben, die ${open(e.drawn)} kommt auf die Ablage – Zug verloren.`;
    case 'powerSkip':
      return `${who} lässt die Kraft (${POWER_NAME[e.power] ?? e.power}) verfallen.`;
    case 'initialPeek':
      return `${who} sieht sich Platz ${e.slot + 1} an.`;
    case 'powerPeek':
      return `${who} sieht per Peek Platz ${e.slot + 1} an.`;
    case 'powerSpy':
      return `${who} spioniert Platz ${e.slot + 1} von ${name(e.owner)}.`;
    case 'powerSwap':
      return `${who} tauscht blind Platz ${e.own.slot + 1} mit ${name(e.target.owner)} (Platz ${
        e.target.slot + 1
      }).`;
    case 'turnEnd':
      return `Zug von ${who} beendet – weiter an ${name(e.next)}.`;
    case 'roundEnd':
      return `Runde ${e.round} beendet (${e.reason}).`;
    default:
      return null; // unbekannt heißt: bleibt hier.
  }
}
