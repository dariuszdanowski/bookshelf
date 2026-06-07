---
change_id: uwagi-round3
title: "Runda 3 uwag z testów manualnych (M24–M27) + backfill atrybucji kosztów"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T15:30:00Z
---

## Notes

Tryb pracy ustalony przez usera: „fix od razu bez PR — będę od razu testował,
na końcu wrzucimy na produkcję poprawki w jednym PR". Jeden zbiorczy branch,
commit per uwaga, user testował na dev (dev server → prod DB) po każdym fixie.

- **M24** (obrazek zajmuje więcej niż ekran): overlay renderował fit-to-width
  (`width: zoom×100%`) — portret 9:16 na desktopie = 1888 px w oknie 648 px
  (pomiar Playwright). Fix: `fitScale` z naturalnych proporcji po onLoad —
  zoom=1 to contain; poziome zdjęcia bez zmian (fitScale=1).
- **M25**: pasek sterujący (Edytuj ramki/$ /Ukryj/zoom) pływa w lewym górnym
  rogu kontenera zdjęcia (absolute sibling viewportu — klik nie startuje
  pan/draw).
- **M26**: każda wzmianka o koszcie = przycisk CostPanel z wartością jako
  etykietą i hintem; etykieta to PEŁNA suma (wszystkie vision_runs +
  refine_calls — spójna z dropdownem): `costs_total_usd` w GET /api/photos/[id]
  (+ per-detekcja `refine_cost_usd`), `total_cost_usd` w liście zdjęć (batch).
  Świadomie nieruszone: agregaty na /account (sekcja raportowa) i teksty
  w confirm-dialogach (ostrzeżenie przed akcją).
- **M27**: suma kosztów per klucz API na /account. Migracja 0020
  (`api_key_id` w vision_runs/refine_calls, FK SET NULL), zapis przy callach
  DEFENSYWNY (retry bez kolumny na PGRST204/42703 — dev-na-prodzie działał
  przed migracją), `cost_by_key` w stats, chip przy kluczu.
- **Backfill (prod, za zgodą usera)**: 0020 zaaplikowana ręcznie + 26 runs
  przypisane do klucza „Anthropic" ($0.8801); ledger migracji naprawiony
  przez usera (`migration repair` 20260607142810→reverted, 0020→applied) —
  `db push` po merge przeskoczy 0020.
- **Środowiskowe** (nie kod): zwichnięty cache Vite optimized-deps (zod 404)
  ubijał hydratację islandów z zodem (/upload rano, /account po południu) —
  fix: wymuszony wbudowany restart dev servera (touch astro.config.mjs).
  Plus `<form>` wokół pól hasła (Chrome warning).
- **Roadmapa**: S-41 cost-analysis-view (docelowy ekran/modal analizy kosztów
  per klucz/działanie — „na razie zostawimy listę"), S-42 camera-capture
  (webcam + aparat telefonu, rozwój post-MVP).

## Outcome

1. M24: zoom=1 mieści całe zdjęcie w oknie podglądu (contain) na każdej
   proporcji; zoom/pan/pinch ponad bazową skalą.
2. M25: kontrolki zdjęcia pływają nad kontenerem (mniej pionowego miejsca).
3. M26: koszt wszędzie jako klikalny przycisk z pełną sumą vision+OCR.
4. M27: /account pokazuje sumę kosztów przy każdym kluczu; wszystkie
   istniejące dane przypisane do klucza „Anthropic" (backfill na prodzie).
5. Nowe E2E: photo-fit-contain (3), cost-panel rozszerzony (2 asercje M26);
   unit: stats +2, AccountIsland +1.
