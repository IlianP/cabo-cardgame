# Cabo

Das Kartenspiel **Cabo** für den Wohnzimmertisch: ein Tablet liegt in der Mitte, wird
reihum weitergegeben, und niemand sieht die Karten der anderen.

Umgesetzt als **Progressive Web App** – reines HTML, CSS und JavaScript, kein Build-Schritt,
keine Abhängigkeiten. Die App läuft im Browser, lässt sich auf dem Startbildschirm ablegen
und funktioniert danach offline.

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

Ein normales Blatt mit 52 Karten plus zwei Jokern bildet das Cabo-Deck (0 bis 13) nach:

| Karte | Wert |
|---|---|
| Joker | 0 |
| Ass | 1 |
| 2 – 10 | Kartenwert |
| Bube | 11 |
| Dame | 12 |
| schwarzer König | 13 |
| **roter König** | **−1** |

**Aufbau.** Jeder bekommt vier verdeckte Karten und darf sich zwei davon ansehen.

**Ein Zug** besteht aus genau einer dieser Möglichkeiten:

- vom verdeckten Stapel ziehen – dann tauschen oder abwerfen (Kartenkraft nutzen),
- die oberste Ablagekarte nehmen und gegen eine eigene tauschen (keine Kartenkraft),
- **Cabo** rufen.

**Kartenkräfte** (nur beim Abwerfen einer frisch gezogenen Karte):

| Karte | Kraft |
|---|---|
| 7, 8 | eigene Karte ansehen |
| 9, 10 | fremde Karte ansehen |
| Bube, Dame | blind eine eigene gegen eine fremde Karte tauschen |
| schwarzer König | eine von zwei gewählten Karten ansehen, dann tauschen oder liegen lassen |

**Cabo.** Nach dem Ruf hat jeder andere noch genau einen Zug, dann wird aufgedeckt.
Liegt der Rufer am niedrigsten, bekommt er 0 Punkte, sonst seine Kartensumme plus
Strafpunkte. Alle anderen bekommen ihre Kartensumme. Erreicht jemand die Zielpunktzahl
(voreingestellt 100), endet das Spiel – gewonnen hat, wer am wenigsten Punkte hat.

### Umschaltbare Hausregeln

Alles, was zwischen Spielgruppen verschieden gehandhabt wird, steht im
Einrichtungsbildschirm zur Wahl:

- roter König als −1 oder 0
- Kraft des schwarzen Königs an/aus
- Strafpunkte für einen misslungenen Cabo-Ruf: 5 oder 10
- Gleichstand zählt für den Rufer: ja/nein
- Zielpunktzahl 50 / 100 / 200
- Punktlandung halbiert den Stand (einmal pro Spieler)
- „Shoot the Moon“ (zwei Damen + beide schwarzen Könige)
- **Einwerfen (Snap)**: nach jedem Abwurf darf einer eine ranggleiche Karte loswerden;
  daneben gegriffen kostet eine Strafkarte
- Sichtschutz: Halten oder Tippen, Anzeigedauer, PIN, Merkhilfe

2 bis 6 Spieler. Der Spielstand wird laufend im Browser gesichert; nach einem
versehentlichen Schließen lässt sich die Partie fortsetzen.

## Aufbau des Codes

```
index.html              Gerüst aller Bildschirme und Overlays
css/style.css           Gestaltung, Quer- und Hochformat
js/deck.js              Kartendeck, Werte, Kartenkräfte, Mischen
js/rules.js             Voreinstellungen und Beschreibung aller Hausregeln
js/engine.js            Spiellogik und Zustandsmaschine – kennt keine Oberfläche
js/privacy.js           Sichtschutz: Halten zum Ansehen, Timer-Ring
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

27 Tests decken Kartenwerte, Austeilen, alle vier Kartenkräfte, Nachmischen bei leerem
Stapel, Einwerfen, die Cabo-Abrechnung inklusive Strafpunkten und Gleichstand,
Punktlandung, Spielende und das Speichern des Spielstands ab.

## Was noch fehlen könnte

- **Mehrgeräte-Modus**: Tablet als Tisch, jedes Handy als eigene Hand. Deutlich
  angenehmer als Weiterreichen, braucht aber einen Server für die Verbindung –
  bewusst nicht in dieser Fassung.
- **Computergegner** für Partien zu zweit.
- **Statistik** über mehrere Abende.
