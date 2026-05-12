# Plan implementacji BookShelf Catalog

**Data:** 2026-05-13
**Cel:** dowieźć MVP do 19.06.2026 (koniec szkolenia), oddać do 5.07.2026 (1. termin)

## Kalendarz wysokopoziomowy

```
13.05 ─ 17.05  TYDZIEŃ 0 — PREWORK + BOOTSTRAP                        [~12h]
              ├─ 13-14.05  dokończ prework (pozostałe ~3-4h)
              ├─ 15.05     bootstrap Astro + Supabase project + CF Pages connect
              ├─ 16.05     PRD doprecyzowany z agentem
              ├─ 17.05     pierwszy deploy „hello world" na Cloudflare
              └─ Subskrypcja Claude Code Pro + Anthropic API budżet $20

18.05 ─ 31.05  M1 (2 tyg) — SCHEMA + UPLOAD + VISION                  [~22h]
              ├─ tydz 1 (18-24.05):
              │   ├─ Astro 6 + Tailwind 4 + React 19 finished setup
              │   ├─ Supabase: auth flow + migracje schema (8 tabel)
              │   ├─ RLS policies + integracja typed client
              │   ├─ Storage bucket photos/ + signed URL flow
              │   └─ UI: login, /shelves CRUD
              ├─ tydz 2 (25-31.05):
              │   ├─ /api/photos/upload + Storage put
              │   ├─ src/lib/vision/ — klient + prompt + Zod schema
              │   ├─ /api/photos/:id/process (sync, bez matching jeszcze)
              │   ├─ UI: PhotoUploader + widok surowych detection
              │   └─ MINIMUM M1: wgraj zdjęcie → zobacz listę detected_title
              └─ E2E mock (1 happy path, bez assercji jakości)

01.06 ─ 14.06  M2 (2 tyg) — MATCHING + CONFIRM + KATALOG              [~22h]
              ├─ tydz 1 (01-07.06):
              │   ├─ src/lib/books/googleBooks.ts + openLibrary.ts
              │   ├─ src/lib/matching/score.ts + dedupe.ts + isbn.ts
              │   ├─ /api/photos/:id/process pełny pipeline (vision→match)
              │   ├─ UI: DetectionReview z kandydatami i confidence
              │   └─ accept/reject/correct flow
              ├─ tydz 2 (08-14.06):
              │   ├─ widok /library z filtrami + search
              │   ├─ widok /shelves/[id] z mapą książek
              │   ├─ unit testy matching+dedupe+isbn (Vitest)
              │   ├─ Playwright: golden path z mock vision response
              │   └─ telemetria corrections
              └─ MINIMUM M2: pełny flow zdjęcie → katalog działa

15.06 ─ 19.06  M3 (1 tyg) — CI/CD + SZLIF + DEMO                      [~10h]
              ├─ GitHub Actions: lint+typecheck+vitest+playwright+deploy
              ├─ Cloudflare Pages: domain + env vars
              ├─ AGENTS.md + README z screenshotami
              ├─ szlif UX (loader, error states, empty states)
              └─ przygotowanie demo (3 półki, ~30 książek)

19.06          KONIEC SZKOLENIA — MVP gotowe + deployed
20.06 ─ 05.07  BUFOR (16 dni) → 1. termin 5.07
              ├─ self-review pod 6 wymogów
              ├─ rozszerzone testy E2E (3 scenariusze)
              └─ ewentualny pivot vision-modelu jeśli accuracy słaba
```

**Razem ~66h przez 5 tygodni** ≈ 13h/tydzień. Bufor 16 dni krytyczny.

## Komendy startowe (do uruchomienia 15.05)

