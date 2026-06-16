---
name: tf-registry
description: Generate Terraform for the Model 2 AWS CodeArtifact npm registry, including domain, repositories, KMS and IAM policy wiring.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# /tf-registry — Generowanie rejestru CodeArtifact

Generujesz Terraform dla prywatnego rejestru npm Modelu 2 używanego przez pakiet narzędzi AI.

Ta umiejętność obejmuje ścieżkę zarządzanej infrastruktury z m5l4: AWS CodeArtifact udostępniony za pośrednictwem Terraform. Powinna być używana tylko wtedy, gdy uczący się świadomie wybierze ścieżkę załącznika AWS, a nie jako domyślna dla każdego zespołu.

## Dane wejściowe

Przeczytaj te pliki, jeśli są obecne:

- `m5l4-codeartifact-spec-terraform.md`
- `m5l4-codeartifact-spec-cicd.md`
- `context/spec-terraform.md`
- `context/spec-cicd.md`

Jeśli brakuje wymaganych wartości, zapytaj o:

- region AWS,
- identyfikator konta AWS,
- nazwę domeny CodeArtifact,
- nazwę prywatnego repozytorium,
- nazwę repozytorium proxy,
- przestrzeń nazw pakietu,
- bucket/klucz stanu Terraform,
- nazwę lub ARN roli GitHub Actions.

## Cele Terraform

Wygeneruj katalog `terraform/` z plikami takimi jak:

```text
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
├── codeartifact.tf
├── iam.tf
├── kms.tf
└── terraform.tfvars.example
```

Infrastruktura powinna zawierać:

- Konfigurację backendu S3 z natywnym blokowaniem S3, gdy wersja Terraform to obsługuje,
- domenę CodeArtifact,
- prywatne repozytorium npm,
- publiczne repozytorium upstream/proxy npm,
- zewnętrzne połączenie npm,
- klucz KMS i alias,
- zarządzaną politykę IAM dla operacji odczytu/publikacji CodeArtifact,
- punkt zaczepienia dla roli GitHub Actions używanej przez CI/CD.

## Pułapki do zachowania

- Domena CodeArtifact i zakres pakietu npm to różne koncepcje.
- `aws codeartifact login --namespace` oczekuje zakresu npm bez `@`.
- Terraform nie powinien zawierać zakodowanych na stałe osobistych poświadczeń.
- Rola GitHub Actions może być odwoływana jako istniejąca rola, gdy organizacja posiada już konfigurację OIDC.

## Weryfikacja

Uruchom, jeśli to możliwe:

```bash
terraform -chdir=terraform fmt -check
terraform -chdir=terraform validate
```

Jeśli Terraform nie jest zainstalowany lub inicjalizacja dostawcy jest niedostępna, powiedz o tym i nadal uruchamiaj statyczne sprawdzenia wygenerowanych plików.

Nie uruchamiaj `terraform apply`, chyba że użytkownik wyraźnie o to poprosi.