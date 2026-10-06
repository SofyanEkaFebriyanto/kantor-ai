#!/usr/bin/env python3
"""Split character sheet (2 pose) + chroma-key green screen -> sprite transparan.

Input : static/sprites/{nama}-sheet.png  (kiri=berdiri, kanan=jalan, bg hijau #00FF00)
Output: static/sprites/{nama}-stand.png , {nama}-walk.png  (400x600, kaki rata bawah)
"""
import os
import sys

from PIL import Image, ImageFilter
import numpy as np

SPR = '/home/hatch/workspace/kantor-ai/static/sprites'
CANVAS = (400, 600)


def key_green(img):
    """Hijau pekat -> transparan. Kembalikan RGBA."""
    a = np.asarray(img.convert('RGB')).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    green = (g > 140) & (g > r + 50) & (g > b + 50)
    alpha = np.where(green, 0, 255).astype(np.uint8)
    # feather 1px di tepi biar tidak bergerigi
    m = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(0.7))
    alpha = np.array(m)
    alpha[green] = 0
    out = img.convert('RGBA')
    out.putalpha(Image.fromarray(alpha, 'L'))
    return out


def trim(rgba):
    """Crop ke bbox non-transparan (dengan margin kecil)."""
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return rgba
    x0, x1 = max(0, xs.min() - 4), min(rgba.width, xs.max() + 5)
    y0, y1 = max(0, ys.min() - 4), min(rgba.height, ys.max() + 5)
    return rgba.crop((x0, y0, x1, y1))


def normalize(rgba):
    """Taruh di kanvas standar, kaki rata bawah, tengah horizontal."""
    t = trim(rgba)
    scale = min(CANVAS[0] / t.width, CANVAS[1] / t.height, 1.0)
    nw, nh = int(t.width * scale), int(t.height * scale)
    t = t.resize((nw, nh), Image.LANCZOS)
    cv = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    cv.paste(t, ((CANVAS[0] - nw) // 2, CANVAS[1] - nh), t)
    return cv


def process(name):
    src = os.path.join(SPR, f'{name}-sheet.png')
    if not os.path.isfile(src):
        print(f'SKIP {name}: {src} tidak ada')
        return False
    sheet = Image.open(src).convert('RGB')
    w = sheet.width
    left = sheet.crop((0, 0, w // 2, sheet.height))
    right = sheet.crop((w // 2, 0, w, sheet.height))
    for pose, half in (('stand', left), ('walk', right)):
        out = normalize(key_green(half))
        # buang bila hasil kosong (sheet gagal)
        if np.asarray(out)[:, :, 3].max() == 0:
            print(f'WARN {name}-{pose}: hasil kosong!')
        out.save(os.path.join(SPR, f'{name}-{pose}.png'))
    print(f'OK {name}')
    return True


if __name__ == '__main__':
    names = sys.argv[1:] or ['bagas', 'dimas', 'putri', 'eko', 'intan']
    ok = all(process(n) for n in names)
    sys.exit(0 if ok else 1)
