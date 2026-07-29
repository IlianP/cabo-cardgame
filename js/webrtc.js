/**
 * WebRTC-Transport – die Geräte reden direkt miteinander.
 *
 * Passt hinter dieselbe schmale Schnittstelle wie die übrigen Transporte
 * (siehe `transport.js`); Engine, Sichten, Gastgeber und Geräte merken vom
 * Wechsel nichts.
 *
 * ## Der Handschlag, und warum er umständlich ist
 *
 * Zwei Browser können sich im Netz nicht von selbst finden. Bevor eine
 * direkte Verbindung steht, müssen sie einmal Beschreibungen austauschen:
 *
 *   Tisch  ──── Angebot (offer) ────>  Handy
 *   Tisch  <──── Antwort (answer) ───  Handy
 *
 * Danach läuft alles direkt zwischen den Geräten – ohne Vermittler, ohne
 * Internet, auch im reinen WLAN. Nur diese zwei Nachrichten müssen
 * irgendwie hinüber. *Wie*, ist hier bewusst offen gelassen: per QR-Code,
 * über einen kleinen Dienst, per Zettel. Diese Datei kennt nur die
 * Beschreibungen, nicht den Weg.
 *
 * ## Warum die Beschreibungen so groß sind
 *
 * Eine Beschreibung enthält nicht nur „hier bin ich“, sondern alle
 * Adressen, unter denen das Gerät erreichbar sein könnte (ICE-Kandidaten).
 * Normalerweise trudeln die nach und nach ein und werden einzeln
 * nachgereicht („Trickle ICE“) – das setzt aber eine stehende Leitung für
 * Nachrichten voraus, die es hier gerade nicht gibt.
 *
 * Deshalb wird gewartet, bis das Sammeln fertig ist, und **eine**
 * vollständige Beschreibung erzeugt. Sie ist dadurch größer, aber sie
 * passt in einen einzigen QR-Code, und danach ist der Weg nicht mehr
 * nötig. `compact()` kürzt sie zusätzlich auf das, was der Gegenseite
 * wirklich nützt.
 *
 * ## Ein Angebot pro Gerät
 *
 * Angebot und Antwort gehören immer zu genau einem Paar. Für vier Handys
 * braucht der Tisch vier Angebote – nacheinander, nicht eines für alle.
 */

/** Kleinster gemeinsamer Nenner: Zuhörer verwalten (wie in transport.js). */
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

/**
 * Ohne STUN-Server kennt ein Gerät nur seine eigenen Adressen im lokalen
 * Netz – für den Küchentisch genau richtig und ganz ohne fremde Dienste.
 * Über Netzgrenzen hinweg braucht es zusätzlich einen STUN-Eintrag.
 */
export const LOCAL_ONLY = { iceServers: [] };

const DEFAULT_TIMEOUT = 20000;

/**
 * Wie lange ein Wackler geduldet wird, bevor ein Gerät als weg gilt.
 *
 * `disconnected` heißt nicht „fort“, sondern „gerade nicht erreichbar“ –
 * das passiert beim Wechsel zwischen WLAN und Mobilfunk oder wenn ein
 * Handy kurz einschläft, und erholt sich oft von selbst. Zu früh
 * aufzugeben würde einen Platz freigeben, der gleich wieder besetzt ist.
 */
const GRACE = 6000;

/**
 * Verlust erkennen.
 *
 * Ein sauber geschlossener Kanal meldet sich selbst (`onclose`). Genau das
 * passiert aber *nicht*, wenn ein Gerät einfach verschwindet: zugeklapptes
 * Notebook, gesperrtes Handy, abgerissenes WLAN. Dann bleibt nur der
 * Verbindungszustand – und darauf muss man horchen, sonst hält der Tisch
 * einen Platz für besetzt, an dem niemand mehr sitzt, und niemand kann ihn
 * übernehmen.
 */
