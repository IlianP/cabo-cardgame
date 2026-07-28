/**
 * Transport – wie Nachrichten zwischen den Geräten reisen.
 *
 * Der Gastgeber (`host.js`) und die Geräte (`client.js`) wissen nichts
 * davon, *wie* eine Nachricht ankommt. Sie kennen nur diese schmale
 * Schnittstelle:
 *
 *   send(to, message)   eine Nachricht an ein Gerät ('host' beim Client)
 *   onMessage(fn)       fn({ from, message })
 *   onJoin(fn)          fn(deviceId)   – nur beim Gastgeber
 *   onLeave(fn)         fn(deviceId)   – nur beim Gastgeber
 *   close()
 *
 * Das ist Absicht: Ob dahinter WebRTC, ein WebSocket oder – wie hier –
 * ein Kanal zwischen zwei Browser-Tabs steckt, ändert an der Spiellogik
 * keine Zeile. Der Reihe nach austauschbar zu sein ist der ganze Zweck.
 *
 * Was hier steht, ist bewusst das, was sich auch prüfen lässt:
 *
 *   MemoryTransport            alles in einem Prozess – für Tests
 *   BroadcastChannelTransport  mehrere Tabs auf demselben Gerät
 *
 * Was noch fehlt, ist der Adapter, der über echte Geräte hinweg
 * funktioniert (WebRTC mit dem Tablet als Gastgeber, siehe Issue #1).
 * Er passt hinter dieselbe Schnittstelle.
 */

/** Kleinster gemeinsamer Nenner: Zuhörer verwalten. */
class Listeners {
  constructor() {
    this.message = new Set();
    this.join = new Set();
    this.leave = new Set();
  }
  onMessage(fn) {
    this.message.add(fn);
    return () => this.message.delete(fn);
  }
  onJoin(fn) {
    this.join.add(fn);
    return () => this.join.delete(fn);
  }
  onLeave(fn) {
    this.leave.add(fn);
    return () => this.leave.delete(fn);
  }
  fire(set, arg) {
    for (const fn of [...set]) fn(arg);
  }
}

// ------------------------------------------------------------- Im Speicher

/**
 * Ein Vermittler, der Gastgeber und Geräte im selben Prozess verbindet.
 *
 * Für Tests: Damit lässt sich der ganze Ablauf – beitreten, ziehen,
 * verteilen, Verbindung verlieren, wiederkommen – durchspielen, ohne dass
 * ein Netz im Spiel ist. `deliver` ist absichtlich synchron; wer Verzögerung
 * oder Verlust prüfen will, nimmt `hold()`.
 */
export class MemoryHub {
  constructor() {
    this.endpoints = new Map(); // id -> Listeners
    this.held = null; // gesammelte Nachrichten, solange angehalten
  }

  connect(id) {
    const listeners = new Listeners();
    const hub = this;
    this.endpoints.set(id, listeners);

    const transport = {
      id,
      send(to, message) {
        hub._deliver(to, { from: id, message });
      },
      onMessage: (fn) => listeners.onMessage(fn),
      onJoin: (fn) => listeners.onJoin(fn),
      onLeave: (fn) => listeners.onLeave(fn),
      close() {
        hub.endpoints.delete(id);
        for (const [other, l] of hub.endpoints) {
          if (other !== id) l.fire(l.leave, id);
        }
      },
    };

    for (const [other, l] of this.endpoints) {
      if (other !== id) l.fire(l.join, id);
    }
    return transport;
  }

  _deliver(to, envelope) {
    if (this.held) {
      this.held.push([to, envelope]);
      return;
    }
    const target = this.endpoints.get(to);
    if (!target) return; // Gerät ist weg – Nachricht fällt auf den Boden
    target.fire(target.message, envelope);
  }

