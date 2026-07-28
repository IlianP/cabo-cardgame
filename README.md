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
js/art.js               Zuordnung Kartenwert -> Bilddatei
js/debug.js             Debug-Zustand als kopierbarer Text
js/ui.js                Zeichnen des Spieltisches, Eingaben
js/app.js               Einrichtung, Einstellungen, Speichern, Start
art/00–13.webp          die Kartenbilder
sw.js                   Service Worker für den Offline-Betrieb
tools/art-prompts.json  Modell, Parameter und Prompts der Bildgenerierung
tools/generate-art.mjs  erzeugt und rechnet die Kartenbilder um
tools/make-icons.py     erzeugt die App-Icons (nur Standardbibliothek)
test/engine.test.mjs    Tests der Spiellogik
test/debug.test.mjs     Tests von Ereignis-Verlauf und Debug-Bericht
test/view.test.mjs      Tests der Sichten-Filterung
```

Die Trennung ist bewusst scharf: `engine.js` enthält keine einzige DOM-Zeile, und die
Oberfläche entscheidet nie selbst, was aufgedeckt werden darf – das gibt immer die Engine
über die Phase `reveal` vor. Der Spielzustand ist reines JSON und lässt sich damit
speichern, laden und in Tests bequem vorbereiten.

## Tests

```bash
npm test
```

62 Tests decken Deckaufbau, Kartenkräfte, Mehrfach-Ablage mit richtiger und falscher Ansage,
Nachmischen bei leerem Stapel, die Abrechnung inklusive Strafpunkten und Gleichstand,
Shoot the Moon, Punktlandung, Startspielerwechsel, Spielende und das Speichern ab –
dazu den Ereignis-Verlauf, den Debug-Bericht und die Sichten-Filterung.

## Mehrgeräte-Modus (in Arbeit)

Geplant ist: das Tablet liegt fest in der Mitte und zeigt nur den öffentlichen Tisch, jeder
Spieler öffnet zusätzlich auf dem eigenen Handy eine Seite mit seiner Hand (Issue #1). Der
erste Baustein steht: **`js/view.js` schneidet den Spielzustand auf ein einzelnes Gerät zu.**

```js
import { tableView, playerView } from './js/view.js';

tableView(game.state);        // Stapel, Ablage, Punkte, Verlauf – keine Hand
playerView(game.state, 2);    // dazu das, was genau dieser Spieler sehen darf
```

Beide Funktionen sind rein (Zustand rein, JSON raus) und lassen erst gar nicht weg, was
geheim ist – statt es später zu verstecken:

- **Karten-IDs verraten ihren Wert** (`v7-1` ist immer eine 7). Deshalb wird pro Sicht
  gesammelt, welche Karten der Zuschauer sehen darf; nur diese landen im Feld `cards`,
  alle übrigen Plätze sind bloß „hier liegt eine Karte“.
- **PINs verlassen den Gastgeber nie** – weitergegeben wird nur `hasPin`.
- **Der Verlauf wird neu geschrieben**, nicht gesäubert: Der Engine-Verlauf notiert Karten
  im Klartext, die öffentliche Fassung entsteht aus den Ereignisdaten, Ereignisart für
  Ereignisart. Unbekannte Ereignisarten fallen heraus statt durchzurutschen.
- **Offengelegt bleibt nicht ewig offen.** Beim Nachmischen wandert die Ablage zurück in den
  verdeckten Stapel, und eine vorher offen abgeworfene Karte kann danach verdeckt in einer
  Hand liegen. Ab dem Nachmischen (und ab jeder neuen Runde) nennt der Verlauf deshalb nur
  noch den Wert und gibt die Karten-ID nicht mehr frei.
- **Aufdeckungen folgen dem Feld `viewer`**: private nur an ihr Gerät, öffentliche
  (Mehrfach-Ablage, Rundenende) an alle.
- **Ohne Merkhilfe bleibt auch die eigene Hand verdeckt** – das Vergessen der eigenen Karten
  ist der Kern von Cabo und soll nicht am Handy scheitern.

Die Tests prüfen das nicht feldweise, sondern über eine Umkehrung: Sie leiten aus dem
Zustand her, welche Karten gerade verdeckt in einer Hand liegen und für den jeweiligen
Zuschauer tabu sind, und suchen dann in der fertigen Sicht nach genau diesen IDs – egal, in
welchem Feld sie stecken. Dieser Maßstab ist unabhängig von `view.js` formuliert, sonst
prüfte der Test nur sich selbst.

Was noch fehlt: der Transport zwischen den Geräten (WebRTC mit dem Tablet als Gastgeber),
die Zuordnung Gerät → Spieler, Wiederverbinden nach Bildschirmsperre und die Rückfallebene
in den Ein-Gerät-Modus. Der Ein-Gerät-Modus benutzt `view.js` nicht und bleibt unverändert.

## Was noch fehlen könnte

- **Mehrgeräte-Modus**: Transport und Beitritt – siehe Issue #1.
- **Computergegner** für Partien zu zweit.
- **Statistik** über mehrere Abende.
