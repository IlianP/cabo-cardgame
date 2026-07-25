/**
 * Oberfläche des Spieltisches.
 *
 * Die Datei zeichnet den Zustand der Engine und schickt Eingaben zurück.
 * Sie entscheidet nie selbst über Spielregeln – auch nicht darüber, wer
 * was sehen darf: Was aufgedeckt werden darf, sagt die Engine über die
 * Phase `reveal`.
 */

import { PHASE } from './engine.js';
import { POWER, POWER_LABEL } from './deck.js';
import { attachReveal, makeTimerRing } from './privacy.js';

const $ = (id) => document.getElementById(id);

const el = {
  screenGame: $('screen-game'),
  hudRound: $('hud-round'),
  hudScores: $('hud-scores'),
  opponents: $('opponents'),
  me: $('me'),
  deckPile: $('pile-deck'),
  deckCount: $('deck-count'),
  discardPile: $('pile-discard'),
  discardCard: $('discard-card'),
  drawnArea: $('drawn-area'),
  prompt: $('prompt'),
  buttons: $('buttons'),
  gate: $('gate'),
  gateName: $('gate-name'),
  gateTask: $('gate-task'),
  gateOk: $('gate-ok'),
  gatePin: $('gate-pin'),
  pinDots: $('pin-dots'),
  pinPad: $('pin-pad'),
  pinError: $('pin-error'),
  reveal: $('reveal'),
  revealTitle: $('reveal-title'),
  revealNote: $('reveal-note'),
  revealCards: $('reveal-cards'),
  revealHint: $('reveal-hint'),
  revealOk: $('reveal-ok'),
  modal: $('modal'),
  modalTitle: $('modal-title'),
  modalBody: $('modal-body'),
  modalActions: $('modal-actions'),
  modalClose: $('modal-close'),
  toast: $('toast'),
};

let game = null;
let hooks = {};
let detachers = [];
let pinBuffer = '';
let lastGateKey = '';
let revealSeen = false;
let toastTimer = 0;

const settings = () => ({
  holdToReveal: game?.rules.holdToReveal ?? true,
  peekSeconds: game?.rules.peekSeconds ?? 5,
});

// ------------------------------------------------------------- Hilfsmittel

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

/** Engine-Aufrufe können Regelverstöße melden – die zeigen wir als Hinweis. */
function guard(fn) {
  try {
    fn();
  } catch (err) {
    toast(err.message || 'Das geht gerade nicht.');
  }
}

/**
 * Vorderseite einer Karte. Die Wertmarke unten rechts erscheint nur, wo
 * der Wert nicht ohnehin auf der Karte steht – also bei Ass, Bube, Dame,
 * König und Joker.
 */
function cardFaceHTML(card) {
  const rank = card.rank === 'JOKER' ? '★' : card.rank;
  const showValue = !/^\d+$/.test(card.rank);
  return (
    `<span class="card-face"><span class="r">${esc(rank)}</span>` +
    `<span class="s">${esc(card.symbol)}</span></span>` +
    (showValue ? `<span class="card-val">${card.value}</span>` : '')
  );
}

function cardMarkup(card, { faceUp, extra = '', classes = [], slotNo = null }) {
  if (!card) {
    return `<div class="card card--empty ${classes.join(' ')}" ${extra}></div>`;
  }
  const cls = ['card', faceUp ? 'card--up' : 'card--down', ...classes];
  if (faceUp && card.color === 'red') cls.push('is-red');
  const label = slotNo != null ? `<span class="card-slot">${slotNo}</span>` : '';
  return `<div class="${cls.join(' ')}" ${extra}>${faceUp ? cardFaceHTML(card) : ''}${label}</div>`;
}

// --------------------------------------------------------------- Auswahl

