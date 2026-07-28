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

import { GameError, viewerOf, legalActions } from './engine.js';
import { POWER_NAME } from './deck.js';

export const TABLE = 'table';

/** Der öffentliche Tisch: alles, was jeder im Raum ohnehin sieht. */
export function tableView(state) {
  return buildView(state, TABLE);
}

/** Die Sicht eines einzelnen Spielers auf dem eigenen Handy. */
export function playerView(state, playerId) {
  if (!state.players.some((p) => p.id === playerId)) {
    // GameError wie in der Engine: ein Gastgeber soll „Handy hat Unsinn
    // geschickt“ von einem eigenen Fehler unterscheiden können.
    throw new GameError(`Diesen Spieler gibt es nicht: ${playerId}`);
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
  // Karten, die zwar in einer Hand liegen, deren Wert aber der ganze Tisch
  // kennt – die Engine führt darüber Buch (state.publicCards).
  for (const id of state.publicCards ?? []) allow(id);

  // Alles, was `allow` ruft, wird hier oben ausgewertet – erst danach darf
  // `pickCards` die Sammlung lesen. Als `const` steht diese Reihenfolge
  // fest und hängt nicht daran, wie das Objekt unten sortiert ist.
  const log = publicLog(state);
  const reveal = revealFor(state, me, allow);
  const roundResult = roundResultFor(state, allow);
  const turn = turnFor(state, me, allow);
  const you = me == null ? null : selfFor(state, me, allow);

  return {
    audience,
    // Der Stand, auf den sich diese Sicht bezieht. Ein Gerät schickt ihn bei
    // jeder Aktion mit, damit der Gastgeber veraltete und doppelte
    // Nachrichten erkennt, statt sie als Regelverstoß abzulehnen.
    version: state.version ?? 0,
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
    turn,
    multi: state.multi ? { slots: state.multi.slots.slice(), hit: state.multi.hit ?? null } : null,
    power: powerFor(state),
    reveal,
    roundResult,
    gameOver: state.gameOver,
    publicCards: (state.publicCards ?? []).slice(),
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
  const open = new Set(state.publicCards ?? []);
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    usedReset: player.usedReset,
    hasPin: Boolean(player.pin),
    mine,
    slots: player.hand.map((id, slot) => {
      // Nur für die eigene Hand und nur mit Merkhilfe: „die kennst du schon“.
      const known = Boolean(mine && state.rules.memoryAid && knownAt(state, player, slot));
      // „Diese Karte kennt der ganze Tisch“ – gilt für jeden Zuschauer.
      const isOpen = id != null && open.has(id);
      return {
        filled: id != null,
        known,
        open: isOpen,
        // Die ID steht nur dort, wo dieser Zuschauer sie ohnehin sehen darf.
        // Ohne sie wüsste die Oberfläche zwar „hier liegt etwas Offenes“,
        // könnte es aber nicht zeichnen.
        cardId: known || isOpen ? id : null,
      };
    }),
  };
}

/**
 * Wissen über einen Platz, sofern es noch gilt: Sobald dort eine andere
 * Karte liegt, ist der alte Eintrag wertlos. Die Markierung am Platz und
 * die mitgeschickten Kartenwerte müssen sich hier einig sein, sonst
 * behauptet ein Handy „die kennst du“ über eine Karte, die es gar nicht
 * bekommen hat.
 */
function knownAt(state, player, slot) {
  const id = state.knowledge[player.id]?.[slot];
  return id != null && player.hand[slot] === id ? id : null;
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
  // `mine` beantwortet „bin ich am Zug“ und gilt auch, bevor gezogen wurde –
  // sonst blendet ein Handy genau die Knöpfe aus, die es zeigen müsste.
  const mine = me != null && me === state.current;
  if (state.drawn == null) return { drawn: null, drawnFrom: state.drawnFrom ?? null, mine };
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
    player.hand.forEach((_, slot) => {
      const id = knownAt(state, player, slot);
      if (id == null) return;
      knowledge[slot] = id;
      allow(id);
    });
  }
  return {
    id: me,
    name: player.name,
    isCurrent: state.current === me,
    isViewer: viewerOf(state) === me,
    knowledge,
    can: legalActions(state, me),
  };
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
 *
 * Der Verlauf gibt bewusst *keine* Karten frei. Ein Wert im Text ist
 * harmlos – „Anna wirft die 7 ab“ ist eine öffentliche Aussage über ein
 * Ereignis, und der Text nennt nie eine ID. Die ID freizugeben wäre etwas
 * anderes: sie verrät den Wert überall dort weiter, wo sie an einem Platz
 * hängt. Welche Karte in einer Hand der ganze Tisch kennen darf, führt die
 * Engine in `state.publicCards` – das überlebt auch das Nachmischen, bei
 * dem eine offen abgeworfene Karte wieder im verdeckten Stapel landet.
 */
export function publicLog(state) {
  const name = (id) => state.players[id]?.name ?? `Spieler ${id + 1}`;
  const value = (id) => state.cards[id]?.value;
  const slotList = (slots) => slots.map((x) => x + 1).join(', ');

  const out = [];
  for (const e of state.log ?? []) {
    const text = publicText(e, { name, slotList, show: value });
    if (text) out.push({ n: e.n, round: e.round, type: e.type, actor: e.actor ?? null, text });
  }
  return out;
}

function publicText(e, h) {
  const { name, slotList, show } = h;
  const who = e.actor != null ? name(e.actor) : '';

  switch (e.type) {
    case 'roundStart':
      return `Runde ${e.round} beginnt – ${name(e.startPlayer)} fängt an.`;
    case 'reshuffle':
      return 'Nachziehstapel war leer – die Ablage wurde neu gemischt.';
    case 'draw':
      return e.from === 'discard'
        ? `${who} nimmt die ${show(e.card)} aus der Ablage.`
        : `${who} zieht vom Stapel.`;
    case 'cabo':
      return `${who} ruft Cabo!`;
    case 'swapDrawn':
      // Die abgelegte Karte landet offen auf der Ablage, die neue nicht.
      return `${who} tauscht Platz ${e.slot + 1} – die ${show(e.cardOut)} kommt auf die Ablage.`;
    case 'discardDrawn':
      return `${who} wirft die ${show(e.card)} ab.`;
    case 'multiStart':
      return `${who} beginnt eine Mehrfach-Ablage.`;
    case 'multiCancel':
      return `${who} bricht die Mehrfach-Ablage ab.`;
    case 'multiSelect':
      return e.picked
        ? `${who} wählt Platz ${e.slot + 1} für die Mehrfach-Ablage.`
        : `${who} nimmt Platz ${e.slot + 1} wieder heraus.`;
    case 'multiClaim': {
      // Angesagt wird offen – hier werden die Karten für alle sichtbar.
      const shown = e.cards.map(show).join(', ');
      return `${who} sagt ${e.slots.length} gleiche an (Plätze ${slotList(e.slots)}): ${shown} – ${
        e.hit ? 'passt' : 'daneben'
      }.`;
    }
    case 'multiResolve':
      return e.hit
        ? `${who} legt ${e.dropped.length} Karten ab; die gezogene Karte kommt auf Platz ${
            e.targetSlot + 1
          }.`
        : `${who} sagt daneben, die ${show(e.drawn)} kommt auf die Ablage – Zug verloren.`;
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
