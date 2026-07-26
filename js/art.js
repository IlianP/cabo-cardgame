/**
 * Kartenbilder.
 *
 * Solange hier nichts eingetragen ist, zeichnet die Oberfläche die Karten
 * selbst: große Zahl, Farbe nach Wert, bei 7 bis 12 zusätzlich der Name der
 * Kartenkraft. Sobald Illustrationen vorliegen, genügt es, sie unter
 * `art/` abzulegen und hier einzutragen – die Oberfläche nimmt sie dann
 * automatisch.
 *
 *   export const CARD_ART = { 0: 'art/00.webp', 1: 'art/01.webp', … };
 *   export const CARD_BACK = 'art/back.webp';
 *
 * Erwartetes Format: Hochformat, Seitenverhältnis etwa 3:4, ohne Zahl und
 * ohne Rahmen im Bild – beides legt die Oberfläche darüber.
 */

/** Wert (0–13) auf Bildpfad. Fehlende Einträge werden gezeichnet. */
export const CARD_ART = {
  0: 'art/00.webp', // Einhorn
  1: 'art/01.webp', // Glühwürmchen
  2: 'art/02.webp', // Schmetterlinge
  3: 'art/03.webp', // Frösche
  4: 'art/04.webp', // Vögel
  5: 'art/05.webp', // Füchse
  6: 'art/06.webp', // Mäuse
  7: 'art/07.webp', // Eulen – Peek
  8: 'art/08.webp', // Schlangen – Peek
  9: 'art/09.webp', // Katzen – Spy
  10: 'art/10.webp', // Raben – Spy
  11: 'art/11.webp', // Kobolde – Swap
  12: 'art/12.webp', // Drachen – Swap
  13: 'art/13.webp', // Höllenhund
};

/**
 * Die Rückseite ist bewusst kein Bild: sie wird in css/style.css als
 * Schuppenmuster gezeichnet. Das bleibt in jeder Größe scharf und spart
 * eine Datei, die auf jeder verdeckten Karte geladen werden müsste.
 */
export const CARD_BACK = null;

/**
 * Liefert einen absoluten Pfad. Das ist kein Schönheitsfehler: die Pfade
 * landen in einer CSS-Variablen, und relative URLs darin werden gegen das
 * Stylesheet aufgelöst, nicht gegen das Dokument – aus `art/00.webp` würde
 * sonst `css/art/00.webp`.
 */
export function artFor(value) {
  const path = CARD_ART[value];
  return path ? new URL(path, document.baseURI).href : null;
}
