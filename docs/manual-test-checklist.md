# Checklist ręcznej weryfikacji (release / self-review)

Procedura manualnych testów po deploy'u na prod (`workers.dev`). Powstała przy
weryfikacji pakietów mobile-fix + S-39 (2026-06-07); utrzymywana jako żywy
dokument — nowe slice'y dopisują sekcje, wyniki zgłaszamy listą
`A1 ✅ / D2 ❌ + screenshot`, wpadki lądują na liście uwag (M-numeracja) i wracają
pakietami fixów.

## Warunki wstępne

1. Wszystkie testowane PR-y zmergowane, **Deploy zielony** (GitHub Actions).
2. Testy na prodzie = realna kolekcja i PROD DB — kroki oznaczone 🗑 sprzątnij po sobie.
3. Pod ręką: telefon (375 px), desktop, oba motywy **systemu** i oba motywy **aplikacji**.

Kolejność przy ograniczonym czasie: **D → A → C3 → B → E → F**.

## A. Motyw jasny/ciemny

| # | Krok | Oczekiwane |
|---|---|---|
| A1 | System ciemny + apka jasna → `/shelves/[id]`, lista książek | Całość jasna, zero ciemnych kart |
| A2 | System jasny + apka ciemna | Całość spójnie ciemna |
| A3 | Dark: przełączniki Książki/Zdjęcia i Karty/Lista/Kafelki | Aktywny niebieski + pogrubiony |
| A4 | 3–4 ekrany (library, review, account) w obu motywach | Zero mieszanych elementów |

## B. Mobile — layout

| # | Krok | Oczekiwane |
|---|---|---|
| B1 | Telefon → półka → tab Zdjęcia | Miniatura na całą szerokość karty |
| B2 | Klik w miniaturę | Otwiera `/photos/[id]` |
| B3 | Tab Książki, tryb Lista | Nic nie wystaje poza kartę; akcje pod tytułem |
| B4 | Header | Badge PROD/LOCAL DB obok przełącznika motywu |
| B5 | Desktop — te same widoki | Bez regresu (akcje w 1 linii, kompaktowa miniatura) |

## C. Modale i gesty

| # | Krok | Oczekiwane |
|---|---|---|
| C1 | Telefon → szczegóły książki → scroll do końca modala i dalej | Strona pod modalem stoi |
| C2 | Zamknij modal | Pozycja strony bez zmian |
| C3 | Review → pinch dwoma palcami na zdjęciu | Zoom 1–4× płynnie, celuje w środek gestu |
| C4 | „Edytuj ramki" → pinch | Nie działa (celowo); rysowanie bbox działa |
| C5 | Detekcja bez kandydata → „Szukaj po tytule" → trafny tytuł | Kandydat się pojawia, formularz znika |

## D. Matching (S-39)

| # | Krok | Oczekiwane |
|---|---|---|
| D1 | Zdjęcie z częściowym matchem → „Ponów match" | Brakujące detekcje dostają kandydatów (operacja może trwać kilkanaście sekund — retry) |
| D2 | Jeśli coś nadal ścięte limitem | Toast „Dopasowano X · N pozycji wstrzymał limit Google — ponów match za chwilę" |
| D3 | Review po D1 | Nowi kandydaci do akceptacji |

## E. Nawigacja i UX slice'ów

| # | Krok | Oczekiwane |
|---|---|---|
| E1 | `/library` → „Źródłowe zdjęcie" przy książce ze zdjęcia | Review z 1 podświetloną ramką + lista przescrollowana; „Pokaż wszystkie detekcje" przywraca |
| E2 | Review → klik w zdjęcie (poza edycją) | (S-24 lightbox — **wyłączony na życzenie 2026-06-07**, M23; mechanizm w kodzie) |
| E3 | `/upload` → odznacz „Analizuj od razu" → wgraj | Zero kosztu, lądowanie na tabie Zdjęcia, akcja „Uruchom vision"; preferencja przeżywa reload. 🗑 |
| E4 | Telefon: library/shelves/półka/review/upload/account | Brak poziomego scrolla; hamburger ☰ działa; na desktopie go nie ma |

## F. Operacje jednorazowe (ops)

| # | Krok | Oczekiwane |
|---|---|---|
| F1 | `node scripts/backfill-photo-hashes.mjs --dry-run` (`.dev.vars` remote) | Lista NULL-hash + hashe, zero UPDATE |
| F2 | Bez `--dry-run`; ponowny run | „Zakończony pomyślnie"; drugi run = 0 do przetworzenia |
| F3 | Re-upload zdjęcia sprzed dedupu | Ostrzeżenie o duplikacie z propozycją reuse |
