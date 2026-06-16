---
name: pack-init
description: Create an npm-based AI toolkit package skeleton that bundles skills, rules and installer logic for the Model 2 CodeArtifact delivery path.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# /pack-init — Inicjalizacja pakietu AI Toolkit

Tworzysz szkielet pakietu, który przekształca wygenerowane artefakty AI w wersjonowany pakiet npm.

Jest to drugi krok potoku Modelu 2 z m5l4: po tym, jak `/create-skill` wygeneruje `skills/code-review/SKILL.md`, ta umiejętność opakowuje artefakt w pakiet, który może zostać opublikowany w AWS CodeArtifact.

## Dane wejściowe

Odczytaj te pliki, jeśli są obecne:

- `m5l4-codeartifact-spec-cicd.md`
- `m5l4-codeartifact-spec-terraform.md`
- `m5l4-shared-spec-skill.md`
- `context/spec-pack.md`
- `context/spec-cicd.md`
- `context/spec-terraform.md`

Sprawdź również istniejące wygenerowane artefakty:

- `skills/*/SKILL.md`
- `rules/CLAUDE.md`
- `commands/`
- `prompts/`

## Przepływ pracy

1. Potwierdź nazwę pakietu i przestrzeń nazw.
   - Preferuj wartości ze specyfikacji.
   - Domyślne wartości lekcji to `@10xdevs/ai-toolkit` i przestrzeń nazw `10xdevs`.
2. Utwórz `packages/ai-toolkit/`, jeśli nie istnieje.
3. Skopiuj lub utwórz strukturę artefaktu:

```text
packages/ai-toolkit/
├── package.json
├── pack.yaml
├── install.js
├── uninstall.js
├── bin/
│   └── cli.js
├── skills/
│   └── code-review/
│       └── SKILL.md
└── rules/
    └── CLAUDE.md
```

4. Dodaj `package.json` z:
   - nazwą pakietu,
   - wersją,
   - `type`,
   - `files`,
   - `bin`,
   - `postinstall`,
   - silnikiem Node.
5. Dodaj `pack.yaml` zawierający co najmniej:
   - `name`,
   - `version`,
   - `description`,
   - `namespace`.
6. Dodaj zachowanie instalatora:
   - tryb `npm install` może tworzyć dowiązania symboliczne z `node_modules`,
   - tryb `npx <package> install` musi kopiować pliki, ponieważ pamięć podręczna npx jest tymczasowa,
   - zainstalowane pliki muszą być śledzone w manifeście,
   - deinstalacja musi odczytywać manifest zamiast zgadywać ścieżki.

## Zasady bezpieczeństwa

- Nie koduj na stałe ścieżek do osobistych maszyn.
- Nie zapisuj tajnych kluczy AWS, tokenów ani danych uwierzytelniających konta do plików pakietu.
- Nie nadpisuj plików zarządzanych przez użytkownika bez bloku strażniczego lub wyraźnego potwierdzenia.
- Utrzymuj operacje instalatora idempotentnymi.

## Weryfikacja

Uruchom, gdy to możliwe:

```bash
npm pack --dry-run
node -e "JSON.parse(require('fs').readFileSync('packages/ai-toolkit/package.json', 'utf8'))"
test -f packages/ai-toolkit/pack.yaml
```

Jeśli wygenerowany pakiet zawiera umiejętności, sprawdź, czy każdy `SKILL.md` zaczyna się od prawidłowego frontmattera.