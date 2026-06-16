```yaml
name: CodeArtifact CI/CD — Requirements
description: Wymagania dotyczące CI/CD dla AWS CodeArtifact
license: CC BY-NC-ND 4.0
metadata:
  tags: aws, codeartifact, ci/cd, github actions, npm
```

# CodeArtifact CI/CD — Wymagania

> **Załącznik AWS dla Modelu 2.** Użyj tego tylko, jeśli celowo wybrałeś ścieżkę
> zarządzanej infrastruktury: AWS CodeArtifact + Terraform. Dla domyślnej
> ścieżki Zadania 2, użyj zamiast tego `m5l4-github-packages-spec-cicd.md`.

## Cel
Stworzenie workflow GitHub Actions, który waliduje i publikuje pakiet npm AI toolkit
do AWS CodeArtifact.

## Konfiguracja
- Gałąź: `master` (dostosuj do `main`, jeśli to jest twoja domyślna gałąź)
- Region AWS: `eu-central-1`
- Domena CodeArtifact: `devs10x`
- Repozytorium CodeArtifact: `npm`
- Plik workflow: `.github/workflows/ci.yml`
- Lokalizacja pakietu: `packages/ai-toolkit/` (względem katalogu głównego repozytorium)
- Sekrety GitHub: `AWS_ACCOUNT_ID` i `AWS_ROLE_ARN`

## Uwierzytelnianie OIDC
- Akcja: `aws-actions/configure-aws-credentials@v4`
- Rola: odwołanie poprzez `${{ secrets.AWS_ROLE_ARN }}`
- Wymagane uprawnienie workflow: `id-token: write`

## Sprawdzanie poprawności
1. `pack.yaml` istnieje z wymaganymi polami: `name`, `version`, `description`, `namespace`
2. Każdy `skills/*/SKILL.md` ma YAML frontmatter z `name` i `description`
3. `name` w frontmatterze odpowiada nazwie katalogu umiejętności
4. `npm pack --dry-run` kończy się sukcesem

## Konfiguracja sekretów
```bash
gh secret set AWS_ACCOUNT_ID --body "<account-id>" --repo <owner>/<repo>
gh secret set AWS_ROLE_ARN --body "<role-arn>" --repo <owner>/<repo>
```

## Przepływ publikacji
1. Skonfiguruj poświadczenia AWS poprzez OIDC.
2. Uruchom `aws codeartifact login`.
3. Uruchom walidację.
4. Opublikuj pakiet npm.