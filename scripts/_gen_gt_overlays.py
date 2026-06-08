import json
from PIL import Image, ImageDraw

GT_DIR = "docs/image-analysis/bbox-groundtruth"

tasks = [
    ("01-shelf-vertical.jpg", "01-shelf-vertical.json", "01-gt-display.overlay.jpg"),
    ("02-mixed-display.jpg", "02-mixed.json", "02-gt-display.overlay.jpg"),
    ("03-bed-nonshelf-display.jpg", "03-bed-nonshelf.json", "03-gt-display.overlay.jpg"),
]

for img_file, json_file, out_file in tasks:
    img = Image.open(f"{GT_DIR}/{img_file}").convert("RGB")
    with open(f"{GT_DIR}/{json_file}", encoding="utf-8") as f:
        gt = json.load(f)
    W, H = img.size
    draw = ImageDraw.Draw(img)
    for det in gt["detections"]:
        x1, y1, x2, y2 = det["bbox"]
        px1, py1, px2, py2 = x1*W, y1*H, x2*W, y2*H
        draw.rectangle([px1, py1, px2, py2], outline="lime", width=4)
        draw.text((px1+4, py1+4), str(det["position"]), fill="yellow")
    img.save(f"{GT_DIR}/{out_file}", quality=88)
    print(f"  {out_file}  ({W}x{H})  {len(gt['detections'])} bboxow")
print("done")