function isSelectable(s, owner, slot) {
  if (s.players[owner].hand[slot] == null) return false;
  switch (s.phase) {
    case PHASE.PEEK: {
      const me = s.peek.order[s.peek.index];
      return owner === me && !s.peek.taken.includes(slot);
    }
    case PHASE.DRAWN:
      return owner === s.current;
    case PHASE.SNAP_PICK:
      return owner === s.snap.claimer;
    case PHASE.POWER: {
      const p = s.power;
      if (p.type === POWER.PEEK) return owner === s.current;
      if (p.type === POWER.SPY) return owner !== s.current;
      if (p.step === 'own') return owner === s.current;
      if (p.step === 'target') return owner !== s.current;
      if (p.step === 'look') {
        return (
          (owner === p.own.owner && slot === p.own.slot) ||
          (owner === p.target.owner && slot === p.target.slot)
        );
      }
      return false;
    }
    default:
      return false;
  }
}

function isChosen(s, owner, slot) {
  const p = s.power;
  if (!p) return false;
  for (const key of ['own', 'target']) {
    if (p[key] && p[key].owner === owner && p[key].slot === slot) return true;
  }
  return false;
}

// -------------------------------------------------------------- Zeichnen

function renderHud() {
  const s = game.state;
  el.hudRound.textContent = `Runde ${s.round}`;
  el.hudScores.innerHTML = s.players
    .map((p) => {
      const cls = ['score-chip'];
      if (p.id === s.current && s.phase !== PHASE.ROUND_END && s.phase !== PHASE.GAME_END) {
        cls.push('is-current');
      }
      if (s.cabo && s.cabo.caller === p.id) cls.push('is-cabo');
      return `<span class="${cls.join(' ')}">${esc(p.name)} <b>${p.score}</b></span>`;
    })
    .join('');
}

function seatMarkup(s, player, isViewer) {
  const cls = ['seat'];
  if (player.id === s.current && s.phase !== PHASE.ROUND_END) cls.push('is-turn');
  if (s.cabo && s.cabo.caller === player.id) cls.push('is-cabo');

  const cards = player.hand
    .map((id, slot) => {
      const classes = [];
      let extra = `data-owner="${player.id}" data-slot="${slot}"`;
      if (isSelectable(s, player.id, slot)) classes.push('card--target');
      if (isChosen(s, player.id, slot)) classes.push('card--chosen');
      if (
        isViewer &&
        game.rules.memoryAid &&
        s.knowledge?.[player.id]?.[slot] &&
        !classes.includes('card--target')
      ) {
        classes.push('card--known', 'card--peekable');
        extra += ` data-peek="${s.knowledge[player.id][slot]}"`;
      }
      return cardMarkup(id == null ? null : game.card(id), {
        faceUp: false,
        extra,
        classes,
        slotNo: slot + 1,
      });
    })
    .join('');

  const tag = s.cabo && s.cabo.caller === player.id ? '<span class="tag">Cabo</span>' : '';
  return `<div class="${cls.join(' ')}">
      <div class="seat-name">${esc(player.name)}${tag}</div>
      <div class="seat-hand">${cards}</div>
    </div>`;
}

function renderSeats() {
  const s = game.state;
  const viewer = game.viewer;
  el.opponents.innerHTML = s.players
    .filter((p) => p.id !== viewer)
    .map((p) => seatMarkup(s, p, false))
    .join('');
  el.me.innerHTML = viewer == null ? '' : seatMarkup(s, s.players[viewer], true);
}

function renderCenter() {
  const s = game.state;
  el.deckCount.textContent = s.deck.length;
  const top = s.discard.length ? game.card(s.discard[s.discard.length - 1]) : null;
  el.discardCard.className = 'pile-card';
  if (top) {
    el.discardCard.classList.add('card', 'card--up');
    if (top.color === 'red') el.discardCard.classList.add('is-red');
    el.discardCard.innerHTML = cardFaceHTML(top);
  } else {
    el.discardCard.classList.add('card', 'card--empty');
    el.discardCard.innerHTML = '';
  }

  const canDraw = s.phase === PHASE.TURN;
  el.deckPile.disabled = !canDraw || s.deck.length === 0;
  el.deckPile.classList.toggle('is-active', canDraw && s.deck.length > 0);
  el.discardPile.disabled = !canDraw || !s.discard.length;
  el.discardPile.classList.toggle('is-active', canDraw && s.discard.length > 0);

  el.drawnArea.innerHTML = '';
  if (s.drawn != null) {
    const card = game.card(s.drawn);
    const fromDeck = s.drawnFrom === 'deck';
    const wrap = document.createElement('div');
    wrap.className = 'hold-wrap';
    wrap.innerHTML = cardMarkup(card, { faceUp: !fromDeck, classes: fromDeck ? ['card--peekable'] : [] });
    const caption = document.createElement('p');
    caption.className = 'drawn-caption';
    caption.textContent = fromDeck
      ? settings().holdToReveal
        ? 'Gezogen – halten zum Ansehen'
        : 'Gezogen – antippen zum Ansehen'
      : 'Aus der Ablage';
    el.drawnArea.append(wrap, caption);

    if (fromDeck) attachCardReveal(wrap.firstElementChild, card, wrap);
  }
}