  /** Hält die Zustellung an; `release()` liefert alles Gesammelte nach. */
  hold() {
    this.held = [];
    return () => {
      const queued = this.held;
      this.held = null;
      for (const [to, envelope] of queued) this._deliver(to, envelope);
    };
  }
}

// ----------------------------------------------------- Zwischen zwei Tabs

/**
 * Verbindung über `BroadcastChannel`: mehrere Tabs oder Fenster auf
 * demselben Gerät.
 *
 * Damit ist der Mehrgeräte-Modus schon jetzt vorführbar – Tisch in einem
 * Tab, jede Hand in einem weiteren – und die Gastgeber-Schicht ist an
 * einem echten Transport erprobt, nicht nur an einer Attrappe. Über
 * Gerätegrenzen hinweg trägt das ausdrücklich *nicht*; dafür braucht es
 * den WebRTC-Adapter.
 */
export class BroadcastChannelTransport {
  /**
   * @param {string} room   Raumkennung – beide Seiten müssen dieselbe nehmen
   * @param {string} id     Kennung dieses Geräts ('host' beim Gastgeber)
   */
  constructor(room, id) {
    this.id = id;
    this.listeners = new Listeners();
    this.channel = new BroadcastChannel(`cabo.${room}`);
    this.seen = new Set();

    this.channel.onmessage = (event) => {
      const { to, from, kind, message } = event.data ?? {};
      if (kind === 'hello' && from !== this.id) {
        if (!this.seen.has(from)) {
          this.seen.add(from);
          this.listeners.fire(this.listeners.join, from);
        }
        return;
      }
      if (kind === 'bye' && from !== this.id) {
        this.seen.delete(from);
        this.listeners.fire(this.listeners.leave, from);
        return;
      }
      if (to !== this.id) return;
      this.listeners.fire(this.listeners.message, { from, message });
    };

    this.channel.postMessage({ kind: 'hello', from: id });
  }

  send(to, message) {
    this.channel.postMessage({ kind: 'message', to, from: this.id, message });
  }

  onMessage(fn) {
    return this.listeners.onMessage(fn);
  }
  onJoin(fn) {
    return this.listeners.onJoin(fn);
  }
  onLeave(fn) {
    return this.listeners.onLeave(fn);
  }

  close() {
    this.channel.postMessage({ kind: 'bye', from: this.id });
    this.channel.close();
  }
}

// ------------------------------------------------------- Direktverbindung

/**
 * Zwei Enden im selben Fenster, fest miteinander verdrahtet.
 *
 * Gebraucht für den Tisch: Sein Bildschirm soll denselben Weg nehmen wie
 * jedes Handy – Sicht anfordern, Sicht bekommen –, aber Gastgeber und
 * Bildschirm sitzen im selben Fenster, und dorthin stellt ein
 * `BroadcastChannel` nicht zu. Ohne diese Verbindung müsste der Tisch am
 * Gastgeber vorbei in den Spielzustand greifen und dabei mehr sehen, als
 * ihm zusteht.
 *
 * @param {string} deviceId  Kennung des lokalen Geräts
 * @returns {{host: object, device: object}}
 */
export function loopback(deviceId = 'lokal') {
  const hostSide = new Listeners();
  const deviceSide = new Listeners();

  const host = {
    id: 'host',
    send: (to, message) => {
      if (to === deviceId) deviceSide.fire(deviceSide.message, { from: 'host', message });
    },
    onMessage: (fn) => hostSide.onMessage(fn),
    onJoin: (fn) => hostSide.onJoin(fn),
    onLeave: (fn) => hostSide.onLeave(fn),
    close: () => {},
  };

  const device = {
    id: deviceId,
    send: (_to, message) => hostSide.fire(hostSide.message, { from: deviceId, message }),
    onMessage: (fn) => deviceSide.onMessage(fn),
    onJoin: (fn) => deviceSide.onJoin(fn),
    onLeave: (fn) => deviceSide.onLeave(fn),
    close: () => {},
  };

  return { host, device };
}
