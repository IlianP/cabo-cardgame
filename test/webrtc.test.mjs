/**
 * Tests des WebRTC-Transports, soweit sie ohne Browser gehen.
 *
 * `RTCPeerConnection` gibt es in Node nicht. Prüfbar sind hier deshalb die
 * reinen Teile – Kodieren und Dekodieren der Verbindungsbeschreibungen –
 * sowie das Verhalten der Transporte gegenüber einer nachgebauten
 * Verbindung. Der echte Handschlag zwischen zwei Browsern wird gesondert
 * geprüft (siehe README, Abschnitt Tests).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compact,
  expand,
  encodeSignal,
  decodeSignal,
  WebRtcHostTransport,
  WebRtcDeviceTransport,
  LOCAL_ONLY,
} from '../js/webrtc.js';

// Ein SDP, wie es tatsächlich aussieht – lang, mehrzeilig, mit Sonderzeichen.
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 192.168.178.42 54321 typ host',
  'a=ice-ufrag:aBc9',
  'a=ice-pwd:sehrGeheimesPasswort/mitSonderzeichen+',
  'a=fingerprint:sha-256 AB:CD:EF:12:34:56',
  'a=sctp-port:5000',
  '',
].join('\r\n');

// ------------------------------------------------------------ Kodierung

test('Beschreibung überlebt Kodieren und Dekodieren unverändert', () => {
  for (const type of ['offer', 'answer']) {
    const text = encodeSignal({ type, sdp: SDP });
    const back = decodeSignal(text);
    assert.equal(back.type, type);
    assert.equal(back.sdp, SDP);
  }
});

test('Der kodierte Text passt in eine URL und in einen QR-Code', () => {
  const text = encodeSignal({ type: 'offer', sdp: SDP });
  // Kein +, / oder = – sonst müsste beim Anhängen an eine URL nochmal
  // umkodiert werden, und der QR-Code würde unnötig größer.
  assert.equal(/^[A-Za-z0-9_-]+$/.test(text), true, text.slice(0, 40));
  assert.equal(encodeURIComponent(text), text);
  // Ein QR-Code fasst rund 2900 Zeichen; ein echtes SDP bleibt darunter.
  assert.ok(text.length < 2900, `${text.length} Zeichen`);
});

test('compact kürzt spürbar, ohne etwas zu verlieren', () => {
  const full = JSON.stringify({ type: 'offer', sdp: SDP });
  const small = JSON.stringify(compact({ type: 'offer', sdp: SDP }));
  assert.ok(small.length < full.length);
  assert.deepEqual(expand(JSON.parse(small)), { type: 'offer', sdp: SDP });
});

test('Unsinn wird als Unsinn gemeldet, nicht stillschweigend geschluckt', () => {
  assert.throws(() => expand(null), /keine gültige/);
  assert.throws(() => expand({ t: 'o' }), /keine gültige/);
  assert.throws(() => decodeSignal('das ist kein code'), () => true);
});

// ------------------------------------------------- Nachgebaute Verbindung

/**
 * Ein Ersatz für RTCPeerConnection, der nur so viel kann, wie der
 * Transport benutzt: Beschreibungen erzeugen, einen Kanal eröffnen und
 * Nachrichten weiterreichen. Damit lässt sich prüfen, dass der Transport
 * die Schnittstelle aus `transport.js` korrekt bedient – ohne Browser.
 */
