/**
 * Flugebene – das Abspielen der Kartenbewegungen.
 *
 * Diese Datei kennt keine Spielregeln. Sie bekommt fertige Flugbahnen aus
 * scenes.js, sucht Start- und Zielpunkt auf dem Bildschirm und lässt eine
 * Wegwerf-Kopie der Karte die Strecke fliegen. Die echte Karte am Ziel
 * bleibt so lange unsichtbar und übernimmt beim Aufsetzen.
 *
 * Warum eine Kopie und nicht die Karte selbst: Die Oberfläche zeichnet den
 * Tisch bei jeder Zustandsänderung komplett neu, ein Element überlebt das
 * nicht. Der Umweg über die Kopie hat außerdem den Vorteil, dass das DOM
 * immer schon den *neuen* Zustand zeigt – wer während einer Animation
 * tippt, tippt nie auf eine veraltete Karte.
 *
 * Drei Regeln, die den ganzen Aufbau bestimmen:
 *
 *   1. Animationen halten niemandem den Weg frei. Kommt der nächste Zug,
 *      springen laufende Flüge ans Ende, statt sich aufzustauen.
 *   2. Bewegt wird nur `transform` und `opacity`. Alles andere zwingt den
 *      Browser zum Neuzeichnen und ruckelt auf älteren Tablets.
 *   3. Der Schatten ist ein eigenes Element. Er bleibt auf dem Tisch
 *      liegen, während die Karte darüber aufsteigt – das ist der Grund,
 *      warum die Bewegung räumlich wirkt und nicht flach.
 */

import { ANCHOR } from './scenes.js';
import { keyOf, resolveAnchor, centeredCard } from './anchors.js';
import { seatAngles, withOverrides, edgePoint } from './seating.js';

/**
 * Richtung des Lichts. Aus ihr ergibt sich, wohin der Schatten wandert,
 * wenn sich eine Karte hebt – für alle Karten gleich, sonst sähe es aus
 * wie viele kleine Lampen statt einer im Raum.
 *
 * Die Lampe hängt bewusst schräg über dem Tisch und nicht senkrecht
 * darüber: Bei senkrechtem Licht bliebe der Schatten unter der Karte
 * liegen und wäre nie zu sehen. Erst der seitliche Versatz macht die Höhe
 * sichtbar – er ist der eigentliche Träger des räumlichen Eindrucks.
 */
const LIGHT = { x: 0.55, y: 0.8 };

/** Wie hoch sich eine Karte im Scheitel des Bogens hebt (in Pixeln). */
const APEX_RISE = 40;

/** Wie stark sie sich dabei vergrößert – das ist die gefühlte Höhe. */
const APEX_GROW = 0.09;

/** Maximale Schräglage in Flugrichtung. */
const MAX_BANK = 8;

let layer = null;
let ghostFor = null;
let seatFor = null;
let speed = 1;
let paused = false;
let pending = [];
let running = new Set();

/**
 * Versteckte Ziele, gezählt statt nur vermerkt.
 *
 * Gezählt, weil zwei Flüge nacheinander dasselbe Ziel haben können – etwa
 * zwei Abwürfe kurz hintereinander. Das Ende eines Fluges meldet sich erst
 * im nächsten Durchlauf, also nachdem der zweite schon gestartet ist; ein
 * bloßes Vermerken würde die Karte dann mitten im zweiten Flug wieder
 * sichtbar machen.
 */
const masks = new Map();

// ------------------------------------------------------------ Einrichtung

/**
 * @param {object} options
 * @param {(scene: object) => HTMLElement|null} options.ghostFor Baut die
 *   fliegende Kopie. Nur die Oberfläche weiß, wie eine Karte aussieht.
 * @param {() => {state: object, viewer: number|null, overrides?: object}} [options.seatFor]
 *   Liefert die Sitzordnung – gebraucht, sobald eine Hand nicht auf diesem
 *   Bildschirm liegt und die Karte zur Tischkante hinausfliegen muss.
 */
export function configure(options = {}) {
  ghostFor = options.ghostFor ?? null;
  seatFor = options.seatFor ?? null;
  ensureLayer();
}

/** Tempo als Faktor: 0 schaltet ab, 1 ist normal, 1.5 ist flott. */
export function setSpeed(factor) {
  speed = Number.isFinite(factor) && factor > 0 ? factor : 0;
}

/**
 * Hält die Warteschlange an.
 *
 * Gebraucht für die Übergabesperre: Ein Zug wird erst zu Ende gespielt,
 * wenn das Gerät weitergereicht ist – sonst liefe die Animation vor einem
 * schwarzen Sperrbildschirm ab und der nächste Spieler sähe nie, was
 * gerade passiert ist.
 */
export function setPaused(value) {
  paused = Boolean(value);
}

export function isEnabled() {
  return speed > 0 && !prefersReducedMotion();
}

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.getElementById('flights');
  return layer;
}

// ------------------------------------------------------------ Warteschlange

/**
 * Nimmt neue Flugbahnen an.
 *
 * Läuft noch etwas, wird es sofort beendet statt eingereiht: Wer zügig
 * spielt, soll nicht auf Animationen warten, die längst überholt sind.
 */
