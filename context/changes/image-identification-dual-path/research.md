---
date: 2026-06-01T12:00:00+02:00
researcher: GitHub Copilot (GPT-5.3-Codex)
git_commit: 72ac8ec
branch: change/match-threshold-and-anthology
repository: bookshelf
topic: "Czy skille 10xDevs nadają się do pełnego cyklu dla dwóch planów identyfikacji książek"
tags: [research, 10xdevs, planning, ocr, vision]
status: complete
last_updated: 2026-06-01
last_updated_by: GitHub Copilot (GPT-5.3-Codex)
---

# Research: 10x skills for dual identification plans

## Research Question

Czy zestaw skilli 10xDevs w tym repo może zostać użyty do poprowadzenia pełnego cyklu zmiany (new -> research -> plan -> plan-review -> implement), oraz czy nadaje się do zbudowania dwóch równoległych kierunków: OCR bez LLM i fallback z drugim przebiegiem obrazu.

## Summary

Tak. Skille 10x są wystarczające do pełnego cyklu dla tej zmiany.

Najbardziej adekwatny przepływ:
1. `/10x-new` -> utworzenie tożsamości zmiany.
2. `/10x-research` -> zebranie danych technicznych, porównanie opcji, artefakt research.
3. `/10x-plan` -> plan wdrożenia w fazach z sekcją `## Progress`.
4. `/10x-plan-review` -> walidacja kompletności i wykonalności planu.
5. `/10x-implement` -> realizacja faz po fazie.
6. `/10x-impl-review` + `/10x-archive` -> domknięcie.

Kluczowy wniosek: oba tory (OCR bez LLM i fallback LLM) powinny być ujęte w jednej zmianie, ale wdrażane sekwencyjnie (najpierw fallback detection-scoped, potem benchmark OCR i decyzja o produkcyjnej integracji).

## Detailed Findings

### 1) Skill `10x-new`

Co wnosi:
- wymusza jednoznaczny `change-id`
- tworzy `context/changes/<id>/change.md`
- narzuca porządek wejścia do cyklu

Dlaczego pasuje:
- temat jest odrębną jednostką pracy (strategia identyfikacji + koszt + jakość), więc naturalnie mapuje się na jeden folder zmiany.

### 2) Skill `10x-research`

Co wnosi:
- formalny artefakt research (`research.md`)
- możliwość równoległych badań kodu i historii
- porównanie wariantów z evidence-based decyzją

Dlaczego pasuje:
- tu istnieją dwa tory techniczne i trzeba udokumentować trade-off koszt/jakość, więc research jest obowiązkowy.

### 3) Skill `10x-plan`

Co wnosi:
- plan fazowy z testowalnym DoD
- mechaniczny kontrakt `## Progress`
- podział na automated/manual verification

Dlaczego pasuje:
- temat ma silny komponent architektoniczny i ryzyka kosztowe; fazowy plan redukuje ryzyko dryfu.

### 4) Skill `10x-plan-review`

Co wnosi:
- gate jakości planu przed implementacją
- wykrywanie luk: brak rollbacku, niejednoznaczne kontrakty, niespójny `Progress`

Dlaczego pasuje:
- zmiana dotyka pipeline vision/matching i może eskalować koszty; review planu jest krytyczny.

### 5) Skills implementacyjne

Skille:
- `10x-implement`
- `10x-impl-review`
- `10x-archive`

Dlaczego pasują:
- oba tory dają się rozbić na 3-4 fazy każda, więc implementacja może być atomowa i audytowalna.

## Skill-to-task matrix

| Zadanie | Skill | Czy używać | Uzasadnienie |
|---|---|---|---|
| Start zmiany | `10x-new` | Tak | porządek i identyfikowalność |
| Analiza opcji OCR vs LLM fallback | `10x-research` | Tak | temat decyzyjny z trade-offami |
| Planowanie faz | `10x-plan` | Tak | potrzebny kontrakt implementacyjny |
| Walidacja planu | `10x-plan-review` | Tak | redukcja ryzyka kosztowego i architektonicznego |
| Wdrożenie | `10x-implement` | Tak | fazowy rollout i checkpointy |
| Review po wdrożeniu | `10x-impl-review` | Tak | quality gate przed archiwizacją |
| Zamknięcie | `10x-archive` | Tak | utrzymanie higieny `context/` |

## Recommended execution shape

Rekomendowany kształt jednej zmiany:

- Faza A: fallback detection-scoped (minimalny koszt, szybki zysk)
- Faza B: benchmark OCR bez LLM na realnych cropach
- Faza C: decyzja architektoniczna (OCR service vs fallback-only)
- Faza D: ewentualny hybrid orchestrator

## Open Questions

- Czy po benchmarku OCR bez LLM akceptujemy dodatkowy komponent infrastrukturalny, czy zostajemy przy fallback LLM + gating?
- Jaki miesięczny budżet API jest graniczny, po którym fallback automatyczny ma być ograniczany?
