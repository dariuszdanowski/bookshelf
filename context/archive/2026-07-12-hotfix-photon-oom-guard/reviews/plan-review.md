<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Hotfix: Photon OOM guard w pipeline zdjęć

- **Plan**: context/changes/hotfix-photon-oom-guard/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-12
- **Werdykt**: SOLIDNY (po zastosowanych poprawkach)
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 1 obserwacja — oba naprawione inline

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY (po poprawce F1) |
| Kompletność planu | ZALICZONY (po poprawce F2) |

## Ugruntowanie

Grounding: 8/8 paths ✓ (resize.ts, crop.ts, upload-file.ts, PhotoUploader.tsx, process.ts, refine.ts, resize.test.ts, thumb.ts), symbols ✓ (deriveWorkingCopy, deriveThumbnail, deriveDetectionCrop, MAX_FILE_SIZE_BYTES, THUMB_MAX_INPUT_BYTES — blast radius exhaustive, no missed callers), brief↔plan ✓

## Ustalenia

### F1 — Kryterium sukcesu „npm run build" fałszywie sugerowało weryfikację izolacji photon/client

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — poprawka oczywista i wąska
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 2, Kryteria sukcesu (Weryfikacja automatyczna)
- **Szczegóły**: Subagent zweryfikował, że `@cf-wasm/photon/package.json` nie ma `browser` condition — `./workerd` subpath jest bezwarunkowy. `astro.config.mjs:34-35` ma tylko `optimizeDeps.exclude` (dev-only, nieistotne dla `astro build`). Gdyby `limits.ts` przez pomyłkę zaciągnął import z `resize.ts`, Vite/Rollup prawdopodobnie zbundlowałby to CICHO do client chunka zamiast rzucić błąd — `npm run build` przechodzący nie dowodzi izolacji.
- **Fix**: Uczyniono niezmiennik trywialnie prawdziwym przez konstrukcję (zero importów w `limits.ts`, komentarz-strażnik w kodzie); zmieniono sformułowanie kryterium sukcesu, żeby nie przypisywać `npm run build` roli dowodu tej własności.
- **Decyzja**: NAPRAWIONE (inline, plan.md zaktualizowany)

### F2 — Cytowany precedens (thumb.ts importowany przez browser-islands) jest nieaktualny

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: „Kluczowe odkrycia" (Analiza stanu obecnego)
- **Szczegóły**: `thumb.ts:3-5` ma komentarz „importują go browser-islands", ale subagent zweryfikował grepem, że żaden client island obecnie nie importuje `thumb.ts` (importerzy: wyłącznie serwer). Plan cytował ten komentarz jako dowód sprawdzonego wzorca — `limits.ts` będzie pierwszym takim przypadkiem, nie powtórzeniem.
- **Fix**: Skorygowano „Kluczowe odkrycia" — bezpieczeństwo wynika z semantyki JS (zero importów), nie z nieistniejącego precedensu.
- **Decyzja**: NAPRAWIONE (inline, plan.md zaktualizowany)
