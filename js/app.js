/**
 * Einstiegspunkt: Einrichtungsbildschirm, Einstellungen, Menü,
 * Speicherung und Start der Partie.
 */

import { CaboGame, PHASE } from './engine.js';
import { DEFAULT_RULES, RULE_GROUPS } from './rules.js';
import { mount, unmount, render, showModal, closeModal, toast } from './ui.js';

// Version im Schlüssel: nach dem Wechsel auf die Verlagsregeln passen alte
// Spielstände und Einstellungen nicht mehr und werden schlicht ignoriert.
const STORE_SETTINGS = 'cabo.settings.v2';
const STORE_GAME = 'cabo.game.v2';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const $ = (id) => document.getElementById(id);

let rules = { ...DEFAULT_RULES };
let seats = [{ name: '', pin: '' }, { name: '', pin: '' }, { name: '', pin: '' }];
let game = null;
let wakeLock = null;

// ------------------------------------------------------------- Speicherung

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_SETTINGS) || 'null');
    if (raw) {
      rules = { ...DEFAULT_RULES, ...raw.rules };
      if (Array.isArray(raw.seats) && raw.seats.length >= MIN_PLAYERS) seats = raw.seats;
    }
  } catch {
    /* kaputter Speicherstand: dann eben Voreinstellungen */
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_SETTINGS, JSON.stringify({ rules, seats }));
  } catch {
    /* privater Modus o. Ä. – nicht schlimm */
  }
}

