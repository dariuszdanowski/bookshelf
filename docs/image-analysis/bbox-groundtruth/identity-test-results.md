# Identity-test — wyniki

```

Identity-test — rozpoznanie tytułów (fuzzy match), v6 vs identity-only
════════════════════════════════════════════════════════════════════════

📷 04 (shelf)  GT czytelnych tytułów=9
   v6 (z bbox)          title-recall=83%  precyzja=94%  wykrytych=8  $0.0382
   identity (bez bbox)  title-recall=89%  precyzja=100%  wykrytych=8  $0.0262

📷 02 (mixed)  GT czytelnych tytułów=10
   v6 (z bbox)          title-recall=90%  precyzja=82%  wykrytych=11  $0.0475
   identity (bez bbox)  title-recall=95%  precyzja=79%  wykrytych=12  $0.0256

📷 03 (none)  GT czytelnych tytułów=6
   v6 (z bbox)          title-recall=67%  precyzja=67%  wykrytych=6  $0.0327
   identity (bez bbox)  title-recall=67%  precyzja=57%  wykrytych=7  $0.0199

════════════════════════════════════════════════════════════════════════
PODSUMOWANIE (mediana z 2 przebiegów)
Photo Type   Wariant               recall  precyzja  wykrytych/GT
------------------------------------------------------------------------
04   shelf  v6 (z bbox)            83%     94%     8/9
04   shelf  identity (bez bbox)    89%    100%     8/9
02   mixed  v6 (z bbox)            90%     82%     11/10
02   mixed  identity (bez bbox)    95%     79%     12/10
03   none   v6 (z bbox)            67%     67%     6/6
03   none   identity (bez bbox)    67%     57%     7/6

Łączny koszt: $0.1901
```
