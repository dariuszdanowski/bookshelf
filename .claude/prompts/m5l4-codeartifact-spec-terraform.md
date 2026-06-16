---
name: CodeArtifact Registry Terraform — Requirements
description: AWS appendix for Model 2. This spec describes a private npm registry as managed cloud infrastructure: AWS CodeArtifact + Terraform. Start with the GitHub Packages specs unless your team already needs AWS-native governance.
license: CC0-1.0
metadata:
  tags:
    - aws
    - codeartifact
    - npm
    - terraform
    - registry
    - private
  model: 2
  difficulty: advanced
---
# Rejestr CodeArtifact Terraform — Wymagania

> **Załącznik AWS dla Modelu 2.** Ta specyfikacja opisuje prywatny rejestr npm jako
> zarządzaną infrastrukturę chmurową: AWS CodeArtifact + Terraform. Zacznij od
> specyfikacji GitHub Packages, chyba że Twój zespół potrzebuje już natywnego zarządzania AWS.

## Cel
Stworzenie infrastruktury AWS dla prywatnego rejestru npm przy użyciu Terraform.

## Konfiguracja

| Parametr | Wartość |
|-----------|-------|
| Nazwa domeny | `devs10x` (musi zaczynać się od małej litery) |
| Region AWS | `eu-central-1` |
| Bucket stanu S3 | `10xdevs-terraform-state` |
| Klucz stanu | `codeartifact/terraform.tfstate` |
| Nazwa prywatnego repozytorium | `npm` |
| Nazwa repozytorium proxy | `npm-store` |
| Połączenie zewnętrzne | `public:npmjs` |
| Nazwa projektu | `webinar-demo` |
| Identyfikator konta AWS | `<your-account-id>` |

## Wersje Terraform
- Wymagana wersja Terraform: `>= 1.10`
- Wersja dostawcy AWS: `>= 5.30, < 5.40`
- Blokowanie backendu S3: `use_lockfile = true` (natywne blokowanie S3, nie potrzeba DynamoDB)

## Tagi
- `Project`: `webinar-demo`
- `ManagedBy`: `terraform`
- `Environment`: `demo`

## KMS
- Alias klucza: `alias/devs10x-codeartifact`

## Zarządzana polityka IAM
- Nazwa polityki: `devs10x-codeartifact-developer`
- Uprawnienia: uwierzytelnianie domeny, odczyt repozytorium, publikowanie pakietów
- Dołącz do istniejącej roli CI/CD za pomocą `aws_iam_role_policy_attachment`

## Rola GitHub Actions
- Nazwa roli: `github-actions-codeartifact` (istniejąca, odwoływana za pomocą źródła `data`)
- Zarządzana polityka jest dołączona do tej roli, aby CI/CD mogło uwierzytelniać się w CodeArtifact

## Przykład tfvars
```hcl
aws_region     = "eu-central-1"
domain_name    = "devs10x"
aws_account_id = "<your-account-id>"
project_name   = "webinar-demo"
```

## Logowanie z zakresem — znany problem
Logowanie z zakresem kieruje tylko zakres Twojego pakietu przez CodeArtifact i pozostawia
wszystko inne na publicznym npm:

```bash
aws codeartifact login --tool npm --domain devs10x --repository npm --namespace 10xdevs
```

`--namespace` przyjmuje zakres pakietu bez `@` (`10xdevs`), a nie
domenę CodeArtifact (`devs10x`). To są dwie różne rzeczy:
zakres pakietu `@10xdevs` != domena `devs10x`.