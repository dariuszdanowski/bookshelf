# S-40: Jakość bboxów z vision — Plan Brief

> Full plan: `context/changes/bbox-quality-validation/plan.md`
> Identity + analiza: `context/changes/bbox-quality-validation/change.md`

## What & Why

Vision-model **systematycznie klastruje współrzędne bbox** (prod: 51/71 detekcji `y2=0.5550`, 18× `y1=0.30`) → ramki grzbietów ucięte ~13%, nie sięgają deski. Prompt v6 już instruuje poprawnie, a model ignoruje → to bias, nie brak instrukcji. Mierzymy go (IoU vs ground-truth), iterujemy prompt mocniejszą dźwignią i kończymy wdrożeniem najlepszego promptu + raportem czy potrzebny dalszy krok. Bezpośredni cel: scena-hero demo (bboxy na zdjęciu) ma wyglądać przekonująco.

## Starting Point

`src/lib/vision/prompt.ts` v6 ma instrukcję „y2 = deska półki" — zignorowaną przez model. UI overlay jest poprawny (zweryfikowany, E2E S-18/S-37). Istnieje infra benchmarku (`scripts/bbox-prompt-benchmark.mjs`, woła realny vision z `.dev.vars`), ale bez IoU.

## Desired End State

Zmierzony baseline + warianty promptu; najlepszy wdrożony jako `PROMPT_VERSION='v7'` (jeśli bije baseline bez regresji detekcji); jawny raport decyzyjny: prompt wystarczył / potrzebny post-processing / model. Na zdjęciu demo overlay sięga deski bez klastrowania.

## Key Decisions Made

| Decyzja | Wybór | Czemu | Źródło |
| --- | --- | --- | --- |
| Ground-truth | Agent anotuje przez Read tool | zero kosztu/toilu, zgodne z regułą „obrazy przez Read"; deliberate > single-shot | Plan |
| DoD | Best prompt + decision point | praktyczne pod demo; pełny post-proc dopiero jeśli raport uzasadni | Plan |
| Metryka | IoU per detekcja + % klastrowania + recall | kwantyfikuje bias, chroni przed regresją wykrywania | Plan |
| Dźwignia | few-shot ze współrzędnymi + anti-anchoring | v6 ma instrukcję, model ignoruje → trzeba mocniej | Change |
| Post-processing | poza zakresem (tylko rekomendacja) | surowe heurystyki odrzucone bez dowodu | Change |

## Scope

**In scope:** harness IoU, ground-truth 2 zdjęć, 2–3 warianty promptu, pomiar, wdrożenie zwycięzcy, raport decyzyjny.
**Out of scope:** implementacja post-processingu, S-21 re-OCR, zmiana palety/overlay/refine-promptu, detektor YOLO.

## Architecture / Approach

Validation-first: narzędzie pomiaru (IoU) → iteracja promptu mierzona tym narzędziem → wdrożenie zwycięzcy + decyzja. Benchmark woła realny vision (BYOK), porównuje detekcje do ręcznie-anotowanego ground-truth. Zmiana produkcyjna = wyłącznie treść `VISION_SYSTEM_PROMPT` + bump wersji.

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Ground-truth + harness IoU | baseline v6 zmierzony liczbowo | jakość ręcznej anotacji agenta |
| 2. Warianty promptu + pomiar | zwycięzca lub „nic nie pomaga" | model może ignorować KAŻDY prompt (bias twardy) |
| 3. Wdrożenie + raport | v7 (warunkowo) + decyzja go/no-go | regresja recall detekcji przy zmianie promptu |

**Prerequisites:** dostęp do 2 zdjęć prod (Storage, service-role z `.dev.vars`), `ANTHROPIC_API_KEY` (BYOK, koszt zaakceptowany).
**Estimated effort:** ~1–2 sesje (3 fazy; gros to benchmark + anotacja, niski wolumen kodu).

## Open Risks & Assumptions

- **Bias może być nieusuwalny promptem** — wtedy Faza 3 = raport rekomendujący post-processing/model (DoD nadal spełnione: osiągnięto decision point).
- Ground-truth z rodziny tego samego modelu (agent) — odnotowane jako ograniczenie; deliberate annotation łagodzi.
- Benchmark to manual/BYOK, NIE w CI (koszt + niedeterminizm — koszt-guardrail).

## Success Criteria (Summary)

- Baseline i warianty zmierzone IoU; zwycięzca wdrożony lub jawnie uzasadniony brak.
- Na realnym zdjęciu overlay sięga deski bez klastrowania (bramka demo).
- Raport jednoznaczny co do następnego kroku (post-proc / S-21 / koniec).
