/**
 * Regelwerk und Hausregeln.
 *
 * Die Voreinstellungen entsprechen den Verlagsregeln von Cabo
 * (Smiling Monster Games / Bezier Games). Umschaltbar ist nur, was
 * zwischen Spielgruppen tatsächlich verschieden gehandhabt wird.
 */

export const DEFAULT_RULES = {
  // --- Aufbau ---
  handSize: 4, // Karten pro Spieler
  initialPeeks: 2, // Karten, die man zu Rundenbeginn ansehen darf

  // --- Zug ---
  multiDiscard: true, // mehrere eigene gleichwertige Karten gemeinsam abwerfen

  // --- Cabo-Ruf ---
  caboPenalty: 5, // Strafpunkte für einen misslungenen Ruf

  // --- Punkte ---
  targetScore: 100, // Spielende, sobald jemand darüber liegt
  resetAtHundred: true, // genau die Zielpunktzahl -> halbiert (einmal pro Spieler)
  shootTheMoon: true, // 12-12-13-13 auf der Hand: 0 für dich, 50 für alle anderen
  winnerStarts: true, // Gewinner der Vorrunde beginnt die nächste

  // --- Bedienung / Sichtschutz ---
  usePins: false, // PIN-Abfrage auf dem Übergabe-Bildschirm
  holdToReveal: true, // Karte nur sichtbar, solange der Finger daraufliegt
  peekSeconds: 5, // Maximale Anzeigedauer einer geheimen Karte
  memoryAid: false, // eigene, bereits gesehene Karten markieren
};

export const RULE_GROUPS = [
  {
    title: 'Spielregeln',
    items: [
      {
        key: 'multiDiscard',
        label: 'Mehrfach-Ablage',
        type: 'toggle',
        hint: 'Beim Ziehen darfst du mehrere eigene Karten gleichen Wertes gemeinsam abwerfen und spielst dann mit weniger Karten weiter. Liegst du falsch, ist der Zug verloren.',
      },
      {
        key: 'shootTheMoon',
        label: 'Shoot the Moon',
        type: 'toggle',
        hint: 'Zwei Zwölfen und beide Dreizehnen auf der Hand: 0 Punkte für dich, 50 für alle anderen.',
      },
      {
        key: 'winnerStarts',
        label: 'Gewinner beginnt',
        type: 'toggle',
        hint: 'Aus: der Startspieler wechselt einfach reihum.',
      },
    ],
  },
  {
    title: 'Punkte',
    items: [
      {
        key: 'caboPenalty',
        label: 'Strafpunkte bei misslungenem Ruf',
        type: 'choice',
        options: [
          { value: 5, label: '5' },
          { value: 10, label: '10' },
        ],
      },
      {
        key: 'targetScore',
        label: 'Spielende über',
        type: 'choice',
        options: [
          { value: 50, label: '50' },
          { value: 100, label: '100' },
          { value: 200, label: '200' },
        ],
      },
      {
        key: 'resetAtHundred',
        label: 'Punktlandung halbiert',
        type: 'toggle',
        hint: 'Wer genau auf der Zielpunktzahl landet, fällt auf die Hälfte zurück – einmal pro Spieler.',
      },
    ],
  },
  {
    title: 'Sichtschutz & Bedienung',
    items: [
      {
        key: 'holdToReveal',
        label: 'Halten zum Ansehen',
        type: 'toggle',
        hint: 'Aus: antippen zeigt die Karte für die eingestellte Dauer.',
      },
      {
        key: 'peekSeconds',
        label: 'Anzeigedauer',
        type: 'choice',
        options: [
          { value: 3, label: '3 s' },
          { value: 5, label: '5 s' },
          { value: 8, label: '8 s' },
        ],
      },
      {
        key: 'usePins',
        label: 'PIN pro Spieler',
        type: 'toggle',
        hint: 'Vierstellige PIN beim Übergeben des Geräts.',
      },
      {
        key: 'memoryAid',
        label: 'Merkhilfe',
        type: 'toggle',
        hint: 'Zeigt dir dauerhaft an, welche deiner eigenen Karten du schon gesehen hast. Macht das Spiel deutlich leichter.',
      },
    ],
  },
];
