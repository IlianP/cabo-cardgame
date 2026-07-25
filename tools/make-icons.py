#!/usr/bin/env python3
"""Erzeugt die App-Icons für die PWA.

Bewusst ohne Bibliotheken (nur zlib aus der Standardbibliothek), damit die
Icons überall neu gebaut werden können:

    python3 tools/make-icons.py
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

FELT = (13, 74, 53, 255)
FELT_LIGHT = (19, 86, 64, 255)
GOLD = (230, 184, 86, 255)
CREAM = (247, 243, 232, 255)
RED = (200, 51, 47, 255)


class Canvas:
    def __init__(self, size, background=(0, 0, 0, 0)):
        self.size = size
        self.px = [list(background) for _ in range(size * size)]

    def blend(self, x, y, color, alpha=1.0):
        if not (0 <= x < self.size and 0 <= y < self.size):
            return
        i = y * self.size + x
        dst = self.px[i]
        src_a = (color[3] / 255) * alpha
        if src_a <= 0:
            return
        out_a = src_a + (dst[3] / 255) * (1 - src_a)
        for c in range(3):
            dst[c] = round((color[c] * src_a + dst[c] * (dst[3] / 255) * (1 - src_a)) / out_a)
        dst[3] = round(out_a * 255)

    def rounded_rect(self, x0, y0, x1, y1, radius, color, border=None, border_width=0):
        """Antialiasing über 3x3-Supersampling der Randpixel."""
        for y in range(int(y0) - 2, int(y1) + 3):
            for x in range(int(x0) - 2, int(x1) + 3):
                cov = self._coverage(x, y, x0, y0, x1, y1, radius)
                if cov <= 0:
                    continue
                if border and border_width:
                    inner = self._coverage(
                        x, y,
                        x0 + border_width, y0 + border_width,
                        x1 - border_width, y1 - border_width,
                        max(0.0, radius - border_width),
                    )
                    self.blend(x, y, border, cov * (1 - inner))
                    self.blend(x, y, color, inner)
                else:
                    self.blend(x, y, color, cov)

    def _coverage(self, x, y, x0, y0, x1, y1, radius, samples=3):
        hits = 0
        for sy in range(samples):
            for sx in range(samples):
                px = x + (sx + 0.5) / samples
                py = y + (sy + 0.5) / samples
                if self._inside(px, py, x0, y0, x1, y1, radius):
                    hits += 1
        return hits / (samples * samples)

    @staticmethod
    def _inside(px, py, x0, y0, x1, y1, radius):
        if not (x0 <= px <= x1 and y0 <= py <= y1):
            return False
        cx = min(max(px, x0 + radius), x1 - radius)
        cy = min(max(py, y0 + radius), y1 - radius)
        return (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius

    def diamond(self, cx, cy, rx, ry, color):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                hits = 0
                for sy in range(3):
                    for sx in range(3):
                        px = x + (sx + 0.5) / 3 - cx
                        py = y + (sy + 0.5) / 3 - cy
                        if abs(px) / rx + abs(py) / ry <= 1:
                            hits += 1
                if hits:
                    self.blend(x, y, color, hits / 9)

    def to_png(self, path):
        raw = bytearray()
        for y in range(self.size):
            raw.append(0)
            for x in range(self.size):
                raw.extend(bytes(self.px[y * self.size + x]))

        def chunk(tag, data):
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.size, self.size, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        path.write_bytes(png)


def draw_icon(size, maskable=False):
    c = Canvas(size)
    s = size / 512  # alles ist für 512 gezeichnet

    # Hintergrund: bei maskable randlos, sonst mit abgerundeten Ecken.
    corner = 0 if maskable else 96 * s
    c.rounded_rect(0, 0, size - 1, size - 1, corner, FELT)

    inset = 1.18 if maskable else 1.0  # maskable braucht Luft am Rand
    def sx(v):
        return size / 2 + (v - 256) * s * 512 / 512 / inset

    # hintere Karte
    c.rounded_rect(sx(120), sx(96), sx(300), sx(392), 26 * s / inset,
                   FELT_LIGHT, border=GOLD, border_width=max(2, 7 * s / inset))
    # vordere Karte
    c.rounded_rect(sx(212), sx(120), sx(392), sx(416), 26 * s / inset, CREAM)
    # Karo als Blickfang
    c.diamond((sx(212) + sx(392)) / 2, (sx(120) + sx(416)) / 2,
              52 * s / inset, 74 * s / inset, RED)
    return c


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192).to_png(OUT / "icon-192.png")
    draw_icon(512).to_png(OUT / "icon-512.png")
    draw_icon(512, maskable=True).to_png(OUT / "icon-maskable-512.png")
    print(f"Icons geschrieben nach {OUT}")


if __name__ == "__main__":
    main()
