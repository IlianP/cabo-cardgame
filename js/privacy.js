/**
 * Sichtschutz.
 *
 * Geheime Karten werden nie einfach angezeigt, sondern immer über diesen
 * Mechanismus: Die Karte ist nur sichtbar, solange ein Finger auf ihr
 * liegt (Totmannschalter), und zusätzlich nur bis zum Ablauf eines
 * Timers. Loslassen, wegrutschen, Fenster wechseln – alles versteckt die
 * Karte sofort wieder.
 *
 * Wer nicht halten mag (Einstellung "Halten zum Ansehen" aus), tippt
 * einmal und die Karte ist für die eingestellte Dauer sichtbar.
 */

const HOLD_EVENTS_END = ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'];

/**
 * @param {HTMLElement} el       Element, das gehalten wird
 * @param {object} opts
 * @param {() => void} opts.onShow
 * @param {() => void} opts.onHide
 * @param {(fraction: number) => void} [opts.onProgress]  1 -> 0
 * @param {() => object} opts.settings  liefert {holdToReveal, peekSeconds}
 * @returns {() => void} Aufräumfunktion
 */
export function attachReveal(el, { onShow, onHide, onProgress, settings }) {
  let visible = false;
  let raf = 0;
  let deadline = 0;

  const stop = () => {
    if (!visible) return;
    visible = false;
    cancelAnimationFrame(raf);
    onProgress?.(0);
    onHide();
  };

  const tick = () => {
    const left = deadline - performance.now();
    const total = settings().peekSeconds * 1000;
    if (left <= 0) return stop();
    onProgress?.(left / total);
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (visible) return;
    visible = true;
    deadline = performance.now() + settings().peekSeconds * 1000;
    onShow();
    onProgress?.(1);
    raf = requestAnimationFrame(tick);
  };

  const onDown = (e) => {
    e.preventDefault();
    if (settings().holdToReveal) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* manche Browser mögen das nicht – dann greifen die Fallback-Events */
      }
      start();
    } else if (visible) {
      stop();
    } else {
      start();
    }
  };

  const onUp = () => {
    if (settings().holdToReveal) stop();
  };

  el.addEventListener('pointerdown', onDown);
  for (const name of HOLD_EVENTS_END) el.addEventListener(name, onUp);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  const onBlur = () => stop();
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onBlur);

  return () => {
    stop();
    el.removeEventListener('pointerdown', onDown);
    for (const name of HOLD_EVENTS_END) el.removeEventListener(name, onUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onBlur);
  };
}

/** Ring, der die Restzeit anzeigt. */
export function makeTimerRing() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.classList.add('timer-ring');
  const track = document.createElementNS(ns, 'circle');
  const bar = document.createElementNS(ns, 'circle');
  for (const c of [track, bar]) {
    c.setAttribute('cx', '20');
    c.setAttribute('cy', '20');
    c.setAttribute('r', '17');
  }
  track.setAttribute('class', 'ring-track');
  bar.setAttribute('class', 'ring-bar');
  const circumference = 2 * Math.PI * 17;
  bar.style.strokeDasharray = String(circumference);
  svg.append(track, bar);
  return {
    el: svg,
    set(fraction) {
      bar.style.strokeDashoffset = String(circumference * (1 - fraction));
      svg.style.opacity = fraction > 0 ? '1' : '0';
    },
  };
}
