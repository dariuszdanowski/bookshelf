# S-43 Vision Identity-First — Plan Brief

> Full plan: `context/changes/vision-identity-first/plan.md`
> Decyzja źródłowa: `context/archive/2026-06-07-bbox-quality-validation/change.md` (sekcja „Pivot produktowy 2026-06-09")

## What & Why

Przeorientowanie pipeline'u vision z „ciasny bbox per książka" na **rozpoznanie jako cel**.
S-40 zmierzył twardo, że współrzędne z promptu są wrodzenie zawodne (klastrowanie, afiniczna
deformacja, wysoka wariancja), a prompt **bez** bbox czyta ≥ równie dobrze i jest 30–46%
tańszy. Wartość produktu = JAKIE książki są na zdjęciu, nie gdzie — match i dedup używają
wyłącznie tekstu, nigdy pikseli.

## Starting Point

Kod jest już w dużej mierze identity-tolerant: `match.ts`/`score.ts` operują tylko na
`raw_title`/`raw_author`; `bbox` jest nullable w schema/DB/DTO; UI degraduje się łagodnie
(detekcja bez boxa renderuje się jako karta). Jedyny twardy wymóg bboxa to endpoint manualnego
tworzenia detekcji (`POST /detections`). Główny prompt (`prompt.ts`, `PROMPT_VERSION='v6'`)
wciąż żąda współrzędnych.

## Desired End State

Główny prompt zwraca `{position, title, author, confidence, spine_color}` bez współrzędnych;
karty „potwierdź" to jedyna domyślna ścieżka review; bbox-editor jest opcjonalnym narzędziem
naprawczym (rysowanie/lokalizacja na żądanie); „dodaj pominiętą książkę" działa przez wpis
tytułu bez rysowania. Zero migracji DB; historyczne runy v6 nietknięte.

## Key Decisions Made

| Decyzja | Wybór | Why | Source |
| --- | --- | --- | --- |
| Zakres `kind` (książki/gry) | Tylko książki, gry odłożone | Najmniejszy spójny scope; gry = osobny slice | Plan (fork usera) |
| Lokalizacja/marker | Czysta identyfikacja, brak współrzędnych z modelu | Zgodne z pomiarem S-40 (taniej, czyściej) | Plan (fork usera) |
| Migracja DB | Żadna | bbox już nullable, brak nowych kolumn | Plan |
| `PROMPT_VERSION` | v6 → v7 | `prompt_version` to text — bez migracji | Plan |
| `spine_color` | Zostaje w prompcie | Load-bearing (filtr S-08) | Plan |
| `orientation` | Usunięte z promptu | Nie persystowane w DB; służyło logice bbox | Plan |
| Schema Zod | Bez zmian | bbox/orientation już optional+nullable+catch | Plan |
| „Dodaj pominiętą" | Wpis tytułu bez rysowania | `POST /detections` przyjmuje opcjonalny title, bbox optional | Plan |
| Miniatura na karcie | Okładka kandydata | Brak crop grzbietu bez bboxa | Plan |
| KPI | title-recall + precyzja + czas review | IoU porzucone (S-40) | Plan |

## Scope

**In scope:**
- Identity-first prompt (drop bbox/orientation), bump `PROMPT_VERSION` v7
- `POST /detections` z opcjonalnym `title` + opcjonalnym `bbox`; UI „dodaj pominiętą po tytule"
- Reframe UI: karty główne, overlay/bbox jako drugorzędne narzędzie naprawcze, graceful empty
- Unit + E2E (mock identity-response bez bbox)

**Out of scope:**
- `kind` / wsparcie gier; marker/coarse-bbox z modelu; migracje DB
- Korekta afiniczna X / post-processing geometrii (warunkowy slice z S-40)
- Usuwanie bbox-editora ani kolumn bbox/quad; zmiana progów matchingu

## Architecture / Approach

Trzy atomic fazy: (1) prompt + schema/pipeline confirm + testy + AGENTS.md → mierzony rdzeń;
(2) endpoint `POST /detections` rozluźniony + UI add-missed-by-title → auto-rematch;
(3) reframe UI (karty główne, overlay drugorzędny z CTA rysowania) + E2E golden-path.
Rdzeń pivota to zmiana promptu — reszta kodu już toleruje brak bboxa.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Prompt identity-first | Detekcje bez współrzędnych, taniej, recall ≥ v6 | Regresja parse'owania starych runów (mitigacja: backward-compat test) |
| 2. Manualny wpis tożsamości | „Dodaj pominiętą" po tytule bez rysowania | Kontrakt endpointu (co najmniej title lub bbox) |
| 3. Reframe UI | Karty główne, bbox jako naprawa, E2E golden-path | Empty-overlay UX + determinizm E2E (S-44) |

**Prerequisites:** S-40 zamknięty (decyzja identity-first); branch `change/vision-identity-first` od main.
**Estimated effort:** ~3 sesje (1 faza/sesja); implementacja Sonnetem po `/clear`.

## Open Risks & Assumptions

- Identity-only prompt zachowuje recall ≥ v6 na realnej kolekcji (zmierzone N=2 w S-40; potwierdzenie = manualny smoke Fazy 1).
- Przy 0 bboxach widok overlay musi pozostać użyteczny (CTA rysowania) — UX Fazy 3.
- Determinizm pełnego E2E (shared-session storageState) — zgodnie z S-44.

## Success Criteria (Summary)

- Przetworzenie zdjęcia zwraca rozpoznane książki jako karty „potwierdź", bez wymogu bboxa, taniej niż v6.
- User dodaje pominiętą książkę wpisem tytułu i otrzymuje kandydatów — bez rysowania.
- Rysowanie ramki działa jako opcjonalna naprawa; pełny E2E golden-path zielony.