export function enqueue(scenes) {
  if (!scenes?.length) return;
  if (!isEnabled()) return;
  if (running.size) finishAll();
  pending.push(...scenes);
}

/**
 * Startet, was bereit ist. Wird nach jedem Zeichnen aufgerufen – erst dann
 * stehen die Zielkarten an ihrem endgültigen Platz und lassen sich messen.
 */
export function pump() {
  if (paused || !pending.length) return;
  if (!isEnabled()) {
    pending = [];
    clearMasks();
    return;
  }
  const scenes = pending;
  pending = [];
  for (const scene of scenes) play(scene);
}

/** Bricht alles ab und räumt auf – etwa beim Verlassen des Spiels. */
export function reset() {
  pending = [];
  finishAll();
  clearMasks();
  if (layer) layer.innerHTML = '';
}

function finishAll() {
  for (const anim of Array.from(running)) {
    try {
      anim.finish();
    } catch {
      /* schon vorbei – dann ist ohnehin nichts mehr zu tun */
    }
  }
  running.clear();
}

// ---------------------------------------------------------------- Maskieren

/**
 * Versteckt die Karten, die gerade unterwegs sind.
 *
 * Muss nach jedem Zeichnen erneut laufen, weil die Oberfläche den Tisch
 * jedes Mal neu aufbaut und die frischen Elemente nichts von der laufenden
 * Animation wissen.
 */
export function applyMasks() {
  for (const key of masks.keys()) {
    const node = findByKey(key);
    if (node) node.style.visibility = 'hidden';
  }
}

function mask(key) {
  if (!key) return;
  masks.set(key, (masks.get(key) ?? 0) + 1);
  const node = findByKey(key);
  if (node) node.style.visibility = 'hidden';
}

function unmask(key) {
  if (!key) return;
  const left = (masks.get(key) ?? 0) - 1;
  if (left > 0) {
    masks.set(key, left);
    return;
  }
  masks.delete(key);
  const node = findByKey(key);
  if (node) node.style.visibility = '';
}

function clearMasks() {
  for (const key of Array.from(masks.keys())) {
    masks.delete(key);
    const node = findByKey(key);
    if (node) node.style.visibility = '';
  }
}

// ------------------------------------------------------------------ Anker

function findByKey(key) {
  const [kind, owner, slot] = key.split(':');
  switch (kind) {
    case ANCHOR.DECK:
      return document.querySelector('#pile-deck .pile-card');
    case ANCHOR.DISCARD:
      return document.getElementById('discard-card');
    case ANCHOR.DRAWN:
      return document.querySelector('#drawn-area .card');
    case ANCHOR.HAND:
      return document.querySelector(`[data-owner="${owner}"][data-slot="${slot}"]`);
    default:
      return null;
  }
}

/**
 * Wo liegt ein Anker auf dem Bildschirm?
 *
 * Die Reihenfolge der Ersatzanker steht in anchors.js (dort ohne DOM
 * geprüft); hier wird nur gemessen. Läuft auch der letzte Ersatz ins
 * Leere, greift für eine Hand die Tischkante in der Richtung, in der
 * dieser Spieler sitzt – heute nur im Mehrgeräte-Modus möglich, und die
 * Stelle, an der später der Übergang von einem Gerät auf das andere
 * ansetzt.
 */
function resolve(anchor) {
  return resolveAnchor(anchor, measure, edgeRect);
}

