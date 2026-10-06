"""Draws site/og.png, the picture a link to Lowlit shows where it is shared: 1200 by 630.

The light is the app's own (app/noir.js), one still frame of it, worked out here the way the page's script does on
the graphics chip. Needs Pillow and numpy.

    py -3 scripts/og.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630
CELL = 2            # a dot's side: two pixels, so the dots survive the picture being shown at half its size
STILL_AT = 12.0     # the moment the page stands still at
LEFT = 72
SHOT_AT = (664, 112)
SHOT_W = 1010
TEXT = (241, 241, 243)
GREY = (165, 165, 172)
DIM = (133, 133, 142)
BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
         3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21]


def noise_texture():
    """The 256 by 256 grain of the app, from its fixed seed (32-bit arithmetic, as JavaScript's)."""
    out = np.empty(256 * 256, dtype=np.float64)
    seed = 0x9E3779B9
    for i in range(out.size):
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((seed ^ (seed >> 15)) * (1 | seed)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
        out[i] = ((t ^ (t >> 14)) & 255) / 255
    return out.reshape(256, 256)


def light():
    """The share of dots lit, then each dot lit or not by its place in an 8 by 8 pattern: an RGB picture."""
    tex = noise_texture()

    def n(x, y):
        # a texture read between its texels, repeating at its edges
        x = x - 0.5
        y = y - 0.5
        x0 = np.floor(x)
        y0 = np.floor(y)
        fx = x - x0
        fy = y - y0
        xa = x0.astype(np.int64) % 256
        ya = y0.astype(np.int64) % 256
        xb = (xa + 1) % 256
        yb = (ya + 1) % 256
        return (tex[ya, xa] * (1 - fx) + tex[ya, xb] * fx) * (1 - fy) + (tex[yb, xa] * (1 - fx) + tex[yb, xb] * fx) * fy

    def fbm2(x, y):
        return 0.5 * n(x, y) + 0.25 * n(x * 2, y * 2)

    def fbm3(x, y):
        return 0.5 * n(x, y) + 0.25 * n(x * 2, y * 2) + 0.125 * n(x * 4, y * 4)

    def smoothstep(a, b, x):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)

    cols, rows = W // CELL, H // CELL
    cx, cy = np.meshgrid(np.arange(cols, dtype=np.float64), np.arange(rows, dtype=np.float64))
    # the graphics chip counts rows from the bottom
    cy = rows - 1 - cy
    vx = (cx + 0.5) * CELL / W
    vy = (cy + 0.5) * CELL / H
    px = vx * W / H
    py = vy
    dx = px + 0.05
    dy = py - 1.08
    dist = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    wrap = lambda x: x % 256
    turn, drift_x, drift_y = wrap(STILL_AT * 0.05), wrap(STILL_AT * 0.02), wrap(STILL_AT * 0.013)
    breath = 0.85 + 0.15 * np.sin(STILL_AT * 0.4)
    rays = smoothstep(0.36, 0.6, fbm2(ang * 12 + turn, dist * 0.35))
    rays = rays * (0.75 + 0.5 * n(ang * 46 - turn * 2.3, dist * 2 - turn * 3))
    fog = fbm3(px * 2.4 + drift_x, py * 2.4 + drift_y)
    # the page's reach is 0.72: here the canvas is lower, and the light must still be seen at half size
    fall = np.exp2(-dist * 1.6 / 1.05)
    lamp = np.exp2(-dist * 6) * 0.55
    lit = (rays * (0.75 + 0.5 * fog) * fall * 1.15 + lamp) * breath
    lit = lit * smoothstep(0, 0.34, vy)
    share = np.clip(lit, 0, 1) * 0.7
    bayer = np.array([round(((b + 0.5) / 64) * 255) / 255 for b in BAYER]).reshape(8, 8)
    th = bayer[cy.astype(np.int64) % 8, cx.astype(np.int64) % 8]
    dot = (share >= th) * (0.2 + 0.28 * smoothstep(0.45, 0.9, share))
    rgb = np.stack([dot * 0.86, dot * 0.88, dot * 0.92], axis=-1)
    rgb = np.repeat(np.repeat(rgb, CELL, axis=0), CELL, axis=1)
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).round().astype(np.uint8), 'RGB')


