# PRD — BookShelf Catalog

**Wersja:** 0.1 (draft startowy, M1)
**Data:** 2026-05-13
**Status:** wstępne wymagania do doprecyzowania w trakcie M1 z agentem

## 1. Wizja produktu

Aplikacja webowa do katalogowania domowej kolekcji książek na podstawie zdjęć półek. Eliminuje konieczność ręcznego wpisywania tytułów przez wykorzystanie vision-LLM do rozpoznawania grzbietów książek na zdjęciu i automatyczne dopasowywanie do publicznych baz książek.

## 2. Adresat

**Primary user:** ja, jako właściciel kolekcji ~1000 książek.
**Secondary:** czytelnicy z dużymi kolekcjami, którzy chcą wiedzieć w księgarni „mam tę książkę czy nie?".

## 3. Problem do rozwiązania

- Nie pamiętam co mam w kolekcji
- Kupuję duplikaty
- Nie wiem co komu pożyczyłem
- Ręczne wpisywanie 200+ tytułów jest nierealne

## 4. Logika biznesowa w jednym zdaniu

> Użytkownik fotografuje półkę z książkami, system wykrywa tytuły przez vision-LLM, matchuje je z zewnętrzną bazą (Google Books / OpenLibrary), wykrywa duplikaty względem istniejącego katalogu użytkownika i proponuje wpisy z lokalizacją (półka, pozycja); użytkownik akceptuje / odrzuca / koryguje propozycje, a system rejestruje korekty do telemetrii jakości.

**Pięć decyzji domenowych:** detekcja, scoring matchu, deduplikacja, ranking propozycji, telemetria korekt.

## 5. MVP scope (1-2 flow)

### Flow 1 — Onboarding + katalogowanie zdjęcia
1. Założenie konta (email/hasło przez Supabase Auth)
2. Dodanie pierwszej półki (nazwa, opcjonalnie lokalizacja w domu)
3. Upload zdjęcia półki
4. Zobaczenie propozycji rozpoznanych książek z kandydatami z bazy zewnętrznej
5. Akceptacja / odrzucenie / korekta każdej propozycji
6. Książki trafiają do katalogu z lokalizacją (półka + pozycja)

### Flow 2 — Wyszukiwanie w katalogu
1. Strona `/library` z listą wszystkich potwierdzonych książek
2. Filtry: autor, półka, data dodania
3. Wyszukiwarka pełnotekstowa po tytule/autorze
4. Kliknięcie książki → widok szczegółu + na której półce stoi

## 6. Wymogi certyfikacji 10xDevs 3.0 — mapowanie

| # | Wymóg | Realizacja w BookShelf |
|---|---|---|
| 1 | Kontrola dostępu | Supabase Auth + RLS (`user_id = auth.uid()`) na każdej tabeli |
| 2 | CRUD domenowy | `Shelf`, `Book`, `ShelfEntry`, korekty propozycji |
| 3 | Logika biznesowa | Vision-detekcja → matching scoring → deduplikacja → ranking → telemetria |
| 4 | Artefakty M1-M3 | Ten PRD + `docs/plan-implementacji.md` + AGENTS.md (do napisania w M1) + spec API |
| 5 | Test E2E | Playwright: golden path `upload → detect → confirm → catalog` z mock vision-response |
| 6 | CI/CD | GitHub Actions: lint + typecheck + vitest + playwright + deploy CF Workers |

## 7. Schemat danych

8 tabel z RLS:

```sql
-- Profil użytkownika (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

create table shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text,
  position_index int default 0,
  created_at timestamptz default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shelf_id uuid not null references shelves(id) on delete cascade,
  storage_path text not null,
  status text not null default 'uploaded',     -- uploaded|processing|processed|failed
  vision_model text,
  vision_cost_usd numeric(10,6),
  vision_latency_ms int,
  detected_count int,
  error_message text,
  taken_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz default now()
);

create table detections (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  position_index int not null,
  raw_title text,
  raw_author text,
  raw_publisher text,
  vision_confidence numeric(3,2),
  spine_color text,
  status text not null default 'pending',      -- pending|matched|confirmed|rejected
  created_at timestamptz default now()
);

create table book_candidates (
  id uuid primary key default gen_random_uuid(),
  detection_id uuid not null references detections(id) on delete cascade,
  source text not null,                        -- google_books|open_library
  external_id text not null,
  title text not null,
  authors text[] not null default '{}',
  isbn_10 text,
  isbn_13 text,
  publisher text,
  published_year int,
  cover_url text,
  match_score numeric(4,3),
  rank int not null,
  created_at timestamptz default now()
);

create table books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  authors text[] not null default '{}',
  isbn_10 text,
  isbn_13 text,
  publisher text,
  published_year int,
  cover_url text,
  source text,
  source_external_id text,
  notes text,
  created_at timestamptz default now()
);
create unique index books_user_isbn13 on books(user_id, isbn_13) where isbn_13 is not null;

create table shelf_entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  shelf_id uuid not null references shelves(id) on delete cascade,
  position_index int,
  photo_id uuid references photos(id) on delete set null,
  detection_id uuid references detections(id) on delete set null,
  is_current boolean not null default true,
  confirmed_at timestamptz default now()
);

create table corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  detection_id uuid references detections(id) on delete set null,
  original_raw_title text,
  corrected_title text,
  corrected_authors text[],
  correction_type text,                        -- title_typo|wrong_author|wrong_book|not_a_book
  created_at timestamptz default now()
);
```

