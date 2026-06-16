# Pakiet narzędzi AI GitHub Packages — Wymagania

> **Domyślna ścieżka dla Zadania 2.** Ta specyfikacja opisuje Model 1 z lekcji:
> wewnętrzny zestaw narzędzi zespołu dystrybuowany jako prywatny pakiet npm za pośrednictwem GitHub
> Packages. Użyj tego jako podstawy, chyba że Twój zespół potrzebuje AWS
> CodeArtifact lub pełnego produktu dostarczającego API+CLI.

## Cel
Spakowanie artefaktów AI zespołu w dystrybuowalny pakiet npm, który repozytoria konsumentów
mogą instalować z GitHub Packages.

## Metadane pakietu
- Nazwa pakietu: `@twoj-zespol/ai-toolkit`
- Krótka nazwa: `ai-toolkit`
- Wersja: `0.1.0`
- Rejestr: `https://npm.pkg.github.com`
- Wersja Node: `>=20`

## Wymagane pliki
Wygeneruj tę początkową strukturę:

```text
ai-toolkit/
├── package.json
├── README.md
├── install.js
├── uninstall.js
├── skills/
│   └── code-review/
│       └── SKILL.md
└── rules/
    └── AGENTS.md
```

## Wymagania package.json
Pakiet musi:
- publikować do GitHub Packages poprzez `publishConfig.registry`;
- zawierać tylko `skills/`, `rules/`, `install.js`, `uninstall.js` i `README.md`
  w opublikowanym pakiecie;
- uruchamiać `node install.js` jako `postinstall`;
- udostępniać `ai-toolkit` jako polecenie bin, jeśli zaimplementujesz ręczną instalację/deinstalację.

Przykład:

```json
{
  "name": "@twoj-zespol/ai-toolkit",
  "version": "0.1.0",
  "description": "Team AI artifacts distributed through GitHub Packages",
  "license": "UNLICENSED",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "files": ["skills/", "rules/", "install.js", "uninstall.js", "README.md"],
  "scripts": {
    "postinstall": "node install.js"
  }
}
```

## Konfiguracja repozytorium konsumenta
Wygeneruj instrukcje dla repozytoriów konsumentów:

```text
@twoj-zespol:registry=https://npm.pkg.github.com
```

Zatwierdzony plik `.npmrc` musi zawierać tylko mapowanie rejestru. Nie może
zawierać tokena.

## Zachowanie instalatora
Instalator powinien:
- zlokalizować katalog główny projektu konsumenta;
- instalować umiejętności do katalogu konfiguracji narzędzia AI/skills/<skill-name>/;
- dołączać reguły do pliku konfiguracyjnego AI projektu (AGENTS.md) między znacznikami strażniczymi;
- zapisywać katalog konfiguracji narzędzia AI/.ai-toolkit-manifest.json z wersją pakietu i zainstalowanymi plikami;
- być idempotentny: dwukrotne uruchomienie instalacji aktualizuje zarządzane bloki zamiast je duplikować;
- unikać niepowodzenia całej `npm install`, gdy czyszczenie po instalacji lub łączenie nie powiedzie się.

Użyj tych znaczników strażniczych:

```text
<!-- BEGIN @twoj-zespol/ai-toolkit -->
<!-- END @twoj-zespol/ai-toolkit -->
```

## Zachowanie uwierzytelniania
Instalator może dodać ten pomocnik `preinstall` do `package.json` konsumenta, gdy
projekt konsumenta nie ma istniejącego przepływu uwierzytelniania GitHub Packages:

```bash
[ -n "$GH_PKG_TOKEN" ] && echo '//npm.pkg.github.com/:_authToken=${GH_PKG_TOKEN}' >> .npmrc || true
```

Ten pomocnik jest przeznaczony dla CI. Lokalni programiści powinni używać `npm login` lub własnego
`.npmrc` na poziomie użytkownika. Nigdy nie zatwierdzaj `_authToken` do repozytorium.