Jesteś inżynierem wprowadzającym nowego developera do dużego repo legacy.

Twoim zadaniem jest utworzyć dokument onboardingowy `context/map/repo-map.md` z trzech już istniejących artefaktów — nie generuj danych od zera, nie powtarzaj ich tabel w całości.

Kontekst do mapy:
- `context/map/artifact-1-territory.md`
- `context/map/artifact-2-structure.md`
- `context/map/artifact-3-contributors.md`

Zasady:
1. Łącz trzy perspektywy w jeden spójny obraz: gdzie żyje system → jak jest powiązany → kogo zapytać.
2. Pokaż realne granice i te miejsca, gdzie struktura katalogów nie odpowiada realnej aktywności.
3. Dokument ma prowadzić od szerokiego obrazu do 5–8 „pierwszych plików do przeczytania”.
4. Zaznacz wprost ograniczenia: to mapa aktywności i struktury w oknie 1 roku.
5. Przy sprzężeniach dopisz, skąd je wiesz: z grafu importów, z historii gita, czy to obszar, którego narzędzie w ogóle nie objęło (np. inny język albo część stacku bez grafu). Jeśli jakaś warstwa nie ma grafu zależności, powiedz to wprost — to jest `unknown`, a nie „brak powiązań”.
6. Jeśli coś zmienia się razem, bo jest generowane albo mockowane, a nie dlatego, że ktoś edytuje to ręcznie — oznacz to. Zmiana „przez regenerację” to inny, tańszy rodzaj sprzężenia niż ręczna edycja i inaczej waży przy ocenie kosztu zmiany.

Struktura `repo-map.md`:
1. TL;DR (5–7 zdań) — czym jest repo, główne warstwy (Mermaid), gdzie skupia się praca, gdzie boli.
2. Teren — duża odpowiedzialność vs peryferia; moduły głębokie i płytkie; aktywność w czasie.
3. Realne powiązania — co naprawdę zmienia się razem (couplingi + warstwy + cykle);
4. Strefy ryzyka — 4–6 obszarów wysokiego ryzyka z jedną linijką „dlaczego”
5. Kogo zapytać — per strefa: 1–2 kandydatów dopasowanych tematycznie.
6. Pierwszy dzień — uporządkowana lista 5–8 plików/modułów wejściowych do przeczytania.
7. Ograniczenia — okno czasowe, metoda, czego mapa NIE mówi.

## Format
Markdown z Mermaid, zwięźle, tabele tylko gdy realnie pomagają.

Cel: nowy developer po 15 min czytania wie, gdzie rzeczy żyją, co jest niebezpieczne i od czego zacząć.

Zapisz do `context/map/repo-map.md`.