def font(name, size, weight):
    f = ImageFont.truetype(str(ROOT / 'site' / 'fonts' / name), size)
    axes = [a['name'] for a in f.get_variation_axes()]
    # Inter has an optical size too: the one made for large type
    f.set_variation_by_axes([32 if a == b'Optical size' else weight for a in axes])
    return f


def write(draw, at, text, f, fill, tracking=0.0):
    """A line of text with its letters set closer (or wider) by tracking, in ems. Returns where it ends."""
    x, y = at
    step = tracking * f.size
    for i, ch in enumerate(text):
        # the place of each letter is read from the line so far, so pairs keep their kerning
        draw.text((x + f.getlength(text[:i]) + i * step, y), ch, font=f, fill=fill)
    return x + f.getlength(text) + (len(text) - 1) * step


def rounded(size, radius):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def main():
    page = light().convert('RGBA')

    # the picture of the app: obsidian over the light, running off the right and the bottom
    shot = Image.open(ROOT / 'docs' / 'ws-all.png').convert('RGB')
    shot = shot.resize((SHOT_W, round(shot.height * SHOT_W / shot.width)), Image.LANCZOS)
    radius = 16
    shade = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shade).rounded_rectangle((SHOT_AT[0] - 6, SHOT_AT[1] - 2, W + 80, H + 80), radius + 6, fill=255)
    shade = shade.filter(ImageFilter.GaussianBlur(34))
    page = Image.composite(Image.new('RGBA', (W, H), (0, 0, 0, 255)), page, shade)
    page.paste(shot, SHOT_AT, rounded(shot.size, radius))
    # its edge: a hairline, and the rim of light along the top and the left, fading away from the corner
    edge = Image.new('L', shot.size, 0)
    ImageDraw.Draw(edge).rounded_rectangle((0, 0, shot.size[0] - 1, shot.size[1] - 1), radius, outline=255, width=1)
    xs = np.clip(1 - np.arange(shot.size[0]) / (shot.size[0] * 0.55), 0, 1)
    ys = np.clip(1 - np.arange(shot.size[1]) / 260, 0, 1)
    rim = 0.1 + 0.34 * np.maximum(xs[None, :] * (ys[:, None] > 0), ys[:, None] * (xs[None, :] > 0)) * np.minimum(1, xs[None, :] + ys[:, None])
    alpha = Image.fromarray((np.asarray(edge, dtype=np.float64) * np.clip(rim, 0, 1)).round().astype(np.uint8), 'L')
    line = Image.new('RGBA', shot.size, (255, 255, 255, 0))
    line.putalpha(alpha)
    page.alpha_composite(line, SHOT_AT)

    # the words, on a layer of their own: a soft black halo goes under them, so they cut through the dots
    words = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(words)
    lockup = Image.open(ROOT / 'assets' / 'lockup-white.png').convert('RGBA')
    lockup = lockup.crop(lockup.getbbox())
    lockup = lockup.resize((round(lockup.width * 40 / lockup.height), 40), Image.LANCZOS)
    words.alpha_composite(lockup, (LEFT, 62))
    head = font('inter-latin.woff2', 66, 600)
    y = 196
    ends = []
    for row in ('Every Claude', 'Code chat in', 'one window.'):
        ends.append(write(d, (LEFT - 3, y), row, head, TEXT, -0.047))
        y += 69
    mono = font('geist-mono.woff', 21, 500)
    ends.append(write(d, (LEFT, y + 30), 'Windows · free · MIT', mono, GREY))
    small = font('geist-mono.woff', 19, 400)
    write(d, (LEFT, H - 78), 'github.com/anessbelbati/lowlit', small, DIM)
    if max(ends) > SHOT_AT[0] - 28:
        raise SystemExit(f'the words run into the picture: they end at {max(ends):.0f}, the picture starts at {SHOT_AT[0]}')

    halo = words.getchannel('A').filter(ImageFilter.GaussianBlur(9))
    halo = ImageChops.add(halo, halo)
    halo = ImageChops.add(halo, halo)
    page = Image.composite(Image.new('RGBA', (W, H), (0, 0, 0, 255)), page, halo)
    page.alpha_composite(words)

    out = ROOT / 'site' / 'og.png'
    page.convert('RGB').save(out, optimize=True)
    print(f'{out.relative_to(ROOT)}: {W} by {H}, {out.stat().st_size} bytes; the words end at {max(ends):.0f}, the picture starts at {SHOT_AT[0]}')


if __name__ == '__main__':
    main()
