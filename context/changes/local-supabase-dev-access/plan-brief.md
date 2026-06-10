# Lokalna baza developerska dostępna z Windows — Plan Brief

> Full plan: `context/changes/local-supabase-dev-access/plan.md`

## What & Why

Dev server (Windows) nie dosięga lokalnego Supabase (WSL2), więc dev + E2E uderzają w **chmurę** —
stąd egress **9,53 GB / 5 GB** i **341 MAU** (signupy z E2E przeciw chmurze). Przyczyna zdiagnozowana
na żywo: **Hyper-V firewall WSL VM blokuje ruch przychodzący** (`DefaultInboundAction: Block`).
Cel: przebić sieć, przepiąć dev/E2E na lokal, zatrzymać egress przed końcem Fair Use grace (9 lipca 2026).

## Starting Point

Cała infra lokalna **już istnieje** (`switch-env.mjs` z auto-detekcją WSL IP, profile `.dev.vars`,
VS Code tasks, runbook). Stack w WSL zdrowy (Kong HTTP 200 wewnątrz WSL). Brakuje wyłącznie:
(1) przebicia warstwy sieci Windows↔WSL, (2) przepięcia aktywnego profilu (`remote` → `local`).

## Desired End State

Z Windows `…:54321/auth/v1/health` → 200; `npm run dev` i E2E uderzają w lokalną bazę; pełny run E2E
tworzy usera w **lokalnym** Studio, a MAU/egress w chmurze nie rośnie. Reguła firewall utrwalona w repo.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Strategia dojścia | Sekwencyjnie: sieć → fallback WSL | Najtańszy fix najpierw, Remote-WSL tylko jeśli korpo zablokuje | Plan (user) |
| Primary fix sieci | Hyper-V firewall scoped allow-rule (54321-54327) | Działa na żywo, bez `wsl --shutdown`, least-privilege | Plan |
| Drabina kontyngencji | firewall=false → mirrored → Remote-WSL | Eskalacja tylko gdy poprzedni szczebel nie zweryfikuje się | Plan |
| Gwarancja „local" dla E2E | Stały profil lokalny, bez zmian w kodzie playwright | Profil = jedyne źródło prawdy; mniej powierzchni zmian | Plan |
| Chmura/Pro plan | Nie ruszamy, nie upgradujemy | Egress resetuje się co cykl — wystarczy zatrzymać źródło | Plan |

## Scope

**In scope:** reguła Hyper-V firewall (skrypt w repo), przełączenie profilu na lokal, dowód braku egressu przez E2E, dokumentacja + memory.

**Out of scope:** zmiany w chmurowej Supabase/prod, upgrade do Pro, przeniesienie repo do WSL / Remote-WSL (chyba że Phase 1 zawiedzie), zmiany w CI/`deploy.yml`/`playwright.config.ts`.

## Architecture / Approach

Phase 1 przebija sieć (primary: scoped Hyper-V allow-rule; drabina kontyngencji wchodzi tylko przy
niepowodzeniu weryfikacji). Phase 2 ustala profil lokalny jako default i dowodzi przez pełny E2E,
że flow trafia lokalnie (signup w lokalnym Studio, MAU chmury płaskie). Phase 3 utrwala konfigurację
w runbooku + memory. Każdy krok weryfikowany twardym testem HTTP 200 **z Windows**.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Przebicie sieci | HTTP 200 z Windows na lokalny Kong | GPO korpo blokuje regułę → schodzimy drabiną kontyngencji |
| 2. Przepięcie dev/E2E | Profil lokalny default + dowód zerowego egressu | `reuseExistingServer` reużywa starego dev servera na profilu remote |
| 3. Utrwalenie | Runbook + skrypt + memory zaktualizowane | — |

**Prerequisites:** WSL + stack Supabase up (jest); uprawnienia admin do reguły firewall (UAC, user-only).
**Estimated effort:** ~1 sesja; gros to user-executed admin + weryfikacje manualne.

## Open Risks & Assumptions

- **Polityka korpo (GPO)** może zablokować `New-NetFirewallHyperVRule` → wtedy drabina kontyngencji (firewall=false / mirrored / Remote-WSL).
- Szczeble b/c kontyngencji wymagają `wsl --shutdown` (disruptive — ubija działający stack, user-only).
- WSL IP zmienia się po restarcie WSL → ponów `npm run env:local` (reguła firewall przeżywa, bo scoped na VMCreatorId).
- Restart dev servera usera na :4321 = user-only (nie ubijać bez zgody).

## Success Criteria (Summary)

- Z Windows: `Invoke-WebRequest http://<WSL_IP>:54321/auth/v1/health` → 200.
- Pełny `npm run test:e2e` zielony, user E2E w **lokalnym** Studio, MAU w chmurze **nie rośnie**.
- Konfiguracja utrwalona (skrypt w repo + runbook + memory) — przeżywa restart WSL/Windows.