/** Macht eine verdeckte Karte im Tisch-Bereich per Halten sichtbar. */
function attachCardReveal(node, card, ringHost) {
  const ring = makeTimerRing();
  (ringHost || node).append(ring.el);
  const detach = attachReveal(node, {
    settings,
    onShow: () => {
      node.classList.remove('card--down');
      node.classList.add('card--up');
      if (card.color === 'red') node.classList.add('is-red');
      node.insertAdjacentHTML('afterbegin', cardFaceHTML(card));
    },
    onHide: () => {
      node.classList.add('card--down');
      node.classList.remove('card--up', 'is-red');
      node.querySelectorAll('.card-face, .card-val').forEach((n) => n.remove());
    },
    onProgress: (f) => ring.set(f),
  });
  detachers.push(detach);
}

function describe() {
  const s = game.state;
  const name = s.players[s.current]?.name ?? '';

  switch (s.phase) {
    case PHASE.PEEK: {
      const me = s.peek.order[s.peek.index];
      const left = game.rules.initialPeeks - s.peek.taken.length;
      return {
        prompt: `<b>${esc(s.players[me].name)}</b>, sieh dir ${left} deiner Karten an.`,
        buttons: [],
      };
    }
    case PHASE.TURN:
      return {
        prompt: s.cabo
          ? `<b>${esc(name)}</b> – letzter Zug vor der Abrechnung.`
          : `<b>${esc(name)}</b> ist am Zug.`,
        buttons: [
          { label: 'Karte ziehen', kind: 'primary', run: () => game.drawFromDeck() },
          {
            label: 'Ablage nehmen',
            run: () => game.takeDiscard(),
            disabled: !s.discard.length,
          },
          {
            label: 'Cabo rufen',
            kind: 'danger',
            run: () => confirmCabo(),
            disabled: Boolean(s.cabo),
          },
        ],
      };
    case PHASE.DRAWN:
      return {
        prompt:
          s.drawnFrom === 'deck'
            ? 'Tippe auf eine deiner Karten, um zu tauschen – oder wirf die gezogene Karte ab.'
            : 'Tippe auf die Karte, die du dafür abgibst.',
        buttons:
          s.drawnFrom === 'deck'
            ? [{ label: 'Abwerfen', run: () => game.discardDrawn() }]
            : [],
      };
    case PHASE.POWER: {
      const p = s.power;
      const skip = { label: 'Kraft verfallen lassen', run: () => game.skipPower() };
      if (p.type === POWER.PEEK) {
        return { prompt: 'Spähen: Tippe auf eine deiner eigenen Karten.', buttons: [skip] };
      }
      if (p.type === POWER.SPY) {
        return { prompt: 'Spionieren: Tippe auf die Karte eines Mitspielers.', buttons: [skip] };
      }
      if (p.step === 'own') {
        return { prompt: 'Wähle zuerst eine deiner eigenen Karten.', buttons: [skip] };
      }
      if (p.step === 'target') {
        return { prompt: 'Wähle jetzt die Karte eines Mitspielers.', buttons: [skip] };
      }
      if (p.step === 'look') {
        return {
          prompt: 'König: Welche der beiden markierten Karten möchtest du ansehen?',
          buttons: [skip],
        };
      }
      return {
        prompt: 'Tauschen oder liegen lassen?',
        buttons: [
          { label: 'Tauschen', kind: 'primary', run: () => game.resolveKing(true) },
          { label: 'Liegen lassen', run: () => game.resolveKing(false) },
        ],
      };
    }
    case PHASE.SNAP_WINDOW: {
      const top = game.card(s.discard[s.discard.length - 1]);
      return {
        prompt: `Einwerfen auf <b>${esc(top ? top.label : '–')}</b>? Wer eine ranggleiche Karte hat, meldet sich.`,
        buttons: [
          ...s.players.map((p) => ({ label: p.name, run: () => game.snapClaim(p.id) })),
          { label: 'Niemand', kind: 'primary', run: () => game.snapPass() },
        ],
      };
    }
    case PHASE.SNAP_PICK:
      return { prompt: 'Tippe auf die Karte, die du einwerfen willst.', buttons: [] };
    default:
      return { prompt: '', buttons: [] };
  }
}

