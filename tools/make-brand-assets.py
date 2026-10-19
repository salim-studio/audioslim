"""Generates the audioslim+ brand mark, its icon set and the wordmark.

The mark is a filled waveform whose amplitude tapers from left to right (the
wave gets "slimmer") paired with a plus sign. Everything is drawn at 8x and
downsampled, so the edges stay clean at 16px.
"""

import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public")
ROOT = os.path.join(HERE, "..")

S = 8  # supersample factor

# Brand palette.
TILE_TOP = (19, 23, 29)
TILE_BOTTOM = (9, 11, 15)
TILE_EDGE = (255, 255, 255, 28)
LIME = (231, 255, 112)
EMERALD = (38, 214, 143)
INK = (240, 244, 238)
GRAPHITE = (20, 24, 29)
BRAND_DEEP = (79, 143, 13)  # the brand accent on a light background

# Wordmark typeface. Montserrat is a geometric sans that suits the mark; the
# app itself uses the system UI font.
WORDMARK_FONT = "C:/Windows/Fonts/Montserrat-SemiBold.ttf"
WORDMARK_FONT_BOLD = "C:/Windows/Fonts/Montserrat-Bold.ttf"


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    n = size
    grad = Image.new("RGBA", (1, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        gd.point((0, y), fill=lerp(top, bottom, y / max(1, n - 1)) + (255,))
    return grad.resize((n, n), Image.BILINEAR)


def waveform_polygon(x0, y0, width, height, cycles=3.1, taper=0.62):
    """A filled waveform: symmetric lobes around the centre line, thinning to
    the right so the wave reads as "slimming"."""
    mid = y0 + height / 2
    top = []
    bottom = []
    steps = 600
    for i in range(steps + 1):
        t = i / steps
        x = x0 + t * width
        # Envelope: overall loudness falls off to the right.
        env = (1.0 - taper * t) * (0.62 + 0.38 * math.sin(math.pi * min(1.0, t * 1.35)) ** 0.6)
        # Lobes: the absolute value of a sine gives the classic filled look.
        lobe = abs(math.sin(math.pi * cycles * t - 0.35))
        amp = height / 2 * env * (0.22 + 0.78 * lobe)
        top.append((x, mid - amp))
        bottom.append((x, mid + amp))
    return top + bottom[::-1]


def plus_mask(size, arm, radius):
    """A plus sign drawn as the union of two rounded bars."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    half = size / 2
    d.rounded_rectangle([half - arm, half - size / 2, half + arm, half + size / 2], radius=radius, fill=255)
    d.rounded_rectangle([half - size / 2, half - arm, half + size / 2, half + arm], radius=radius, fill=255)
    return m


def draw_mark(size, tile=True, plus=True, wave_scale=1.0):
    """Draws the brand mark at `size` px and returns an RGBA image."""
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    if tile:
        radius = n * 0.2237
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=radius, fill=255)
        img.paste(vertical_gradient(n, TILE_TOP, TILE_BOTTOM), (0, 0), mask)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle(
            [S // 2, S // 2, n - 1 - S // 2, n - 1 - S // 2],
            radius=radius,
            outline=TILE_EDGE,
            width=max(1, S),
        )

    # Layout: the waveform sits in the lower band, the plus in the upper right.
    pad = n * 0.145
    if plus:
        wave_w = n * 0.66
        wave_h = n * 0.40 * wave_scale
        wave_x = pad
        wave_y = n * 0.50
    else:
        wave_w = n * 0.71
        wave_h = n * 0.46 * wave_scale
        wave_x = pad
        wave_y = n * 0.46

    poly = waveform_polygon(wave_x, wave_y, wave_w, wave_h)

    ribbon = vertical_gradient(n, LIME, EMERALD)
    ribbon_mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(ribbon_mask).polygon(poly, fill=255)
    ribbon.putalpha(ribbon_mask)
    img.alpha_composite(ribbon)

    if plus:
        p_size = n * 0.27
        p_arm = p_size * 0.30
        pm = plus_mask(int(p_size), int(p_arm), int(p_size * 0.075))
        # Offset the plus so it sits in the upper-right corner of the tile.
        px = int(n * 0.750 - p_size / 2)
        py = int(n * 0.250 - p_size / 2)
        plus_layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        plus_color = Image.new("RGBA", (int(p_size), int(p_size)), EMERALD + (255,))
        plus_layer.paste(plus_color, (px, py), pm)
        img.alpha_composite(plus_layer)

    return img.resize((size, size), Image.LANCZOS)


def write_png(img, path):
    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.basename(path):32s} {img.size[0]}x{img.size[1]}")


def build_social(path):
    """Social preview card: 1200x630 with the mark and the wordmark."""
    w, h = 1200, 630
    img = Image.new("RGBA", (w, h), (11, 13, 17, 255))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp((17, 21, 27), (8, 10, 13), y / h) + (255,))

    img.alpha_composite(draw_mark(300, tile=True), (96, (h - 300) // 2))

    d = ImageDraw.Draw(img)
    try:
        font_big = ImageFont.truetype("arialbd.ttf", 104)
        font_sub = ImageFont.truetype("arial.ttf", 32)
    except Exception:
        font_big = font_sub = ImageFont.load_default()

    x = 452
    d.text((x, 226), "audioslim+", font=font_big, fill=INK + (255,))
    d.text((x + 6, 350), "Waveform & multitrack audio editor", font=font_sub, fill=(150, 160, 150, 255))
    d.text((x + 6, 394), "salim-slimani  -  2026", font=font_sub, fill=(108, 118, 110, 255))
    img.convert("RGB").save(path, "JPEG", quality=88, optimize=True)
    print(f"  {os.path.basename(path):32s} 1200x630")


def build_wordmark(path, dark=True):
    """The horizontal logo lockup: the mark in its tile, then the name.

    On a light background the name is graphite with a deep green plus; on a
    dark one it is off-white with the brand lime.
    """
    scale = 4
    tile = 168 * scale
    text_size = 84 * scale
    gap = 26 * scale
    pad = 8 * scale

    try:
        font = ImageFont.truetype(WORDMARK_FONT, text_size)
        font_plus = ImageFont.truetype(WORDMARK_FONT_BOLD, text_size)
    except Exception:
        font = font_plus = ImageFont.load_default()

    name = "audioslim"
    ascent, descent = font.getmetrics()
    w_name = int(font.getlength(name))
    w_plus = int(font_plus.getlength("+"))
    text_h = ascent + descent

    width = pad * 2 + tile + gap + w_name + w_plus
    height = pad * 2 + max(tile, text_h)

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # The mark, in its own tile.
    mark = draw_mark(tile, tile=True)
    img.alpha_composite(mark, (pad, (height - tile) // 2))

    # The name, vertically centred on the text's own box.
    text_y = (height - text_h) // 2 + ascent
    x = pad + tile + gap
    d.text((x, text_y), name, font=font, fill=(GRAPHITE if not dark else INK) + (255,), anchor="ls")
    d.text((x + w_name, text_y), "+", font=font_plus, fill=(BRAND_DEEP if not dark else LIME) + (255,), anchor="ls")

    img = img.resize((width // scale, height // scale), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.basename(path):32s} {img.size[0]}x{img.size[1]}")


def main():
    pub = os.path.abspath(PUB)
    os.makedirs(pub, exist_ok=True)
    print("public/")

    write_png(draw_mark(512, tile=True), os.path.join(pub, "app-icon.png"))

    # Maskable icons are cropped by the OS, so the mark keeps a safe zone.
    maskable = Image.new("RGBA", (512, 512), TILE_BOTTOM + (255,))
    maskable.alpha_composite(draw_mark(512, tile=False).resize((330, 330), Image.LANCZOS), (91, 91))
    write_png(maskable, os.path.join(pub, "icon-maskable-512.png"))

    write_png(draw_mark(192, tile=True), os.path.join(pub, "icon-192.png"))
    write_png(draw_mark(512, tile=True), os.path.join(pub, "icon-512.png"))

    write_png(draw_mark(16, tile=True), os.path.join(pub, "favicon-16x16.png"))
    write_png(draw_mark(32, tile=True), os.path.join(pub, "favicon-32x32.png"))
    write_png(draw_mark(48, tile=True), os.path.join(pub, "favicon-48x48.png"))
    draw_mark(48, tile=True).save(os.path.join(pub, "favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {'favicon.ico':32s} ico")

    # Apple touch icons are masked by the OS, so no rounded tile is drawn.
    write_png(draw_mark(180, tile=False), os.path.join(pub, "apple-touch-icon.png"))

    build_wordmark(os.path.join(pub, "logo.png"), dark=False)
    build_wordmark(os.path.join(pub, "logo-dark.png"), dark=True)

    build_social(os.path.join(pub, "social-graph.jpg"))

    root = os.path.abspath(ROOT)
    print("root/")
    write_png(draw_mark(512, tile=True), os.path.join(root, "icon.png"))
    write_png(draw_mark(128, tile=True), os.path.join(root, "icon-128.png"))
    write_png(draw_mark(512, tile=True), os.path.join(root, "logo.png"))


if __name__ == "__main__":
    main()
