# Bbox self-test — wnioski (S-40, 2026-06-08)

Weryfikacja **bez API**: agent Claude jako proxy endpointu vision (Read tool) vs ręczny
ground-truth usera vs realny zapis API v6 (`01-model-v6.json`). Narzędzie:
`scripts/bbox-llm-selftest.mjs`. Overlaye: `01-compare.overlay.jpg`, `01-gt-disagree.overlay.jpg`.

## Projekt eksperymentu

- **Czysty test (ślepy):** zdjęcie 01/04 = ta sama biała półka Kallax (landscape, 8–9 grzbietów
  pionowych). Bboxy agenta wygenerowane **zanim** zobaczył GT.
- **Skażony (sanity-check):** 02/03 — GT widziany wcześniej, IoU≈0.97–0.99 potwierdza tylko,
  że scorer nagradza trafne współrzędne. Nie liczą się jako dowód zdolności.
- Trzy źródła porównane greedy max-IoU; metryki kierunkowe: 1D-xIoU, trafienie środka,
  stosunek szerokości, |Δy2|, %klastra y2, regresja afiniczna środków.

## Wyniki

```
Photo Źródło    recall 2D-IoU 1D-xIoU ctrHit  szer×  |Δy2|  %Y2cl
01    llm-read    89%  0.419  0.528    63%  1.41  0.099    25%   (vs GT01 „deska", wąski)
01    model-v6    78%  0.326  0.500    57%  1.78  0.024    88%   (API, vs GT01)
04    llm-read    78%  0.413  0.527    71%  1.00  0.020    25%   (vs GT04 „dół grzbietu")
04    model-v6    67%  0.086  0.467    50%  1.32  0.095    88%   (API, vs GT04)
02    llm-read   100%  0.966  0.985   100%  1.00  0.001    25%   (SKAŻONE)
03    llm-read   100%  0.993  0.997   100%  1.00  0.000    17%   (SKAŻONE)
```

## Pięć wniosków

1. **Ground-truth jest niespójny — to dominanta szumu, nie jakość modelu.** Te same MOJE bboxy
   dają `szer×1.41 / |Δy2|=0.099` vs GT01, a `szer×1.00 / |Δy2|=0.020` vs GT04 — różni je tylko
   konwencja anotacji (GT01: „y2=deska 0.805" + wąskie x; GT04: „y2=dół grzbietu 0.92" + realne x).
   Wizualny dowód: `01-gt-disagree.overlay.jpg` (zielony ≠ pomarańczowy na tym samym obrazie).
   **Bez jednej, zamrożonej konwencji GT każde IoU jest nieporównywalne.**

2. **Realny, konwencjo-niezależny defekt modelu = zawyżona SZEROKOŚĆ grzbietu.** API v6 rysuje
   ramki `×1.78` (vs GT01) i `×1.32` (vs GT04) — za szerokie względem OBU. Ramki nachodzą na
   sąsiadów, jedna ląduje w pustej części półki (false positive). Widać to na `01-compare.overlay.jpg`
   (czerwone rozlane). Stosunek szerokości jest odporny na konwencję y (to oś X), więc to twardy sygnał.

3. **2D IoU to zła metryka podstawowa dla wąskich grzbietów.** Nawet mój wizualnie dobry odczyt
   (cyan) dostaje 2D-IoU≈0.42, bo grzbiet ma szerokość ~0.04–0.07 → IoU jest hiperczuły na drobne
   przesunięcia x i na konwencję y2. Lepsze: 1D-xIoU, trafienie środka, stosunek szerokości,
   |Δy2| osobno. Wniosek metodyczny: nie bramkować na 2D-IoU.

4. **Model POTRAFI lokalizować — wina leży w prompcie/inferencji, nie w zdolności.** Ten sam model
   rodziny: careful-read (cyan) = `szer×1.00`, `centerHit 71%`, `%Y2cluster 25%` (naturalny rozrzut);
   single-shot API v6 = `szer×1.78`, `centerHit 57%`, `%Y2cluster 88%` (twarde klastrowanie).
   Mechanizm klastra zidentyfikowany: prompt v6 ma przykład `bbox:[0.22,0.24,0.25,0.82]` i regułę
   „y2=deska [0.75–0.88]" → **model kopiuje y2≈0.82–0.83 z przykładu** zamiast mierzyć
   (API dało y2=0.83 ×7/8). → reframe promptu (usunąć kotwicę + przykład y2) jest uzasadniony.

5. **Bug prod `y2=0.555` jest portrait-specyficzny i NIE został przetestowany na ślepo.** Czysty
   test mam tylko na zdjęciu landscape (01/04), gdzie model klastruje y2≈0.83 (prawie poprawnie).
   Wartość 0.555 z produkcji występuje na zdjęciach portretowych (telefon, AR≈0.46). Hipoteza:
   dystorsja wzdłuż DŁUŻSZEJ osi obrazu (X dla landscape, Y dla portrait) — wymaga testu API na
   zdjęciu portretowym, bo agent-Read i endpoint-API mogą różnie traktować resize/orientację.

## Jak badać takie zdjęcia (protokół)

1. **Zamroź jedną konwencję GT** (np. „ciasny obrys widocznego grzbietu, y2 = dolna widoczna
   krawędź grzbietu, nie deska") i anotuj wszystkie zdjęcia tak samo. Precyzja musi być
   **ciaśniejsza niż szerokość obiektu** (dla grzbietów ±0.01, nie ±0.03).
2. **Overlay = bramka #0.** Najpierw narysuj GT na obrazie i sprawdź wzrokowo, że przylega.
   Dopiero potem ufaj liczbom.
3. **Metryki kierunkowe, nie samo 2D-IoU:** 1D-xIoU + trafienie środka + stosunek szerokości
   (oś rozrzutu) oraz |Δy2| i %klastra (kotwica) osobno. 2D-IoU tylko jako pomocniczy.
4. **Self-test LLM-via-Read jako darmowy baseline zdolności** PRZED wydaniem grosza na API:
   izoluje „czy model umie" od „czy prompt/inferencja psują".
5. **Testuj per orientacja (landscape vs portrait).** Bug klastrowania zmienia wartość zależnie
   od dłuższej osi; jeden typ zdjęcia nie generalizuje.
6. **Rozdziel trzy źródła błędu:** (a) niespójność/imprecyzja GT, (b) konwencja y2 (deska vs grzbiet),
   (c) defekt modelu (szerokość, kotwica). Tylko (c) naprawia prompt; (a)/(b) to higiena pomiaru.

## Rekomendacja przed testem API

- **Najpierw napraw GT:** wybierz konwencję (proponowane: „dół widocznego grzbietu" jak GT04,
  bo zgadza się z niezależnym odczytem), re-anotuj 01 spójnie, dorzuć ≥1 zdjęcie **portretowe**
  z czystym (nie-skażonym) GT do testu kotwicy 0.555.
- **Potem test API:** v6 vs wariant v7 (bez kotwicy „deska"/bez przykładu y2), N=3, na landscape
  ORAZ portrait, metryki kierunkowe. Oczekiwanie: v7 obniża %Y2cluster i szer× bez utraty recall.