function renderActions() {
  const { prompt, buttons } = describe();
  el.prompt.innerHTML = prompt;
  el.buttons.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn' + (b.kind ? ` btn--${b.kind}` : '');
    btn.textContent = b.label;
    btn.disabled = Boolean(b.disabled);
    btn.addEventListener('click', () => guard(b.run));
    el.buttons.append(btn);
  }
}

// ---------------------------------------------------------- Übergabesperre

function gateTaskText(resume) {
  if (resume === 'peek') return `Sieh dir ${game.rules.initialPeeks} deiner Karten an.`;
  if (resume === 'snapPick') return 'Du willst einwerfen – wähle gleich deine Karte.';
  return 'Du bist am Zug.';
}

function renderGate() {
  const s = game.state;
  const open = s.phase === PHASE.HANDOFF;
  el.gate.classList.toggle('hidden', !open);
  if (!open) {
    lastGateKey = '';
    return;
  }
  const player = s.players[s.handoff.to];
  const key = `${s.round}-${s.handoff.to}-${s.handoff.resume}-${s.current}-${s.peek?.index ?? ''}`;
  if (key !== lastGateKey) {
    lastGateKey = key;
    pinBuffer = '';
    el.pinError.textContent = '';
  }
  el.gateName.textContent = player.name;
  el.gateTask.textContent = gateTaskText(s.handoff.resume);

  const needsPin = game.rules.usePins && Boolean(player.pin);
  el.gatePin.classList.toggle('hidden', !needsPin);
  el.gateOk.textContent = needsPin ? 'Entsperren' : 'Bereit';
  renderPinDots();
}

function renderPinDots() {
  el.pinDots.innerHTML = Array.from({ length: 4 })
    .map((_, i) => `<span class="pin-dot ${i < pinBuffer.length ? 'is-set' : ''}"></span>`)
    .join('');
}

function buildPinPad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  el.pinPad.innerHTML = keys
    .map((k) => (k === '' ? '<span></span>' : `<button type="button" data-key="${k}">${k}</button>`))
    .join('');
}

function onPinKey(key) {
  el.pinError.textContent = '';
  if (key === '⌫') pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 4) pinBuffer += key;
  renderPinDots();
  if (pinBuffer.length === 4) submitGate();
}

function submitGate() {
  const result = game.confirmHandoff(pinBuffer);
  if (!result.ok) {
    el.pinError.textContent = result.error;
    pinBuffer = '';
    renderPinDots();
  }
}

// -------------------------------------------------------------- Aufdecken

