/**
 * Mehrgeräte-Oberfläche.
 *
 * Zwei Rollen, eine Datei: Der **Tisch** eröffnet die Partie und hält den
 * Gastgeber (`host.js`), jede **Hand** verbindet sich als Gerät
 * (`client.js`). Beide zeichnen ausschließlich aus der Sicht, die vom
 * Gastgeber kommt – kein Bildschirm hier greift auf den Spielzustand zu.
 *
 * Das ist der Unterschied zum Ein-Gerät-Modus, und er ist wichtiger als er
 * aussieht: Die Hand *kann* fremde Karten nicht anzeigen, weil sie sie nie
 * bekommen hat. Sichtschutz ist hier keine Frage der Bedienung mehr,
 * sondern eine Eigenschaft der Verbindung.
 *
 * Diese Fassung ist bewusst schlicht gehalten – sie zeigt, dass die
 * Aufteilung trägt, und ersetzt noch nicht die ausgearbeitete Oberfläche
 * des Ein-Gerät-Modus.
 */

import { CaboGame } from './engine.js';
import { DEFAULT_RULES } from './rules.js';
import { CaboHost } from './host.js';
import { CaboClient } from './client.js';
import { BroadcastChannelTransport, loopback } from './transport.js';
import { TABLE } from './view.js';
import { artFor, CARD_BACK } from './art.js';
import { POWER_NAME, MAX_VALUE } from './deck.js';
import { attachReveal } from './privacy.js';

const $ = (id) => document.getElementById(id);
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const STORE = 'cabo.multi.v1';

let seats = [{ name: '' }, { name: '' }, { name: '' }];
let host = null;
let client = null;
let revealSeen = false;

// ------------------------------------------------------------ Werkzeuge

const esc = (text) =>
  String(text ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 2600);
}

function show(screen) {
  for (const id of ['screen-role', 'screen-seat', 'screen-table', 'screen-hand']) {
    $(id).classList.toggle('hidden', id !== screen);
  }
}

const hueFor = (value) => Math.round((170 - (value / MAX_VALUE) * 175 + 360) % 360);

/** Vorderseite wie im Ein-Gerät-Modus: Zahl über Eck, Kraft als Band. */
function cardFaceHTML(card) {
  const power = card.power ? `<span class="card-power">${POWER_NAME[card.power]}</span>` : '';
  return (
    `<span class="card-num card-num--tl">${card.value}</span>` +
    `<span class="card-num card-num--br">${card.value}</span>${power}`
  );
}

/**
 * Eine Karte zeichnen. `card` ist entweder ein Kartenobjekt aus
 * `view.cards` oder null – und null heißt hier wirklich „ich weiß es
 * nicht“, nicht „verstecke es“.
 */
function cardHTML(card, { classes = [], label = '', empty = false } = {}) {
  if (empty) return `<div class="card card--empty ${classes.join(' ')}"></div>`;
  const cls = ['card', card ? 'card--up' : 'card--down', ...classes];
  const styles = [`--hue:${hueFor(card?.value ?? 0)}`];
  const art = card ? artFor(card.value) : CARD_BACK;
  if (art) {
    cls.push('card--art');
    styles.push(`--art:url('${art}')`);
  }
  const slot = label ? `<span class="card-slot">${label}</span>` : '';
  return `<div class="${cls.join(' ')}" style="${styles.join(';')}">${
    card ? cardFaceHTML(card) : ''
  }${slot}</div>`;
}

/** Karte umdrehen, ohne den Knoten neu zu bauen (der Halte-Griff bleibt dran). */
function faceUp(node, card) {
  if (!card) return;
  node.innerHTML = cardFaceHTML(card);
  node.style.setProperty('--hue', hueFor(card.value));
  node.style.setProperty('--art', `url('${artFor(card.value)}')`);
  node.classList.add('card--up');
  node.classList.remove('card--down');
}

function faceDown(node) {
  node.innerHTML = '';
  node.style.setProperty('--art', `url('${CARD_BACK}')`);
  node.classList.remove('card--up');
  node.classList.add('card--down');
}

// --------------------------------------------------------- Einrichtung

function loadSeats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw?.seats?.length >= MIN_PLAYERS) seats = raw.seats;
    if (raw?.room) $('room').value = raw.room;
  } catch {
    /* egal */
  }
}

function saveSeats() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ seats, room: $('room').value }));
  } catch {
    /* privater Modus */
  }
}

