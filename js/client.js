/**
 * Gerät – hält die eigene Sicht und schickt Absichten an den Gastgeber.
 *
 * Ein Client weiß nie mehr, als der Gastgeber ihm geschickt hat. Er hat
 * keinen Spielzustand, keine Engine und keine Regelprüfung, die etwas
 * entscheidet: `view.you.can` sagt ihm, welche Knöpfe sinnvoll sind, und
 * der Gastgeber prüft dieselbe Frage noch einmal, bevor etwas passiert.
 *
 * Die Version der zuletzt erhaltenen Sicht geht bei jeder Aktion mit. Ein
 * zweiter Tipp auf denselben Knopf trägt also dieselbe Version wie der
 * erste und wird vom Gastgeber geschluckt statt abgelehnt. Nach einem
 * Verbindungsabriss reicht `resync()`, um wieder auf Stand zu kommen –
 * ohne die Partie zu verlieren.
 */

export class CaboClient {
  /**
   * @param {object} transport   siehe transport.js
   * @param {{hostId?: string, onView?: (view) => void, onError?: (msg) => void}} options
   */
  constructor(transport, { hostId = 'host', onView = null, onError = null, onLobby = null } = {}) {
    this.transport = transport;
    this.hostId = hostId;
    this.onView = onView;
    this.onError = onError;
    this.onLobby = onLobby;
    this.view = null;
    this.audience = null;
    this.seq = 0;

    this.off = transport.onMessage(({ message }) => this.receive(message));
  }

  receive(message) {
    switch (message?.type) {
      case 'joined':
        this.audience = message.audience;
        this.setView(message.view);
        break;
      case 'view':
        this.setView(message.view);
        break;
      case 'lobby':
        this.onLobby?.(message.players);
        break;
      case 'error':
        this.onError?.(message.message);
        break;
      default:
        break;
    }
  }

  setView(view) {
    this.view = view;
    this.onView?.(view);
  }

  /** Platz übernehmen: `TABLE` oder eine Spielernummer. */
  join(audience) {
    this.send({ type: 'join', audience });
  }

  /** Die Platzliste holen, ohne schon einen Platz zu belegen. */
  lobby() {
    this.send({ type: 'lobby' });
  }

  /** Nach einem Aussetzer den aktuellen Stand anfordern. */
  resync() {
    this.send({ type: 'resync' });
  }

  /**
   * Einen Zug schicken. Ohne Sicht (also vor dem ersten Empfang) geht das
   * nicht – dann fehlte die Version, und der Gastgeber müsste raten, auf
   * welchen Stand sich der Zug bezieht.
   */
  act(action, ...args) {
    if (!this.view) return false;
    this.send({
      type: 'action',
      action,
      args,
      version: this.view.version,
      seq: ++this.seq,
    });
    return true;
  }

  /** Was dieses Gerät gerade tun darf – direkt aus der letzten Sicht. */
  get can() {
    return this.view?.you?.can ?? [];
  }

  send(message) {
    this.transport.send(this.hostId, message);
  }

  close() {
    this.off?.();
    this.transport.close?.();
  }
}