function renderReveal() {
  const s = game.state;
  const open = s.phase === PHASE.REVEAL;
  el.reveal.classList.toggle('hidden', !open);
  if (!open) return;

  const r = s.reveal;
  el.revealTitle.textContent = r.title;
  el.revealNote.textContent = r.note || '';
  el.revealNote.classList.toggle('hidden', !r.note);
  el.revealCards.innerHTML = '';
  revealSeen = r.isPublic;

  for (const entry of r.cards) {
    const card = game.card(entry.cardId);
    const wrap = document.createElement('div');
    wrap.className = 'hold-wrap';
    wrap.innerHTML = cardMarkup(card, {
      faceUp: r.isPublic,
      classes: r.isPublic ? [] : ['card--peekable'],
    });
    el.revealCards.append(wrap);
    if (!r.isPublic) {
      attachCardReveal(wrap.firstElementChild, card, wrap);
      wrap.firstElementChild.addEventListener('pointerdown', () => {
        revealSeen = true;
        el.revealOk.disabled = false;
      });
    }
  }

  el.revealHint.textContent = r.isPublic
    ? 'Alle dürfen mitschauen.'
    : settings().holdToReveal
      ? 'Halte den Finger auf die Karte. Loslassen versteckt sie sofort.'
      : 'Tippe auf die Karte. Sie verschwindet automatisch wieder.';
  el.revealOk.disabled = !revealSeen;
}

// ---------------------------------------------------------------- Dialoge

export function showModal({ title, body, actions = [], closable = true }) {
  el.modalTitle.textContent = title;
  el.modalBody.innerHTML = body;
  el.modalActions.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn' + (a.kind ? ` btn--${a.kind}` : '');
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      if (a.close !== false) closeModal();
      a.run?.();
    });
    el.modalActions.append(btn);
  }
  el.modalClose.classList.toggle('hidden', !closable);
  el.modal.classList.remove('hidden');
}

export function closeModal() {
  el.modal.classList.add('hidden');
}

function confirmCabo() {
  showModal({
    title: 'Cabo rufen?',
    body: '<p>Alle anderen bekommen noch genau einen Zug, danach wird aufgedeckt. Liegst du nicht am niedrigsten, kostet das Strafpunkte.</p>',
    actions: [
      { label: 'Abbrechen' },
      { label: 'Cabo!', kind: 'danger', run: () => guard(() => game.callCabo()) },
    ],
  });
}

function handMarkup(hand) {
  return `<div class="result-hand">${hand
    .map((id) => cardMarkup(id == null ? null : game.card(id), { faceUp: true }))
    .join('')}</div>`;
}

