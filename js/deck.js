/**
 * Kartendeck für Cabo.
 *
 * Gespielt wird mit einem normalen Skat-/Pokerblatt (52 Karten) plus zwei
 * Jokern. Die Werte bilden das Original-Cabo-Deck (0 bis 13) nach:
 *
 *   Joker        =  0
 *   Ass          =  1
 *   2 bis 10     =  Kartenwert
 *   Bube         = 11
 *   Dame         = 12
 *   schwarzer K  = 13
 *   roter König  = -1   (die begehrteste Karte im Spiel)
 */

export const SUITS = [
  { id: 'S', symbol: '♠', color: 'black', name: 'Pik' },
  { id: 'H', symbol: '♥', color: 'red', name: 'Herz' },
  { id: 'D', symbol: '♦', color: 'red', name: 'Karo' },
  { id: 'C', symbol: '♣', color: 'black', name: 'Kreuz' },
];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];

export const JOKER = 'JOKER';

/** Kartenkräfte, die beim Abwerfen einer frisch gezogenen Karte ausgelöst werden. */
export const POWER = {
  PEEK: 'peek', // 7, 8   – eigene Karte ansehen
  SPY: 'spy', // 9, 10  – fremde Karte ansehen
  SWAP: 'swap', // B, D   – blind tauschen
  KING: 'king', // K (schwarz) – eine Karte ansehen, dann optional tauschen
};

export const POWER_LABEL = {
  [POWER.PEEK]: 'Spähen: eigene Karte ansehen',
  [POWER.SPY]: 'Spionieren: fremde Karte ansehen',
  [POWER.SWAP]: 'Tauschen: blind mit einem Mitspieler tauschen',
  [POWER.KING]: 'König: eine Karte ansehen, dann tauschen oder liegen lassen',
};

export function cardValue(rank, suit, rules) {
  if (rank === JOKER) return 0;
  if (rank === 'A') return 1;
  if (rank === 'B') return 11;
  if (rank === 'D') return 12;
  if (rank === 'K') return suit.color === 'red' ? rules.redKingValue : 13;
  return Number(rank);
}

export function cardPower(rank, suit, rules) {
  if (rank === '7' || rank === '8') return POWER.PEEK;
  if (rank === '9' || rank === '10') return POWER.SPY;
  if (rank === 'B' || rank === 'D') return POWER.SWAP;
  if (rank === 'K' && suit.color === 'black') return rules.kingPower ? POWER.KING : null;
  return null;
}

function makeCard(id, rank, suit, rules) {
  return {
    id,
    rank,
    suit: suit ? suit.id : null,
    symbol: suit ? suit.symbol : '★',
    color: suit ? suit.color : 'joker',
    label: suit ? `${rank}${suit.symbol}` : 'Joker',
    value: cardValue(rank, suit, rules),
    power: suit ? cardPower(rank, suit, rules) : null,
  };
}

export function createDeck(rules) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push(makeCard(`${suit.id}${rank}`, rank, suit, rules));
    }
  }
  for (let i = 0; i < rules.jokerCount; i++) {
    cards.push(makeCard(`X${i}`, JOKER, null, rules));
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
