"""Puts the top part of several screenshots side by side for quick review.

  python3 audit/ux/grid.py <run> <out-name> <height> <file1> <file2> ...
"""
import os
import sys

from PIL import Image

run, name, h = sys.argv[1], sys.argv[2], int(sys.argv[3])
files = sys.argv[4:]
base = f"audit/artifacts/ux/{run}"
ims = []
for f in files:
    im = Image.open(os.path.join(base, f)).convert("RGB")
    ims.append(im.crop((0, 0, im.size[0], min(im.size[1], h))))
gap = 12
sheet = Image.new("RGB", (sum(i.size[0] for i in ims) + gap * (len(ims) - 1), max(i.size[1] for i in ims)), (255, 0, 255))
x = 0
for i in ims:
    sheet.paste(i, (x, 0))
    x += i.size[0] + gap
os.makedirs(f"{base}/sheets", exist_ok=True)
out = os.path.abspath(f"{base}/sheets/{name}.png")
sheet.save(out)
print(out, sheet.size)
