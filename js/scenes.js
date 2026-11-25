/**
 * Choreografie – welche Bewegung gehört zu welchem Zug.
 *
 * Die Engine schreibt zu jedem Zug einen strukturierten Eintrag in den
 * Verlauf (siehe `log()` in engine.js): Art des Zuges, handelnder Spieler,
 * betroffene Plätze, Karten-IDs. Diese Datei übersetzt solche Einträge in
 * Flugbahnen – und sonst nichts. Sie ist rein: Eintrag rein, Beschreibung
 * raus. Kein DOM, keine Zeitmessung, keine Spielregeln.
 *
 * Dass die Übersetzung hier getrennt steht, hat einen Grund: Ob sich eine
 * Karte unterwegs zeigt oder nicht, ist eine Frage des Sichtschutzes, und
 * die lässt sich nur dann prüfen, wenn sie nicht mitten im Zeichencode
 * steckt. Der Maßstab dafür steht in test/scenes.test.mjs.
 *
 * Die Grundregel, die dort geprüft wird:
 *
 *   Eine fliegende Karte wird immer so gezeigt, wie sie an ihrem
 *   *Ausgangsort* lag.
 *
 * Eine Karte, die aus einer Hand auf die Ablage wandert, fliegt also
 * verdeckt und liegt erst beim Aufsetzen offen da. Damit kann eine
 * Animation niemals etwas früher verraten als das Spiel selbst – und wenn
 * später das Umdrehen dazukommt, ist genau dieser Aufsetz-Moment die
 * Stelle, an der es hingehört.
 *
 * Anker statt Koordinaten: Ziel und Quelle stehen als Beschreibung da
 * ("die Hand von Spieler 2, Platz 3"), nicht als Bildschirmposition. Wo
 * das liegt, löst flight.js auf – im Mehrgeräte-Modus notfalls als Punkt
 * auf der Tischkante, an der dieser Spieler sitzt.
 */

/**
 * Ankerarten. `EDGE` entsteht erst beim Auflösen, nicht hier.
 *
 * `DRAWN` ist die gezogene Karte selbst, `DRAWN_SLOT` der Platz, an dem
 * sie liegt. Der Unterschied zählt beim Abspielen: Ist die Karte schon
 * weggeräumt, steht ihr Platz noch da.
 */
export const ANCHOR = {
  DECK: 'deck',
  DISCARD: 'discard',
  DRAWN: 'drawn',
  DRAWN_SLOT: 'drawnSlot',
  HAND: 'hand',
  EDGE: 'edge',
};

/** Grundtempo in Millisekunden. Skaliert wird beim Abspielen. */
export const TIMING = {
  travel: 320,
  settle: 90,
};

/**
 * Alle Verlaufseinträge, die seit `lastSeq` dazugekommen sind.
 *
 * Der Zustand wird von der Engine an Ort und Stelle verändert, ein
 * Vorher-Nachher-Vergleich zweier Zustandsobjekte ginge also ins Leere.
 * Der Verlauf wächst dagegen nur hinten an und trägt mit `n` eine
 * fortlaufende Nummer – daran hängt sich diese Datei auf.
 */
export function newEntries(state, lastSeq) {
  const log = state?.log ?? [];
  return log.filter((e) => e.n > lastSeq);
}

/** Höchste vergebene Nummer – der Merkposten für den nächsten Durchgang. */
export function latestSeq(state) {
  return state?.logSeq ?? 0;
}

/**
 * Übersetzt einen Verlaufseintrag in null bis mehrere Flugbahnen.
 *
 * Stufe 1 kennt die drei häufigsten Wege: ziehen, abwerfen, tauschen.
 * Alles andere liefert bewusst eine leere Liste – eine fehlende Animation
 * ist harmlos, eine falsche nicht.
 */
export function scenesFor(entry) {
  if (!entry) return [];
  switch (entry.type) {
    case 'draw':
      return drawScenes(entry);
    case 'discardDrawn':
      return discardScenes(entry);
    case 'swapDrawn':
      return swapScenes(entry);
    default:
      return [];
  }
}

