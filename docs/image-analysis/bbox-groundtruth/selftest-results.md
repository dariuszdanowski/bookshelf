# Bbox self-test (bez API) — wyniki

```

Bbox SELF-TEST (bez API) — GT usera vs LLM-via-Read vs API v6
══════════════════════════════════════════════════════════════════════════════

📷 01  GT=9 książek
   llm-read  dets=8 recall=89% medIoU(2D)=0.419 med-xIoU(1D)=0.528 fp=0
             centerHit=63% (środek detekcji w GT książce)  szerokość×1.41  |Δy2|=0.099
             klaster: %Y2=25% (mode=0.9 ×2)  %Y1=25%
             afiniczne X: src=0.94·gt+0.036 (R²=0.987)
   model-v6  dets=8 recall=78% medIoU(2D)=0.326 med-xIoU(1D)=0.500 fp=1
             centerHit=57% (środek detekcji w GT książce)  szerokość×1.78  |Δy2|=0.024
             klaster: %Y2=88% (mode=0.83 ×7)  %Y1=38%
             afiniczne X: src=1.02·gt+0.005 (R²=0.971)

📷 02  GT=12 książek
   llm-read  dets=12 recall=100% medIoU(2D)=0.966 med-xIoU(1D)=0.985 fp=0
             centerHit=100% (środek detekcji w GT książce)  szerokość×1.00  |Δy2|=0.001
             klaster: %Y2=25% (mode=0.818 ×3)  %Y1=25%
             afiniczne X: src=1.00·gt+0.000 (R²=1.000)

📷 03  GT=6 książek
   llm-read  dets=6 recall=100% medIoU(2D)=0.993 med-xIoU(1D)=0.997 fp=0
             centerHit=100% (środek detekcji w GT książce)  szerokość×1.00  |Δy2|=0.000
             klaster: %Y2=17% (mode=0.452 ×1)  %Y1=17%
             afiniczne X: src=0.98·gt+0.009 (R²=0.999)

📷 04  GT=9 książek
   llm-read  dets=8 recall=78% medIoU(2D)=0.413 med-xIoU(1D)=0.527 fp=1
             centerHit=71% (środek detekcji w GT książce)  szerokość×1.00  |Δy2|=0.020
             klaster: %Y2=25% (mode=0.9 ×2)  %Y1=25%
             afiniczne X: src=1.04·gt+0.011 (R²=0.995)
   model-v6  dets=8 recall=67% medIoU(2D)=0.086 med-xIoU(1D)=0.467 fp=2
             centerHit=50% (środek detekcji w GT książce)  szerokość×1.32  |Δy2|=0.095
             klaster: %Y2=88% (mode=0.83 ×7)  %Y1=38%
             afiniczne X: src=1.14·gt-0.015 (R²=0.990)

══════════════════════════════════════════════════════════════════════════════
PODSUMOWANIE
══════════════════════════════════════════════════════════════════════════════
Photo Źródło    recall 2D-IoU 1D-xIoU ctrHit  szer×  |Δy2|  %Y2cl
------------------------------------------------------------------------------
01    llm-read    89%  0.419  0.528    63%  1.41  0.099    25%
01    model-v6    78%  0.326  0.500    57%  1.78  0.024    88%
02    llm-read   100%  0.966  0.985   100%  1.00  0.001    25%
03    llm-read   100%  0.993  0.997   100%  1.00  0.000    17%
04    llm-read    78%  0.413  0.527    71%  1.00  0.020    25%
04    model-v6    67%  0.086  0.467    50%  1.32  0.095    88%

Referencja prod API v6 (results.md, single-run):
  01: medIoU≈0.28 recall≈78% %Y2cluster≈100%
  02: medIoU≈0.15 recall≈67% %Y2cluster≈67%
  03: medIoU≈0.14 recall≈63% %Y2cluster≈17%

Interpretacja afiniczna: slope a≈1.0 & offset b≈0.0 = wierne odwzorowanie.
  a>1 = rozciągnięcie osi, |b|>0.05 = przesunięcie. Niskie R² = szum (brak liniowości).
```