function fakePeerConnections() {
  const channels = [];

  class FakeChannel {
    constructor(label) {
      this.label = label;
      this.readyState = 'connecting';
      this.sent = [];
      this.peer = null;
      channels.push(this);
    }
    addEventListener(type, fn, opts) {
      if (type === 'open') this._onopen = fn;
      void opts;
    }
    send(data) {
      this.sent.push(data);
      this.peer?.onmessage?.({ data });
    }
    open() {
      this.readyState = 'open';
      this.onopen?.();
      this._onopen?.();
    }
    close() {
      this.readyState = 'closed';
      this.onclose?.();
    }
  }

  class FakePC {
    constructor(config) {
      this.config = config;
      this.iceGatheringState = 'complete';
      this.localDescription = null;
      this.remoteDescription = null;
      this.closed = false;
    }
    createDataChannel(label) {
      this.channel = new FakeChannel(label);
      return this.channel;
    }
    async createOffer() {
      return { type: 'offer', sdp: SDP };
    }
    async createAnswer() {
      return { type: 'answer', sdp: SDP };
    }
    async setLocalDescription(d) {
      this.localDescription = d;
    }
    async setRemoteDescription(d) {
      this.remoteDescription = d;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.closed = true;
    }
  }

  return { FakePC, channels };
}

test('Der Gastgeber erzeugt pro Einladung ein eigenes Angebot', async () => {
  const { FakePC } = fakePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: FakePC });

  const a = await host.invite();
  const b = await host.invite();

  assert.notEqual(a.id, b.id, 'jede Einladung braucht eine eigene Kennung');
  assert.equal(decodeSignal(a.signal).type, 'offer');
  assert.equal(host.pending.size, 2, 'beide warten auf ihre Antwort');
});

test('Erst mit der Antwort wird aus der Einladung eine Verbindung', async () => {
  const { FakePC } = fakePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: FakePC });
  const { id, signal } = await host.invite();

  assert.equal(decodeSignal(signal).type, 'offer');
  await host.accept(id, encodeSignal({ type: 'answer', sdp: SDP }));

  assert.equal(host.pending.size, 0);
  assert.equal(host.peers.size, 1);
  await assert.rejects(() => host.accept(id, signal), /gibt es nichts/);
});

test('Der Gastgeber meldet Beitritt, Nachricht und Verlust weiter', async () => {
  const { FakePC } = fakePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: FakePC });
  const joined = [];
  const left = [];
  const got = [];
  host.onJoin((id) => joined.push(id));
  host.onLeave((id) => left.push(id));
  host.onMessage((envelope) => got.push(envelope));

  const { id } = await host.invite();
  const channel = host.pending.get(id).channel;
  await host.accept(id, encodeSignal({ type: 'answer', sdp: SDP }));

  channel.open();
  assert.deepEqual(joined, [id]);

  // Solange nichts offen ist, wird nichts verschickt – aber auch nichts geworfen.
  assert.equal(host.send(id, { type: 'view' }), true);
  assert.equal(host.send('wer-auch-immer', { type: 'view' }), false);
  assert.deepEqual(JSON.parse(channel.sent[0]), { type: 'view' });

  channel.onmessage({ data: JSON.stringify({ type: 'join', audience: 0 }) });
  assert.deepEqual(got, [{ from: id, message: { type: 'join', audience: 0 } }]);

  // Kaputte Nachrichten dürfen nicht die ganze Verbindung mitreißen.
  channel.onmessage({ data: 'kein json' });
  assert.equal(got.length, 1);

  channel.close();
  assert.deepEqual(left, [id]);
  assert.equal(host.peers.size, 0);
});

test('Das Gerät erzeugt aus dem Angebot eine Antwort', async () => {
  const { FakePC } = fakePeerConnections();
  const device = new WebRtcDeviceTransport({ RTCPeerConnection: FakePC });

  const answer = await device.answer(encodeSignal({ type: 'offer', sdp: SDP }));
  assert.equal(decodeSignal(answer).type, 'answer');
  assert.equal(device.pc.remoteDescription.type, 'offer');
});

test('Ohne offenen Kanal verschickt das Gerät nichts', async () => {
  const { FakePC } = fakePeerConnections();
  const device = new WebRtcDeviceTransport({ RTCPeerConnection: FakePC });
  await device.answer(encodeSignal({ type: 'offer', sdp: SDP }));
  assert.equal(device.send('host', { type: 'join' }), false);
});

test('Ohne STUN-Eintrag bleibt alles im lokalen Netz', () => {
  assert.deepEqual(LOCAL_ONLY.iceServers, []);
  const { FakePC } = fakePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: FakePC });
  assert.deepEqual(host.config, LOCAL_ONLY);
});