function renderPlayerList() {
  $('player-list').innerHTML = seats
    .map(
      (seat, i) => `<div class="player-row">
        <span class="seat-no">${i + 1}</span>
        <input type="text" data-name="${i}" value="${esc(seat.name)}"
               placeholder="Spieler ${i + 1}" maxlength="14" autocomplete="off">
      </div>`,
    )
    .join('');
  $('player-list')
    .querySelectorAll('[data-name]')
    .forEach((input) =>
      input.addEventListener('input', () => {
        seats[Number(input.dataset.name)].name = input.value;
        saveSeats();
      }),
    );
  $('btn-add-player').disabled = seats.length >= MAX_PLAYERS;
  $('btn-remove-player').disabled = seats.length <= MIN_PLAYERS;
}

// ---------------------------------------------------------------- Tisch

function startAsTable() {
  const room = $('room').value.trim() || 'tisch';
  const players = seats.map((s, i) => ({ name: s.name.trim() || `Spieler ${i + 1}` }));
  const game = new CaboGame({ players, rules: { ...DEFAULT_RULES } });

  // Der Tisch ist selbst nur ein Gerät: Er zeichnet aus derselben
  // beschnittenen Sicht wie jedes Handy und greift nie in den Spielzustand.
  // Weil er im selben Fenster wie der Gastgeber sitzt, läuft das über eine
  // Direktverbindung – ein BroadcastChannel stellt nicht an sich selbst zu.
  const local = loopback('tisch-gerät');
  host = new CaboHost(game, {
    transports: [new BroadcastChannelTransport(room, 'host'), local.host],
  });
  client = new CaboClient(local.device, { onView: renderTable, onError: toast });
  client.join(TABLE);
  saveSeats();
  show('screen-table');
}

function renderTable(view) {
  $('t-round').textContent = `Runde ${view.round}`;
  $('t-scores').innerHTML = view.players
    .map((p) => {
      const cls = ['score-chip'];
      if (p.id === view.current) cls.push('score-chip--current');
      return `<span class="${cls.join(' ')}">${esc(p.name)} <b>${p.score}</b></span>`;
    })
    .join('');

  const missing = new Set(host?.missingSeats() ?? []);
  $('t-seats').innerHTML = view.players
    .map((p) => {
      const cards = p.slots
        .map((slot, i) => {
          if (!slot.filled) return cardHTML(null, { empty: true });
          // Der Tisch zeigt nur, was der ganze Tisch kennen darf – und die
          // Sicht nennt die Karte genau dann, wenn das zutrifft.
          const card = slot.cardId ? view.cards[slot.cardId] : null;
          return cardHTML(card, { classes: slot.open ? ['card--open'] : [], label: String(i + 1) });
        })
        .join('');
      const state = missing.has(p.id) ? '<span class="seat-missing">kein Gerät</span>' : '';
      return `<div class="seat ${p.id === view.current ? 'seat--current' : ''}">
          <div class="seat-head"><b>${esc(p.name)}</b> ${state}</div>
          <div class="seat-cards">${cards}</div>
        </div>`;
    })
    .join('');

  $('t-deck').textContent = view.deckLeft;
  const top = view.discardTop ? view.cards[view.discardTop] : null;
  $('t-discard').innerHTML = top ? cardHTML(top) : '<span class="muted">leer</span>';

  $('t-prompt').innerHTML = tablePrompt(view);
  // Der Tisch hat kein `you` – gemeinsame Schritte leiten sich aus der Phase ab.
  $('t-buttons').innerHTML = '';
  if (view.phase === 'reveal' && view.reveal?.isPublic) {
    addButton($('t-buttons'), 'Weiter', () => client.act('ackReveal'));
  }
  if (view.phase === 'roundEnd') {
    addButton($('t-buttons'), 'Nächste Runde', () => client.act('nextRound'));
  }

  $('t-log').innerHTML = view.log
    .slice(-8)
    .reverse()
    .map((e) => `<div class="log-line">${esc(e.text)}</div>`)
    .join('');
}

function tablePrompt(view) {
  const name = esc(view.players[view.current]?.name ?? '');
  switch (view.phase) {
    case 'handoff':
      return `<b>${esc(view.players[view.handoff.to].name)}</b> ist dran – am eigenen Handy.`;
    case 'peek':
      return `<b>${esc(view.players[view.peek.player].name)}</b> sieht sich Startkarten an.`;
    case 'reveal':
      return view.reveal.isPublic ? esc(view.reveal.title) : 'Jemand sieht sich eine Karte an.';
    case 'roundEnd':
      return 'Runde vorbei.';
    case 'gameEnd':
      return 'Spiel vorbei.';
    default:
      return `<b>${name}</b> ist am Zug.`;
  }
}

// ----------------------------------------------------------------- Hand