function saveGame(state) {
  try {
    if (!state || state.phase === PHASE.GAME_END) localStorage.removeItem(STORE_GAME);
    else localStorage.setItem(STORE_GAME, JSON.stringify(state));
  } catch {
    /* nicht schlimm */
  }
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORE_GAME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------- Einstellungen

function renderRuleGroups(container, groups) {
  container.innerHTML = groups
    .map(
      (group) => `<div class="rule-group">
        <h3>${group.title}</h3>
        ${group.items.map(ruleMarkup).join('')}
      </div>`,
    )
    .join('');

  container.querySelectorAll('[data-toggle]').forEach((node) => {
    node.addEventListener('click', () => {
      const key = node.dataset.toggle;
      rules[key] = !rules[key];
      node.setAttribute('aria-checked', String(rules[key]));
      afterRuleChange();
    });
  });
  container.querySelectorAll('[data-choice]').forEach((node) => {
    node.addEventListener('click', () => {
      const key = node.dataset.choice;
      rules[key] = JSON.parse(node.dataset.value);
      node.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      node.setAttribute('aria-pressed', 'true');
      afterRuleChange();
    });
  });
}

function ruleMarkup(item) {
  const value = rules[item.key];
  const control =
    item.type === 'toggle'
      ? `<button class="switch" type="button" role="switch" aria-checked="${Boolean(
          value,
        )}" data-toggle="${item.key}" aria-label="${item.label}"></button>`
      : `<div class="seg">${item.options
          .map(
            (o) =>
              `<button type="button" data-choice="${item.key}" data-value='${JSON.stringify(
                o.value,
              )}' aria-pressed="${o.value === value}">${o.label}</button>`,
          )
          .join('')}</div>`;
  return `<div class="rule">
      <div class="rule-text">
        <div class="rule-label">${item.label}</div>
        ${item.hint ? `<div class="rule-hint">${item.hint}</div>` : ''}
      </div>
      ${control}
    </div>`;
}

function afterRuleChange() {
  saveSettings();
  if (game) {
    // Sichtschutz-Einstellungen wirken sofort, auch mitten in der Partie.
    Object.assign(game.state.rules, rules);
    render();
  } else {
    renderPlayerList();
  }
}

// ------------------------------------------------------------- Einrichtung

function renderPlayerList() {
  const list = $('player-list');
  list.innerHTML = seats
    .map(
      (seat, i) => `<div class="player-row">
        <span class="seat-no">${i + 1}</span>
        <input type="text" data-name="${i}" value="${escapeAttr(seat.name)}"
               placeholder="Spieler ${i + 1}" maxlength="14" autocomplete="off">
        ${
          rules.usePins
            ? `<input class="pin-input" type="password" inputmode="numeric" autocomplete="off" data-pin="${i}"
                 value="${escapeAttr(seat.pin)}" placeholder="PIN" maxlength="4">`
            : ''
        }
      </div>`,
    )
    .join('');

  list.querySelectorAll('[data-name]').forEach((input) => {
    input.addEventListener('input', () => {
      seats[Number(input.dataset.name)].name = input.value;
      saveSettings();
    });
  });
  list.querySelectorAll('[data-pin]').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      seats[Number(input.dataset.pin)].pin = input.value;
      saveSettings();
    });
  });

  $('btn-add-player').disabled = seats.length >= MAX_PLAYERS;
  $('btn-remove-player').disabled = seats.length <= MIN_PLAYERS;
}

function escapeAttr(text) {
  return String(text ?? '').replace(/"/g, '&quot;');
}

function showSetup() {
  $('screen-setup').classList.remove('hidden');
  unmount();
  game = null;
  renderPlayerList();
  renderRuleGroups($('rules-form'), RULE_GROUPS);
  refreshResumeBox();
}

function refreshResumeBox() {
  const saved = loadSavedGame();
  const box = $('resume-box');
  if (!saved) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  $('resume-info').textContent = `Runde ${saved.round} · ${saved.players
    .map((p) => `${p.name} ${p.score}`)
    .join(' · ')}`;
}

// ------------------------------------------------------------------ Partie

function startGame(fromState = null) {
  game = fromState ? CaboGame.fromJSON(fromState) : new CaboGame({ players: seats, rules });
  if (fromState) Object.assign(game.state.rules, pickDisplayRules(rules));
  $('screen-setup').classList.add('hidden');
  mount(game, {
    onChange: (state) => saveGame(state),
    onMenu: openMenu,
    onExit: () => {
      saveGame(null);
      showSetup();
    },
    onRestart: () => {
      saveGame(null);
      startGame();
    },
  });
  requestWakeLock();
}

/** Nur die Bedien-Einstellungen dürfen eine laufende Partie überschreiben. */
function pickDisplayRules(source) {
  const { holdToReveal, peekSeconds, usePins, memoryAid } = source;
  return { holdToReveal, peekSeconds, usePins, memoryAid };
}

function openMenu() {
  showModal({
    title: 'Menü',
    body: `<div id="live-rules"></div>`,
    actions: [
      { label: 'Spielregeln', run: showHelp },
      { label: 'Partie abbrechen', kind: 'danger', run: confirmAbort },
      { label: 'Weiterspielen', kind: 'primary' },
    ],
  });
  const container = document.getElementById('live-rules');
  const displayGroup = RULE_GROUPS.find((g) => g.title.startsWith('Sichtschutz'));
  renderRuleGroups(container, [displayGroup]);
}

function confirmAbort() {
  showModal({
    title: 'Partie abbrechen?',
    body: '<p>Der aktuelle Spielstand geht verloren.</p>',
    actions: [
      { label: 'Weiterspielen' },
      {
        label: 'Abbrechen',
        kind: 'danger',
        run: () => {
          saveGame(null);
          showSetup();
        },
      },
    ],
  });
}

// -------------------------------------------------------------- Spielregeln

const HELP = `
<h3>Ziel</h3>
<p>Am Ende jeder Runde zählen die Werte deiner Handkarten zusammen. Wer über das ganze Spiel
die wenigsten Punkte sammelt, gewinnt. Du siehst deine eigenen Karten fast nie – merken ist alles.</p>

<h3>Das Deck</h3>
<p>52 Karten mit den Werten 0 bis 13. Die Zahl ist der Punktwert. Die <b>0</b> liegt zweimal im
Deck und ist die beste Karte, die <b>13</b> ebenfalls zweimal und ist die teuerste. Alle Werte
von 1 bis 12 gibt es viermal.</p>

<h3>Aufbau</h3>
<p>Jeder bekommt vier verdeckte Karten. Zu Beginn darf sich jeder zwei davon ansehen – danach
bleiben alle Karten verdeckt liegen und dürfen nicht umsortiert werden.</p>

<h3>Dein Zug</h3>
<p>Du hast genau eine von drei Möglichkeiten:</p>
<ul>
  <li><b>Vom Stapel ziehen.</b> Danach tauschst du die Karte gegen eine deiner eigenen (die alte
      kommt offen auf die Ablage) – oder du wirfst die gezogene Karte direkt ab und nutzt ihre Kraft.</li>
  <li><b>Die oberste Ablagekarte nehmen.</b> Die musst du gegen eine eigene Karte tauschen.
      Kartenkräfte gibt es dabei nicht.</li>
  <li><b>Cabo rufen.</b></li>
</ul>