test('waitForOpen löst auf, sobald der Kanal steht', async () => {
  const { FakePC } = fakePeerConnections();
  const device = new WebRtcDeviceTransport({ RTCPeerConnection: FakePC });
  await device.answer(encodeSignal({ type: 'offer', sdp: SDP }));

  // Der Gastgeber eröffnet den Kanal – hier von Hand nachgestellt.
  const sent = [];
  const channel = {
    readyState: 'connecting',
    send: (data) => sent.push(data),
    addEventListener: (type, fn) => type === 'open' && (channel._open = fn),
  };
  const joined = [];
  device.onJoin((who) => joined.push(who));
  device.pc.ondatachannel({ channel });

  channel.readyState = 'open';
  channel._open();

  await device.waitForOpen(500);
  assert.deepEqual(joined, ['host'], 'auch das Gerät meldet die offene Verbindung');
  assert.equal(device.send('host', { type: 'join', audience: 0 }), true);
  assert.deepEqual(JSON.parse(sent[0]), { type: 'join', audience: 0 });
});

test('waitForOpen scheitert mit Frist, aber nur wenn jemand fragt', async () => {
  const { FakePC } = fakePeerConnections();
  const device = new WebRtcDeviceTransport({ RTCPeerConnection: FakePC });
  await device.answer(encodeSignal({ type: 'offer', sdp: SDP }));
  await assert.rejects(() => device.waitForOpen(60), /kam nicht zustande/);
});

// ------------------------------------------------- Verbindung verlieren

/** Ein FakePC, der Zustandswechsel der Verbindung nachstellen kann. */
function watchablePeerConnections() {
  const { FakePC } = fakePeerConnections();
  class WatchablePC extends FakePC {
    constructor(config) {
      super(config);
      this.connectionState = 'new';
      this._watchers = [];
    }
    addEventListener(type, fn) {
      if (type === 'connectionstatechange') this._watchers.push(fn);
    }
    setState(state) {
      this.connectionState = state;
      for (const fn of this._watchers) fn();
    }
  }
  return WatchablePC;
}

test('Ein abrupt verschwundenes Gerät gilt als weg', async () => {
  const PC = watchablePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: PC });
  const left = [];
  host.onLeave((id) => left.push(id));

  const { id } = await host.invite();
  const pc = host.pending.get(id).pc;
  await host.accept(id, encodeSignal({ type: 'answer', sdp: SDP }));

  // Kein sauberes Schließen – die Leitung fällt einfach aus.
  pc.setState('failed');
  assert.deepEqual(left, [id], 'ohne das hielte der Tisch den Platz für besetzt');
  assert.equal(host.peers.size, 0);
});

test('Ein Wackler wird geduldet, ein anhaltender Ausfall nicht', async () => {
  const PC = watchablePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: PC });
  const left = [];
  host.onLeave((id) => left.push(id));

  const { id } = await host.invite();
  const pc = host.pending.get(id).pc;
  await host.accept(id, encodeSignal({ type: 'answer', sdp: SDP }));

  pc.setState('disconnected');
  assert.deepEqual(left, [], 'kurz weg ist noch nicht fort');
  pc.setState('connected');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(left, [], 'hat sich wieder gefangen');

  pc.setState('failed');
  assert.deepEqual(left, [id]);
});

test('Ein Verlust wird nur einmal gemeldet', async () => {
  const PC = watchablePeerConnections();
  const host = new WebRtcHostTransport({ RTCPeerConnection: PC });
  const left = [];
  host.onLeave((id) => left.push(id));

  const { id } = await host.invite();
  const { pc, channel } = host.pending.get(id);
  await host.accept(id, encodeSignal({ type: 'answer', sdp: SDP }));

  // Beide Wege melden dasselbe Ereignis – der Tisch darf es nicht doppelt sehen.
  channel.close();
  pc.setState('failed');
  assert.deepEqual(left, [id]);
});
