# BookShelf Catalog — kontekst dla agenta

## Czym jest projekt

Aplikacja webowa do katalogowania książek na podstawie zdjęć półek. Użytkownik fotografuje półkę, system rozpoznaje tytuły przez vision-LLM, matchuje je z bazą zewnętrzną (Google Books / OpenLibrary), wykrywa duplikaty względem istniejącego katalogu i proponuje wpisy z lokalizacją (półka, pozycja); użytkownik akceptuje / odrzuca / koryguje, a system rejestruje korekty do telemetrii.

**Projekt zaliczeniowy 10xDevs 3.0** (start kursu 18.05.2026, 1. termin oddania 5.07.2026).

## Logika biznesowa w jednym zdaniu

Vision-detekcja → matching scoring → deduplikacja → ranking propozycji → potwierdzenie użytkownika → telemetria korekt.

Pięć decyzji domenowych: (1) detekcja z obrazu, (2) scoring matchu z bazą zewnętrzną, (3) deduplikacja vs istniejący katalog, (4) ranking propozycji, (5) telemetria akceptacji.

## Stack

| Warstwa | Wybór |
|---|---|
| Meta-framework | Astro 6 (SSR) |
| UI | React 19 (islands) |
| Typy | TypeScript strict |
| Style | Tailwind 4 |
| Backend | Astro endpoints (`src/pages/api/`) |
| Auth | Supabase Auth (email/password + opcjonalnie Google OAuth) |
| DB | Supabase Postgres + RLS |
| Storage | Supabase Storage (bucket `photos/`) |
| Vision LLM | Claude Sonnet 4.6 (multimodal) — bezpośrednio przez Anthropic API |
| Walidacja LLM I/O | Zod schemas |
| Book metadata | Google Books API (primary) + OpenLibrary (fallback) |
| Deployment | Cloudflare Pages |
| Test framework | Vitest (unit) + Playwright (E2E) |
| CI | GitHub Actions |

**Match z kursowym stackiem: 8/8.**

## Architektura — schemat

```
Browser (React 19 islands) ─→ Astro SSR (Cloudflare Pages)
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Supabase Auth         Supabase Postgres      Supabase Storage
       (JWT + sesja)         (z RLS na user_id)     (zdjęcia półek)
                                   │
                                   ▼
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Anthropic API          Google Books API        OpenLibrary API
       (Sonnet 4.6 vision)    (primary metadata)      (fallback)
```

## Model danych (Postgres)

8 tabel z RLS na `user_id = auth.uid()`:

- `profiles` (id FK auth.users, display_name)
- `shelves` (user_id, name, location, position_index)
- `photos` (user_id, shelf_id, storage_path, status, vision_cost_usd, vision_latency_ms)
- `detections` (photo_id, position_index, raw_title, raw_author, vision_confidence, status)
- `book_candidates` (detection_id, source, external_id, title, authors, isbn_*, match_score, rank)
- `books` (user_id, isbn_*, title, authors, source, source_external_id) — confirmed catalog
- `shelf_entries` (book_id, shelf_id, position_index, photo_id, detection_id, is_current)
- `corrections` (user_id, detection_id, original_raw_title, corrected_title, correction_type)

