# Bbox IoU Benchmark — S-40

_Metryki: medIoU = median IoU po N przebiegach; ±σ = std dev; %Y2cluster = % detekcji z identycznym y2 (mod okrąglenie 0.001); Recall = dopasowane GT / łączne GT (greedy max-IoU)._

## 2026-06-08 — v6 baseline (single-run measurements, display-orientation GT)

GT zdjęć 02/03 w display-orientation coords (ExifTranspose, x_d=1-y_raw).

| Foto (typ) | Prompt | medIoU | ±σ | Recall | %Y2cluster | %Y1cluster | Koszt |
|---|---|---|---|---|---|---|---|
| 01 (shelf) | v6 | ~0.28 | — | ~78% | 100% (mode≈0.82–0.85 ×8) | ~50–63% | ~$0.019 |
| 02 (mixed) | v6 | ~0.15 | — | ~67% | 67% (mode≈0.88–0.95 ×8) | ~67% | ~$0.025 |
| 03 (none)  | v6 | ~0.14 | — | ~63% | 17% (mode≈0.42–0.44 ×1) | ~17% | ~$0.016 |

Wartości uśrednione z 2 niezależnych przebiegów (n=1 każdy). Pełny N=3 run po weryfikacji GT.

**Kluczowe obserwacje:**
- 01 (shelf): **100% Y2 klastrowanie** — wszystkie 8 detekcji ma identyczne y2≈0.82–0.85, bezpośredni dowód na bias kotwicy „deska półki"
- 02 (mixed): 67% Y2 klastrowanie — kotwica widoczna też na stosach poziomych
- 03 (none): 17% Y2 klastrowanie — bez półki model nie kotwiczył (brak „deski")


---

## 2026-06-08 — v6 (1 runs/photo)

| Foto (typ) | Prompt | medIoU | ±σ | Recall | %Y2cluster | %Y1cluster | Koszt |
|---|---|---|---|---|---|---|---|
| 04 (shelf) | v6 | 0.306 | 0.235 | 67% | 100% (mode=0.850 ×8) | 63% | $0.01910 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereptzentatywne, re-anotacja wymagana.

---

## 2026-06-08 — v7a-no-anchor (1 runs/photo)

| Foto (typ) | Prompt | medIoU | ±σ | Recall | %Y2cluster | %Y1cluster | Koszt |
|---|---|---|---|---|---|---|---|
| 04 (shelf) | v7a-no-anchor | 0.015 | 0.111 | 56% | 100% (mode=0.820 ×8) | 100% | $0.01924 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereptzentatywne, re-anotacja wymagana.

---

## 2026-06-08 — v7b-fewshot (1 runs/photo)

| Foto (typ) | Prompt | medIoU | ±σ | Recall | %Y2cluster | %Y1cluster | Koszt |
|---|---|---|---|---|---|---|---|
| 04 (shelf) | v7b-fewshot | 0.077 | 0.193 | 56% | 100% (mode=0.880 ×8) | 75% | $0.01944 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereptzentatywne, re-anotacja wymagana.

---

## 2026-06-08 — v7c-combined (1 runs/photo)

| Foto (typ) | Prompt | medIoU | ±σ | Recall | %Y2cluster | %Y1cluster | Koszt |
|---|---|---|---|---|---|---|---|
| 04 (shelf) | v7c-combined | 0.076 | 0.190 | 56% | 100% (mode=0.880 ×8) | 38% | $0.01951 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereptzentatywne, re-anotacja wymagana.

---

## 2026-06-08 — v6 (3 runs/photo)

_Metryki kierunkowe (S-40 self-test): xIoU=1D IoU w osi X; szer×=stosunek szerokości det/GT (>1 za szerokie); |Δy2|=śr. błąd dolnej krawędzi; ctrHit=% środków detekcji w GT książce._

| Foto (typ) | Prompt | medIoU | xIoU | szer× | \|Δy2\| | ctrHit | Recall | %Y2cluster | Koszt |
|---|---|---|---|---|---|---|---|---|---|
| 02 (mixed) | v6 | 0.424 | 0.746 | 0.81 | 0.045 | 100% | 83% | 67% (mode=0.950 ×8) | $0.07585 |
| 03 (none) | v6 | 0.322 | 0.858 | 1.08 | 0.026 | 100% | 83% | 17% (mode=0.420 ×1) | $0.04897 |
| 04 (shelf) | v6 | 0.207 | 0.358 | 1.29 | 0.075 | 50% | 67% | 100% (mode=0.820 ×8) | $0.05729 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereprezentatywne, re-anotacja wymagana.

---

## 2026-06-08 — v7-final (3 runs/photo)

_Metryki kierunkowe (S-40 self-test): xIoU=1D IoU w osi X; szer×=stosunek szerokości det/GT (>1 za szerokie); |Δy2|=śr. błąd dolnej krawędzi; ctrHit=% środków detekcji w GT książce._

| Foto (typ) | Prompt | medIoU | xIoU | szer× | \|Δy2\| | ctrHit | Recall | %Y2cluster | Koszt |
|---|---|---|---|---|---|---|---|---|---|
| 02 (mixed) | v7-final | 0.339 | 0.819 | 0.92 | 0.111 | 100% | 83% | 67% (mode=0.950 ×8) | $0.07898 |
| 03 (none) | v7-final | 0.263 | 0.857 | 1.09 | 0.025 | 100% | 83% | 17% (mode=0.460 ×1) | $0.05208 |
| 04 (shelf) | v7-final | 0.042 | 0.402 | 1.59 | 0.044 | 20% | 56% | 100% (mode=0.880 ×8) | $0.06047 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereprezentatywne, re-anotacja wymagana.

---

## 2026-06-08 — v6+think2500 (3 runs/photo)

_Metryki kierunkowe (S-40 self-test): xIoU=1D IoU w osi X; szer×=stosunek szerokości det/GT (>1 za szerokie); |Δy2|=śr. błąd dolnej krawędzi; ctrHit=% środków detekcji w GT książce._

| Foto (typ) | Prompt | medIoU | xIoU | szer× | \|Δy2\| | ctrHit | Recall | %Y2cluster | Koszt |
|---|---|---|---|---|---|---|---|---|---|
| 02 (mixed) | v6+think2500 | 0.398 | 0.730 | 0.77 | 0.090 | 100% | 83% | 67% (mode=0.920 ×8) | $0.11295 |
| 04 (shelf) | v6+think2500 | 0.189 | 0.348 | 1.39 | 0.104 | 33% | 67% | 100% (mode=0.820 ×8) | $0.08193 |

⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereprezentatywne, re-anotacja wymagana.