function startAsHand() {
  const room = $('room').value.trim() || 'tisch';
  const id = `handy-${Math.random().toString(36).slice(2, 8)}`;
  let gotLobby = false;
  client = new CaboClient(new BroadcastChannelTransport(room, id), {
    onView: (view) => client.audience != null && renderHand(view),
    onLobby: (players) => {
      gotLobby = true;
      renderSeatList(players);
    },
    onError: toast,
  });
  saveSeats();
  show('screen-seat');
  $('seat-hint').textContent = 'Warte auf den Tisch …';
  // Die Platzliste holen, ohne schon einen Platz zu belegen.
  client.lobby();
  setTimeout(() => {
    if (!gotLobby) $('seat-hint').textContent = 'Kein Tisch gefunden. Ist der Raumname gleich?';
  }, 1200);
}

function renderSeatList(players) {
  $('seat-hint').textContent = '';
  $('seat-list').innerHTML = players
    .map(
      (p) => `<button class="btn btn--big seat-choice" data-seat="${p.id}" ${
        p.taken ? 'data-taken="1"' : ''
      }>
        ${esc(p.name)}${p.taken ? ' <span class="muted small">(belegt)</span>' : ''}
      </button>`,
    )
    .join('');
  $('seat-list')
    .querySelectorAll('[data-seat]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        client.join(Number(btn.dataset.seat));
        show('screen-hand');
      }),
    );
}

function renderHand(view) {
  const me = view.you;
  $('h-who').textContent = me.name;
  $('h-state').innerHTML = view.players
    .map((p) => `<span class="score-chip">${esc(p.name)} <b>${p.score}</b></span>`)
    .join('');

  // Der Tisch in klein: wer wie viele Karten hat, wer dran ist.
  $('h-table').innerHTML = view.players
    .filter((p) => !p.mine)
    .map(
      (p) => `<div class="mini-seat ${p.id === view.current ? 'mini-seat--current' : ''}">
        <span>${esc(p.name)}</span>
        <span class="mini-cards">${p.slots
          .map((slot) => `<i class="${slot.filled ? (slot.open ? 'pip pip--open' : 'pip') : 'pip pip--gone'}"></i>`)
          .join('')}</span>
      </div>`,
    )
    .join('');

  const mySeat = view.players[me.id];
  $('h-cards').innerHTML = mySeat.slots
    .map((slot, i) => {
      if (!slot.filled) return cardHTML(null, { empty: true });
      const id = slot.cardId;
      const card = id ? view.cards[id] : null;
      const classes = [];
      if (slot.known) classes.push('card--known', 'card--peekable');
      if (slot.open) classes.push('card--open');
      if (canPick(view, i)) classes.push('card--target');
      return `<div class="hold-wrap" data-slot="${i}">${cardHTML(card, {
        classes,
        label: String(i + 1),
      })}</div>`;
    })
    .join('');

  // Gezogene Karte, falls sie mir gehört.
  if (view.turn.drawn) {
    const card = view.cards[view.turn.drawn];
    $('h-cards').insertAdjacentHTML(
      'beforeend',
      `<div class="hold-wrap drawn" data-drawn="1">${cardHTML(card, {
        classes: ['card--peekable'],
        label: 'neu',
      })}</div>`,
    );
  }

  wireHandCards(view);
  $('h-prompt').innerHTML = handPrompt(view);
  renderHandButtons(view);
  renderHandReveal(view);
}

function canPick(view, slot) {
  if (!view.you.can.includes('selectCard')) return false;
  if (view.phase === 'peek') return !view.peek.taken.includes(slot);
  return true;
}

function wireHandCards(view) {
  const settings = () => ({ holdToReveal: view.rules.holdToReveal, peekSeconds: view.rules.peekSeconds });

  for (const wrap of $('h-cards').querySelectorAll('.hold-wrap')) {
    const node = wrap.firstElementChild;
    const slot = wrap.dataset.slot != null ? Number(wrap.dataset.slot) : null;

    if (node.classList.contains('card--peekable')) {
      // Auch die eigene Karte bleibt hinter dem Totmannschalter – das Handy
      // liegt schließlich auf dem Tisch, nicht im Safe.
      const id = slot != null ? view.players[view.you.id].slots[slot].cardId : view.turn.drawn;
      const card = id ? view.cards[id] : null;
      node.dataset.hidden = '1';
      attachReveal(node, {
        settings,
        onShow: () => faceUp(node, card),
        onHide: () => faceDown(node),
      });
    }

    if (slot != null && canPick(view, slot)) {
      node.addEventListener('click', () => client.act('selectCard', view.you.id, slot));
    }
  }
}

