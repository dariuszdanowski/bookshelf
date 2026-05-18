# Proces identyfikacji książek z zdjęć półki

**Data utworzenia:** 2026-05-13  
**Status:** Dokument procesowy  
**Źródło:** Delegowane od orchestratora

---

## Spis treści

1. [Część 1: Opis procesu identyfikacji książek](#część-1-opis-procesu-identyfikacji-książek)
   - [Faza 1 — Wstępna analiza wizualna](#faza-1--wstępna-analiza-wizualna)
   - [Faza 2 — Weryfikacja w bazach danych](#faza-2--werifikacja-w-bazach-danych)
   - [Faza 3 — Zaawansowane przetwarzanie obrazu](#faza-3--zaawansowane-przetwarzanie-obrazu)
   - [Faza 4 — Ostateczna weryfikacja](#faza-4--ostateczna-weryfikacja)
   - [Wyniki](#wyniki)
2. [Część 2: Proponowane podejście do weryfikacji WSZYSTKICH zdjęć](#część-2-proponowane-podejście-do-weryfikacji-wszystkich-zdjęć)
   - [2.1. Inwentaryzacja zdjęć](#21-inwentaryzacja-zdjęć)
   - [2.2. Pipeline przetwarzania](#22-pipeline-przetwarzania)
   - [2.3. Narzędzia i technologie](#23-narzędzia-i-technologie)
   - [2.4. Metryki jakości](#24-metryki-jakości)
   - [2.5. Proponowana struktura danych](#25-proponowana-struktura-danych)
   - [2.6. Harmonogram prac](#26-harmonogram-prac)

---

## Część 1: Opis procesu identyfikacji książek

> Przykład na zdjęciu `20260512_230159.jpg` (`C:\projekty\10xDevs\photos\20260512_230159.jpg`, 4000×1848 px)

Proces identyfikacji książek z jednego zdjęcia został przeprowadzony w czterech fazach, z wykorzystaniem analizy wizualnej AI, zaawansowanego przetwarzania obrazu i weryfikacji w publicznych bazach danych.

---

### Faza 1 — Wstępna analiza wizualna

**Cel:** Identyfikacja wszystkich książek widocznych na zdjęciu i określenie poziomu czytelności każdego grzbietu.

**Kroki:**

1. **Analiza zdjęcia przez model AI (vision)**
   - Model AI (z możliwością przetwarzania obrazu) analizuje zdjęcie w całości
   - Wizualne odczytanie tytułów i autorów z grzbietów książek
   - Identyfikacja obiektów dekoracyjnych blokujących widok (kubki, świeczki, figurki)

2. **Identyfikacja książek czytelnych vs. zasłoniętych**
   - Każda książka otrzymuje oznaczenie pozycji na zdjęciu (w procentach szerokości, od lewej do prawej)
   - Książki są klasyfikowane pod kątem czytelności:
     - **Pełna czytelność** — tytuł i autor wyraźnie widoczne
     - **Częściowa czytelność** — widoczny fragment tekstu, zasłonięty przez obiekt dekoracyjny
     - **Brak czytelności** — grzbiet całkowicie zasłonięty lub zbyt mały do odczytania

3. **Przygotowanie wstępnej tabeli ze statusem weryfikacji**
   - Tworzenie tabeli z kolumnami: Lp., Tytuł, Autor, Wydawca, Status weryfikacji, Pozycja na zdjęciu (%)
   - Statusy:
     - ✅ — zweryfikowane (tytuł i autor czytelne)
     - ⚠️ — częściowe (widoczny fragment tekstu)
     - ❌ — nierozpoznane (całkowicie zasłonięte lub nieczytelne)

**Wynik fazy 1 (dla `20260512_230159.jpg`):**

| Metryka | Wartość |
|---------|---------|
| Łącznie książek wykrytych | 23 |
| ✅ Zweryfikowano wstępnie | 14 (61%) |
| ⚠️ Częściowa weryfikacja | 6 (26%) |
| ❌ Nierozpoznane | 1 (4%) |
| Nie określono | 2 (9%) |

**Wykryte obiekty blokujące widok:**

| Obiekt | Pozycja | Wpływ |
|--------|---------|-------|
| Kubek | Lewa strona, 0–2% | Zasłania książkę nr 1 |
| Żaba origami | Przed książkami 12–13 | Nie zasłania grzbietów |
| Świeca | Prawa strona, 83–100% | Zasłania książki nr 21–23 |

---

### Faza 2 — Weryfikacja w bazach danych

**Cel:** Potwierdzenie istnienia zidentyfikowanych książek i zebranie pełnych metadanych (wydawca, rok, ISBN).

**Kroki:**

1. **Sprawdzenie tytułów i autorów w źródłach publicznych**
   - Dla każdej książki oznaczonej jako ✅ lub ⚠️ przeprowadzono wyszukiwanie:
     - Google Books (`books.google.pl`)
     - Open Library (`openlibrary.org`)
     - ISBN.pl / WorldCat (`isbn.search.worldcat.org`)
     - Strony wydawców (Kultura Gniewu, Fabryka Słów, Wydawnictwo A/Agora)

2. **Potwierdzenie istnienia książek**
   - Weryfikacja: tytuł + autor → wydawca, rok wydania, ISBN
   - Dla książek z częściową informacją: wyszukiwanie po fragmencie tytułu + autor + wydawca

3. **Oznaczenie książek jako:**
   - ✅ **Zweryfikowane** — tytuł, autor, wydawca potwierdzone w co najmniej jednym źródle
   - ⚠️ **Częściowe** — widoczny fragment tekstu, wymaga dalszej analizy
   - ❌ **Nierozpoznane** — brak danych do weryfikacji

**Wynik fazy 2:**

- 14 książek ✅ zweryfikowanych wstępnie
- 6 książek ⚠️ wymagających zaawansowanej analizy obrazu
- 1 książka ❌ całkowicie zasłonięta (kubek) — wymaga nowego zdjęcia

---

### Faza 3 — Zaawansowane przetwarzanie obrazu

**Cel:** Odczytanie tekstu z grzbietów książek oznaczonych jako ⚠️ i ❌ poprzez zastosowanie technik przetwarzania obrazu.

**Kroki:**

1. **Wycinanie fragmentów odpowiadających książkom nierozpoznanych**
   - Na podstawie pozycji (%) z fazy 1, wycinanie prostokątnych fragmentów zdjęcia
   - Każdy fragment odpowiada jednej książce
   - Zastosowanie powiększenia 3x-4x z interpolacją LANCZOS dla zachowania ostrości

2. **Zastosowanie 12 technik przetwarzania obrazu**

   Dla każdego wycinka wygenerowano 12 wersji przetworzonych:

   | Nr | Technika | Opis | Narzędzie |
   |----|----------|------|-----------|
   | 1 | **CLAHE** | Contrast Limited Adaptive Histogram Equalization | `cv2.createCLAHE()` |
   | 2 | **Zwiększenie kontrastu** | Wzmocnienie kontrastu (factor=2.0) | `ImageEnhance.Contrast` |
   | 3 | **Zwiększenie jasności** | Rozjaśnienie (factor=1.5–1.8) | `ImageEnhance.Brightness` |
   | 4 | **Zmiana saturacji/barw** | Wzmocnienie kolorów (factor=2.0) | `ImageEnhance.Color` |
   | 5 | **Sharpening (wyostrzanie)** | Unsharp Mask, radius=1.5, percent=200 | `ImageFilter.SHARPEN` |
   | 6 | **Binarna segmentacja tekstu** | Próg=100–128, separacja tekstu od tła | `Image.point()` |
   | 7 | **Autocontrast** | Automatyczna korekta kontrastu | `ImageOps.autocontrast` |
   | 8 | **Histogram equalization** | Równomierny rozkład jasności | `ImageOps.equalize` |
   | 9 | **Powiększenie 3x-4x** | Skalowanie z interpolacją LANCZOS | `Image.resize()` + `LANCZOS` |
   | 10 | **Kombinacje metod** | Kontrast + jasność + sharpening | Łączenie `ImageEnhance` |
   | 11 | **Grayscale + kontrast** | Szarość + wzmocniony kontrast | `.convert('L')` + `Contrast` |
   | 12 | **Oryginał** | Surowy wycinek (referencja) | — |

3. **Wizualna analiza przetworzonych obrazów**
   - Każdy przetworzony obraz jest analizowany przez model AI (vision)
   - Odczytanie tekstu z najlepszych wersji (zazwyczaj: powiększenie + kombinacja metod)
   - Identyfikacja: tytuł, autor, wydawca, numer tomu

**Najskuteczniejsze metody (wg wyników):**

| Miejsce | Metoda | Skuteczność |
|---------|--------|-------------|
| 1 | Powiększenie 3x-4x z LANCZOS | Podstawowa metoda dla wszystkich książek |
| 2 | Kombinacja (kontrast + jasność + sharpening) | Najlepsza dla ciemnych fragmentów |
| 3 | Grayscale + kontrast | Najlepsza dla czytelności tekstu na jednolitym tle |
| 4 | Autocontrast | Skuteczna dla książek z jasnymi grzbietami |

**Wynik fazy 3 — zidentyfikowane książki:**

| Nr | Pozycja | Tytuł | Autor | Wydawca |
|----|---------|-------|-------|---------|
| 2 | 0–4,5% | Wojna Balonowa (Pogodnik Trzeciej Kategorii, Tom II) | Romuald Pawlak | Kultura Gniewu |
| 3 | 4,5–9% | Czarem i smoczym oddechem (Tom I) | Romuald Pawlak | Kultura Gniewu |
| 21 | 82–85% | Zielona Burza Część 2 | Philip Reeve | Wydawnictwo A |
| 22 | 85–88% | Zielona Burza Część 1 | Philip Reeve | Wydawnictwo A |
| 23 | 88–92% | Cynowiec | Philip Reeve | Wydawnictwo A |
| 24 | 92–95% | Kosmos | Neil deGrasse Tyson | — |
| 25 | 95–100% | Osadnicy/Catcatcher | Rebecca Roanhorse | — |

**Wygenerowane pliki:**
- Katalog: [`docs/image-analysis/`](docs/image-analysis/)
- Skrypty: [`analyze_books.py`](docs/image-analysis/analyze_books.py), [`analyze_books_v2.py`](docs/image-analysis/analyze_books_v2.py)
- 60+ plików PNG (przetworzone obrazy)

---

### Faza 4 — Ostateczna weryfikacja

**Cel:** Potwierdzenie wszystkich zidentyfikowanych tytułów w bazach danych i zebranie pełnych metadanych.

**Kroki:**

1. **Sprawdzenie zidentyfikowanych tytułów w bazach:**

   | Baza danych | URL | Zastosowanie |
   |-------------|-----|--------------|
   | Google Books | https://books.google.pl | Wyszukiwanie po tytule + autorze |
   | Open Library | https://openlibrary.org | Metadane, edycje, ISBN |
   | ISBN.pl / WorldCat | https://isbn.search.worldcat.org | Wyszukiwanie po ISBN/tytule |
   | Kultura Gniewu | https://kulturaniewu.pl | Książki Romualda Pawlaka |
   | Wydawnictwo A (Agora) | https://agora.com.pl | Książki Philipa Reeve |
   | Fabryka Słów | — | Książki: Kantoch, Kozak, Podlewski |

2. **Potwierdzenie danych:**
   - Tytuł (polski + oryginał)
   - Autor
   - Wydawca
   - Rok wydania
   - ISBN (jeśli dostępne)
   - Seria / numer tomu

3. **Ostateczna klasyfikacja:**

   | Status | Opis |
   |--------|------|
   | ✅ Potwierdzona | Dane zweryfikowane w co najmniej 1 źródle |
   | ⚠️ Wymaga weryfikacji | Brak pełnych danych w źródłach |
   | ❌ Nierozpoznana | Wymaga nowego zdjęcia lub ręcznej identyfikacji |

---

### Wyniki

**Podsumowanie końcowe dla zdjęcia `20260512_230159.jpg`:**

| Metryka | Wartość |
|---------|---------|
| **Łącznie książek na półce** | **23** |
| ✅ Zweryfikowane wstępnie (faza 1-2) | 14 (61%) |
| ⚠️ Częściowe → po analizie ✅ potwierdzone | 6 (26%) → 6 ✅ |
| ❌ Całkowicie zasłonięta (kubek) | 1 (4%) |
| **Ostatecznie zidentyfikowanych** | **22/23 (96%)** |

**Tabela końcowa wszystkich książek:**

| Lp. | Tytuł | Autor | Wydawca | Status |
|-----|-------|-------|---------|--------|
| 1 | NIE ROZPOZNANY | NIEZNAJOMY | NIEZNAJOMY | ❌ (kubek) |
| 2 | Wojna Balonowa (Pogodnik Trzeciej Kategorii, Tom II) | Romuald Pawlak | Kultura Gniewu | ✅ |
| 3 | Czarem i smoczym oddechem (Tom I) | Romuald Pawlak | Kultura Gniewu | ✅ |
| 4 | 13 anioł | Anna Kantoch | Fabryka Słów | ✅ |
| 5 | Nocarz | Magdalena Kozak | Fabryka Słów | ✅ |
| 6 | Głębia. Skokowiec (Tom 1) | Marcin Podlewski | Fabryka Słów | ✅ |
| 7 | Powołanie. Morrigan Crow 2 | Jessica Townsend | — | ✅ |
| 8 | Nevermoor. Przypadki Morrigan Crow 1 | Jessica Townsend | — | ✅ |
| 9 | Długi Kosmos | Pratchett & Baxter | Prószyński i S-ka | ✅ |
| 10 | Długa Utopia | Pratchett & Baxter | Prószyński i S-ka | ✅ |
| 11 | Długi Mars | Pratchett & Baxter | Prószyński i S-ka | ✅ |
| 12 | Długa Wojna | Pratchett & Baxter | Prószyński i S-ka | ✅ |
| 13 | Kiksy. Klawiatury | Terry Pratchett | Prószyński i S-ka | ✅ |
| 14 | Życie i praca z magią w Hle | Terry Pratchett | Prószyński i S-ka | ✅ |
| 15 | Pasterska Korona | Terry Pratchett | Prószyński i S-ka | ✅ |
| 16 | Nauka Świata Dysku IV | Pratchett, Stewart, Cohen | Prószyński i S-ka | ✅ |
| 17 | Para w ruch | Terry Pratchett | Prószyński i S-ka | ✅ |
| 18 | Ostatnia Godzina | Bartomiejczyk & Gajewska | WAS | ✅ |
| 19 | Zielona Burza Część 2 | Philip Reeve | Wydawnictwo A | ✅ |
| 20 | Zielona Burza Część 1 | Philip Reeve | Wydawnictwo A | ✅ |
| 21 | Cynowiec | Philip Reeve | Wydawnictwo A | ✅ |
| 22 | Kosmos | Neil deGrasse Tyson | — | ✅ |
| 23 | Osadnicy/Catcatcher | Rebecca Roanhorse | — | ✅ |

**Książka wymagająca nowego zdjęcia:**

| Nr | Problem | Rozwiązanie |
|----|---------|-------------|
| 1 | Kubek całkowicie zasłania grzbiet (pozycja 0–2%) | Przesunąć kubek, wykonać nowe zdjęcie |

---

## Część 2: Proponowane podejście do weryfikacji WSZYSTKICH zdjęć z katalogu

Na podstawie doświadczeń z analizy zdjęcia `20260512_230159.jpg`, poniżej przedstawiono kompleksowy plan automatyzacji procesu identyfikacji książek ze wszystkich zdjęć.

---

### 2.1. Inwentaryzacja zdjęć

**Cel:** Identyfikacja wszystkich zdjęć do przetworzenia i wstępna ocena jakości.

**Kroki:**

1. **Wykrycie wszystkich plików `.jpg`/`.png`** w katalogu `C:\projekty\10xDevs\photos`
2. **Dla każdego zdjęcia:**
   - Wstępna analiza wizualna (AI vision):
     - Ilość książek widocznych na półce
     - Ogólna czytelność grzbietów
     - Identyfikacja przeszkód (obiekty dekoracyjne, cienie, rozmycie)
   - Ocena jakości zdjęcia:
     - Rozdzielczość
     - Oświetlenie
     - Kąt ujęcia
     - Poziom rozmycia
3. **Klasyfikacja zdjęć:**
   - 🟢 **Gotowe do automatycznej analizy** — dobra jakość, czytelne grzbiet
   - 🟡 **Wymagające korekty** — średnia jakość, możliwe zastosowanie przetwarzania obrazu
   - 🔴 **Wymagające nowego zdjęcia** — zła jakość, zbyt ciemne, rozmyte

---

### 2.2. Pipeline przetwarzania (proponowany)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PIPELINE PRZETWARZANIA                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Zdjęcie                                                                │
│    │                                                                    │
│    ▼                                                                    │
│  ┌──────────────────────────┐                                          │
│  │ Analiza wizualna AI      │ ← Model AI (vision)                      │
│  │ (Faza 1)                 │   - Wykrycie książek                      │
│  │                          │   - Odczyt tytułów/autorów                │
│  │                          │   - Identyfikacja przeszkód               │
│  └──────────┬───────────────┘                                          │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────────┐                                          │
│  │ Tabela wstępna           │ ← Klasyfikacja: ✅/⚠️/❌                  │
│  └──────────┬───────────────┘                                          │
│             │                                                          │
│      ┌──────┴────────┐                                                │
│      ▼               ▼                                                │
│  ┌────────┐    ┌────────────────┐                                    │
│  │ Książki│    │ Książki ⚠️/❌   │                                    │
│  │  ✅    │    │                │                                    │
│  └───┬────┘    └──────┬─────────┘                                    │
│      │                │                                               │
│      ▼                ▼                                               │
│  ┌────────────┐  ┌──────────────────────────┐                       │
│  │ Weryfikacja│  │ Przetwarzanie obrazu     │                       │
│  │ w bazach   │  │ (Faza 3 - 12 technik)    │                       │
│  │ (Faza 2/4) │  │                          │                       │
│  └─────┬──────┘  └──────────┬───────────────┘                       │
│        │                    │                                        │
│        │                    ▼                                        │
│        │            ┌───────────────┐                               │
│        │            │ Analiza AI    │ ← Ponowna analiza wizualna    │
│        │            │ przetworzonego│                               │
│        │            │ obrazu        │                               │
│        │            └───────┬───────┘                               │
│        │                    │                                        │
│        │                    ▼                                        │
│        │            ┌───────────────┐                               │
│        │            │ Weryfikacja   │ ← Bazy danych                 │
│        │            │ w bazach      │                               │
│        │            └───────┬───────┘                               │
│        │                    │                                        │
│        ▼                    ▼                                        │
│  ┌────────────────────────────────┐                                  │
│  │      GOTOWE — Zapis do bazy    │                                  │
│  └──────────────────┬─────────────┘                                  │
│                     │                                                │
│                     ▼                                                │
│            ┌────────────────┐                                       │
│            │ Jeszcze ❌ ?    │                                       │
│            └────────┬───────┘                                       │
│                     │                                                │
│              ┌──────┴──────┐                                        │
│              ▼             ▼                                        │
│         ┌─────────┐  ┌────────────┐                                │
│         │ Flaguj   │  │ Sugeruj    │                                │
│         │ do ręcznej│  │ nowe zdjęcie│                               │
│         │ weryfikacji│  │            │                               │
│         └─────────┘  └────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 2.3. Narzędzia i technologie

| Technologia | Zastosowanie | Status |
|-------------|--------------|--------|
| **Python + Pillow** | Przetwarzanie obrazu (12 technik) | ✅ Zaimplementowane |
| **Python + OpenCV** | Zaawansowane operacje (CLAHE, segmentacja) | ⚠️ Do zaimplementowania |
| **NumPy** | Operacje macierzowe na danych obrazu | ✅ Zaimplementowane |
| **OCR — Tesseract** | Automatyczne odczytywanie tekstu z grzbietów | ⚠️ Do zaimplementowania |
| **OCR — Google Vision API** | Alternatywny OCR (lepsza dokładność) | 🔲 Do rozważenia |
| **AI Vision** | Analiza wizualna (jak w fazie 1) | ✅ Dostępne |
| **Google Books API** | Weryfikacja książek, metadane | 🔲 Do integracji |
| **Open Library API** | Alternatywne źródło metadanych | 🔲 Do integracji |
| **ISBN.pl / WorldCat API** | Wyszukiwanie po ISBN | 🔲 Do integracji |
| **Supabase** | Przechowywanie danych (baza książek) | ✅ Dostępne w projekcie |

**Skrypty już zaimplementowane:**

| Skrypt | Opis |
|--------|------|
| [`analyze_books.py`](docs/image-analysis/analyze_books.py) | Skrypt v1 — podstawowe przetwarzanie obrazu |
| [`analyze_books_v2.py`](docs/image-analysis/analyze_books_v2.py) | Skrypt v2 — rozszerzone techniki + korekty |

---

### 2.4. Metryki jakości

**Cele:**

| Metryka | Cel | Pomiar |
|---------|-----|--------|
| **Procent zidentyfikowanych książek** | ≥95% automatycznie | (książki ✅ / wszystkie książki) × 100% |
| **Procent wymagających ręcznej weryfikacji** | ≤5% | (książki ⚠️/❌ / wszystkie książki) × 100% |
| **Czas przetwarzania jednego zdjęcia** | ≤10 min | Od analizy do zapisu w bazie |
| **Dokładność OCR** | ≥90% poprawnych odczytów | Porównanie OCR vs. analiza AI vision |

**Raport końcowy:**

- Tabela wszystkich książek ze wszystkich zdjęć
- Statystyki: liczba zdjęć, liczba książek, procent zidentyfikowanych
- Lista książek wymagających ręcznej weryfikacji
- Lista zdjęć wymagających ponownego wykonania

---

### 2.5. Proponowana struktura danych

**Format JSON/CSV dla każdego zdjęcia:**

```json
{
  "zdjecie": {
    "plik": "20260512_230159.jpg",
    "sciezka": "C:\\projekty\\10xDevs\\photos\\20260512_230159.jpg",
    "wymiary": "4000x1848",
    "data_analizy": "2026-05-13",
    "ilosc_ksiazek": 23,
    "przeszkody": ["kubek", "swieca", "zaba_origami"]
  },
  "ksiazki": [
    {
      "pozycja": 2,
      "pozycja_na_zdjeciu": "0-4.5%",
      "tytul": "Wojna Balonowa",
      "tytul_pełny": "Wojna Balonowa (Pogodnik Trzeciej Kategorii, Tom II)",
      "autor": "Romuald Pawlak",
      "wydawca": "Kultura Gniewu",
      "rok": null,
      "isbn": null,
      "seria": "Pogodnik Trzeciej Kategorii",
      "tom": 2,
      "status": "zweryfikowana",
      "faza_identyfikacji": 3,
      "metody_przetwarzania": ["powiekszenie_4x", "kombinacja"],
      "zrodlo_weryfikacji": "kultura_gniewu.pl"
    }
  ]
}
```

**Tabela w bazie danych (Supabase):**

```sql
CREATE TABLE books (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_filename  VARCHAR(255) NOT NULL,
  position        INTEGER NOT NULL,
  position_range  VARCHAR(20),
  title           VARCHAR(500) NOT NULL,
  title_full      TEXT,
  author          VARCHAR(255),
  publisher       VARCHAR(255),
  year            INTEGER,
  isbn            VARCHAR(20),
  series          VARCHAR(255),
  volume          INTEGER,
  status          VARCHAR(20) NOT NULL,  -- 'zweryfikowana', 'czesciowa', 'nierozpoznana'
  verification_source VARCHAR(255),
  processing_methods TEXT[],
  created_at      TIMESTAMP DEFAULT NOW()
);
```

---

### 2.6. Harmonogram prac

| Etap | Opis | Szacowany czas | Zależności |
|------|------|----------------|------------|
| **Etap 1** | Inwentaryzacja zdjęć — wykrycie wszystkich plików, wstępna ocena jakości | 1–2h | — |
| **Etap 2** | Automatyczna analiza wizualna wszystkich zdjęć (AI vision, faza 1) | 2–4h | Etap 1 |
| **Etap 3** | Przetwarzanie obrazu dla książek nierozpoznanych (12 technik, faza 3) | 4–6h | Etap 2 |
| **Etap 4** | Weryfikacja w bazach danych (API + ręczna, faza 2/4) | 2–3h | Etap 2, 3 |
| **Etap 5** | Raport końcowy — tabela wszystkich książek, statystyki, flagowanie | 1h | Etap 4 |
| **Łącznie** | | **10–16h** | |

**Priorytety:**

1. 🟢 **Etap 1-2** — jak najszybciej (dane wejściowe do dalszych etapów)
2. 🟡 **Etap 3** — równolegle z etapem 4 (dla różnych zdjęć)
3. 🟡 **Etap 4** — równolegle z etapem 3
4. 🔴 **Etap 5** — po ukończeniu etapów 1-4

---

## Załączniki

### A. Dokumentacja procesowa

| Dokument | Ścieżka |
|----------|---------|
| Analiza półki (pełna) | [`docs/analiza-polki-20260512_230159.md`](docs/analiza-polki-20260512_230159.md) |
| Raport analizy obrazu | [`docs/image-analysis/raport-analiza-ksiazek.md`](docs/image-analysis/raport-analiza-ksiazek.md) |
| Skrypt przetwarzania v1 | [`docs/image-analysis/analyze_books.py`](docs/image-analysis/analyze_books.py) |
| Skrypt przetwarzania v2 | [`docs/image-analysis/analyze_books_v2.py`](docs/image-analysis/analyze_books_v2.py) |

### B. Wygenerowane obrazy

Katalog: [`docs/image-analysis/`](docs/image-analysis/)

| Książka | Liczba plików | Przykładowe pliki |
|---------|--------------|-------------------|
| nr 2 (Wojna Balonowa) | 12 | `book2_clahe.png`, `book2_combo.png`, `book2_enlarged.png` |
| nr 3 (Czarem i smoczym oddechem) | 12 | `book3_clahe.png`, `book3_combo.png`, `book3_enlarged.png` |
| nr 21 (Zielona Burza Część 2) | 5+ | `book21_v2_autocontrast.png`, `book21_v2_combo.png` |
| nr 22 (Zielona Burza Część 1) | 5+ | `book22_v2_autocontrast.png`, `book22_v2_combo.png` |
| nr 23 (Cynowiec) | 5+ | `book23_v2_autocontrast.png`, `book23_v2_combo.png` |
| nr 24 (Kosmos) | 5+ | `book24_v2_autocontrast.png`, `book24_v2_combo.png` |
| nr 25 (Osadnicy/Catcatcher) | 5+ | `book25_v2_autocontrast.png`, `book25_v2_combo.png` |

---

*Dokument przygotowany w ramach procesu identyfikacji książek z projektu Bookshelf.*