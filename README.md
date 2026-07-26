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

Der Spielstand wird laufend im Browser gesichert; nach einem versehentlichen Schließen lässt
sich die Partie fortsetzen.

## Kartenbilder

Ohne Illustrationen zeichnet die Oberfläche die Karten selbst: große Zahl, Farbe nach Wert
(niedrig grün, hoch rot) und bei 7 bis 12 der Name der Kartenkraft. Das ist als Dauerlösung
brauchbar und als Platzhalter gedacht.

Sobald Bilder vorliegen, genügt es, sie unter `art/` abzulegen und in `js/art.js`
einzutragen:

```js
export const CARD_ART = { 0: 'art/00.webp', 1: 'art/01.webp', /* … */ };
export const CARD_BACK = 'art/back.webp';
```

Erwartet werden Hochformat-Bilder im Verhältnis etwa 3:4, **ohne Zahl und ohne Rahmen** –
beides legt die Oberfläche darüber, damit die Zahl scharf bleibt und jederzeit änderbar ist.
Nicht eingetragene Werte werden weiterhin gezeichnet, ein gemischter Zustand ist also
unproblematisch.

## Aufbau des Codes

```
index.html              Gerüst aller Bildschirme und Overlays
css/style.css           Gestaltung, Quer- und Hochformat
js/deck.js              Kartendeck, Werte, Kartenkräfte, Mischen
js/rules.js             Voreinstellungen und Beschreibung aller Regelschalter
js/engine.js            Spiellogik und Zustandsmaschine – kennt keine Oberfläche
js/privacy.js           Sichtschutz: Halten zum Ansehen, Timer-Ring
js/art.js               optionale Kartenbilder
js/ui.js                Zeichnen des Spieltisches, Eingaben
js/app.js               Einrichtung, Einstellungen, Speichern, Start
sw.js                   Service Worker für den Offline-Betrieb
tools/make-icons.py     erzeugt die App-Icons (nur Standardbibliothek)
test/engine.test.mjs    Tests der Spiellogik
```

Die Trennung ist bewusst scharf: `engine.js` enthält keine einzige DOM-Zeile, und die
Oberfläche entscheidet nie selbst, was aufgedeckt werden darf – das gibt immer die Engine
über die Phase `reveal` vor. Der Spielzustand ist reines JSON und lässt sich damit
speichern, laden und in Tests bequem vorbereiten.

## Tests

```bash
npm test
```

30 Tests decken Deckaufbau, Kartenkräfte, Mehrfach-Ablage mit richtiger und falscher Ansage,
Nachmischen bei leerem Stapel, die Abrechnung inklusive Strafpunkten und Gleichstand,
Shoot the Moon, Punktlandung, Startspielerwechsel, Spielende und das Speichern ab.

## Was noch fehlen könnte

- **Illustrationen** für die Werte 0 bis 13 und die Rückseite (siehe oben).
- **Mehrgeräte-Modus**: Tablet als Tisch, jedes Handy als eigene Hand – siehe Issue #1.
- **Computergegner** für Partien zu zweit.
- **Statistik** über mehrere Abende.
