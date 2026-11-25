/**
 * Anker auflösen – die Entscheidung, *welche* Stelle eine Flugbahn meint.
 *
 * Getrennt von flight.js, weil genau diese Entscheidung ohne DOM prüfbar
 * sein muss: Ob ein Anker ins Leere läuft, zeigt sich im Browser nicht
 * als Fehler, sondern nur als Animation, die stillschweigend ausfällt.
 * Hier steht deshalb nur die Reihenfolge der Ersatzanker; das Messen
 * übernimmt eine Funktion, die flight.js hereinreicht (im Test eine
 * Tabelle).
 *
 * Wie scenes.js kennt diese Datei keine Spielregeln und keinen Zustand.
 */

import { ANCHOR } from './scenes.js';

/** Schlüssel eines Ankers – derselbe, unter dem maskiert wird. */
export function keyOf(anchor) {
  if (!anchor) return '';
  if (anchor.kind === ANCHOR.HAND) return `hand:${anchor.owner}:${anchor.slot}`;
  return anchor.kind;
}

/**
 * Wo liegt ein Anker auf dem Bildschirm?
 *
 * Reihenfolge: das Element selbst, dann der Ersatzanker aus der Flugbahn,
 * und für eine Hand zuletzt die Tischkante in Richtung dieses Spielers.
 *
 * @param {object} anchor Anker aus scenes.js
 * @param {(key: string) => ?{left:number, top:number, width:number, height:number}} measure
 *   Misst den Anker mit diesem Schlüssel; `null`, wenn es ihn nicht gibt.
 * @param {(owner: number) => ?object} [edge] Ersatz für eine Hand, die
 *   nicht auf diesem Bildschirm liegt.
 */
export function resolveAnchor(anchor, measure, edge) {
  if (!anchor) return null;
  const rect = measure(keyOf(anchor));
  if (usable(rect)) return rect;
  if (anchor.fallback) return resolveAnchor(anchor.fallback, measure, edge);
  if (anchor.kind === ANCHOR.HAND) return edge?.(anchor.owner) ?? null;
  return null;
}

/**
 * Ein Kartenformat mittig in einem Bereich.
 *
 * Für den Platz des Ablagebereichs: Ist er leer, schrumpft er auf null
 * Breite – seine Mitte bleibt aber genau dort, wo die Karte eben noch lag.
 */
export function centeredCard(box, size) {
  if (!box || !size) return null;
  return {
    left: box.left + box.width / 2 - size.width / 2,
    top: box.top + box.height / 2 - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function usable(rect) {
  return Boolean(rect) && rect.width > 0 && rect.height > 0;
}
