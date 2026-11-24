/**
 * Gastgeber – ein Gerät hält die Partie, die anderen schauen und tippen.
 *
 * Der Gastgeber ist die einzige Stelle, an der der volle Spielzustand
 * liegt. Geräte schicken *Absichten* („ich möchte ziehen“), nie fertige
 * Zustände; der Gastgeber prüft, wendet an und verteilt danach an jedes
 * Gerät dessen eigene, beschnittene Sicht (`view.js`).
 *
 * Drei Dinge sind hier wichtiger als sie aussehen:
 *
 * **Nichts wird geglaubt.** Auch wenn ein Handy nur Knöpfe zeigt, die
 * gerade erlaubt sind, wird jede Nachricht erneut gegen `legalActions`
 * geprüft. Die Freigabe im Client ist Bequemlichkeit, nicht Sicherheit.
 *
 * **Doppelte Nachrichten sind normal.** Jede Aktion trägt die Version des
 * Zustands, auf den sie sich bezieht. Passt sie nicht mehr, wird sie
 * *geschluckt* und das Gerät bekommt den aktuellen Stand – keine
 * Fehlermeldung. Zweimal getippt, unterwegs verdoppelt, zu spät
 * angekommen: über eine wackelige Verbindung ist das der Normalfall, und
 * ein Regelverstoß-Hinweis wäre dort schlicht gelogen.
 *
 * **Die Sichten werden einmal je Zustand gebaut**, nicht einmal je Gerät –
 * bei vier Spielern spart das vier Durchläufe über den Verlauf pro Zug.
 */

import { CaboGame, GameError, legalActions, PHASE } from './engine.js';
import { viewFor, TABLE } from './view.js';

/**
 * Was ein Tisch-Gerät selbst auslösen darf. Der Tisch hat keine Hand und
 * spielt nicht mit – aber „weiter“ nach einer öffentlichen Aufdeckung und
 * das Starten der nächsten Runde sind gemeinsame Handlungen, und der
 * große Bildschirm in der Mitte ist dafür der natürliche Ort.
 */
const TABLE_ACTIONS = new Set(['ackReveal', 'nextRound']);

/** Aktionen, die nicht über `selectCard` laufen, mit ihren Argumenten. */
const ACTIONS = {
  confirmHandoff: (game, args) => game.confirmHandoff(args[0] ?? ''),
  drawFromDeck: (game) => game.drawFromDeck(),
  takeDiscard: (game) => game.takeDiscard(),
  callCabo: (game) => game.callCabo(),
  discardDrawn: (game) => game.discardDrawn(),
  startMultiDiscard: (game) => game.startMultiDiscard(),
  cancelMultiDiscard: (game) => game.cancelMultiDiscard(),
  confirmMultiDiscard: (game) => game.confirmMultiDiscard(),
  skipPower: (game) => game.skipPower(),
  ackReveal: (game) => game.ackReveal(),
  nextRound: (game) => game.nextRound(),
  selectCard: (game, args, playerId) => game.selectCard(args[0] ?? playerId, args[1]),
};

export class CaboHost {
  /**
   * @param {CaboGame} game
   * @param {{transport?: object, onChange?: (state) => void}} options
   */
  constructor(game, { transport = null, transports = [], onChange = null } = {}) {
    this.game = game;
    this.onChange = onChange;
    this.devices = new Map(); // deviceId -> { audience, link }
    this.links = new Map(); // deviceId -> Transport, über den es zuletzt sprach
    this.transports = [];
    this.unbind = [];
    for (const t of [transport, ...transports].filter(Boolean)) this.useTransport(t);
  }

  /**
   * Ein Gastgeber kann an mehreren Leitungen gleichzeitig hängen.
   *
   * Das ist kein Luxus, sondern nötig: Der Tisch zeigt seinen eigenen
   * Bildschirm über dasselbe Sicht-Verfahren wie jedes Handy, sitzt aber im
   * selben Fenster wie der Gastgeber – und ein `BroadcastChannel` stellt
   * nicht an das Fenster zu, das gesendet hat. Der eigene Bildschirm hängt
   * deshalb an einer Direktverbindung (`loopback()`), die Handys am Kanal.
   */
  useTransport(transport) {
    this.transports.push(transport);
    this.unbind.push(
      transport.onMessage?.(({ from, message }) => this.receive(from, message, transport)) ??
        (() => {}),
      transport.onLeave?.((id) => this.detach(id)) ?? (() => {}),
    );
  }

  close() {
    for (const off of this.unbind) off();
    this.unbind = [];
    for (const t of this.transports) t.close?.();
    this.transports = [];
  }

  // ------------------------------------------------------------- Geräte

  /**
   * Ein Gerät übernimmt einen Platz: `TABLE` für den Tisch, sonst die
   * Spielernummer. Dieselbe Nummer noch einmal ist kein Fehler, sondern
   * ein Wechsel – wer sein Handy tauscht oder den Tab neu lädt, soll
   * weiterspielen können. Das alte Gerät verliert den Platz.
   */
  attach(deviceId, audience, link = null) {
    if (audience !== TABLE) {
      const known = this.game.state.players.some((p) => p.id === audience);
      if (!known) throw new GameError(`Diesen Platz gibt es nicht: ${audience}`);
      for (const [other, info] of this.devices) {
        if (other !== deviceId && info.audience === audience) this.devices.delete(other);
      }
    }
    this.devices.set(deviceId, { audience, link: link ?? this.devices.get(deviceId)?.link ?? null });
    this.send(deviceId, { type: 'joined', audience, view: viewFor(this.game.state, audience) });
    return audience;
  }

  detach(deviceId) {
    this.devices.delete(deviceId);
  }

