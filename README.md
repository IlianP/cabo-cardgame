# Cabo

Das Kartenspiel **Cabo** für den Wohnzimmertisch: ein Tablet liegt in der Mitte, wird
reihum weitergegeben, und niemand sieht die Karten der anderen.

Umgesetzt als **Progressive Web App** – reines HTML, CSS und JavaScript, kein Build-Schritt,
keine Abhängigkeiten. Die App läuft im Browser, lässt sich auf dem Startbildschirm ablegen
und funktioniert danach offline.

Gespielt wird nach den Verlagsregeln von Cabo (Smiling Monster Games / Bezier Games,
Mandy Henning und Melissa Limes) mit dem Original-Deck von 0 bis 13.

---

## Warum eine PWA und keine Android-App?

| | PWA | natives Android |
|---|---|---|
| Installieren | „Zum Startbildschirm hinzufügen“, eigenes Icon, Vollbild | Play Store oder APK von Hand |
| Offline | ja (Service Worker) | ja |
| Update | einmal pushen | neues Paket bauen, signieren, verteilen |
| Aufwand | eine Codebasis | zusätzliche Toolchain |

Für ein Spiel, das nur Tippen und Zeichnen braucht, ist die PWA die deutlich einfachere
Variante – auf dem Tablet ist der Unterschied zu einer installierten App nicht zu sehen.
Falls später doch eine `.apk` gewünscht ist: derselbe Code lässt sich mit
[Capacitor](https://capacitorjs.com/) oder als Trusted Web Activity einpacken, ohne dass
etwas neu geschrieben werden muss.

## Sichtschutz – vier Ebenen

Das Kernproblem beim Spiel auf einem Gerät: Karten, die nur einer sehen darf. Die App löst
das so, dass geheime Informationen nie länger als nötig auf dem Bildschirm stehen.

1. **Übergabe-Sperrbildschirm.** Zwischen zwei Zügen liegt ein Vollbild-Overlay
   („Gerät weitergeben an Bea“). Solange es offen ist, ist vom Tisch nichts zu sehen –
   das Tablet kann gefahrlos herumgereicht werden.
2. **Halten statt Tippen.** Eine geheime Karte ist nur sichtbar, *solange* ein Finger auf
   ihr liegt. Loslassen, wegrutschen oder die App wechseln versteckt sie sofort.
   Zusätzlich läuft ein Timer mit (Voreinstellung 5 Sekunden), sichtbar als Ring an der Karte.
3. **PIN pro Spieler** (optional). Vierstellig, auf dem Übergabe-Bildschirm. Verhindert,
   dass jemand fremde Züge startet.
4. **Nichts liegt offen herum.** Alle Hände bleiben grundsätzlich verdeckt – aufgedeckt wird
   nur über legitime Spielzüge. Auch die frisch gezogene Karte muss man halten, um sie zu
   sehen. Die optionale **Merkhilfe** markiert Karten, die du schon gesehen hast, mit einem
   Punkt; der Wert erscheint erst beim Gedrückthalten.

Was die App absichtlich *nicht* tut: dir deine eigenen Karten dauerhaft zeigen. Das
Vergessen der eigenen Hand ist der Kern von Cabo.

## Aufs Tablet bekommen

### Variante A – über GitHub Pages (empfohlen)

1. Im Repository: **Settings → Pages → Source: „Deploy from a branch“**, Branch `main`,
   Ordner `/ (root)`, speichern.
2. Nach ein bis zwei Minuten ist das Spiel unter
   `https://<benutzername>.github.io/cabo-cardgame/` erreichbar.
3. Auf dem Tablet aufrufen, im Browser-Menü **„App installieren“** bzw.
   **„Zum Startbildschirm hinzufügen“** wählen.

Danach startet Cabo im Vollbild ohne Browserleiste und läuft auch ohne Netz.

### Variante B – lokal ausprobieren

Die App nutzt ES-Module und einen Service Worker, beides funktioniert nicht über
`file://`. Also einen kleinen Server starten:

```bash
npm start          # oder: python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen.

## Gespielte Regeln

**Das Deck.** 52 Karten mit den Werten 0 bis 13, die Zahl ist der Punktwert. Die 0 und die 13
liegen je zweimal im Deck, alle Werte von 1 bis 12 je viermal. Die 0 ist die beste Karte.

**Aufbau.** Jeder bekommt vier verdeckte Karten und darf sich zwei davon ansehen.

**Ein Zug** besteht aus genau einer dieser Möglichkeiten:

- vom verdeckten Stapel ziehen – dann tauschen, mehrfach ablegen, oder abwerfen und die
  Kartenkraft nutzen,
- die oberste Ablagekarte nehmen und gegen eine eigene tauschen (keine Kartenkraft),
- **Cabo** rufen.

**Mehrfach-Ablage.** Statt einer einzelnen Karte darf man beim Ziehen auch mehrere eigene
Karten *gleichen Wertes* gemeinsam abwerfen: ansagen, aufdecken, und danach mit weniger
Karten weiterspielen – die gezogene Karte kommt auf einen der frei gewordenen Plätze.
Stimmen die Werte nicht überein, wird alles wieder verdeckt und der Zug ist verloren.

**Kartenkräfte** (nur beim Abwerfen einer frisch gezogenen Karte):

| Karte | Kraft |
|---|---|
| 7, 8 | **Peek** – eigene Karte ansehen |
| 9, 10 | **Spy** – fremde Karte ansehen |
| 11, 12 | **Swap** – blind eine eigene gegen eine fremde Karte tauschen |
| 13 | keine |

**Wertung.** Nach dem Cabo-Ruf hat jeder andere noch genau einen Zug, dann wird aufgedeckt.

- Die **niedrigste Summe bekommt 0 Punkte** – auch ohne Cabo-Ruf.
- Wer Cabo gerufen hat und nicht am niedrigsten liegt, notiert seine Summe **plus 5 Strafpunkte**.
- Alle übrigen bekommen ihre Kartensumme.
- Bei Gleichstand um die niedrigste Summe gewinnt der Cabo-Sager; ohne Cabo-Sager bekommen
  alle Beteiligten 0 Punkte.
- Zwei Zwölfen und beide Dreizehnen auf der Hand: 0 Punkte für dich, 50 für alle anderen.
- Wer genau auf 100 landet, fällt auf 50 zurück – einmal pro Spieler.

Sobald jemand über 100 Punkte liegt, endet das Spiel. Gewonnen hat, wer am wenigsten hat.

### Umschaltbare Regeln

Im Einrichtungsbildschirm wählbar: Mehrfach-Ablage, Shoot the Moon, „Gewinner der Vorrunde
beginnt“, Strafpunkte 5 oder 10, Zielpunktzahl 50/100/200, Punktlandung, sowie alle
Sichtschutz-Einstellungen. 2 bis 6 Spieler.

## Debug-Zustand 🪲

Im Spiel liegt oben links ein kleiner Käfer – nur das Emoji, ohne Beschriftung, und er
verschiebt nichts außer dem Menü-Knopf daneben. Ein Tipp darauf legt den kompletten
Zustand in die Zwischenablage:

- Runde, Phase (samt offenem Detail wie „gewählte Plätze“ oder „Swap, Schritt target“),
  Spieler am Zug und wer gerade auf den Bildschirm sehen darf,
- alle Hände mit Platznummer, Karten-ID, Wert und Summe, dazu welche Plätze der Spieler kennt,
- Nachziehstapel und komplette Ablage von unten nach oben,
- die letzten 40 Ereignisse mit laufender Nummer: **wer** hat **welche Karte** **wie**
  bewegt (`draw`, `swapDrawn`, `multiSelect`, `multiClaim`, `multiResolve`, `powerSwap`, …),
- die geltenden Regeln und zum Schluss der Rohzustand als JSON, aus dem sich die Lage
  exakt nachstellen lässt.

Der Verlauf steht im Spielzustand selbst, überlebt also Speichern, Laden und einen
Neustart der App. Der Käfer liegt über allen Overlays und ist deshalb auch auf dem
Übergabe- und dem Aufdeck-Bildschirm erreichbar.

Der Text landet direkt in der Zwischenablage und wird **nicht** angezeigt – er enthält
alle Karten im Klartext, und am Tisch soll niemand mitlesen. Nur wenn das Kopieren
scheitert (Browser ohne Clipboard-API), erscheint er zum Markieren in einem Dialog.

Der Knopf ist ab Werk an und lässt sich unter **Regeln & Einstellungen → Fehlersuche**
sowie im Menü der laufenden Partie abschalten.

Der Spielstand wird laufend im Browser gesichert; nach einem versehentlichen Schließen lässt
sich die Partie fortsetzen.

## Kartenbilder

Jeder Wert hat ein eigenes Motiv, von harmlos nach unangenehm – das unterstützt die
Spiellogik, dass niedrig gut ist:

| 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Einhorn | Glühwürmchen | Schmetterlinge | Frösche | Vögel | Füchse | Mäuse |

| 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|
| Eulen | Schlangen | Katzen | Raben | Kobolde | Drachen | Höllenhund |

Zahl und Kraftname liegen als Overlay über dem Bild, nicht im Bild: die Zahl steht wie bei
einer Spielkarte zweimal über Eck, der Kraftname als Band auf halber Höhe. So bleibt die
Zahl in jeder Größe scharf und lässt sich ändern, ohne ein Bild neu zu erzeugen.

Die **Rückseite ist absichtlich kein Bild**, sondern ein in `css/style.css` gezeichnetes
Schuppenmuster aus zwei versetzten Lagen halber Kreise. Das bleibt verlustfrei in jeder
Größe und spart eine Datei, die sonst auf jeder verdeckten Karte geladen würde.

Alle 14 Bilder zusammen wiegen rund 560 kB.

### Bilder neu erzeugen

Erzeugt wurden sie mit **Nano Banana 2** über [fal.ai](https://fal.ai). Modell, Parameter und
sämtliche Prompts stehen versioniert in [`tools/art-prompts.json`](tools/art-prompts.json) –
dort wird geändert, nicht im Skript.

```bash
export FAL_KEY=…                          # niemals ins Repository
node tools/generate-art.mjs               # alle fehlenden Werte
node tools/generate-art.mjs 3 7 --force   # nur diese, auch wenn sie existieren
node tools/generate-art.mjs --convert-only  # nur neu umrechnen, ohne API-Kosten
```

Die Originale (rund 5 MB je Bild) bleiben in `tools/.art-cache/` liegen und sind von der
Versionierung ausgenommen. Ein späterer Lauf mit `--convert-only` rechnet daraus andere
Größen oder Qualitäten, ohne noch einmal zu bezahlen. Zum Umrechnen nach WebP nimmt das
Skript, was es findet: `cwebp`, ImageMagick oder ersatzweise Chromium über Playwright.

Zwei Dinge sind für das Ergebnis entscheidend und stehen deshalb so in der Prompt-Datei:

- Der **Stilblock liegt im `system_prompt`**, nicht in den einzelnen Prompts. Nur so sehen
  alle 14 Karten aus wie von derselben Hand. Ein Versuch mit dem Stil im Motiv-Prompt
  lieferte 14 Bilder in 14 Stilen.
- Bilder werden **ohne Text, ohne Zahlen und ohne Rahmen** angefordert. „playing card“ im
  Prompt zu erwähnen ist ein Fehler – dann malt das Modell einen Kartenrahmen mit ins Bild.

Neue Werte trägt man in `js/art.js` ein. Fehlt dort ein Eintrag, zeichnet die Oberfläche die
Karte wie zuvor selbst – ein gemischter Zustand ist also unproblematisch.

## Aufbau des Codes

```
index.html              Gerüst aller Bildschirme und Overlays
css/style.css           Gestaltung, Kartenrückseite, Quer- und Hochformat
js/deck.js              Kartendeck, Werte, Kartenkräfte, Mischen
js/rules.js             Voreinstellungen und Beschreibung aller Regelschalter
js/engine.js            Spiellogik und Zustandsmaschine – kennt keine Oberfläche
js/privacy.js           Sichtschutz: Halten zum Ansehen, Timer-Ring
js/view.js              Sichten: was ein einzelnes Gerät erfahren darf
js/host.js              Gastgeber: prüft Züge, verteilt Sichten
js/client.js            Gerät: hält seine Sicht, schickt Absichten
js/transport.js         wie Nachrichten reisen (Speicher, BroadcastChannel)
js/webrtc.js            direkte Verbindung zwischen zwei Geräten
js/multi.js             Oberfläche für Tisch und Hand
js/art.js               Zuordnung Kartenwert -> Bilddatei
js/debug.js             Debug-Zustand als kopierbarer Text
js/scenes.js            Choreografie: welcher Zug wird wie zur Bewegung
js/seating.js           Sitzordnung: in welcher Richtung sitzt wer am Tisch
js/flight.js            Flugebene: spielt die Bewegungen ab
js/ui.js                Zeichnen des Spieltisches, Eingaben
js/app.js               Einrichtung, Einstellungen, Speichern, Start
art/00–13.webp          die Kartenbilder
sw.js                   Service Worker für den Offline-Betrieb
tools/art-prompts.json  Modell, Parameter und Prompts der Bildgenerierung
tools/generate-art.mjs  erzeugt und rechnet die Kartenbilder um
tools/make-icons.py     erzeugt die App-Icons (nur Standardbibliothek)
tools/rtc-check.mjs     echter WebRTC-Handschlag zwischen zwei Browser-Seiten
test/engine.test.mjs    Tests der Spiellogik
test/debug.test.mjs     Tests von Ereignis-Verlauf und Debug-Bericht
test/view.test.mjs      Tests der Sichten-Filterung
test/host.test.mjs      Tests des Mehrgeräte-Modus
test/webrtc.test.mjs    Tests des WebRTC-Transports (ohne Browser)
test/scenes.test.mjs    Tests der Choreografie und der Sitzordnung
multi.html              Einstieg in den Mehrgeräte-Modus
```

Die Trennung ist bewusst scharf: `engine.js` enthält keine einzige DOM-Zeile, und die
Oberfläche entscheidet nie selbst, was aufgedeckt werden darf – das gibt immer die Engine
über die Phase `reveal` vor. Der Spielzustand ist reines JSON und lässt sich damit
speichern, laden und in Tests bequem vorbereiten.

Dieselbe Trennung gilt für die Animationen: `scenes.js` übersetzt einen Verlaufseintrag
in Flugbahnen und ist rein – Eintrag rein, Beschreibung raus, kein DOM. `flight.js` spielt
diese Beschreibungen ab und kennt umgekehrt keine Spielregeln. Dadurch lässt sich die eine
Frage, auf die es beim Sichtschutz ankommt, tatsächlich prüfen: Eine fliegende Karte wird
immer so gezeigt, wie sie an ihrem *Ausgangsort* lag. Was aus einer Hand kommt, fliegt
verdeckt und liegt erst beim Aufsetzen offen da – eine Animation kann damit nie etwas
früher verraten als das Spiel selbst.

## Tests

```bash
npm test
```

118 Tests decken Deckaufbau, Kartenkräfte, Mehrfach-Ablage mit richtiger und falscher Ansage,
Nachmischen bei leerem Stapel, die Abrechnung inklusive Strafpunkten und Gleichstand,
Shoot the Moon, Punktlandung, Startspielerwechsel, Spielende und das Speichern ab –
dazu den Ereignis-Verlauf, den Debug-Bericht, die Sichten-Filterung und den
Mehrgeräte-Modus (Beitreten, Wiederverbinden, doppelte und veraltete Nachrichten), den
WebRTC-Transport sowie die Choreografie der Animationen samt der Prüfung, dass keine
Animation eine verdeckte Karte verrät.

`RTCPeerConnection` gibt es in Node nicht – der echte Handschlag zwischen zwei Browsern
läuft deshalb als eigenes Werkzeug, das einen Browser braucht und darum nicht in `npm test`
hängt:

```bash
npx playwright@latest install chromium   # einmalig
node tools/rtc-check.mjs
```

## Mehrgeräte-Modus – Stand der Dinge

Das Ziel aus Issue #1: Das Tablet liegt fest in der Mitte und zeigt den **Tisch**, jeder
öffnet zusätzlich auf dem eigenen Handy eine **Hand**.

> **Heute funktioniert das nur zwischen Fenstern desselben Browsers auf demselben Gerät.**
> Ein zweites Gerät im selben WLAN kann sich noch nicht verbinden – dafür fehlt der
> Transport (siehe unten). Am Wohnzimmertisch spielst du bis dahin im Ein-Gerät-Modus.

Was schon steht, ist alles außer der Verbindung: die Aufteilung in Tisch und Hand, die
Filterung der Sichten, der Gastgeber mit Regelprüfung, Beitreten und Wiederverbinden. Zum
Ausprobieren: `multi.html`, Tisch in einem Tab, jede Hand in einem weiteren. Beide Modi
bestehen nebeneinander; der Ein-Gerät-Modus bleibt unverändert.

### Wie es aufgebaut ist

```
   Handy (Hand)  ─┐
   Handy (Hand)  ─┼─ Transport ─→ Gastgeber ─→ Engine
   Tablet (Tisch) ┘                   │
                                      └─ pro Gerät eine eigene Sicht zurück
```

Ein Gerät hält die Partie. Alle anderen schicken **Absichten** („ich möchte ziehen“), nie
fertige Zustände, und bekommen eine beschnittene Sicht zurück. Vier Schichten, jede mit
genau einer Aufgabe:

| Datei | Aufgabe |
|---|---|
| `js/engine.js` | die Regeln – kennt weder Oberfläche noch Netz |
| `js/view.js` | was ein einzelnes Gerät erfahren darf |
| `js/host.js` | nimmt Züge an, prüft sie, verteilt die Sichten |
| `js/client.js` | hält die eigene Sicht, schickt Absichten |
| `js/transport.js` | wie Nachrichten reisen – austauschbar |

### Was daran wichtig ist

**Sichtschutz ist keine Frage der Bedienung mehr.** Ein Handy *kann* fremde Karten nicht
anzeigen, weil es sie nie bekommen hat. Karten-IDs verraten schon in der ID ihren Wert
(`v7-1` ist immer eine 7), es reicht also nicht, Werte wegzulassen – die Sicht sammelt pro
Gerät, welche Karten es sehen darf, und nur die gehen über die Leitung. PINs verlassen den
Gastgeber nie, weitergegeben wird nur `hasPin`.

**Der Gastgeber glaubt keinem Gerät.** Dass ein Handy nur erlaubte Knöpfe zeigt, ist
Bequemlichkeit; entschieden wird jede Nachricht noch einmal gegen `legalActions`. Ein Gerät,
das einen fremden Platz als Argument mitschickt, bekommt eine Absage.

**Doppelte Nachrichten sind der Normalfall, kein Fehler.** Jede Aktion trägt die Version des
Zustands, auf den sie sich bezieht. Passt sie nicht mehr, wird sie *geschluckt* und das Gerät
bekommt den aktuellen Stand – ohne Meldung. Zweimal getippt, unterwegs verdoppelt, zu spät
angekommen: über eine wackelige Verbindung passiert das ständig, und ein
Regelverstoß-Hinweis wäre dort schlicht gelogen. Deshalb dürfen bei einer öffentlichen
Aufdeckung auch **alle** auf „weiter“ tippen, statt dass einer suchen muss, wer dran ist.

**Wiederverbinden verliert nichts.** Ein Platz gehört immer genau einem Gerät; meldet sich
ein neues für denselben Platz, übernimmt es und bekommt den vollen Stand. Tab neu geladen,
Handy gesperrt, Akku leer und am Ersatzgerät weiter – die Partie läuft unbeeindruckt weiter.

**Der Tisch spielt nicht mit.** Er hat keine Hand und kann nicht ziehen. Gemeinsame Schritte
darf er auslösen – „weiter“ nach einer *öffentlichen* Aufdeckung und die nächste Runde –,
eine private Aufdeckung dagegen nicht: die sieht er gar nicht, und wegtippen würde jemandem
den Blick nehmen. Auch der Tisch zeichnet übrigens aus einer beschnittenen Sicht und greift
nie in den Spielzustand.

### Verbindung zwischen echten Geräten

`js/webrtc.js` verbindet zwei Browser direkt miteinander – ohne Vermittler, ohne Internet,
auch im reinen WLAN. Nachgewiesen mit `node tools/rtc-check.mjs`: zwei getrennte
Browser-Kontexte, echte `RTCPeerConnection`, eine Runde Cabo darüber.

Was dabei **noch fehlt, ist der Handschlag**. Bevor eine Verbindung steht, müssen beide
Seiten einmal eine Beschreibung austauschen:

```
   Tisch  ──── Angebot ────>  Handy
   Tisch  <──── Antwort ────  Handy
```

Danach braucht es den Weg nie wieder. Nur diese zwei Nachrichten müssen hinüber, und dafür
gibt es drei Wege – alle hinter derselben Schnittstelle:

| Weg | Was er kostet |
|---|---|
| **QR-Code** | Ganz ohne Dienst: Tisch zeigt einen Code, Handy scannt und zeigt einen zurück, Tisch scannt mit der Kamera. Zwei Scans pro Gerät. Die Beschreibungen sind ~850 Zeichen, ein QR-Code fasst ~2900 – es passt. |
| **Kleiner Signalisierungs-Dienst** | Ein Dienst nimmt Angebot und Antwort entgegen. Dann reicht **ein** Scan: Der QR-Code öffnet die Seite und die Verbindung stellt sich von selbst her. Der Dienst wird nur für den Handschlag gebraucht. |
| **Server im eigenen WLAN** | Ein Rechner im Haus liefert Seite und Verbindung. Nichts verlässt das Netz, aber der Rechner muss laufen und jeder tippt eine IP-Adresse ein. |

An Engine, Sichten, Gastgeber und Geräten ändert keiner dieser Wege eine Zeile.

**Ohne gemeinsames WLAN** hilft der einfachste Trick: Ein Gerät macht einen Hotspot auf, die
anderen gehen dort hinein. Dann sind alle in einem Netz und WebRTC verbindet sie direkt.
Bluetooth geht nicht – ein Browser kann sich darüber nur *mit* einem Gerät verbinden, aber
sich nicht selbst anbieten; zwei Browser finden sich so nie.

Die Mehrgeräte-Oberfläche ist bewusst schlicht: Sie zeigt, dass die Aufteilung trägt, und
ersetzt noch nicht die ausgearbeitete Oberfläche des Ein-Gerät-Modus.

## Was noch fehlen könnte

- **Verbindung zwischen echten Geräten** – siehe Issue #1.
- **Einwerfen (Snap)**: eigene Spielregel, im Mehrgeräte-Modus besonders reizvoll.
- **Computergegner** für Partien zu zweit.
- **Statistik** über mehrere Abende.
