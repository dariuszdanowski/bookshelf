---
name: setup-cicd
description: Generate a GitHub Actions validation and publish pipeline for an AI toolkit package published to AWS CodeArtifact through OIDC.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# /setup-cicd — Zbuduj potok publikacji CodeArtifact

Generujesz przepływ pracy CI/CD dla pakietu narzędzi AI Modelu 2.

Potok waliduje pakiet i publikuje go w AWS CodeArtifact z GitHub Actions przy użyciu OIDC. Nie może on zależeć od długotrwałych kluczy dostępu AWS.

## Dane wejściowe

Odczytaj te pliki, jeśli są obecne:

- `m5l4-codeartifact-spec-cicd.md`
- `m5l4-codeartifact-spec-terraform.md`
- `context/spec-cicd.md`
- `context/spec-terraform.md`
- `packages/ai-toolkit/package.json`
- `packages/ai-toolkit/pack.yaml`

Jeśli brakuje domeny CodeArtifact, repozytorium, regionu AWS, lokalizacji pakietu lub gałęzi, zapytaj o nie przed napisaniem przepływu pracy.

## Przepływ pracy

1. Określ:
   - domyślną gałąź,
   - lokalizację pakietu,
   - region AWS,
   - domenę CodeArtifact,
   - repozytorium CodeArtifact,
   - przestrzeń nazw pakietu,
   - nazwę sekretu ARN roli.
2. Utwórz `.github/workflows/ci.yml`.
3. Dodaj uprawnienia przepływu pracy:

```yaml
permissions:
  contents: read
  id-token: write
```

4. Dodaj zadanie walidacji, które sprawdza:
   - czy `pack.yaml` istnieje,
   - czy wymagane pola `pack.yaml` są obecne,
   - czy każdy `skills/*/SKILL.md` ma frontmatter `name` i `description`,
   - czy frontmatter `name` odpowiada katalogowi umiejętności,
   - czy `npm pack --dry-run` zakończyło się sukcesem.
5. Dodaj zadanie publikacji, które uruchamia się tylko przy pushu do domyślnej gałęzi.
6. Skonfiguruj poświadczenia AWS za pomocą `aws-actions/configure-aws-credentials@v4`.
7. Uruchom `aws codeartifact login`.
8. Publikuj z katalogu pakietu.

## Zasady bezpieczeństwa

- Używaj OIDC poprzez `AWS_ROLE_ARN`; nie generuj przepływów pracy z `AWS_ACCESS_KEY_ID` lub `AWS_SECRET_ACCESS_KEY`.
- Nie drukuj tokenów.
- Przechowuj identyfikator konta i ARN roli w sekretach GitHub, chyba że użytkownik wyraźnie wybierze inny mechanizm.
- Nie publikuj na żądaniach ściągnięcia.

## Weryfikacja

Uruchom lokalne sprawdzenia, jeśli to możliwe:

```bash
test -f .github/workflows/ci.yml
grep -q "id-token: write" .github/workflows/ci.yml
grep -q "aws codeartifact login" .github/workflows/ci.yml
npm --prefix packages/ai-toolkit pack --dry-run
```

Zakończ, wymieniając wymagane sekrety GitHub i wszelkie ręczne konfiguracje AWS, które muszą istnieć przed pierwszym uruchomieniem.