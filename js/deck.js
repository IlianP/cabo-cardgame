/**
 * Das Cabo-Kartendeck.
 *
 * 52 Karten mit den Werten 0 bis 13. Die 0 und die 13 liegen doppelt im
 * Deck, alle Werte von 1 bis 12 viermal:
 *
 *   2 × 0     die beste Karte im Spiel
 *   4 × 1 … 4 × 12
 *   2 × 13    die teuerste Karte
 *
 * Die Zahl ist zugleich der Punktwert. Karten haben keine Farben und keine
 * Bilder auf dieser Ebene – wie sie aussehen, entscheidet die Oberfläche.
 */

/** Kartenkräfte, die beim Abwerfen einer frisch gezogenen Karte wirken. */
export const POWER = {
  PEEK: 'peek', // 7, 8   – eigene Karte ansehen
  SPY: 'spy', // 9, 10  – fremde Karte ansehen
  SWAP: 'swap', // 11, 12 – blind tauschen
};

export const POWER_NAME = {
  [POWER.PEEK]: 'Peek',
  [POWER.SPY]: 'Spy',
  [POWER.SWAP]: 'Swap',
};

export const POWER_LABEL = {
  [POWER.PEEK]: 'Peek: Sieh dir eine deiner eigenen Karten an.',
  [POWER.SPY]: 'Spy: Sieh dir die Karte eines Mitspielers an.',
  [POWER.SWAP]: 'Swap: Tausche blind eine eigene gegen eine fremde Karte.',
};

export const MIN_VALUE = 0;
export const MAX_VALUE = 13;

/** Wie oft jeder Wert im Deck liegt. */
export function copiesOf(value) {
  return value === MIN_VALUE || value === MAX_VALUE ? 2 : 4;
}

export function powerOf(value) {
  if (value === 7 || value === 8) return POWER.PEEK;
  if (value === 9 || value === 10) return POWER.SPY;
  if (value === 11 || value === 12) return POWER.SWAP;
  return null;
}

function makeCard(value, copy) {
  return {
    id: `v${value}-${copy}`,
    value,
    power: powerOf(value),
    label: String(value),
  };
}

export function createDeck() {
  const cards = [];
  for (let value = MIN_VALUE; value <= MAX_VALUE; value++) {
    for (let copy = 0; copy < copiesOf(value); copy++) {
      cards.push(makeCard(value, copy));
    }
  }
  return cards;
}

/** Fisher-Yates, mischt in-place. */
export function shuffle(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Deterministischer PRNG – für Tests und reproduzierbare Partien. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
