# OCR benchmark report (2026-06)

Benchmark date: 2026-05-31T22:51:40.501Z
Cases evaluated: 6 (primary OCR-repair subset: 3)
Success threshold (title similarity): 0.75

## Summary

- Baseline recall@top1 (existing raw_title): 66.7%
- Best OCR profile: tesseract_psm6 (Tesseract.js (PSM 6, uniform block))
- Best OCR recall@top1: 0.0%
- Lift vs baseline: -66.7 pp
- Decision: **no-go**

## Profile comparison

| Profile | Recall@top1 | Avg confidence | Primary cases |
| --- | ---: | ---: | ---: |
| tesseract_psm7 | 0.0% | 18.7% | 3 |
| tesseract_psm6 | 0.0% | 43.7% | 3 |

## Per-case results (best profile)

| Case | Track | Similarity | OCR text (trimmed) |
| --- | --- | ---: | --- |
| A_p01 | ocr_repair | 3.1% | wz                      p
TC a? NR
NY               -
ty          \|
\|            \|
'
\| |
| A_p11 | ocr_repair | 14.3% | $% © www o a \|
i s e LI        DIVINITY    we ——
 x        ;  yu.  m       jaw c  '    z  |
| A_p16 | ocr_repair | 9.3% | ',                                        :          OE yl Tr O         == >             p |
| B_p09 | localization_blocked | 11.3% | AL                        )                                x

; 7     z                    |
| B_p10 | localization_blocked | 17.4% | HE                 Sk            s
NE         \|                  kl >          Ce
th:     |
| B_p11 | localization_blocked | 8.3% | 3 3                  :                                                              ii
Pay |

## Recommendation

- NO-GO for OCR-first at this stage. Keep manual LLM refine as primary fallback and revisit after localization improvements and broader OCR evaluation.
