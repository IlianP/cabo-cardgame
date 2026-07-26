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
export const CARD_ART = {};

/** Bild für die Kartenrückseite, oder null für das gezeichnete Muster. */
export const CARD_BACK = null;

export function artFor(value) {
  return CARD_ART[value] ?? null;
}