function measure(key) {
  if (key === ANCHOR.DRAWN_SLOT) return drawnSlotRect();
  const node = findByKey(key);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Der Platz des Ablagebereichs – auch wenn er leer ist.
 *
 * Leer schrumpft er auf null Breite, bleibt aber zwischen Stapel und
 * Ablage stehen; seine Mitte ist die Stelle, an der die Karte lag.
 */
function drawnSlotRect() {
  const area = document.getElementById('drawn-area');
  // Ausgeblendet hätte er keine Lage – dann lieber gar kein Flug als
  // einer aus der Bildschirmecke.
  if (!area?.isConnected || !area.getClientRects().length) return null;
  return centeredCard(area.getBoundingClientRect(), referenceCardSize());
}

/** Ein Kartenformat direkt an der Tischkante, in Richtung eines Spielers. */
function edgeRect(owner) {
  const table = document.getElementById('table');
  if (!table || !seatFor) return null;
  const seats = seatFor();
  if (!seats?.state) return null;

  const angles = withOverrides(seatAngles(seats.state, seats.viewer ?? null), seats.overrides);
  const angle = angles[owner];
  if (angle == null) return null;

  const r = table.getBoundingClientRect();
  const size = referenceCardSize();
  const point = edgePoint(angle, { left: r.left, top: r.top, width: r.width, height: r.height }, 1.05);
  return { left: point.x - size.width / 2, top: point.y - size.height / 2, ...size };
}

function referenceCardSize() {
  const sample = document.querySelector('#pile-deck .pile-card');
  if (sample) {
    const r = sample.getBoundingClientRect();
    if (r.width > 0) return { width: r.width, height: r.height };
  }
  return { width: 70, height: 101 };
}

// ---------------------------------------------------------------- Abspielen

function play(scene) {
  const host = ensureLayer();
  if (!host || !ghostFor) return;

  const from = resolve(scene.from);
  const to = resolve(scene.to);
  if (!from || !to) return;

  const card = ghostFor(scene);
  if (!card) return;

  const targetKey = keyOf(scene.to);
  mask(targetKey);

  const wrap = document.createElement('div');
  wrap.className = 'flight';
  wrap.style.width = `${from.width}px`;
  wrap.style.height = `${from.height}px`;
  wrap.style.setProperty('--card-w', `${from.width}px`);
  wrap.append(card);

  const shadow = document.createElement('div');
  shadow.className = 'flight-shadow';
  shadow.style.width = `${from.width}px`;
  shadow.style.height = `${from.height}px`;

  host.append(shadow, wrap);

  const path = geometry(from, to, scene.lift ?? 1);
  const duration = Math.max(80, (scene.duration ?? 320) / speed);
  const delay = Math.max(0, (scene.delay ?? 0) / speed);
  const options = { duration, delay, easing: 'linear', fill: 'both' };

  const cardAnim = wrap.animate(cardFrames(path), options);
  const shadowAnim = shadow.animate(shadowFrames(path), options);

  running.add(cardAnim);
  running.add(shadowAnim);

  // Nur einmal abräumen: `finish` und `cancel` können beide eintreffen,
  // und ein zweites Abmelden würde die Karte zu früh sichtbar machen.
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    running.delete(cardAnim);
    running.delete(shadowAnim);
    wrap.remove();
    shadow.remove();
    unmask(targetKey);
  };
  cardAnim.addEventListener('finish', done);
  cardAnim.addEventListener('cancel', done);
}

/**
 * Die Bahn: Anfang, Scheitel, Ende.
 *
 * Der Scheitel liegt nicht einfach in der Mitte, sondern etwas über der
 * Verbindungslinie – eine gerade Strecke sieht mechanisch aus. Wie hoch,
 * hängt an der Entfernung: ein kurzer Weg soll keinen Looping schlagen.
 */
function geometry(from, to, lift) {
  const x0 = from.left;
  const y0 = from.top;
  const x1 = to.left + (to.width - from.width) / 2;
  const y1 = to.top + (to.height - from.height) / 2;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  const rise = Math.min(APEX_RISE * lift, distance * 0.28);
  const grow = APEX_GROW * lift;

  return {
    x0,
    y0,
    x1,
    y1,
    scale: from.width > 0 ? to.width / from.width : 1,
    midX: x0 + dx / 2,
    midY: y0 + dy / 2 - rise,
    groundMidX: x0 + dx / 2,
    groundMidY: y0 + dy / 2,
    rise,
    grow,
    bank: Math.max(-MAX_BANK, Math.min(MAX_BANK, dx / 40)),
  };
}

function cardFrames(p) {
  const midScale = (1 + p.scale) / 2 + p.grow;
  return [
    {
      transform: `translate3d(${p.x0}px, ${p.y0}px, 0) scale(1) rotate(0deg)`,
      easing: 'cubic-bezier(.32,.06,.44,.55)',
    },
    {
      offset: 0.5,
      transform: `translate3d(${p.midX}px, ${p.midY}px, 0) scale(${midScale}) rotate(${p.bank}deg)`,
      easing: 'cubic-bezier(.28,.72,.3,1)',
    },
    {
      transform: `translate3d(${p.x1}px, ${p.y1}px, 0) scale(${p.scale}) rotate(0deg)`,
    },
  ];
}

/**
 * Der Schatten bleibt am Boden.
 *
 * Er folgt derselben Strecke, aber ohne den Bogen – dafür wandert er in
 * Lichtrichtung von der Karte weg, wird größer und blasser, je höher sie
 * steigt. Beim Aufsetzen zieht er sich wieder eng darunter zusammen. Genau
 * dieser letzte Moment ist es, der die Landung spürbar macht.
 */
function shadowFrames(p) {
  const offX = p.rise * LIGHT.x;
  const offY = p.rise * LIGHT.y;
  const spread = 1 + p.rise / 80;
  return [
    {
      transform: `translate3d(${p.x0}px, ${p.y0 + 4}px, 0) scale(.94)`,
      opacity: 0.55,
      easing: 'cubic-bezier(.32,.06,.44,.55)',
    },
    {
      offset: 0.5,
      transform: `translate3d(${p.groundMidX + offX}px, ${p.groundMidY + offY}px, 0) scale(${spread})`,
      // Weiter weg heißt weicher und blasser – aber nicht unsichtbar,
      // sonst verschwindet genau der Hinweis auf die Höhe.
      opacity: 0.34,
      easing: 'cubic-bezier(.28,.72,.3,1)',
    },
    {
      transform: `translate3d(${p.x1}px, ${p.y1 + 4}px, 0) scale(${p.scale * 0.94})`,
      opacity: 0.55,
    },
  ];
}
