[AI_TRIAGE_V1]
TRIAGE_ID: BOOKSHELF-153-T1
TRIAGE_FOR: dariuszdanowski/bookshelf#153
TRIAGE_PARENT: NONE
TRIAGE_VERSION: 1
TRIAGE_MODE: auto
TRIAGE_TIMESTAMP: 2026-07-12T20:35:00Z
TRIAGE_AGENT: claude-sonnet-5
SOURCE_FINGERPRINT: sha256:1184420a6d0bf6fcdac5ccae2877b6845bfb462c8aa7d5bc3ddadcc837b885b1
PREV_FINGERPRINT: none
FINGERPRINT_STATUS: MATCH
DECISION: DO_ROZWAZENIA_TERAZ
CONFIDENCE: 0.85
SEVERITY: LOW
IMPLEMENTATION_GATE: OPEN
RATIONALE_TAGS: ux-blocker,manual-correction,quick-fix
TOP_RISKS: Nalezy potwierdzic czy backend/matching potrafi realnie wyszukac kandydata po samym ISBN (bez tytulu) - jesli nie, zmiana samego warunku disabled na froncie nie rozwiaze problemu.
RECOMMENDED_NEXT_STEP: Zbadac formularz recznej korekty/wyszukiwania na widoku zdjecia/detekcji, zluzowac warunek disabled przycisku "Szukaj" tak, by ISBN sam w sobie tez uprawnial do wyszukania, zweryfikowac warstwe API/matching pod katem wsparcia zapytania ISBN-only.
SKIP_REASON: none
[/AI_TRIAGE_V1]

## Triage - podsumowanie
- Wplyw na uzytkownika: Blokuje reczna korekte/wyszukanie ksiazki, gdy user zna tylko ISBN (np. z okladki), a nie zna/nie chce wpisywac tytulu - zmusza do wymyslania sztucznego tytulu albo rezygnacji z korekty.
- Czestotliwosc: Potencjalnie czesta przy recznych korektach niskiej jakosci detekcji (rozmyty grzbiet, brak widocznego tytulu, ale czytelny kod ISBN z innego zrodla).
- Koszt wdrozenia: Niski - zmiana warunku disabled w formularzu + weryfikacja/ew. rozszerzenie zapytania wyszukiwania o obsluge samego ISBN.
- Rekomendacja: Zaimplementowac teraz (DO_ROZWAZENIA_TERAZ) - male ryzyko, jasny UX-fix zgloszony bezposrednio przez uzytkownika produktu.