```powershell
# Repo już sklonowane do c:\Projekty\10xDevs\bookshelf
cd c:\Projekty\10xDevs\bookshelf

# 1. Bootstrap Astro w istniejącym katalogu
npm create astro@latest . -- --template minimal --typescript strict --no-git --install
# (zaakceptuj nadpisanie README.md gdy zapyta)

# 2. Dodaj integracje
npx astro add react tailwind cloudflare

# 3. Dodaj runtime deps
npm i @supabase/supabase-js @supabase/ssr zod

# 4. Init Supabase
npx supabase init
npx supabase login
npx supabase projects create bookshelf-10xdevs
npx supabase link --project-ref <ref-z-poprzedniego-kroku>

# 5. Env vars (utworz .env.local)
@"
PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
ANTHROPIC_API_KEY=<your-anthropic-key>
GOOGLE_BOOKS_API_KEY=<optional, dla wyższego limitu>
"@ | Out-File -FilePath .env.local -Encoding utf8

# 6. .gitignore — upewnij się że .env.local jest ignorowany
# Domyślny .gitignore Node.js powinien już to mieć — sprawdź

# 7. Cloudflare Pages
# W panelu CF: Workers & Pages → Create → Pages → Connect to Git
# Wybierz repo dariuszdanowski/bookshelf, framework preset = Astro
# Po pierwszym deploy: dodaj env vars w CF Pages settings (te same co .env.local)

# 8. Pierwszy commit + push
git add -A
git commit -m "chore: bootstrap Astro + Tailwind + React + Cloudflare adapter"
git push origin main
git tag pre-course-baseline
git push origin pre-course-baseline
```

## Kluczowe pliki do utworzenia w M1 (kolejność)

1. `supabase/migrations/0001_initial_schema.sql` — 8 tabel + indeksy
2. `supabase/migrations/0002_rls_policies.sql` — RLS na każdą tabelę
3. `src/lib/db/supabase.server.ts` + `supabase.browser.ts`
4. `src/middleware.ts` — auth guard
5. `src/pages/login.astro` + `src/pages/auth/callback.ts`
6. `src/pages/shelves/index.astro` + `[id].astro`
7. `src/pages/api/photos/upload.ts`
8. `src/lib/vision/prompt.ts` + `schema.ts` + `client.ts`
9. `src/pages/api/photos/[id]/process.ts`
10. `src/components/PhotoUploader.tsx`

## Definition of Done — per milestone

### M1 (31.05)
- [ ] Astro/Tailwind/React skonfigurowane, deploy na CF Pages działa
- [ ] Login + logout + email confirmation
- [ ] Tworzenie półki przez UI
- [ ] Upload zdjęcia → Supabase Storage
- [ ] Vision call zwraca listę detected_title widoczną w UI
- [ ] Pierwszy test Playwright (mock vision) zielony lokalnie
- [ ] Pierwszy plan PRD doprecyzowany — `docs/prd.md` zaktualizowany

### M2 (14.06)
- [ ] Google Books + OpenLibrary klienci działają
- [ ] Matching scoring + dedupe
- [ ] UI DetectionReview z kandydatami i confidence
- [ ] Accept / reject / correct flow
- [ ] `/library` z search + filtry
- [ ] Vitest pokrywa matching/dedupe/isbn (≥80% lines)
- [ ] Playwright golden path zielony w CI

### M3 (19.06)
- [ ] GitHub Actions: full pipeline (lint+typecheck+test+deploy)
- [ ] CF Pages: produkcyjny URL działa
- [ ] AGENTS.md + CLAUDE.md final
- [ ] README z screenshotami i quick-start
- [ ] Demo content: 3 półki, ~30 książek prawdziwych
- [ ] Self-review pod 6 wymogów certyfikacji

## Ryzyka i kiedy je adresować

| Ryzyko | Kiedy sprawdzam | Trigger pivota |
|---|---|---|
| CF Pages 30s timeout na vision call | M1, tydz 2 (po pierwszej integracji) | Jeśli >25s średnio → przenieś process do Supabase Edge Function |
| Vision recall <70% w realiach | M1 do końca | Eskalacja do Opus 4.7; jeśli dalej słabo → manualne entry jako primary w MVP |
| Google Books rate limit | M2, tydz 1 | Cache w book_candidates, fallback OpenLibrary jako primary |
| Hybrid Astro/React miesza się | M1, ongoing | Trzymaj się reguły: server data = Astro, interactive = React |
| Time overrun (>13h/tydz) | Co weekend | Wytnij kolejny element z „świadomie poza MVP" |

## Co po MVP (post-19.06, opcjonalnie)

- Mobile/PWA z camera capture (`getUserMedia` + canvas crop)
- ISBN barcode scanner (ZXing-js)
- Batch upload (kolejka jobs)
- Eksport CSV/JSON katalogu
- Shared shelves między userami
- Dziennik czytania, oceny
- Routing vision callów przez localLLM proxy (synergia z drugim projektem)
