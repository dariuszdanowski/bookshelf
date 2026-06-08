# S-40: Jakość bboxów z vision — Plan Brief

> Full plan: `context/changes/bbox-quality-validation/plan.md`
> Identity + analiza + reframe: `context/changes/bbox-quality-validation/change.md`

## What & Why

Vision-model **klastruje współrzędne bbox** (prod: 51/71 detekcji `y2=0.5550`) → ramki nie obrysowują pojedynczych książek. **Reframe (user):** instrukcja v6 „y2 = deska półki" to błędne uogólnienie — działa tylko dla pionowych na półce, **łamie się na zdjęciach nie-półkowych** (koc / stos na blacie — Flow B „dodaj zakup", przypadek pełnoprawny) i jest **głównym podejrzanym o samo klastrowanie** (model kotwiczy wszystkie y2 do jednej domniemanej linii). Cel: bboxy ciasno obrysowujące widoczne książki na każdym typie zdjęcia — pod scenę-hero demo.

## Starting Point

`src/lib/vision/prompt.ts` v6 zakotwiczony w „desce". UI overlay poprawny (E2E S-18/S-37). Jest infra benchmarku (`scripts/bbox-prompt-benchmark.mjs`, realny vision z `.dev.vars`) bez IoU.

## Desired End State

Baseline + warianty zmierzone IoU na **3 zdjęciach różnego rodzaju**; najlepszy wdrożony jako `PROMPT_VERSION='v7'` (jeśli bije baseline bez regresji na żadnym typie); raport decyzyjny (prompt wystarczył / post-proc / model + czy kotwica „deska" była przyczyną). Overlay ciasny na półce I poza nią.

## Key Decisions Made

| Decyzja | Wybór | Czemu | Źródło |
| --- | --- | --- | --- |
| Niezmiennik bbox | ciasny obrys widocznego obiektu, surface-agnostic, per-book | „deska" błędna i podejrzana o klastrowanie | User |
| Zakres non-shelf | pełnoprawny (koc/stos/blat) | Flow B fotografuje blat, nie półkę | User |
| Korpus referencyjny | 3 zdjęcia różnego rodzaju (user dostarcza) | pokrycie półka / stos / nie-półka | User |
| Ground-truth | agent anotuje przez Read | zero kosztu/toilu; deliberate > single-shot | Plan |
| DoD | best prompt + decision point | praktyczne pod demo | Plan |
| Dźwignia | usuń „deska" + tight-bound + anti-anchoring | testuje hipotezę, że kotwica = przyczyna | Plan |

## Scope

**In scope:** harness IoU, ground-truth 3 typów, warianty promptu surface-agnostic, pomiar per-typ, wdrożenie zwycięzcy, raport.
**Out of scope:** implementacja post-processingu, S-21, zmiana palety/overlay/refine, YOLO.

## Architecture / Approach

Validation-first na zróżnicowanym korpusie: pomiar (IoU) → iteracja promptu wokół poprawnego niezmiennika → wdrożenie + decyzja. Zmiana prod = wyłącznie treść `VISION_SYSTEM_PROMPT` + bump wersji.

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Ground-truth (3 typy) + harness IoU | baseline per-typ zmierzony | jakość ręcznej anotacji agenta |
| 2. Warianty promptu (surface-agnostic) | zwycięzca lub „nic nie pomaga" | bias może być nieusuwalny promptem |
| 3. Wdrożenie + raport | v7 (warunkowo) + decyzja | regresja recall lub poprawa na półce kosztem nie-półki |

**Prerequisites:** **user dostarcza 3 zdjęcia różnego rodzaju**; `ANTHROPIC_API_KEY` (BYOK, koszt zaakceptowany).
**Estimated effort:** ~1–2 sesje (gros to benchmark + anotacja 3 zdjęć).

## Open Risks & Assumptions

- Bias może być nieusuwalny promptem → Faza 3 = raport rekomendujący post-proc/model (DoD spełnione: decision point).
- Poprawa na półce może pogorszyć nie-półkę (i odwrotnie) — dlatego metryki per-typ + guard regresji.
- Ground-truth z rodziny tego modelu (agent) — ograniczenie odnotowane.
- Benchmark manual/BYOK, NIE w CI.

## Success Criteria (Summary)

- Baseline i warianty zmierzone IoU per-typ; zwycięzca wdrożony lub jawnie uzasadniony brak.
- Overlay ciasny na półce I nie-półkowym (bramka demo).
- Raport: kotwica „deska" — przyczyna czy nie; następny krok jednoznaczny.
