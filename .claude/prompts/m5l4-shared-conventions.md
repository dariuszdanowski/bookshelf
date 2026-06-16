```yaml
name: Shared Team Engineering Conventions
description: A set of shared engineering conventions for a team, covering naming, error handling, TypeScript, functions, security, and testing.
license: CC0-1.0
metadata:
  tags: engineering-conventions, best-practices, coding-standards
```
# Wspólne Konwencje Inżynieryjne Zespołu

Użyj tego dokumentu jako źródła danych wejściowych dla umiejętności `code-review`. Traktuj go jako
punkt wyjścia, a nie jako uniwersalną prawdę: dostosuj nazwy, zasady frameworków, politykę testowania i
oczekiwania dotyczące bezpieczeństwa do swojego zespołu przed wygenerowaniem umiejętności.

## Nazewnictwo
- Zmienne i funkcje: opisowe camelCase (bez skrótów z wyjątkiem `url`, `id`, `api`, `config`)
- Wartości logiczne: prefiks `is`, `has`, `should`, `can`
- Funkcje: czasownik na początku (`getUserById`, nie `user`)
- Pliki: zgodne z głównym eksportem (`UserService.ts` eksportuje `UserService`)
- Stałe: UPPER_SNAKE_CASE

## Obsługa Błędów
- Wszystkie operacje asynchroniczne: try/catch lub `.catch()`
- Komunikaty o błędach zawierają informację o tym, która operacja się nie powiodła i odpowiednie dane wejściowe
- Brak pustych bloków catch; co najmniej, zaloguj lub ponownie zgłoś błąd
- Błędy HTTP zawierają kod statusu i komunikat umożliwiający podjęcie działania
- Czyszczenie należy do bloków `finally`, gdy zasoby są otwarte

## TypeScript
- Zero `any` bez jawnego komentarza uzasadniającego
- Preferuj `interface` zamiast `type` dla kształtów obiektów
- Używaj `unknown` dla danych zewnętrznych, zawężaj za pomocą type guards
- Modeluj stany za pomocą discriminated unions, a nie opcjonalnych pól
- Parametry generyczne: opisowe nazwy (`TUser`, nie `T`)

## Funkcje
- Jedna odpowiedzialność; jeśli potrzebujesz "i", aby ją opisać, podziel ją
- Maksymalnie 3 parametry; powyżej tego użyj obiektu opcji
- Wczesne powroty zamiast zagnieżdżonych warunków
- Funkcje zapytań (`get*`, `find*`, `is*`) muszą być czyste

## Bezpieczeństwo
- Brak sekretów w kodzie; tylko zmienne środowiskowe
- Walidacja danych wejściowych użytkownika na granicach systemu
- SQL: tylko sparametryzowane instrukcje
- Odpowiedzi API nigdy nie ujawniają śladów stosu ani wewnętrznych ścieżek

## Testowanie
- Nazwy testów opisują zachowanie: "returns empty array when no results found"
- Każdy test odpowiada za swoje przygotowanie i sprzątanie
- Specyficzne asercje: `toEqual(expected)` zamiast `toBeTruthy()`
- Pokryj przypadki brzegowe: puste, null, wartości graniczne i ścieżki błędów