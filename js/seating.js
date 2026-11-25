/**
 * Sitzordnung – in welcher Richtung sitzt wer am Tisch.
 *
 * Für Animationen reicht es nicht zu wissen, *dass* eine Karte zu einem
 * Spieler wandert; sie muss auch in die richtige Richtung fliegen. Solange
 * alle Hände auf demselben Bildschirm liegen, ist das leicht – dann steht
 * die Zielkarte einfach da. Sobald aber ein Spieler seine Hand auf dem
 * eigenen Handy hält (Mehrgeräte-Modus), gibt es auf dem Tisch-Bildschirm
 * kein Ziel mehr: die Karte muss zu der Kante hinausfliegen, an der dieser
 * Spieler tatsächlich sitzt.
 *
 * Diese Datei beantwortet genau diese eine Frage und sonst nichts. Sie ist
 * rein – Zustand rein, Winkel raus – und kennt weder DOM noch Engine.
 *
 * Winkel sind Grad im Bildschirm-Koordinatensystem: 0° zeigt nach rechts,
 * 90° nach unten, 180° nach links, 270° nach oben. Der Betrachter sitzt
 * immer unten, also bei 90° – das ist die Kante, an der er das Gerät hält.
 */

export const VIEWER_ANGLE = 90;

/**
 * Verteilt die Spieler auf dem Kreis um den Tisch.
 *
 * Der Betrachter sitzt unten, alle anderen in Spielreihenfolge gegen den
 * Uhrzeigersinn weiter – dieselbe Reihenfolge, in der die Engine reihum
 * geht. Dadurch wandert der Zug sichtbar im Kreis und nicht in Sprüngen.
 *
 * Ohne Betrachter (Tisch-Bildschirm im Mehrgeräte-Modus, Abrechnung)
 * beginnt die Verteilung bei Spieler 0 unten – dort steht sonst niemand.
 *
 * @param {{players: {id: number}[]}} state
 * @param {number|null} viewer
 * @returns {Record<number, number>} Spieler-ID -> Winkel in Grad
 */
export function seatAngles(state, viewer = null) {
  const ids = state.players.map((p) => p.id);
  const n = ids.length;
  const anchor = viewer != null && ids.includes(viewer) ? ids.indexOf(viewer) : 0;

  const out = {};
  for (let i = 0; i < n; i += 1) {
    const step = (i - anchor + n) % n;
    // Gegen den Uhrzeigersinn: auf dem Bildschirm wächst y nach unten,
    // deshalb wird der Schritt abgezogen und nicht addiert.
    out[ids[i]] = norm(VIEWER_ANGLE - (step * 360) / n);
  }
  return out;
}

/**
 * Feste Sitzrichtung von Hand setzen.
 *
 * Später soll man am Tisch-Gerät angeben können, an welcher Kante jemand
 * sitzt. Bis dahin ist `seatAngles` die Voreinstellung, und diese Funktion
 * legt einzelne Spieler darüber – ohne dass der Rest davon weiß.
 *
 * @param {Record<number, number>} angles
 * @param {Record<number, number>} overrides
 */
export function withOverrides(angles, overrides = {}) {
  const out = { ...angles };
  for (const [id, angle] of Object.entries(overrides)) {
    if (Number.isFinite(angle)) out[id] = norm(angle);
  }
  return out;
}

/**
 * Der Punkt auf dem Rand eines Rechtecks, der in einer Richtung liegt.
 *
 * Damit fliegt eine Karte zu genau der Kante hinaus, an der ihr Besitzer
 * sitzt. Gerechnet wird vom Mittelpunkt aus als Strahl, der an der
 * nächstgelegenen Rechteckseite endet – bei 45° also in der Ecke.
 *
 * @param {number} angleDeg
 * @param {{left:number, top:number, width:number, height:number}} rect
 * @param {number} overshoot Faktor > 1 schiebt den Punkt vor die Kante
 */
export function edgePoint(angleDeg, rect, overshoot = 1) {
  const rad = (norm(angleDeg) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const hw = rect.width / 2;
  const hh = rect.height / 2;

  // Wie weit kommt der Strahl, bis er an eine der beiden Seiten stößt?
  const tx = Math.abs(dx) < 1e-6 ? Infinity : hw / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-6 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty) * overshoot;

  return {
    x: rect.left + hw + dx * t,
    y: rect.top + hh + dy * t,
  };
}

/** Grobe Himmelsrichtung – für Beschriftungen und zum Prüfen. */
export function edgeName(angleDeg) {
  const a = norm(angleDeg);
  if (a >= 45 && a < 135) return 'bottom';
  if (a >= 135 && a < 225) return 'left';
  if (a >= 225 && a < 315) return 'top';
  return 'right';
}

function norm(deg) {
  return ((deg % 360) + 360) % 360;
}
