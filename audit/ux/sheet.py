"""Builds review sheets from crawl screenshots (audit/artifacts/ux/<run>/).

  python3 audit/ux/sheet.py <run> <pattern> [max_height] [cols]

Tall full-page screenshots are cut into columns side by side so one image shows a whole
phone page at readable size. Output: audit/artifacts/ux/<run>/sheets/<pattern>.png
"""
import glob
import os
import sys

from PIL import Image

run, pattern = sys.argv[1], sys.argv[2]
max_h = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
base = f"audit/artifacts/ux/{run}"
os.makedirs(f"{base}/sheets", exist_ok=True)
for f in sorted(glob.glob(f"{base}/{pattern}")):
    img = Image.open(f).convert("RGB")
    w, h = img.size
    parts = [img.crop((0, y, w, min(h, y + max_h))) for y in range(0, h, max_h)][:6]
    gap = 12
    sheet = Image.new("RGB", (len(parts) * (w + gap) - gap, min(h, max_h)), (255, 0, 255))
    for i, p in enumerate(parts):
        sheet.paste(p, (i * (w + gap), 0))
    out = f"{base}/sheets/{os.path.basename(f)}"
    sheet.save(out)
    print(out, sheet.size)
