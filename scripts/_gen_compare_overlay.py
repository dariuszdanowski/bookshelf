import json
from PIL import Image, ImageDraw

GT_DIR = "docs/image-analysis/bbox-groundtruth"

def load(f):
    j = json.load(open(f"{GT_DIR}/{f}", encoding="utf-8"))
    return j if isinstance(j, list) else j["detections"]

# zdjęcie 01 = 04 (ten sam obraz). Rysujemy 3 źródła.
img_file = "01-shelf-vertical.jpg"
layers = [
    ("01-shelf-vertical.json", "lime", 0),   # GT-01 (deska)
    ("01-model-v6.json",       "red",  0),    # API v6
    ("01-shelf-vertical.llm.json", "cyan", 0),# LLM via Read
]

img = Image.open(f"{GT_DIR}/{img_file}").convert("RGB")
W, H = img.size
draw = ImageDraw.Draw(img)
for f, color, _ in layers:
    for d in load(f):
        x1, y1, x2, y2 = d["bbox"]
        draw.rectangle([x1*W, y1*H, x2*W, y2*H], outline=color, width=3)
out = f"{GT_DIR}/01-compare.overlay.jpg"
img.save(out, quality=90)
print(f"{out} ({W}x{H})  green=GT01  red=API-v6  cyan=LLM-read")

# osobno: GT-04 (dół grzbietu) vs GT-01 (deska) — pokazać niespójność GT
img2 = Image.open(f"{GT_DIR}/{img_file}").convert("RGB")
draw2 = ImageDraw.Draw(img2)
for d in load("01-shelf-vertical.json"):
    x1, y1, x2, y2 = d["bbox"]; draw2.rectangle([x1*W, y1*H, x2*W, y2*H], outline="lime", width=3)
for d in load("04-shelf-dariusz.json"):
    x1, y1, x2, y2 = d["bbox"]; draw2.rectangle([x1*W, y1*H, x2*W, y2*H], outline="orange", width=3)
out2 = f"{GT_DIR}/01-gt-disagree.overlay.jpg"
img2.save(out2, quality=90)
print(f"{out2}  green=GT01(deska)  orange=GT04(dół grzbietu) — niespójność GT")