function handPrompt(view) {
  const can = view.you.can;
  if (view.phase === 'handoff' && can.includes('confirmHandoff')) return 'Du bist dran.';
  if (view.phase === 'peek' && can.includes('selectCard')) {
    return `Sieh dir ${view.peek.remaining} deiner Karten an.`;
  }
  if (view.phase === 'turn' && view.turn.mine) return 'Ziehen, Ablage nehmen oder Cabo rufen.';
  if (view.phase === 'drawn' && view.turn.mine) {
    return 'Tausche gegen eine deiner Karten – oder wirf die gezogene ab.';
  }
  if (view.phase === 'multi' && view.turn.mine) return 'Wähle mindestens zwei gleiche Karten.';
  if (view.phase === 'power' && view.turn.mine) return `${view.power.name}: wähle eine Karte.`;
  if (view.phase === 'roundEnd') return 'Runde vorbei.';
  const current = view.players[view.current]?.name ?? '';
  return `${esc(current)} ist am Zug.`;
}

const BUTTON_LABEL = {
  confirmHandoff: 'Bereit',
  drawFromDeck: 'Karte ziehen',
  takeDiscard: 'Ablage nehmen',
  callCabo: 'Cabo rufen',
  discardDrawn: 'Abwerfen',
  startMultiDiscard: 'Mehrere gleiche ablegen',
  cancelMultiDiscard: 'Abbrechen',
  confirmMultiDiscard: 'Ansagen und aufdecken',
  skipPower: 'Kraft verfallen lassen',
  nextRound: 'Nächste Runde',
};

function renderHandButtons(view) {
  const box = $('h-buttons');
  box.innerHTML = '';
  for (const action of view.you.can) {
    // selectCard läuft über die Karten, ackReveal über das Overlay.
    if (action === 'selectCard' || action === 'ackReveal') continue;
    addButton(box, BUTTON_LABEL[action] ?? action, () => client.act(action), {
      primary: action === 'drawFromDeck' || action === 'confirmHandoff',
      danger: action === 'callCabo',
    });
  }
}

function addButton(box, label, run, { primary = false, danger = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn${primary ? ' btn--primary' : ''}${danger ? ' btn--danger' : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', run);
  box.append(btn);
}

function renderHandReveal(view) {
  const overlay = $('h-reveal');
  const r = view.reveal;
  const open = view.phase === 'reveal' && r?.forMe;
  overlay.classList.toggle('hidden', !open);
  if (!open) return;

  $('h-reveal-title').textContent = r.title;
  $('h-reveal-note').textContent = r.note ?? '';
  revealSeen = r.isPublic;
  $('h-reveal-ok').disabled = !revealSeen;

  const box = $('h-reveal-cards');
  box.innerHTML = '';
  for (const entry of r.cards) {
    const card = entry.cardId ? view.cards[entry.cardId] : null;
    const wrap = document.createElement('div');
    wrap.className = 'hold-wrap';
    wrap.innerHTML = cardHTML(r.isPublic ? card : null, {
      classes: r.isPublic ? [] : ['card--peekable'],
    });
    box.append(wrap);
    if (r.isPublic) continue;

    const node = wrap.firstElementChild;
    attachReveal(node, {
      settings: () => ({
        holdToReveal: view.rules.holdToReveal,
        peekSeconds: view.rules.peekSeconds,
      }),
      onShow: () => faceUp(node, card),
      onHide: () => faceDown(node),
    });
    node.addEventListener('pointerdown', () => {
      revealSeen = true;
      $('h-reveal-ok').disabled = false;
    });
  }

  $('h-reveal-hint').textContent = r.isPublic
    ? 'Alle dürfen mitschauen.'
    : 'Halte den Finger auf die Karte.';
}

// ---------------------------------------------------------------- Start

function init() {
  loadSeats();
  renderPlayerList();

  $('btn-add-player').addEventListener('click', () => {
    if (seats.length >= MAX_PLAYERS) return;
    seats.push({ name: '' });
    saveSeats();
    renderPlayerList();
  });
  $('btn-remove-player').addEventListener('click', () => {
    if (seats.length <= MIN_PLAYERS) return;
    seats.pop();
    saveSeats();
    renderPlayerList();
  });
  $('room').addEventListener('input', saveSeats);
  $('btn-be-table').addEventListener('click', startAsTable);
  $('btn-be-hand').addEventListener('click', startAsHand);
  $('h-reveal-ok').addEventListener('click', () => {
    if (revealSeen) client.act('ackReveal');
  });

  // Nach dem Aufwachen (Bildschirmsperre) kann uns eine Sicht entgangen sein.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') client?.resync();
  });
}

init();
