# Konwencja ground-truth bbox (zamrożona 2026-06-08, S-40)

Powód: self-test wykazał, że dwie anotacje tego samego obrazu (01 „deska" vs 04 „dół grzbietu")
różniły się o ~0.12 w y2 i ~2× w szerokości → IoU nieporównywalne. Zamrażamy JEDNĄ konwencję.

## Reguła (surface-agnostic, per-book)

Współrzędne `[x1, y1, x2, y2]` w 0..1, **top-left origin**, względem PEŁNEGO obrazu w orientacji
**display** (po `ExifTranspose` — to co dostaje model).

- **x1 / x2** = lewa / prawa **realna krawędź grzbietu** (linia podziału do sąsiada).
  NIE zawężać do obszaru tekstu; NIE rozszerzać na sąsiedni grzbiet.
- **y1** = górna widoczna krawędź grzbietu / okładki tej książki.
- **y2** = **DOLNA WIDOCZNA krawędź grzbietu** — gdzie kończy się TA książka.
  **NIE linia deski**, jeśli książka stoi wyżej. Dla książek na wspólnej desce y2 wyjdzie
  zbliżone — ale z pomiaru, nie z założenia.
- **Bez wspólnej kotwicy**: każda książka ma własne y1/y2/x; zakaz kopiowania wartości.
- **Precyzja**: ciaśniejsza niż szerokość obiektu. Dla grzbietów pionowych cel ±0.01 w x.

## Typy powierzchni

- `shelf` — stoją pionowo na półce (grzbiet od przodu, wąski w x, wysoki w y).
- `stack` — leżą poziomo w stosie (grzbiet z boku, szeroki w x, cienki w y).
- `none` — luźno na podłożu (koc/blat/kanapa), często ukośnie → bbox axis-aligned jest luźny,
  IoU traktować orientacyjnie (rozważyć quad — `0022_detection_quad.sql`).

## Stan plików (po zamrożeniu)

| Plik | Orientacja | Typ | Konwencja |
| --- | --- | --- | --- |
| `01-shelf-vertical.json` | landscape | shelf | ZGODNA (naprawione — było „deska") |
| `04-shelf-dariusz.json` | landscape | shelf | ZGODNA (referencyjna; ten sam obraz co 01) |
| `02-mixed.json` | portrait | stack+shelf | ZGODNA (y2 = dół grzbietu) |
| `03-bed-nonshelf.json` | portrait | none | ZGODNA (axis-aligned, IoU orientacyjne) |
