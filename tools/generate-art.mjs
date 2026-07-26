#!/usr/bin/env node
/**
 * Erzeugt die Kartenbilder über fal.ai und legt sie als WebP unter art/ ab.
 *
 *   FAL_KEY=… node tools/generate-art.mjs             # alle fehlenden Werte
 *   FAL_KEY=… node tools/generate-art.mjs 3 7         # nur diese Werte
 *   FAL_KEY=… node tools/generate-art.mjs 3 --force   # auch wenn es sie schon gibt
 *   node tools/generate-art.mjs --convert-only        # nur neu umrechnen, ohne API
 *
 * Modell, Parameter und sämtliche Prompts stehen in tools/art-prompts.json –
 * dort wird geändert, nicht hier.
 *
 * Die heruntergeladenen Originale bleiben in tools/.art-cache/ liegen. Damit
 * kostet ein erneutes Umrechnen (andere Größe, andere Qualität) nichts.
 *
 * Zum Umrechnen nach WebP nimmt das Skript, was es findet: cwebp, ImageMagick
 * oder ersatzweise Chromium über Playwright.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SPEC = JSON.parse(readFileSync(join(HERE, 'art-prompts.json'), 'utf8'));
const CACHE = join(HERE, '.art-cache');
const OUT = join(ROOT, SPEC.output.directory);

const args = process.argv.slice(2);
const force = args.includes('--force');
const convertOnly = args.includes('--convert-only');
const wanted = args.filter((a) => /^\d+$/.test(a)).map(Number);

const pad = (v) => String(v).padStart(2, '0');
const values = (wanted.length ? wanted : Object.keys(SPEC.cards).map(Number)).sort((a, b) => a - b);

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------- Erzeugen

async function generate(value) {
  const card = SPEC.cards[String(value)];
  if (!card) throw new Error(`Für den Wert ${value} steht kein Prompt in art-prompts.json.`);

  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY ist nicht gesetzt.');

  const body = { prompt: card.prompt, system_prompt: SPEC.system_prompt, ...SPEC.params };
  const res = await fetch(SPEC.endpoint, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${value}: HTTP ${res.status} – ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error(`${value}: keine Bild-URL in der Antwort.`);

  const png = join(CACHE, `${pad(value)}.png`);
  const bin = await fetch(url);
  writeFileSync(png, Buffer.from(await bin.arrayBuffer()));
  return png;
}

// ------------------------------------------------------------ Umrechnen

const has = (cmd) => spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;

function convertWithCwebp(src, dest) {
  const { width, height, quality } = SPEC.output;
  const r = spawnSync('cwebp', [
    '-q', String(Math.round(quality * 100)),
    '-resize', String(width), String(height),
    src, '-o', dest,
  ], { stdio: 'ignore' });
  return r.status === 0;
}

function convertWithMagick(src, dest) {
  const { width, height, quality } = SPEC.output;
  const cmd = has('magick') ? 'magick' : 'convert';
  const r = spawnSync(cmd, [
    src, '-resize', `${width}x${height}^`, '-gravity', 'center',
    '-extent', `${width}x${height}`, '-quality', String(Math.round(quality * 100)), dest,
  ], { stdio: 'ignore' });
  return r.status === 0;
}

/** Letzte Rettung: Chromium rechnet das Bild über ein Canvas um. */
async function convertWithChromium(pairs) {
  let chromium;
  try {
    // Bewusst require statt import: nur so wird auch eine global installierte
    // Playwright-Fassung über NODE_PATH gefunden.
    ({ chromium } = require('playwright'));
  } catch {
    return false;
  }
  const { width, height, quality } = SPEC.output;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage();
  for (const [src, dest] of pairs) {
    const dataUrl = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
    const out = await page.evaluate(
      async ({ dataUrl, w, h, q }) => {
        const img = new Image();
        await new Promise((ok, no) => {
          img.onload = ok;
          img.onerror = no;
          img.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // Bildausschnitt füllend zuschneiden, damit nichts verzerrt wird.
        const scale = Math.max(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return canvas.toDataURL('image/webp', q);
      },
      { dataUrl, w: width, h: height, q: quality },
    );
    writeFileSync(dest, Buffer.from(out.split(',')[1], 'base64'));
  }
  await browser.close();
  return true;
}

async function convertAll(pairs) {
  if (!pairs.length) return;
  if (has('cwebp') && pairs.every(([s, d]) => convertWithCwebp(s, d))) return;
  if ((has('magick') || has('convert')) && pairs.every(([s, d]) => convertWithMagick(s, d))) return;
  if (await convertWithChromium(pairs)) return;
  throw new Error(
    'Kein Umrechner gefunden. Installiere cwebp (Paket webp) oder ImageMagick, ' +
      'oder mache Playwright auflösbar (bei globaler Installation: ' +
      'NODE_PATH=$(npm root -g)). Die Originale liegen in tools/.art-cache/ – ' +
      'ein späterer Lauf mit --convert-only kostet nichts.',
  );
}

// ----------------------------------------------------------------- Lauf

const pending = [];
for (const value of values) {
  const png = join(CACHE, `${pad(value)}.png`);
  const webp = join(OUT, `${pad(value)}.webp`);

  if (existsSync(webp) && !force && !convertOnly) {
    console.log(`${pad(value)}  liegt schon vor – übersprungen`);
    continue;
  }
  if (!existsSync(png) || (force && !convertOnly)) {
    if (convertOnly) {
      console.log(`${pad(value)}  kein Original im Cache – übersprungen`);
      continue;
    }
    process.stdout.write(`${pad(value)}  ${SPEC.cards[String(value)].motif} … `);
    await generate(value);
    console.log(`${(statSync(png).size / 1024).toFixed(0)} kB geladen`);
  }
  pending.push([png, webp]);
}

await convertAll(pending);

for (const [, webp] of pending) {
  console.log(`→ ${webp.replace(ROOT + '/', '')}  ${(statSync(webp).size / 1024).toFixed(0)} kB`);
}
console.log(
  pending.length
    ? `\nFertig: ${pending.length} Bild(er).`
    : '\nNichts zu tun – alle Bilder liegen schon vor.',
);
