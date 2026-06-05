// Czyszczenie tytułu OCR przed wyszukiwaniem w bazach zewnętrznych.
//
// Vision-OCR potrafi: (a) wstawić cyrylickie homoglify wyglądające jak łacińskie
// (Filut"ек" z cyrylickim е/к, "Asprа" z cyrylickim а) — dla Google Books to inny
// ciąg → 0 wyników; (b) dokleić zakres lat ("1985-2003"), tom, podtytuł po –/:.
// Te śmieci zawężają zapytanie i pudłują match mimo poprawnie odczytanego tytułu.

// Cyrylica → łacina dla liter o identycznym kształcie (najczęstsze w polskim OCR).
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', с: 'c', р: 'p', х: 'x', у: 'y', к: 'k', м: 'm',
  т: 't', н: 'h', в: 'b', і: 'i', ј: 'j',
  А: 'A', Е: 'E', О: 'O', С: 'C', Р: 'P', Х: 'X', У: 'Y', К: 'K', М: 'M',
  Т: 'T', Н: 'H', В: 'B', І: 'I',
};

/** Mapuje cyrylickie homoglify na łacińskie odpowiedniki. */
export function deCyrillic(s: string): string {
  return s.replace(/[Ѐ-ӿ]/g, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch);
}

/**
 * Czyści tytuł do zapytania wyszukiwania:
 * 1. homoglify cyrylica → łacina
 * 2. usuwa zakresy lat (1985-2003 / 1985–2003)
 * 3. kolapsuje białe znaki
 * Zwraca przyciętą wersję (zachowuje diakrytyki PL i wielkość liter).
 */
export function cleanSearchTitle(raw: string): string {
  return deCyrillic(raw)
    .replace(/\b\d{4}\s*[-–—]\s*\d{4}\b/g, ' ') // zakres lat
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Główny człon tytułu — przed pierwszym separatorem podtytułu (– — :).
 * "Y: OSTATNI Z MĘŻCZYZN – ZARAZA" → "Y" jest za krótkie, więc bierzemy
 * najdłuższy człon, nie pierwszy: chroni serie gdzie tom jest po separatorze,
 * ale i tytuły typu "Tytuł: podtytuł". Heurystyka: najdłuższy segment ≥3 znaki.
 */
export function mainTitleSegment(cleaned: string): string {
  const parts = cleaned
    .split(/\s*[–—:]\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  if (parts.length === 0) return cleaned;
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Heurystycznie rozdziela "Tytuł — Imię Nazwisko" na osobne pola.
 * Pasuje gdy część po myślniku em/en wygląda jak imię i nazwisko:
 * 2–3 słowa, każde zaczyna się wielką literą i zawiera małe litery
 * (wyklucza WIELKIE_LITERY będące podtytułami).
 * Zwraca { title, author: null } gdy wzorzec nie pasuje.
 */
export function extractAuthorFromTitle(raw: string): { title: string; author: string | null } {
  const match = /^(.{3,}?)\s*[–—]\s*(.+?)\s*$/.exec(raw);
  if (!match) return { title: raw, author: null };
  const candidate = match[2].trim();
  const words = candidate.split(/\s+/);
  if (
    words.length >= 2 &&
    words.length <= 3 &&
    words.every((w) => /^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(w) && /[a-ząćęłńóśźż]/.test(w))
  ) {
    return { title: match[1].trim(), author: candidate };
  }
  return { title: raw, author: null };
}

/**
 * Warianty zapytania do kaskady wyszukiwania, od najpełniejszego do najwęższego,
 * bez duplikatów. Konsument próbuje kolejno aż do pierwszego trafienia.
 */
export function titleQueryVariants(raw: string): string[] {
  const cleaned = cleanSearchTitle(raw);
  const main = mainTitleSegment(cleaned);
  const variants = [cleaned, main];
  return [...new Set(variants.filter((v) => v.length > 0))];
}