<h3>Mehrfach-Ablage</h3>
<p>Statt nur einer Karte darfst du beim Ziehen auch <b>mehrere eigene Karten gleichen Wertes</b>
gemeinsam abwerfen. Du sagst es an, deckst sie auf – und spielst danach mit weniger Karten
weiter, die gezogene Karte kommt auf einen der frei gewordenen Plätze. Stimmt der Wert nicht
überein, wird alles wieder verdeckt und der Zug ist verloren.</p>

<h3>Kartenkräfte</h3>
<p>Sie wirken nur, wenn du die Karte frisch vom verdeckten Stapel gezogen und dann abgeworfen hast.</p>
<ul>
  <li><b>7 und 8 – Peek:</b> sieh dir eine deiner eigenen Karten an.</li>
  <li><b>9 und 10 – Spy:</b> sieh dir eine fremde Karte an.</li>
  <li><b>11 und 12 – Swap:</b> tausche eine deiner Karten blind gegen eine fremde.</li>
  <li>Die 13 hat keine Kraft.</li>
</ul>

<h3>Cabo rufen</h3>
<p>Wer glaubt, am niedrigsten zu liegen, ruft statt eines Zuges „Cabo“. Alle anderen haben dann
noch genau einen Zug, danach wird aufgedeckt.</p>
<ul>
  <li><b>Die niedrigste Summe bekommt 0 Punkte</b> – auch ohne Cabo-Ruf.</li>
  <li>Wer Cabo gerufen hat und nicht am niedrigsten liegt, notiert seine Kartensumme
      <b>plus Strafpunkte</b>.</li>
  <li>Alle übrigen bekommen ihre Kartensumme gutgeschrieben.</li>
  <li>Bei Gleichstand um die niedrigste Summe gewinnt der Cabo-Sager.</li>
</ul>
<p>Sobald jemand über der Zielpunktzahl liegt, endet das Spiel – gewonnen hat, wer am wenigsten
Punkte hat.</p>

<h3>Sichtschutz auf einem Gerät</h3>
<ul>
  <li>Zwischen zwei Zügen liegt immer ein Sperrbildschirm. Erst weitergeben, dann antippen.</li>
  <li>Geheime Karten sind nur sichtbar, solange dein Finger daraufliegt – und höchstens für die
      eingestellte Dauer.</li>
  <li>Optional lässt sich pro Spieler eine PIN vergeben.</li>
  <li>Die Merkhilfe markiert Karten, die du schon gesehen hast. Zum Nachschauen hältst du sie
      wieder gedrückt – auf dem Bildschirm steht nie ein Wert offen herum.</li>
</ul>
`;

function showHelp() {
  showModal({
    title: 'Spielregeln',
    body: HELP,
    actions: [{ label: 'Verstanden', kind: 'primary' }],
  });
}

// ------------------------------------------------------------- Bildschirm

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    /* nicht überall verfügbar – dann bleibt es beim Standardverhalten */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && game) requestWakeLock();
});

// ------------------------------------------------------------------- Start

function init() {
  loadSettings();
  showSetup();

  $('btn-add-player').addEventListener('click', () => {
    if (seats.length >= MAX_PLAYERS) return;
    seats.push({ name: '', pin: '' });
    saveSettings();
    renderPlayerList();
  });
  $('btn-remove-player').addEventListener('click', () => {
    if (seats.length <= MIN_PLAYERS) return;
    seats.pop();
    saveSettings();
    renderPlayerList();
  });
  $('btn-reset-rules').addEventListener('click', () => {
    rules = { ...DEFAULT_RULES };
    saveSettings();
    renderRuleGroups($('rules-form'), RULE_GROUPS);
    renderPlayerList();
  });
  $('btn-help-setup').addEventListener('click', showHelp);

  $('btn-start').addEventListener('click', () => {
    if (rules.usePins) {
      const bad = seats.find((s) => s.pin && s.pin.length !== 4);
      if (bad) return toast('PINs müssen vierstellig sein (oder leer bleiben).');
    }
    seats = seats.map((s, i) => ({ ...s, name: s.name.trim() || `Spieler ${i + 1}` }));
    saveSettings();
    saveGame(null);
    startGame();
  });

  $('btn-resume').addEventListener('click', () => {
    const saved = loadSavedGame();
    if (!saved) return refreshResumeBox();
    startGame(saved);
  });
  $('btn-discard-save').addEventListener('click', () => {
    saveGame(null);
    refreshResumeBox();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* offline-Betrieb ist ein Extra, kein Muss */
      });
    });
  }
}

init();