/** Bequemer Sammelaufruf über mehrere Einträge. */
export function scenesForAll(entries) {
  return entries.flatMap((e) => scenesFor(e));
}

// ------------------------------------------------------------- Einzelfälle

/** Stapel oder Ablage -> Ablagebereich vor dem Spieler. */
function drawScenes(entry) {
  const fromDeck = entry.from === 'deck';
  return [
    scene({
      key: `${entry.n}-draw`,
      from: fromDeck ? { kind: ANCHOR.DECK } : { kind: ANCHOR.DISCARD },
      to: { kind: ANCHOR.DRAWN },
      card: entry.card,
      // Vom Stapel kommt sie verdeckt; aus der Ablage lag sie ohnehin offen.
      faceUp: !fromDeck,
      lift: 1,
    }),
  ];
}

/**
 * Ablagebereich -> Ablagestapel.
 *
 * Immer verdeckt: Abgeworfen werden darf nur eine frisch vom Stapel
 * gezogene Karte – eine aus der Ablage genommene *muss* getauscht werden
 * (Wächter in `discardDrawn`). Der Ausgangsort liegt hier also nie offen.
 *
 * Die Karte selbst ist beim Abspielen nie mehr da: Die Engine leert
 * `drawn` im selben Zug, und die Oberfläche zeichnet neu, bevor die
 * Animation startet – bei Zugende sogar erst nach der Übergabesperre.
 * Darum der Platz des Ablagebereichs als Ersatz; er wird erst beim
 * Abspielen gemessen und stimmt so auch nach einer Drehung des Tablets.
 */
function discardScenes(entry) {
  return [
    scene({
      key: `${entry.n}-discard`,
      from: { kind: ANCHOR.DRAWN, fallback: { kind: ANCHOR.DRAWN_SLOT } },
      to: { kind: ANCHOR.DISCARD },
      card: entry.card,
      faceUp: false,
      lift: 1,
    }),
  ];
}

/**
 * Der Tausch: zwei Karten kreuzen sich.
 *
 * Zuerst hebt die alte Karte aus der Hand ab und wandert zur Ablage, kurz
 * darauf zieht die gezogene Karte in den frei gewordenen Platz. Die
 * Versetzung ist wichtig – gleichzeitig sähe es aus wie ein Zusammenstoß,
 * nacheinander liest es sich als Ursache und Wirkung.
 */
function swapScenes(entry) {
  const owner = entry.actor;
  return [
    scene({
      key: `${entry.n}-out`,
      from: { kind: ANCHOR.HAND, owner, slot: entry.slot },
      to: { kind: ANCHOR.DISCARD },
      card: entry.cardOut,
      // Aus der Hand: verdeckt losgeflogen, offen angekommen.
      faceUp: false,
      lift: 1,
    }),
    scene({
      key: `${entry.n}-in`,
      // Der Ablagebereich ist beim Abspielen oft schon leer geräumt;
      // flight.js weicht dann auf den Stapel aus, aus dem sie kam.
      from: { kind: ANCHOR.DRAWN, fallback: fallbackPile(entry.from) },
      to: { kind: ANCHOR.HAND, owner, slot: entry.slot },
      card: entry.cardIn,
      faceUp: entry.from === 'discard',
      lift: 1.15,
      delay: TIMING.settle,
    }),
  ];
}

// ------------------------------------------------------------- Hilfsmittel

function fallbackPile(from) {
  return from === 'discard' ? { kind: ANCHOR.DISCARD } : { kind: ANCHOR.DECK };
}

function scene({ key, from, to, card, faceUp, lift = 1, delay = 0, duration = TIMING.travel }) {
  return {
    key,
    from,
    to,
    card: card ?? null,
    faceUp: Boolean(faceUp),
    // Stufe 2: unterwegs umdrehen. Bis dahin wechselt die Darstellung
    // beim Aufsetzen, weil dort ohnehin die echte Karte übernimmt.
    flip: false,
    lift,
    delay,
    duration,
  };
}
