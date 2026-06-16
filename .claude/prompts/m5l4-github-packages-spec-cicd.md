---
name: GitHub Packages CI/CD — Requirements
description: Specyfikacja dla zadania 2.
license: CC0-1.0
metadata:
  tags: github-actions, ci-cd, npm, github-packages
  difficulty: medium
---

# GitHub Packages CI/CD — Wymagania

> **Domyślna ścieżka dla Zadania 2.** Ta specyfikacja publikuje pakiet narzędzi AI do
> GitHub Packages. Celowo unika AWS, Terraform, ról IAM i
> CodeArtifact.

## Cel
Stworzenie przepływu pracy GitHub Actions, który waliduje i publikuje pakiet npm
AI toolkit do GitHub Packages.

## Konfiguracja
- Plik przepływu pracy: `.github/workflows/publish-ai-toolkit.yml`
- Lokalizacja pakietu: katalog główny repozytorium, chyba że agent wygenerował układ monorepo;
  w takim przypadku użyj `packages/ai-toolkit/`
- Gałąź: obsługuje zarówno `main`, jak i `master`
- Wersja Node: `20` lub nowsza
- Rejestr: `https://npm.pkg.github.com`
- Zakres pakietu: `@twoj-zespol`

## Uprawnienia
Użyj efemerycznego tokenu GitHub Actions do publikowania:

```yaml
permissions:
  contents: read
  packages: write
```

Nie wymagaj `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, `id-token: write` ani żadnego
kroku logowania CodeArtifact.

## Zadanie walidacji
Przed publikacją, zweryfikuj:
1. `package.json` istnieje i zawiera `name`, `version`, `publishConfig.registry`.
2. `skills/code-review/SKILL.md` istnieje.
3. `SKILL.md` posiada YAML frontmatter z `name` i `description`.
4. `name` z frontmattera odpowiada nazwie katalogu umiejętności.
5. `npm pack --dry-run` zakończy się sukcesem.

## Zadanie publikacji
Przy pushu do `main` lub `master`:
1. Sklonuj repozytorium.
2. Skonfiguruj Node z rejestrem GitHub Packages i zakresem pakietu.
3. Uruchom walidację.
4. Opublikuj z `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

Kształt początkowy:

```yaml
name: Publish AI Toolkit

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  packages: write

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://npm.pkg.github.com"
          scope: "@twoj-zespol"
      - run: npm ci
      - run: npm pack --dry-run

  publish:
    needs: validate
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://npm.pkg.github.com"
          scope: "@twoj-zespol"
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Uwaga dla CI konsumenta
Repozytoria konsumenckie, które instalują ten prywatny pakiet, potrzebują autoryzacji do odczytu. Użyj
oddzielnego sekretu `GH_PKG_TOKEN` dla zewnętrznych systemów CI lub konsumentów międzyorganizacyjnych.
GitHub Actions w tej samej organizacji mogą być w stanie użyć uprawnień repozytorium/pakietu,
ale nie zakładaj, że każda platforma kompilacji może widzieć token GitHub.
