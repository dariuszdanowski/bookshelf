# Umiejętność współdzielonej recenzji kodu — Wymagania

## Cel
Stworzenie umiejętności Agenta do automatycznej recenzji kodu w oparciu o konwencje inżynieryjne zespołu.

## Dane wejściowe
Użyj załączonego materiału `m5l4-shared-conventions.md` jako dokumentu źródłowego.
Wygenerowana umiejętność powinna recenzować kod pod kątem tych konwencji, a nie tworzyć
nowego standardu recenzji.

## Konfiguracja
- Nazwa umiejętności: `code-review`
- Kategoria: quality
- Plik docelowy: `skills/code-review/SKILL.md`
- Frazy wyzwalające: "review code", "check this PR", "review my changes", "code review"

## Frontmatter
Plik `SKILL.md` musi zawierać YAML frontmatter z:

```yaml
---
name: code-review
description: Review code changes against team engineering conventions, testing standards and security expectations.
---
```

## Kategorie recenzji
Użyj kategorii pochodzących z materiału dotyczącego konwencji:
- Naming
- Error handling
- TypeScript
- Function design
- Security
- Testing

## Format wyjściowy
Wyniki zorganizowane według ważności: Krytyczne → Ostrzeżenie → Sugestia.
Każdy wynik zawiera odniesienie `file:line`, jeśli to możliwe.
Zakończ jedną rekomendacją: `APPROVE`, `REQUEST CHANGES` lub `NEEDS DISCUSSION`.