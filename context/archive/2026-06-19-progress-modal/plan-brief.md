# Progress Modal — Krótki plan

> Pełny plan: `context/changes/progress-modal/plan.md`

## Co i dlaczego

Długie operacje (vision ~10s, rematch/refine ~3–5s) pokazują postęp wyłącznie jako
stan przycisku lub mały inline-spinner — zbyt subtelnie. User może nie zauważyć trwającego
procesu, kliknąć link w nawigacji i opuścić stronę, tracąc wyświetlenie wyników. Budujemy
blokujący modal overlay z opisem bieżącego kroku i indeterminate paskiem postępu.

## Punkt wyjścia

`PhotoUploader.tsx:578–595` ma już inline `progress-area` z spinnerem i etykietą etapu,
ale nie blokuje nawigacji. `DetectionReview.tsx` pokazuje progress tylko przez `busy=true`
na przyciskach. Istniejący testid `progress-area` używany jest w 2 spec'ach E2E — nowy
modal jest addytywny i go nie zastępuje.

## Pożądany stan końcowy

Po wgraniu zdjęcia, od etapu `processing` przez `matching`, pojawia się modal blokujący
header i nawigację — z etykietą etapu z `stageLabel`. Po kliknięciu „Szukaj" (rematch)
lub „Ponów analizę" (refine) w `DetectionReview` — analogiczny modal z dedykowanym opisem.
Modal zamyka się samoczynnie po zakończeniu operacji; błędy obsługuje istniejący inline UI.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
|---------|-------|----------|--------|
| Scope | PhotoUploader + DetectionReview | memory note wymienia „vision" + „rematch"; PhotoListIsland follow-up | Plan |
| Etapy z modalem (upload) | `processing` + `matching` | `uploading`/`recording` < 2s, natarczywe | Plan |
| Typ paska postępu | Indeterminate (`animate-pulse`) | API nie zwraca % ukończenia | Plan |
| Możliwość zamknięcia | Brak (blokujący) | Cel = blokada nawigacji; błędy → existing inline UI | Plan |
| Shared komponent | `src/components/ProgressModal.tsx` | Reużycie dla upload + rematch (memory note) | Plan |
| Tracking operacji w DetectionReview | `busyLabel: string \| null` | `busy` obsługuje też confirm/reject (za szybkie) | Plan |
| Addytywność | Nie usuwamy `progress-area` | 2 istniejące E2E spec'y go używają | Plan |

## Zakres

**W zakresie:**
- `src/components/ProgressModal.tsx` — nowy shared komponent
- `src/components/PhotoUploader.tsx` — modal dla `processing` + `matching`
- `src/components/DetectionReview.tsx` — `busyLabel` w hooku + modal dla rematch/refine
- E2E testy: modal visibility w `upload-flow.spec.ts` i `manual-rematch.spec.ts`

**Poza zakresem:**
- `PhotoListIsland.tsx` (row-level vision/match) — follow-up slice
- Determinate progress bar (streaming poza scope MVP)
- Error state w ProgressModal (obsługiwane przez istniejące inline UI)

## Architektura / Podejście

```
ProgressModal (src/components/ProgressModal.tsx)
  Props: { open: boolean; label: string }
  Wzorzec: identyczny z ConfirmDialog — fixed overlay, useBodyScrollLock,
           role="dialog", aria-modal — POZA: brak onClose/Escape
  
PhotoUploader — open={stage === 'processing' || stage === 'matching'}
              — label={stageLabel[stage]}

DetectionReview — dodaje busyLabel: string|null do useDetectionDecision
               — open={busyLabel !== null}, label={busyLabel}
```

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|------|-------------|-----------------|
| 1. ProgressModal | Shared komponent blokującego overlay | Escape key — upewnić się że NIE zamyka |
| 2. PhotoUploader | Blokada nawigacji podczas vision/match | Nie złamać `progress-area` testidów E2E |
| 3. DetectionReview | `busyLabel` + modal dla rematch/refine | `busy` vs `busyLabel` — confirm/reject bez modalu |
| 4. E2E | Testy visibility dla obu flow | Timing — `toBeVisible()` z odpowiednim timeout |

**Wymagania wstępne:** Brak zależności zewnętrznych; `useBodyScrollLock.ts` i `stageLabel` dostępne.  
**Szacowany nakład:** ~1 sesja implementacyjna w 4 fazach.

## Otwarte ryzyka i założenia

- Jeśli `useDetectionDecision` jest eksportowany/używany w >1 miejscu, zmiana sygnatury
  hooka może wymagać aktualizacji w kilku komponentach
- `ProgressModal` blokuje Escape — sprawdzić czy `useBodyScrollLock` nie dodaje własnego
  close handlera (z kodu hooków: nie robi tego)

## Kryteria sukcesu (podsumowanie)

- Modal blokuje nawigację header podczas vision/match (klik linku bez efektu)
- Modal pojawia się i znika automatycznie — bez akcji usera
- Istniejące E2E testy przechodzą bez zmian