Pełny SQL: [docs/prd.md](docs/prd.md#schemat-danych).

## Struktura katalogów

```
bookshelf/
├── src/
│   ├── pages/              # Astro pages + /api/ endpoints
│   ├── components/         # React islands (PhotoUploader, DetectionReview, BookCard...)
│   ├── lib/
│   │   ├── vision/         # klient Anthropic + prompt + Zod schema
│   │   ├── books/          # Google Books + OpenLibrary klienci + reconcile
│   │   ├── matching/       # score, dedupe, isbn
│   │   ├── db/             # Supabase typed clients (server/browser)
│   │   └── auth/           # middleware guard
│   ├── middleware.ts
│   └── env.d.ts
├── supabase/
│   ├── migrations/         # SQL migrations
│   └── seed.sql
├── tests/
│   ├── unit/               # Vitest
│   ├── integration/
│   └── e2e/                # Playwright (z mock vision-response)
├── .github/workflows/
│   ├── ci.yml              # lint + typecheck + tests
│   └── deploy.yml          # build + deploy CF Pages
├── docs/
│   ├── prd.md              # PRD modułu (artefakt M1)
│   └── plan-implementacji.md
├── CLAUDE.md               # ten plik
└── README.md
```

## Konwencje

### TypeScript
- `strict: true` — nie obniżać
- Brak `any` — używaj `unknown` + narrowing
- Zod schemas dla każdego external I/O (LLM responses, API responses, form inputs)
- Inferowanie typów z Zod: `type Foo = z.infer<typeof FooSchema>`

### Astro / React
- **Server pages** w Astro (`.astro`) — SSR, auth guard, data fetch
- **Interactive views** w React (`.tsx`) — `client:load` / `client:visible` islands
- Granica jasna: jeśli komponent nie ma stanu interakcji, zostaje Astro

### Supabase
- **RLS od pierwszego dnia** — każda tabela ma policy `user_id = auth.uid()`
- Typed client: `supabase.server.ts` (service role, tylko w API endpoints) i `supabase.browser.ts` (anon key)
- Migracje wersjonowane w `supabase/migrations/`

### Vision LLM
- Single source of truth dla promptu: `src/lib/vision/prompt.ts`
- Output **zawsze** walidowany przez Zod (`DetectionSchema`)
- Jeśli model zwróci śmieci → retry z `extended_thinking`, eskalacja do Opus tylko w MVP+
- Każda detekcja persistowana **przed** matchingiem (idempotencja przy retry)

### Matching
- Próg `match_score >= 0.75` = wysoka jakość, pre-zaznaczone w UI
- `0.55 - 0.75` = średnia, user musi potwierdzić
- `< 0.55` = brak matchu, użytkownik wpisuje ręcznie → record w `corrections`

### Testy
- **Vitest** dla unit: matching, dedupe, isbn validation, vision response parsing
- **Playwright** dla E2E: jeden golden path (`tests/e2e/upload-flow.spec.ts`) z **mock** vision-response
- Real vision tylko w manualnym smoke test (nie w CI — flaky + drogi)

### CI
- GitHub Actions: lint + typecheck + vitest + playwright + deploy CF Pages
- Sekrety: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN` w GitHub Secrets

## Decyzje świadomie odsunięte (NIE w MVP)

- Mobile app / PWA / camera capture w przeglądarce — desktop upload wystarczy
- Batch upload wielu zdjęć — pętla pojedyncza w MVP
- Skanowanie ISBN czytnikiem kodów kreskowych
- Rekomendacja co przeczytać / podobne książki
- Wypożyczanie / dziennik czytania / oceny
- Eksport CSV/JSON
- Shared shelves między userami
- Integracja z lubimyczytac jako źródło danych (tylko deep-link do strony książki)
- Offline mode / PWA cache
- Image cropping w UI

## Status (stan na 2026-05-13)

- ✅ Repo sklonowane z GitHuba (`git@github.com:dariuszdanowski/bookshelf.git`)
- ✅ Reality check vision zaliczony pozytywnie (recall 100%, precision ~82% na zdjęciu polskiej półki)
- ✅ SSH-agent skonfigurowany, klucz GitHub działa
- ⏳ Bootstrap Astro 6 + Tailwind + React + Cloudflare adapter — następny krok
- ⏳ Supabase project init + migracje
- ⏳ PRD modułu (`docs/prd.md`) — szkielet jest

## Najbliższe kroki (M1 — 18.05 → 31.05)

1. `npm create astro@latest . -- --template minimal --typescript strict --no-git --install`
2. `npx astro add react tailwind cloudflare`
3. `npm i @supabase/supabase-js @supabase/ssr zod`
4. `npx supabase init && npx supabase login && npx supabase projects create bookshelf-10xdevs && npx supabase link`
5. Połączenie Cloudflare Pages z repo GitHub
6. Migracje Prismy → 8 tabel + RLS
7. Auth flow + UI `/shelves` CRUD
8. `/api/photos/upload` + Storage
9. `src/lib/vision/` — klient + prompt + Zod
10. `/api/photos/:id/process` (vision tylko, bez matching jeszcze)

Cały kalendarz: [docs/plan-implementacji.md](docs/plan-implementacji.md).

## Kontekst zewnętrzny

- Pełna analiza projektu (poza tym repo): `c:\Projekty\10xDevs\analiza-projektu-bookshelf.md`
- Porównanie z innymi kandydatami: `c:\Projekty\10xDevs\porownanie-projektow.md`
- Wymogi certyfikacji 10xDevs 3.0: `c:\Projekty\10xDevs\analiza-projektu-kursowego.md` sekcja 1
- Prework: `c:\Projekty\10xDevs\prework\`

Te pliki **nie są** częścią projektu kursowego (nie commituj ich tu) — to prywatny meta-kontekst decyzyjny.
