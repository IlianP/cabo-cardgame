/**
 * Regelwerk und Hausregeln.
 *
 * Die Voreinstellungen entsprechen den offiziellen Cabo-Regeln
 * (cabogame.com). Alles, was zwischen Spielgruppen verschieden gehandhabt
 * wird, ist hier als Schalter abgebildet und im Einstellungsmenü sichtbar.
 */

export const DEFAULT_RULES = {
  // --- Aufbau ---
  handSize: 4, // Karten pro Spieler
  initialPeeks: 2, // Karten, die man zu Rundenbeginn ansehen darf
  jokerCount: 2,

  // --- Kartenwerte ---
  redKingValue: -1, // roter König: -1 (Original) oder 0
  kingPower: true, // schwarzer König: ansehen + optional tauschen

  // --- Cabo-Ruf ---
  caboPenalty: 5, // Strafpunkte für einen misslungenen Ruf (5 oder 10)
  tieCountsForCaller: true, // Gleichstand zählt für den Rufer als Erfolg

  // --- Punkte ---
  targetScore: 100, // Spielende, sobald jemand das erreicht
  resetAtHundred: true, // genau 100 Punkte -> zurück auf 50 (einmal pro Spieler)
  shootTheMoon: false, // zwei Damen + beide schwarzen Könige: 0 für dich, 50 für alle anderen

  // --- Hausregeln ---
  snapEnabled: false, // Einwerfen (Snap) einer ranggleichen Karte

  // --- Bedienung / Sichtschutz ---
  usePins: false, // PIN-Abfrage auf dem Übergabe-Bildschirm
  holdToReveal: true, // Karte nur sichtbar, solange der Finger daraufliegt
  peekSeconds: 5, // Maximale Anzeigedauer einer geheimen Karte
  memoryAid: false, // eigene, bereits gesehene Karten dauerhaft markieren
};

export const RULE_GROUPS = [
  {
    title: 'Kartenwerte',
    items: [
      {
        key: 'redKingValue',
        label: 'Roter König',
        type: 'choice',
        options: [
          { value: -1, label: '−1' },
          { value: 0, label: '0' },
        ],
        hint: 'Im Original ist der rote König −1 wert.',
      },
      {
        key: 'kingPower',
        label: 'Kraft des schwarzen Königs',
        type: 'toggle',
        hint: 'Eine Karte ansehen, danach tauschen oder liegen lassen.',
      },
    ],
  },
  {
    title: 'Cabo-Ruf',
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
        key: 'tieCountsForCaller',
        label: 'Gleichstand zählt für den Rufer',
        type: 'toggle',
        hint: 'Aus: der Rufer muss echt am niedrigsten liegen.',
      },
    ],
  },
  {
    title: 'Punkte',
    items: [
      {
        key: 'targetScore',
        label: 'Spielende bei',
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
      {
        key: 'shootTheMoon',
        label: 'Shoot the Moon',
        type: 'toggle',
        hint: 'Zwei Damen und beide schwarzen Könige auf der Hand: 0 Punkte für dich, 50 für alle anderen.',
      },
    ],
  },
  {
    title: 'Hausregeln',
    items: [
      {
        key: 'snapEnabled',
        label: 'Einwerfen erlaubt',
        type: 'toggle',
        hint: 'Nach jedem Abwurf darf einer eine ranggleiche Karte loswerden – daneben gegriffen kostet eine Strafkarte.',
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
