"""Optimise the self-hosted demo imagery for web delivery.

Pexels' `large2x` is fine for most frames but a few high-detail architectural
shots come back at 2–3 MB. This caps the long edge and re-encodes with a
quality that is visually indistinguishable at display size, which is the
difference between a showroom that loads instantly and one that does not.

Idempotent: skips anything already within budget.
"""
import glob
import os
import sys

from PIL import Image

MAX_EDGE = 2000          # covers 1x and 2x on a 1440 viewport for most slots
BUDGET_KB = 260          # anything larger gets re-encoded
START_Q = 82
MIN_Q = 62

total_before = total_after = 0
touched = []

for f in sorted(glob.glob(r"D:\seai.public\public\assets\demos\**\*.jpg", recursive=True)):
    size = os.path.getsize(f)
    total_before += size
    kb = size / 1024
    if kb <= BUDGET_KB:
        total_after += size
        continue
    try:
        im = Image.open(f).convert("RGB")
    except Exception as e:
        print(f"  skip {os.path.basename(f)}: {e}")
        total_after += size
        continue

    if max(im.size) > MAX_EDGE:
        im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)

    q = START_Q
    while q >= MIN_Q:
        im.save(f, "JPEG", quality=q, optimize=True, progressive=True)
        if os.path.getsize(f) / 1024 <= BUDGET_KB:
            break
        q -= 5

    after = os.path.getsize(f)
    total_after += after
    touched.append((os.path.basename(f), kb, after / 1024))

for n, b, a in touched:
    print(f"  {n:44} {b:7.0f} KB -> {a:6.0f} KB")

print(f"\n{len(touched)} re-encoded. "
      f"total {total_before/1024:.0f} KB -> {total_after/1024:.0f} KB "
      f"({100*(1-total_after/total_before):.0f}% smaller)")