function watchConnection(pc, onLost) {
  let timer = null;
  const clear = () => {
    clearTimeout(timer);
    timer = null;
  };
  pc.addEventListener('connectionstatechange', () => {
    switch (pc.connectionState) {
      case 'failed':
      case 'closed':
        clear();
        onLost();
        break;
      case 'disconnected':
        if (!timer) timer = setTimeout(onLost, GRACE);
        break;
      case 'connected':
        clear(); // hat sich wieder gefangen
        break;
      default:
        break;
    }
  });
  return clear;
}

/**
 * Wartet, bis alle Adressen gesammelt sind – dann ist die Beschreibung
 * vollständig und muss nicht nachgereicht werden.
 *
 * Der Zeitpunkt ist nicht garantiert: Manche Netze liefern ewig weitere
 * Kandidaten nach. Deshalb zusätzlich eine Frist; was bis dahin da ist,
 * reicht für das lokale Netz praktisch immer.
 */
function whenIceGathered(pc, timeout = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeout);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * Beschreibung auf das Nötige kürzen.
 *
 * Der Typ steckt in einem Buchstaben, das SDP bleibt Text. Das spart
 * gegenüber dem rohen Objekt gut ein Drittel – wichtig, wenn das Ganze
 * durch einen QR-Code passen soll.
 */
export function compact(description) {
  return { t: description.type === 'offer' ? 'o' : 'a', s: description.sdp };
}

export function expand(packed) {
  if (!packed || typeof packed.s !== 'string') {
    throw new Error('Das ist keine gültige Verbindungsbeschreibung.');
  }
  return { type: packed.t === 'o' ? 'offer' : 'answer', sdp: packed.s };
}

/** Beschreibung als kompakter Text, wie er in einen QR-Code passt. */
export function encodeSignal(description) {
  const json = JSON.stringify(compact(description));
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeSignal(text) {
  const base64 = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(escape(atob(base64)));
  return expand(JSON.parse(json));
}

// ------------------------------------------------------------- Gastgeber

/**
 * Die Gastgeber-Seite: erzeugt pro Gerät ein Angebot und wartet auf die
 * zugehörige Antwort.
 *
 * Der Gastgeber weiß beim Erzeugen des Angebots noch nicht, *wer* es
 * einlösen wird – er vergibt deshalb eine vorläufige Kennung und lernt den
 * richtigen Namen erst, wenn das Gerät sich meldet.
 */
export class WebRtcHostTransport {
  /**
   * @param {{config?: RTCConfiguration, RTCPeerConnection?: Function}} [options]
   */
  constructor({ config = LOCAL_ONLY, RTCPeerConnection: PC } = {}) {
    this.config = config;
    this.PC = PC ?? globalThis.RTCPeerConnection;
    this.listeners = new Listeners();
    this.peers = new Map(); // deviceId -> { pc, channel }
    this.pending = new Map(); // Einladung, die noch nicht eingelöst ist
    this.seq = 0;
  }

  /**
   * Eine Einladung erzeugen: Angebot als Text, plus die Kennung, unter der
   * das Gerät später auftaucht.
   *
   * @returns {Promise<{id: string, signal: string}>}
   */
  async invite() {
    const id = `gast-${++this.seq}-${Math.random().toString(36).slice(2, 6)}`;
    const pc = new this.PC(this.config);
    // Der Kanal wird vom Gastgeber eröffnet; das Gerät bekommt ihn per
    // Ereignis. So braucht keine Seite zu raten, wer anfängt.
    const channel = pc.createDataChannel('cabo', { ordered: true });
    this._wireChannel(id, channel);
    watchConnection(pc, () => this._lost(id));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await whenIceGathered(pc);

    this.pending.set(id, { pc, channel });
    return { id, signal: encodeSignal(pc.localDescription) };
  }

  /**
   * Die Antwort des Geräts einlösen. Danach baut sich die Verbindung von
   * selbst auf; `onJoin` meldet sich, sobald der Kanal offen ist.
   */
  async accept(id, signalText) {
    const entry = this.pending.get(id);
    if (!entry) throw new Error(`Zu dieser Einladung gibt es nichts: ${id}`);
    await entry.pc.setRemoteDescription(decodeSignal(signalText));
    this.pending.delete(id);
    this.peers.set(id, entry);
    return id;
  }

  /** Ein Gerät ist weg – höchstens einmal melden, egal auf welchem Weg. */
  _lost(id) {
    if (!this.peers.delete(id) && !this.pending.delete(id)) return;
    this.listeners.fire(this.listeners.leave, id);
  }

  _wireChannel(id, channel) {
    channel.onopen = () => this.listeners.fire(this.listeners.join, id);
    channel.onclose = () => this._lost(id);
    channel.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // Unlesbares fällt auf den Boden, statt alles mitzureißen.
      }
      this.listeners.fire(this.listeners.message, { from: id, message });
    };
  }

  send(to, message) {
    const peer = this.peers.get(to);
    if (!peer || peer.channel.readyState !== 'open') return false;
    peer.channel.send(JSON.stringify(message));
    return true;
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
    for (const { pc } of [...this.peers.values(), ...this.pending.values()]) pc.close();
    this.peers.clear();
    this.pending.clear();
  }
}