function roundResultBody() {
  const s = game.state;
  const r = s.roundResult;
  let banner = '';
  if (r.moon != null) {
    banner = `<div class="banner">Shoot the Moon! <b>${esc(
      s.players[r.moon].name,
    )}</b> hatte zwei Damen und beide schwarzen Könige – 0 Punkte, alle anderen bekommen 50.</div>`;
  } else if (r.reason === 'deckEmpty') {
    banner = '<div class="banner">Der Nachziehstapel war leer – die Runde endet ohne Cabo-Ruf.</div>';
  } else if (r.caller != null) {
    const callerName = esc(s.players[r.caller].name);
    banner = r.callerOk
      ? `<div class="banner"><b>${callerName}</b> lag am niedrigsten – der Ruf sitzt, 0 Punkte.</div>`
      : `<div class="banner is-bad"><b>${callerName}</b> hat sich verrufen: ${
          r.sums[r.caller]
        } + ${game.rules.caboPenalty} Strafpunkte.</div>`;
  }

  const rows = s.players
    .map((p) => {
      const cls = r.winners.includes(p.id) ? ' class="is-winner"' : '';
      const reset = r.resets.includes(p.id) ? ' <span class="muted">(Punktlandung → halbiert)</span>' : '';
      return `<tr${cls}>
        <td>${esc(p.name)}${r.caller === p.id ? ' <span class="muted">· Cabo</span>' : ''}</td>
        <td>${handMarkup(r.hands[p.id])}</td>
        <td>${r.sums[p.id]}</td>
        <td>+${r.points[p.id]}</td>
        <td><b>${r.after[p.id]}</b>${reset}</td>
      </tr>`;
    })
    .join('');

  return `${banner}
    <table class="result-table">
      <thead><tr><th>Spieler</th><th>Blatt</th><th>Summe</th><th>Punkte</th><th>Gesamt</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function gameEndBody() {
  const standings = game.standings();
  const best = standings[0].score;
  const rows = standings
    .map(
      (p, i) =>
        `<tr${p.score === best ? ' class="is-winner"' : ''}><td>${i + 1}.</td><td>${esc(
          p.name,
        )}</td><td><b>${p.score}</b></td></tr>`,
    )
    .join('');
  const champions = standings.filter((p) => p.score === best).map((p) => p.name);
  return `<div class="banner">${
    champions.length > 1 ? 'Gleichstand an der Spitze: ' : 'Gewonnen hat '
  }<b>${esc(champions.join(', '))}</b> mit ${best} Punkten.</div>
    <table class="result-table result-table--standings"><tbody>${rows}</tbody></table>`;
}

function renderEndScreens() {
  const s = game.state;
  if (s.phase === PHASE.ROUND_END) {
    showModal({
      title: `Runde ${s.round} – Abrechnung`,
      body: roundResultBody(),
      closable: false,
      actions: [
        {
          label: s.gameOver ? 'Endstand ansehen' : 'Nächste Runde',
          kind: 'primary',
          run: () => guard(() => game.nextRound()),
        },
      ],
    });
  } else if (s.phase === PHASE.GAME_END) {
    showModal({
      title: 'Spielende',
      body: gameEndBody(),
      closable: false,
      actions: [
        { label: 'Zur Einrichtung', run: () => hooks.onExit?.() },
        { label: 'Nochmal spielen', kind: 'primary', run: () => hooks.onRestart?.() },
      ],
    });
  }
}

// ----------------------------------------------------------------- Gesamt

export function render() {
  for (const d of detachers) d();
  detachers = [];

  const s = game.state;
  renderHud();
  renderSeats();
  renderCenter();
  renderActions();
  renderGate();
  renderReveal();

  const modalPhase = s.phase === PHASE.ROUND_END || s.phase === PHASE.GAME_END;
  if (modalPhase) renderEndScreens();
  else if (!el.modal.classList.contains('hidden') && el.modalClose.classList.contains('hidden')) {
    closeModal();
  }

  attachMemoryPeeks();
  hooks.onChange?.(s);
}

function attachMemoryPeeks() {
  if (game.state.phase !== PHASE.TURN) return;
  for (const node of el.me.querySelectorAll('.card--peekable[data-peek]')) {
    attachCardReveal(node, game.card(node.dataset.peek), node.parentElement);
  }
}

// ------------------------------------------------------------- Verdrahtung

let wired = false;

function wire() {
  if (wired) return;
  wired = true;

  const tableClick = (e) => {
    const target = e.target.closest('.card--target');
    if (!target) return;
    guard(() => game.selectCard(Number(target.dataset.owner), Number(target.dataset.slot)));
  };
  el.opponents.addEventListener('click', tableClick);
  el.me.addEventListener('click', tableClick);

  el.deckPile.addEventListener('click', () => guard(() => game.drawFromDeck()));
  el.discardPile.addEventListener('click', () => guard(() => game.takeDiscard()));

  buildPinPad();
  el.pinPad.addEventListener('click', (e) => {
    const key = e.target.dataset?.key;
    if (key) onPinKey(key);
  });
  el.gateOk.addEventListener('click', () => {
    if (game.rules.usePins && game.state.players[game.state.handoff.to].pin && pinBuffer.length < 4) {
      el.pinError.textContent = 'Bitte PIN eingeben.';
      return;
    }
    submitGate();
  });

  el.revealOk.addEventListener('click', () => guard(() => game.ackReveal()));
  el.modalClose.addEventListener('click', closeModal);
  $('btn-menu').addEventListener('click', () => hooks.onMenu?.());
}

export function mount(instance, callbacks = {}) {
  game = instance;
  hooks = callbacks;
  wire();
  el.screenGame.classList.remove('hidden');
  game.on(render);
  render();
}

export function unmount() {
  for (const d of detachers) d();
  detachers = [];
  el.screenGame.classList.add('hidden');
  el.gate.classList.add('hidden');
  el.reveal.classList.add('hidden');
  closeModal();
  game = null;
}

export function powerHelp(type) {
  return POWER_LABEL[type] ?? '';
}
