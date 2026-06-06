# Impl-review — photo-upload-skip-process (S-36)

**Data:** 2026-06-07
**Reviewer:** agent (Opus), Fast track

## Zgodność plan ↔ implementacja

| Kontrakt | Stan |
| --- | --- |
| Checkbox `auto-process-checkbox`, default true, localStorage `bookshelf:upload-auto-process` | ✅ |
| Skip path: bez `/process`/`/match`, BEZ resume-state (pitfall roadmapy), redirect `?tab=photos` | ✅ |
| `useShelfTab` honoruje `?tab=` (param > localStorage, persist; śmieci → fallback) | ✅ |
| Adaptacja: „Uruchom vision" w tabie bez rename (intent „Analizuj" zachowany) | ✅ udokumentowane w change.md |
| Testy: 4 unit PhotoUploader + 2 ShelfTabs + 2 E2E | ✅ |

## Findings

### F1 (LOW, zaaplikowane w trakcie) — hydration race w E2E

`uncheck()` przed hydratacją islanda ginął (handler niepodpięty) → flaky persist-test.
Fix: wait na `shelf-select` (sygnał hydratacji + fetch półek) przed interakcją —
pattern znany z `photos-crud.spec.ts` (`revealPhotosTab`).

## Weryfikacja

- ✅ lint · typecheck 0 err · unit **890/890** · E2E **132 passed / 0 failed**
  (w tym twardy guardrail: kolektor requestów potwierdza ZERO wywołań `/process`/`/match` przy skip)
- ⏳ Manual 1.5 (user-only): skip-upload na realnym zdjęciu, zero kosztu, ręczny vision z taba

## Werdykt

**PASS** — zero zmian backendu (zgodnie z planem), pitfall resume-state pokryty asercją.