// ----------------------------------------------------------------- Gerät

/**
 * Die Geräte-Seite: nimmt ein Angebot entgegen und erzeugt die Antwort,
 * die zurück zum Tisch muss.
 */
export class WebRtcDeviceTransport {
  constructor({ config = LOCAL_ONLY, RTCPeerConnection: PC } = {}) {
    this.config = config;
    this.PC = PC ?? globalThis.RTCPeerConnection;
    this.listeners = new Listeners();
    this.pc = null;
    this.channel = null;
    // Löst auf, sobald der Kanal offen ist – und scheitert **nie**. Ein
    // Versprechen, das von selbst scheitert, obwohl es niemand eingelöst
    // hat, hinterlässt sonst eine unbehandelte Ablehnung in der Konsole.
    // Wer eine Frist will, ruft `waitForOpen()`.
    this.ready = new Promise((resolve) => {
      this._markReady = resolve;
    });
  }

  /**
   * Auf die offene Verbindung warten, mit Frist.
   *
   * Bewusst eine eigene Methode: Die Ablehnung entsteht nur, wenn sie auch
   * jemand entgegennimmt.
   */
  waitForOpen(timeout = DEFAULT_TIMEOUT) {
    let timer;
    return Promise.race([
      this.ready.then(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Die Verbindung kam nicht zustande.')), timeout);
      }),
    ]);
  }

  /**
   * Angebot annehmen und die Antwort erzeugen.
   *
   * @param {string} signalText  Text aus dem QR-Code
   * @returns {Promise<string>}  die Antwort, die zurück zum Tisch muss
   */
  async answer(signalText) {
    const pc = new this.PC(this.config);
    this.pc = pc;

    watchConnection(pc, () => this.listeners.fire(this.listeners.leave, 'host'));

    pc.ondatachannel = (event) => {
      this.channel = event.channel;
      this._wireChannel(event.channel);
      const open = () => {
        this._markReady();
        this.listeners.fire(this.listeners.join, 'host');
      };
      if (event.channel.readyState === 'open') open();
      else event.channel.addEventListener('open', open, { once: true });
    };

    await pc.setRemoteDescription(decodeSignal(signalText));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await whenIceGathered(pc);
    return encodeSignal(pc.localDescription);
  }

  _wireChannel(channel) {
    channel.onclose = () => this.listeners.fire(this.listeners.leave, 'host');
    channel.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this.listeners.fire(this.listeners.message, { from: 'host', message });
    };
  }

  /** Das Gerät redet immer nur mit dem Gastgeber – `to` ist Formsache. */
  send(_to, message) {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify(message));
    return true;
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
    this.pc?.close();
    this.pc = null;
    this.channel = null;
  }
}