  /** Welche Plätze gerade kein Gerät haben – der Tisch zeigt das an. */
  missingSeats() {
    const taken = new Set([...this.devices.values()].map((d) => d.audience));
    return this.game.state.players.filter((p) => !taken.has(p.id)).map((p) => p.id);
  }

  // --------------------------------------------------------- Nachrichten

  receive(deviceId, message, link = null) {
    const { type } = message ?? {};
    // Über welche Leitung dieses Gerät redet, lernt der Gastgeber aus der
    // ersten Nachricht – Antworten nehmen denselben Weg zurück.
    if (link) this.links.set(deviceId, link);
    if (type === 'join') {
      try {
        this.attach(deviceId, message.audience, link);
      } catch (err) {
        this.send(deviceId, { type: 'error', message: err.message, seq: message.seq ?? null });
      }
      return;
    }
    if (type === 'lobby') {
      // Vor dem Beitreten: Wer sitzt am Tisch, und welcher Platz ist frei?
      // Das verrät nur Namen und Belegung – keine Karte, kein Spielstand.
      const taken = new Set([...this.devices.values()].map((d) => d.audience));
      return this.send(deviceId, {
        type: 'lobby',
        players: this.game.state.players.map((p) => ({
          id: p.id,
          name: p.name,
          taken: taken.has(p.id),
        })),
      });
    }
    if (type === 'resync') {
      const info = this.devices.get(deviceId);
      if (info) this.sendView(deviceId, info.audience);
      return;
    }
    if (type === 'action') return this.act(deviceId, message);
    this.send(deviceId, { type: 'error', message: `Unbekannte Nachricht: ${type}` });
  }

  /**
   * Eine Aktion anwenden – oder begründet ablehnen.
   *
   * Reihenfolge der Prüfungen ist wichtig: erst die Version (dann ist es
   * eine veraltete Nachricht und *kein* Fehler), danach erst die Regeln.
   * Andersherum bekäme ein Doppeltipp eine Regelverstoß-Meldung.
   */
  act(deviceId, message) {
    const info = this.devices.get(deviceId);
    if (!info) {
      return this.send(deviceId, { type: 'error', message: 'Dieses Gerät sitzt an keinem Platz.' });
    }
    const state = this.game.state;
    const { action, args = [], version, seq = null } = message;

    if (version != null && version !== state.version) {
      // Veraltet oder doppelt: schlucken und den aktuellen Stand nachreichen.
      return this.sendView(deviceId, info.audience, { stale: true, seq });
    }

    const playerId = info.audience === TABLE ? this.actingSeatForTable(action) : info.audience;
    if (playerId == null) {
      return this.send(deviceId, {
        type: 'error',
        message: 'Der Tisch kann das nicht auslösen.',
        seq,
      });
    }
    if (!ACTIONS[action]) {
      return this.send(deviceId, { type: 'error', message: `Unbekannter Zug: ${action}`, seq });
    }
    if (!legalActions(state, playerId).includes(action)) {
      return this.send(deviceId, { type: 'error', message: 'Das geht gerade nicht.', seq });
    }

    try {
      const result = ACTIONS[action](this.game, args, playerId);
      // confirmHandoff meldet eine falsche PIN als Rückgabewert, nicht als Fehler.
      if (result && result.ok === false) {
        return this.send(deviceId, { type: 'error', message: result.error, seq });
      }
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      return this.send(deviceId, { type: 'error', message: err.message, seq });
    }

    this.onChange?.(this.game.state);
    this.broadcast(seq, deviceId);
  }

  /**
   * Für welchen Platz handelt der Tisch? Nur bei gemeinsamen Handlungen,
   * und dann für den, für den sie gerade erlaubt sind.
   */
  actingSeatForTable(action) {
    if (!TABLE_ACTIONS.has(action)) return null;
    const state = this.game.state;
    // Eine private Aufdeckung sieht der Tisch gar nicht – er darf sie also
    // auch nicht wegtippen und damit jemandem den Blick nehmen.
    if (action === 'ackReveal' && !state.reveal?.isPublic) return null;
    const candidate = state.players.find((p) => legalActions(state, p.id).includes(action));
    return candidate ? candidate.id : null;
  }

  // ---------------------------------------------------------- Verteilen

  /**
   * Jedem Gerät seine Sicht schicken. Die Sicht je Publikum wird einmal
   * gebaut und an alle Geräte desselben Publikums weitergereicht – zwei
   * Handys am selben Platz sind selten, der Tisch mit mehreren Bildschirmen
   * nicht.
   */
  broadcast(seq = null, origin = null) {
    const built = new Map();
    for (const [deviceId, info] of this.devices) {
      if (!built.has(info.audience)) built.set(info.audience, viewFor(this.game.state, info.audience));
      this.send(deviceId, {
        type: 'view',
        view: built.get(info.audience),
        seq: deviceId === origin ? seq : null,
      });
    }
  }

  sendView(deviceId, audience, extra = {}) {
    this.send(deviceId, { type: 'view', view: viewFor(this.game.state, audience), ...extra });
  }

  send(deviceId, message) {
    const link = this.devices.get(deviceId)?.link ?? this.links.get(deviceId);
    if (link) return link.send(deviceId, message);
    // Noch keine Leitung gelernt: an allen versuchen, eine trägt.
    for (const t of this.transports) t.send(deviceId, message);
  }
}

/** Bequemer Einstieg: neue Partie mit Gastgeber. */
export function hostGame({ players, rules, rng, transport, onChange } = {}) {
  const game = new CaboGame({ players, rules, rng });
  return new CaboHost(game, { transport, onChange });
}

export { TABLE, PHASE };
