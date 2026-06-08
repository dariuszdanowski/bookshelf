import json
from PIL import Image, ImageDraw

GT_DIR = "docs/image-analysis/bbox-groundtruth"

def load(f):
    j = json.load(open(f"{GT_DIR}/{f}", encoding="utf-8"))
    return j if isinstance(j, list) else j["detections"]

# 04 (landscape shelf) — najgorszy przypadek. GT vs realny API v6 vs API v7.
img = Image.open(f"{GT_DIR}/04-shelf-dariusz.jpg").convert("RGB")
W, H = img.size
draw = ImageDraw.Draw(img)
layers = [("04-shelf-dariusz.json", "lime"), ("04-v6-run3.raw.json", "red"), ("04-v7-final-run1.raw.json", "cyan")]
for f, color in layers:
    for d in load(f):
        x1, y1, x2, y2 = d["bbox"]
        draw.rectangle([x1*W, y1*H, x2*W, y2*H], outline=color, width=3)
out = f"{GT_DIR}/04-api-compare.overlay.jpg"
img.save(out, quality=90)
print(f"{out}  green=GT  red=API-v6  cyan=API-v7")