**Wszystkie tabele** mają RLS policy: `user_id = auth.uid()` lub join przez table user_id.

## 8. Kluczowe API endpoints

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/photos/upload` | POST | Upload zdjęcia → Supabase Storage signed URL → INSERT photos(status='uploaded') |
| `/api/photos/:id/process` | POST | Trigger vision call → INSERT detections → matching → INSERT book_candidates |
| `/api/detections/:id/confirm` | POST | Accept candidate → INSERT books (jeśli nowa) + shelf_entries |
| `/api/detections/:id/reject` | POST | Mark detection as rejected |
| `/api/detections/:id/correct` | POST | Manual title/author override → re-search + INSERT corrections |
| `/api/books/search` | GET | Pełnotekstowa wyszukiwarka katalogu |
| `/api/shelves` | GET/POST/PUT/DELETE | CRUD półek |

## 9. Vision LLM — prompt

System prompt (skrót):
```
Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki
widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string (tytuł na grzbiecie)
- author: string | null
- confidence: float (0-1)
- spine_color: string | null

Reguły:
- NIE zgaduj — pusta odpowiedź lepsza niż halucynacja
- Tekst częściowo zasłonięty → zwróć + confidence < 0.7
- Tytuły polskie zostaw po polsku
- Output: JSON array, nic więcej

Format: [{"position":1,"title":"...","author":"...","confidence":0.95,"spine_color":"red"}, ...]
```

Walidacja Zod:
```ts
const DetectionSchema = z.array(z.object({
  position: z.number().int().positive(),
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
  spine_color: z.string().max(50).nullable().optional(),
}));
```

## 10. Matching — formuła scoringu

```
score = 0.65 × titleSim + 0.30 × authorSim + 0.05 × isbnBonus
```

- `titleSim` = 1 - levenshtein(normalize(detection.title), normalize(candidate.title)) / max(len)
- `authorSim` = max similarity over candidate.authors[]; jeśli brak detection.author → 0.5 (neutral)
- `isbnBonus` = 0.05 jeśli candidate ma ISBN, 0 wpp

Progi:
- `>= 0.75` — wysoka jakość, pre-zaznaczone w UI
- `0.55 - 0.75` — średnia, user musi potwierdzić
- `< 0.55` — brak matchu, użytkownik wpisuje ręcznie

## 11. Deduplikacja

```
IF candidate.isbn_13 != null:
   SELECT * FROM books WHERE user_id = $u AND isbn_13 = $isbn
   → exact duplicate, blokada akceptacji + komunikat
ELSE:
   SELECT * FROM books WHERE user_id = $u
   AND levenshtein(lower(title), lower($title)) < 3
   AND authors && $authors
   → potential duplicate, ostrzeżenie UI
```

## 12. Świadomie poza MVP

- Mobile / PWA / camera capture
- Batch upload wielu zdjęć
- ISBN barcode scanner
- Rekomendacje, podobne książki
- Dziennik czytania, oceny, wypożyczenia
- Eksport CSV/JSON
- Shared shelves
- Scraping lubimyczytac (tylko deep-link)
- Offline mode

## 13. Ryzyka

1. **Vision quality** — częściowo zmitygowane reality checkiem (recall 100%, precision 82% na polskich półkach)
2. **Cloudflare Workers CPU limit 30s (paid plan)** — vision call może dochodzić do 15-20s; fallback do Supabase Edge Function jeśli problem
3. **Koszt vision** — cap per user $1/dzień w `profiles.daily_vision_budget_usd`
4. **Rate limit Google Books** — cache w `book_candidates` po `external_id`, fallback OpenLibrary
5. **RLS misconfiguration** — per-tabela policy test w `supabase/tests/`

## 14. Następne kroki

Patrz [plan-implementacji.md](plan-implementacji.md).
