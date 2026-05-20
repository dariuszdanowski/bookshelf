# BookShelf Catalog

Aplikacja webowa do katalogowania domowej biblioteczki na podstawie zdjęć półek.
Fotografujesz półkę, vision-LLM rozpoznaje tytuły, system sam matchuje je z bazą
zewnętrzną i proponuje wpisy z lokalizacją — tobie zostaje akceptacja lub korekta.

> **Projekt zaliczeniowy 10xDevs 3.0** — start kursu 18.05.2026, oddanie 5.07.2026.

## O projekcie

Po wgraniu zdjęcia półki aplikacja:

1. **Detekcja** — Claude Sonnet 4.6 (multimodal) wyciąga listę widocznych tytułów i autorów.
2. **Matching** — Google Books / OpenLibrary dostarczają metadane (ISBN, okładkę, autora).
3. **Deduplikacja** — sprawdzenie, czy książka już jest w twoim katalogu.
4. **Ranking** — propozycje uporządkowane wg pewności matchu.
5. **Potwierdzenie** — ty akceptujesz, odrzucasz lub korygujesz; system uczy się z korekt.

W jednym zdaniu: **zdjęcie → detekcja → match → dedup → ranking → potwierdzenie**.

## Stack

| Warstwa | Wybór |
|---|---|
| Meta-framework | Astro 6 (SSR) |
| UI | React 19 (islands) |
| Style | Tailwind 4 |
| Typy | TypeScript strict |
| Backend | Astro endpoints (`src/pages/api/`) |
| Auth | Supabase Auth (email + opcj. Google OAuth) |
| DB | Supabase Postgres + RLS |
| Storage | Supabase Storage (zdjęcia półek) |
| Vision LLM | Claude Sonnet 4.6 przez Anthropic API |
| Walidacja LLM I/O | Zod |
| Metadane książek | Google Books (primary) + OpenLibrary (fallback) |
| Deployment | Cloudflare Workers (z Workers Assets) |
| Testy | Vitest (unit) + Playwright (E2E) |
| CI | GitHub Actions |

## Architektura

```
Browser (React 19 islands) ─→ Astro SSR (Cloudflare Workers + Assets)
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Supabase Auth         Supabase Postgres      Supabase Storage
       (JWT + sesja)         (RLS na user_id)       (zdjęcia półek)
                                   │
                                   ▼
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Anthropic API          Google Books API        OpenLibrary API
       (Sonnet 4.6 vision)    (primary metadata)      (fallback)
```

## Szybki start

Wymagania: **Node.js ≥ 22.12.0**, `npm`, konto Supabase, klucz Anthropic API.

```powershell
# 1. Klon i zależności
git clone git@github.com:dariuszdanowski/bookshelf.git
cd bookshelf
npm install

# 2. Zmienne środowiskowe
Copy-Item .env.example .env.local
# Uzupełnij PUBLIC_SUPABASE_URL, klucze Supabase, ANTHROPIC_API_KEY

# 3. Dev server
npm run dev
# → http://localhost:4321/
```

### Komendy

| Komenda | Co robi |
|---|---|
| `npm run dev` | Dev server na `localhost:4321` z HMR |
| `npm run build` | Produkcyjny build do `dist/` (bundle pod Cloudflare Workers) |
| `npm run preview` | Preview produkcyjnego buildu lokalnie |
| `npm run astro ...` | CLI Astro (np. `astro add`, `astro check`) |
| `npm run generate-types` | Wygeneruj typy z Cloudflare bindings (`wrangler types`) |

## Struktura katalogów

```
bookshelf/
├── src/
│   ├── pages/              # Astro pages + /api/ endpointy
│   ├── components/         # React islands (PhotoUploader, DetectionReview…)
│   ├── layouts/            # Astro layouts
│   ├── styles/             # Tailwind entry
│   └── lib/
│       ├── vision/         # klient Anthropic + prompt + Zod schema
│       ├── books/          # Google Books + OpenLibrary + reconcile
│       ├── matching/       # score, dedupe, ISBN
│       ├── db/             # Supabase typed clients (server/browser)
│       └── auth/           # middleware guard
├── supabase/
│   ├── migrations/         # SQL migracje + RLS policies
│   └── seed.sql
├── tests/
│   ├── unit/               # Vitest
│   ├── integration/
│   └── e2e/                # Playwright (z mock vision-response)
├── docs/
│   ├── prd.md              # PRD modułu
│   └── plan-implementacji.md
└── .github/workflows/      # CI: lint + typecheck + tests + deploy
```

## Status i dokumentacja

| Plik | Co tam jest |
|---|---|
| [docs/prd.md](docs/prd.md) | PRD modułu — wymagania funkcjonalne, schemat danych (8 tabel) |
| [docs/plan-implementacji.md](docs/plan-implementacji.md) | Kalendarz milestonów, ryzyka, definition of done |
| [CLAUDE.md](CLAUDE.md) | Kontekst i konwencje pracy z agentem AI |

### Harmonogram

| Milestone | Termin | Zakres |
|---|---|---|
| M0 — bootstrap | 17.05.2026 | Astro + Tailwind + React + Cloudflare ✓ |
| M1 — schema + upload + vision | 31.05.2026 | Auth, RLS, upload zdjęcia, vision call |
| M2 — matching + katalog | 14.06.2026 | Books API, scoring, dedup, UI review |
| M3 — CI/CD + szlif | 19.06.2026 | GitHub Actions, deploy CF Workers, demo |

## Świadomie poza MVP

Mobile app / PWA, camera capture w przeglądarce, skanowanie ISBN czytnikiem
kodów kreskowych, batch upload wielu zdjęć, rekomendacje „co przeczytać",
eksport CSV/JSON, shared shelves między userami, dziennik czytania —
wszystko kandyduje na post-19.06, poza zakresem MVP.

## Licencja

MIT — zobacz [LICENSE](LICENSE).
