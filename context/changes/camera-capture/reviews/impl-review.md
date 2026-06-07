<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Camera Capture (S-42)

- **Plan**: context/changes/camera-capture/plan.md
- **Scope**: Phase 1–3 of 3 (full plan, post-merge PR #81)
- **Date**: 2026-06-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Drift agent: 18 MATCH, 3 minor DRIFT (CameraPreview renderowany obok drop-zone zamiast zamiast niej; busy-guard jako stageRef zamiast `disabled`; testy 1/2/5 bez mocków GET), 0 MISSING. Scope guardrails („NOT doing") respektowane.

## Findings

### F1 — CI na main czerwone od PR #79: toolbar M25 zasłania ikony markerów (single-bbox-edit ×7)

- **Severity**: ⚠️ WARNING (w skali main: de facto krytyczne dla pipeline)
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/components/PhotoDetectionOverlay.tsx (commit 741c98d, PR #79 — NIE camera-capture)
- **Detail**: Kryterium 3.5 „pełne test:e2e — brak regresji" odhaczone, ale e2e check na PR #81 był FAILURE (odziedziczony z PR #79/#80). Floating toolbar (M25, absolute top-left kontenera) przykrywa ołówki/ikony markerów bbox przy górnej krawędzi zdjęcia (spec: y1=0.02) → `locator.click` timeout we wszystkich 7 testach `single-bbox-edit.spec.ts` (3× retry). Potwierdzone screenshotem z artifactu CI. Lokalny regres M25 „36/36" nie obejmował tego speca. To również realny bug UX (toolbar zawsze zasłania lewy-górny pas zdjęcia w prodzie).
- **Fix**: Osobny change `fix-overlay-toolbar-marker-overlap` — toolbar nie może przechwytywać kliknięć w markery (np. toolbar nad kontenerem zamiast nad zdjęciem, albo pointer-events przepuszczające + offset markerów). NIE jest to wina camera-capture — finding eskalowany jako niezależny bug.
- **Decision**: PENDING

### F2 — Busy-guard blokuje handleFile w stage='error' z mylącym komunikatem (dead-end)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/PhotoUploader.tsx:317-321
- **Detail**: Guard `stageRef.current !== 'idle'` blokuje też stage `'error'`, w którym drop-zone + przycisk kamery są nadal wyrenderowane. User po failu vision/match wybierający NOWY plik dostaje fałszywy banner „Poczekaj na zakończenie bieżącego przetwarzania" i nie może zacząć od nowa bez reloada. Przed zmianą nowy plik startował świeży flow.
- **Fix**: Guard tylko na realnie busy stages: `['uploading','recording','processing','matching'].includes(stageRef.current)` (lub reset error state na początku handleFile).
- **Decision**: PENDING

### F3 — Desktop E2E test realnie uploaduje do Supabase Storage + nieomockowane /match, /check-hash

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: tests/e2e/camera-capture.spec.ts:53-73
- **Detail**: `mockUploadRoutes` nie mockuje `**/storage/v1/object/shelf-photos/**` (konwencja z upload-flow.spec.ts:146) ani `/api/photos/*/match` i `/api/photos/check-hash`. Przechwycona klatka jest realnie wgrywana do Storage wskazywanego przez `.dev.vars` — przy profilu remote = śmieci w PROD storage przy każdym lokalnym runie (wbrew nagłówkowi speca „zero side-effectów"). `runMatch` strzela w realny endpoint (404 na fake UUID — benign, ale latent).
- **Fix**: Dodać do mockUploadRoutes mocki storage + match + check-hash (kopiując wzorzec z upload-flow.spec.ts).
- **Decision**: PENDING

### F4 — Naruszenia reguł E2E w camera-capture.spec.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/camera-capture.spec.ts:77,122-125,137
- **Detail**: (a) `page.waitForTimeout(300)` (l.137) — wprost zakazane w regułach E2E repo; (b) `page.waitForSelector('[data-testid=...][data-camera-mode="desktop"]')` (l.77) — CSS selector zamiast `expect(...).toHaveAttribute(...)`; (c) layered `route.continue()` (l.122-125) omija wcześniejszy mock POST /api/photos — gdyby upload kiedyś wystartował, trafiłby w realny endpoint; powinno być `route.fallback()`.
- **Fix**: (a) zastąpić deterministycznymi asercjami idle-state (drop-zone visible + progress-area hidden) przed `expect(uploadCalled).toBe(false)`; (b) `toHaveAttribute('data-camera-mode','desktop')`; (c) `route.fallback()`.
- **Decision**: PENDING

### F5 — `server: { host: true }` w astro.config.mjs eksponuje dev server na LAN na stałe

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: astro.config.mjs:13 (commit f10c0d0, EXTRA — nie w planie)
- **Detail**: Dev server (zawsze działający na :4321 per workflow usera, z sekretami `.dev.vars` — często profil PROD Supabase + ścieżki ANTHROPIC_API_KEY) bindowany na 0.0.0.0 → osiągalny dla każdego peera w sieci korporacyjnej. Potrzebne jednorazowo do manualnej weryfikacji mobile (3.6). Zmiana dev-only (zero wpływu na prod CF Workers), ale permanentna ekspozycja to nieuzasadniony koszt po zamknięciu slice'a.
- **Fix A ⭐ Recommended**: Usunąć z configu; do testów na telefonie ad hoc `npm run dev -- --host`.
  - Strength: Zero stałej ekspozycji; identyczna funkcjonalność na żądanie.
  - Tradeoff: Trzeba pamiętać o fladze przy następnym mobile-debugu.
  - Confidence: HIGH — flaga CLI to udokumentowany standard Astro/Vite.
  - Blind spot: None significant.
- **Fix B**: Gate przez env: `server: { host: process.env.DEV_LAN === '1' }`.
  - Strength: Opt-in bez zmiany komendy.
  - Tradeoff: Martwy kod w configu na rzadki use-case.
  - Confidence: MED.
  - Blind spot: process.env w astro.config czytany build-time — wymaga restartu deva tak czy owak.
- **Decision**: PENDING

### F6 — Mobile native-camera path martwy na HTTPS: telefony dostają CameraPreview, nie natywny aparat

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence (niespójność wewnętrzna planu przeniesiona do kodu)
- **Location**: src/components/PhotoUploader.tsx:90-94,541-547
- **Detail**: Desired End State planu: „Na telefonie «Zrób zdjęcie» otwiera natywny aparat". Ale dispatch `supportsDesktopCamera = !!navigator.mediaDevices?.getUserMedia` jest true na każdej nowoczesnej mobilnej przeglądarce po HTTPS (czyli w prodzie) → telefon dostaje inline CameraPreview (`facingMode: environment` działa, ale traci natywny UX: focus/HDR/rozdzielczość). Ścieżka `capture="environment"` osiągalna tylko w insecure context (HTTP LAN dev — tak była weryfikowana manualnie, 3.6). Kontrakt Phase 2 sam specyfikował tę detekcję — plan-internal inconsistency, nie drift implementacji.
- **Fix A ⭐ Recommended**: Dispatch po typie urządzenia: `matchMedia('(pointer: coarse)')` → preferuj natywny input na touch; getUserMedia tylko desktop.
  - Strength: Realizuje deklarowany end-state na realnych telefonach w prodzie; natywny aparat = lepsza jakość zdjęć półek (krytyczne dla vision).
  - Tradeoff: Heurystyka pointer:coarse obejmie też tablety z myszką itp. — krawędzie do zaakceptowania.
  - Confidence: MED-HIGH — standardowy pattern; wymaga przetestowania na realnym telefonie po HTTPS (prod).
  - Blind spot: Nie zweryfikowano zachowania na realnym telefonie przez HTTPS (manual 3.6 robiony po HTTP LAN).
- **Fix B**: Zaakceptować inline CameraPreview na mobile i zaktualizować plan/roadmapę (rename `data-camera-mode`).
  - Strength: Zero zmian kodu; CameraPreview na mobile działa.
  - Tradeoff: Gorszy UX aparatu na telefonie; end-state z planu niezrealizowany literalnie.
  - Confidence: MED.
  - Blind spot: Jakość zdjęć z getUserMedia vs natywny aparat nieporównana na realnym urządzeniu.
- **Decision**: PENDING

### F7 — CameraPreview: drobne race'y i ciche ścieżki błędów (skonsolidowane)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/CameraPreview.tsx:50-69, src/components/PhotoUploader.tsx:319
- **Detail**: (a) `canvas.toBlob` null blob → cichy `return` bez feedbacku; (b) double-click „Zrób zdjęcie" → 2× onCapture zanim stage się ustawi (mitygowane server-side 409); (c) Anuluj przed resolve toBlob → onCapture po unmount → upload mimo cancel; (d) `setTimeout(4000)` overlapWarning bez cleanup. Cleanup streamu (unmount/capture/cancel/error + `cancelled` guard na getUserMedia post-unmount) — poprawny.
- **Fix**: flaga `capturing` blokująca przycisk + `cancelledRef` sprawdzany w callbacku toBlob + `setError('unavailable')` przy null blob.
- **Decision**: PENDING

### F8 — Scope creep kosmetyczny + adaptacje dev-only (skonsolidowane, do świadomości)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/PhotoUploader.tsx:28-50,570-584
- **Detail**: (a) Przepisanie progress-area Skeleton→spinner — niezaplanowany polish UI (testid zachowany, niski risk); (b) `safeRandomId` + fallback SHA-256 dla insecure context — konsekwencja testów po HTTP LAN; na HTTP dedup cicho wyłączony przez losowy fake-hash zapisywany do `photos.file_hash_sha256` (dev-only data pollution, prod HTTPS nietknięty). Obie adaptacje skomentowane w kodzie; brakowało write-backu do planu.
- **Fix**: Brak akcji w kodzie; odnotowane tutaj jako plan write-back (niniejszy raport pełni tę rolę).
- **Decision**: PENDING

## Success criteria — weryfikacja

| Kryterium | Wynik |
|---|---|
| typecheck | ✅ green (pre-push hook 2026-06-07, 0 errors) |
| lint | ✅ green (eslint . — czysto) |
| unit | ✅ green (970/970, 82 pliki) |
| e2e --grep camera-capture | ✅ green w CI (testy camera przechodzą) |
| pełne e2e bez regresji (3.5) | ❌ CI red — single-bbox-edit ×7 (odziedziczone z PR #79, zob. F1); manual-rematch flaky |
| Manual 3.6 (real device) | ✅ odhaczone przez usera (po HTTP LAN — zob. F6 blind spot) |
