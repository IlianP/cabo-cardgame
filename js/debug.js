/**
 * Debug-Zustand: der ganze Tisch als kopierbarer Text.
 *
 * Der 🪲-Knopf im Spiel ruft `copyDebugState()` auf. Der Text ist so
 * gebaut, dass er sich in eine Fehlermeldung einfügen lässt und dabei
 * beides enthält: eine lesbare Zusammenfassung für Menschen und den
 * vollständigen Zustand als JSON, aus dem sich die Lage exakt
 * nachstellen lässt.
 *
 * Achtung: der Text enthält alle Karten im Klartext. Er ist zum
 * Weitergeben nach dem Spiel gedacht, nicht zum Vorlesen am Tisch –
 * deshalb wandert er direkt in die Zwischenablage und nicht auf den
 * Bildschirm.
 */

import { PHASE } from './engine.js';

const pad = (text, width) => String(text).padEnd(width, ' ');

/** Karte als "v7-1(7)" – ID und Wert, beides braucht man beim Nachstellen. */
function tag(game, id) {
  if (id == null) return '—';
  const card = game.card(id);
  return card ? `${card.id}(${card.value})` : `${id}(?)`;
}

function handLine(game, player) {
  const hand = player.hand
    .map((id, slot) => `${slot + 1}:${id == null ? 'leer' : tag(game, id)}`)
    .join('  ');
  return `${hand}   Σ${game.handSum(player.id)}`;
}

function rulesLine(rules) {
  return Object.entries(rules)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function pileLine(game, ids) {
  if (!ids.length) return 'leer';
  return ids.map((id) => tag(game, id)).join(' ');
}

function phaseDetail(s) {
  switch (s.phase) {
    case PHASE.HANDOFF:
      return `an Spieler #${s.handoff.to}, weiter mit "${s.handoff.resume}"`;
    case PHASE.PEEK:
      return `Spieler #${s.peek.order[s.peek.index]}, bereits angesehen: ${
        s.peek.taken.join(', ') || '—'
      }`;
    case PHASE.MULTI:
      return `gewählte Plätze (1-basiert): ${
        s.multi.slots.map((x) => x + 1).join(', ') || '—'
      }`;
    case PHASE.POWER:
      return `${s.power.type}, Schritt "${s.power.step}"`;
    case PHASE.REVEAL:
      return `"${s.reveal.title}", weiter mit "${s.reveal.next}"`;
    default:
      return '';
  }
}

/** Die letzten Einträge des Verlaufs, neueste zuletzt. */
function historyBlock(s, limit) {
  const entries = s.log.slice(-limit);
  if (!entries.length) return '  (leer)';
  return entries
    .map((e) => `  #${pad(e.n ?? '?', 4)} R${e.round} ${pad(e.type ?? '—', 14)} ${e.text}`)
    .join('\n');
}

/**
 * Baut den Debug-Text.
 * @param {import('./engine.js').CaboGame} game
 */
export function buildDebugReport(game, { historyLimit = 40 } = {}) {
  const s = game.state;
  const viewer = game.viewer;
  const lines = [];

  lines.push('CABO – DEBUG-ZUSTAND');
  lines.push(`Zeit:     ${new Date().toISOString()}`);
  lines.push(`Seite:    ${globalThis.location?.href ?? '—'}`);
  lines.push(`Browser:  ${globalThis.navigator?.userAgent ?? '—'}`);
  lines.push('');

  lines.push(`Runde:    ${s.round}`);
  const detail = phaseDetail(s);
  lines.push(`Phase:    ${s.phase}${detail ? ` (${detail})` : ''}`);
  lines.push(
    `Am Zug:   #${s.current} ${s.players[s.current]?.name ?? '—'}` +
      `   Ansicht: ${viewer == null ? 'niemand' : `#${viewer} ${s.players[viewer].name}`}`,
  );
  lines.push(
    `Cabo:     ${
      s.cabo ? `#${s.cabo.caller} ${s.players[s.cabo.caller].name}, noch ${s.cabo.turnsRemaining} Zug/Züge` : 'nicht gerufen'
    }`,
  );
  lines.push(`Gezogen:  ${tag(game, s.drawn)}${s.drawn == null ? '' : ` (aus: ${s.drawnFrom})`}`);
  lines.push('');

  lines.push('HÄNDE (Platz:Karte(Wert), Platznummern wie in der Oberfläche)');
  for (const p of s.players) {
    const marks = [];
    if (p.id === s.current) marks.push('am Zug');
    if (p.id === viewer) marks.push('sieht zu');
    if (s.cabo?.caller === p.id) marks.push('Cabo');
    const known = Object.keys(s.knowledge?.[p.id] ?? {})
      .map((slot) => Number(slot) + 1)
      .sort((a, b) => a - b);
    lines.push(
      `  #${p.id} ${pad(p.name, 12)} ${handLine(game, p)}   Punkte ${p.score}` +
        `${marks.length ? `   [${marks.join(', ')}]` : ''}`,
    );
    lines.push(`      kennt Plätze: ${known.join(', ') || '—'}`);
  }
  lines.push('');

  lines.push(`STAPEL   Nachziehstapel: ${s.deck.length} Karten`);
  lines.push(`         Ablage (${s.discard.length}, oberste rechts): ${pileLine(game, s.discard)}`);
  lines.push('');

  lines.push(`VERLAUF (letzte ${Math.min(historyLimit, s.log.length)} von ${s.log.length})`);
  lines.push(historyBlock(s, historyLimit));
  lines.push('');

  lines.push(`REGELN   ${rulesLine(s.rules)}`);
  lines.push('');

  lines.push('ROHZUSTAND (JSON)');
  lines.push(game.toJSON());

  return lines.join('\n');
}

/** Zwischenablage mit Rückfallebene für Browser ohne Clipboard-API. */
async function writeClipboard(text) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* z. B. kein sicherer Kontext – dann der alte Weg */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Kopiert den Debug-Zustand.
 * @returns {Promise<{ok: boolean, text: string}>}
 */
export async function copyDebugState(game, options) {
  const text = buildDebugReport(game, options);
  return { ok: await writeClipboard(text), text };
}
