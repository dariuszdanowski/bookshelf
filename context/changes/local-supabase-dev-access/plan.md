# Lokalna baza developerska dostępna z Windows — Implementation Plan

## Overview

Doprowadzić Astro dev (Windows) do połączenia z lokalnym stackiem Supabase (WSL2) i przepiąć
dev + E2E z chmury na lokal, eliminując egress generowany przez development. Przyczyna jest
zdiagnozowana na żywo: **Hyper-V firewall WSL VM blokuje ruch przychodzący** (`DefaultInboundAction: Block`).
Cała infrastruktura lokalna już istnieje (`scripts/switch-env.mjs`, profile `.dev.vars`, VS Code tasks,
runbook `supabase/AGENTS.md`) — brakuje wyłącznie przebicia warstwy sieci i przepięcia aktywnego profilu.

## Current State Analysis

Zweryfikowane na żywo (2026-06-10):

- **Stack Supabase w WSL jest zdrowy**: Kong zwraca `HTTP 200` na `127.0.0.1:54321/auth/v1/health`
  *wewnątrz* WSL; porty `54321-54327` bound na `0.0.0.0`; kontenery `supabase_*_bookshelf` up.
  WSL IP: `192.168.245.146/20` (eth0).
- **Windows nie dosięga WSL**: `Test-NetConnection 192.168.245.146:54321` → `False`; `127.0.0.1:54321` → `False`;
  HTTP timeout. To blokada warstwy sieci, nie „usługa nieready".
- **Root cause**: `Get-NetFirewallHyperVVMSetting` dla WSL VM (`{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}`,
  FriendlyName `WSL`) zwraca `DefaultInboundAction: Block`. Adapter `vEthernet (WSL (Hyper-V firewall))` Up.
  WSL `2.6.3.0`, brak `.wslconfig` (domyślny NAT mode). Maszyna w domenie korpo (Firewall Domain profile ON).
- **Aktywny profil `.dev.vars` = `remote`** (`foqpoqdbicgsrbkcuckc.supabase.co`) → dev/E2E uderza w chmurę.
- **E2E `tests/e2e/auth.setup.ts`** robi 1 realny signup/run przez dev server (= aktywny profil).
  Przy profilu `remote` każdy run = signup w chmurze = MAU + egress. `playwright.config.ts` `webServer: npm run dev`,
  `reuseExistingServer: !CI` → reużywa działającego dev servera usera (a ten dziś biegnie na profilu remote).

### Key Discoveries

- Fix Hyper-V firewall **działa na żywo, bez `wsl --shutdown`** — reguła scoped na VMCreatorId przeżywa zmianę WSL IP (`scripts/switch-env.mjs:22` i tak re-detekuje IP).
- `scripts/switch-env.mjs:80-87` podstawia WSL IP do `.dev.vars` z wzorca `.dev.vars.local` (127.0.0.1 → WSL IP) — gotowe, wystarczy `npm run env:local`.
- WSL IP zmienia się po `wsl --shutdown` → po każdym restarcie WSL trzeba ponowić `npm run env:local` (runbook `supabase/AGENTS.md` to odnotowuje).
- Stała blokada sieci jest **bezpieczna kosztowo**: jeśli `.dev.vars` ma nieaktualny lokalny IP, dev po prostu nie połączy się z bazą (błąd) — **nie** ucieka do chmury. Brak cichego egressu.
- CI używa lokalnej Supabase (`127.0.0.1:54321`) i jest niezależne od tej zmiany — egress jest wyłącznie po stronie lokalnej maszyny.

## Desired End State

- Z Windows: `Invoke-WebRequest http://<WSL_IP>:54321/auth/v1/health` zwraca **200**.
- `npm run env:status` pokazuje profil **local**; `npm run dev` ładuje strony uderzające w **lokalną** bazę.
- Pełny przebieg `npm run test:e2e` przechodzi, a signup z `auth.setup.ts` ląduje w **lokalnym** Studio — **MAU w chmurze NIE rośnie**.
- Reguła firewall utrwalona w repo (`scripts/setup-wsl-firewall.ps1`) + udokumentowana w `supabase/AGENTS.md`, tak by przeżyć reinstalację / aktualizacje Windows.
- Memory `local-supabase-blocked-by-corporate-av` zaktualizowane na „rozwiązane (Hyper-V firewall allow-rule)".

## What We're NOT Doing

- **Nie** ruszamy chmurowej Supabase (prod) — egress resetuje się co cykl, wystarczy zatrzymać źródło.
- **Nie** upgradujemy do Pro planu.
- **Nie** przenosimy repo do natywnego FS WSL ani nie wdrażamy Remote-WSL — **chyba że** Phase 1 zawiedzie (kontyngencja, niżej).
- **Nie** zmieniamy `playwright.config.ts` ani skryptu `dev` (logika reuse zostaje; gwarancję „local" daje stały profil, nie zmiana kodu) — chyba że Phase 2 wykaże nieszczelność.
- **Nie** dotykamy CI (już lokalne) ani `deploy.yml`.

## Implementation Approach

Sekwencyjnie, każdy krok z twardą weryfikacją połączenia z Windows. Phase 1 = przebicie sieci
(primary fix: Hyper-V firewall allow-rule; drabina kontyngencji wbudowana — wchodzi tylko gdy poprzedni
szczebel nie zweryfikuje się). Phase 2 = przepięcie dev/E2E na lokal jako stały default + dowód braku egressu.
Phase 3 = utrwalenie i dokumentacja.

## Phase 1: Przebicie sieci Windows → WSL Supabase

### Overview

Doprowadzić do `HTTP 200` z Windows na lokalny Kong. Primary fix to scoped reguła Hyper-V firewall.
Drabina kontyngencji (szczeble b/c/d) uruchamiana **tylko** gdy poprzedni szczebel nie przejdzie weryfikacji.

### Changes Required:

#### 1. (szczebel a — primary) Reguła Hyper-V firewall: allow inbound na porty Supabase

**File**: `scripts/setup-wsl-firewall.ps1` (nowy) — utrwalony, idempotentny skrypt.

**Intent**: Dodać scoped regułę zezwalającą na ruch przychodzący do WSL VM na portach `54321-54327`
(API/Studio/Postgres/Inbucket/Analytics), bez globalnego otwierania `DefaultInboundAction`. Skrypt
commitowany do repo, by przeżyć restart/aktualizacje Windows i być odtwarzalny.

**Contract**: PowerShell, **wymaga uruchomienia jako Administrator** (UAC — user-only). Idempotentny
(usuwa istniejącą regułę o tej nazwie przed dodaniem). Reguła scoped na VMCreatorId WSL, nie na IP:

```powershell
$wslVm = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'  # Get-NetFirewallHyperVVMCreator → FriendlyName 'WSL'
Remove-NetFirewallHyperVRule -Name 'WSL-Supabase-Local' -ErrorAction SilentlyContinue
New-NetFirewallHyperVRule -Name 'WSL-Supabase-Local' -DisplayName 'WSL Supabase local dev (54321-54327)' `
  -Direction Inbound -VMCreatorId $wslVm -Protocol TCP -LocalPorts 54321-54327 -Action Allow
```

Uwaga: cmdlety `*-NetFirewallHyperVRule` to wspierana ścieżka dla WSL Hyper-V firewall na Win11 (mamy 26200). Reguła działa na żywo, bez `wsl --shutdown`.

#### 2. (szczeble kontyngencji — TYLKO jeśli #1 nie zweryfikuje się)

**File**: `%USERPROFILE%\.wslconfig` (user-only) oraz dokumentacja w `supabase/AGENTS.md`.

**Intent**: Jeśli polityka korpo (GPO) zablokuje dodanie reguły Hyper-V firewall, zejść drabiną:
**(b)** `.wslconfig [wsl2] firewall=false` (wyłącza WSL Hyper-V firewall; wymaga `wsl --shutdown` — user-only, disruptive);
**(c)** mirrored networking (`[wsl2] networkingMode=mirrored`; jeśli wróci konflikt „address already in use" z bind portów Dockera — dodać `ignoredPorts` lub `[experimental] hostAddressLoopback=true`; wymaga `wsl --shutdown`);
**(d)** jeśli b/c też odrzucone przez korpo → Phase 1 kończy się „BLOCKED"; Remote-WSL (repo na natywnym FS WSL + VSCode Remote-WSL) to wtedy **osobny `/10x-plan`**, nie otwarty punkt tego planu — uruchamiany tylko po stwierdzeniu, że wszystkie szczeble sieciowe są zablokowane. [F3]

**Contract**: Każdy szczebel ma ten sam kryterium sukcesu co #1 (HTTP 200 z Windows). Stop na pierwszym, który przejdzie. Szczeble b/c są **user-executed** (edycja `.wslconfig` + `wsl --shutdown` ubija działający stack — wymaga świadomej zgody usera i restartu Supabase).

#### 3. Przełączenie profilu na lokalny + weryfikacja połączenia

**File**: (brak zmian w kodzie) — wykonanie `npm run env:local`.

**Intent**: Po przebiciu sieci aktywować profil lokalny (`switch-env.mjs` wstrzyknie aktualny WSL IP do `.dev.vars`) i potwierdzić połączenie z Windows.

**Contract**: `npm run env:status` → `local`; `Invoke-WebRequest http://<WSL_IP>:54321/auth/v1/health` → 200.

### Success Criteria:

#### Automated Verification:

- [ ] `node scripts/switch-env.mjs status` raportuje profil `local`
- [ ] Z Windows: `Invoke-WebRequest http://<WSL_IP>:54321/auth/v1/health` zwraca HTTP 200
- [ ] `scripts/setup-wsl-firewall.ps1` jest idempotentny (drugie uruchomienie nie błędzi)

#### Manual Verification:

- [ ] (user-only, admin) `scripts/setup-wsl-firewall.ps1` uruchomiony z podniesionymi uprawnieniami bez odrzucenia przez GPO
- [ ] Reguła widoczna: `Get-NetFirewallHyperVRule -Name 'WSL-Supabase-Local'`
- [ ] Jeśli #1 odrzucone przez korpo → udokumentowany który szczebel kontyngencji zadziałał

**Implementation Note**: Po Phase 1 — pauza na ręczne potwierdzenie połączenia (admin + restart, jeśli był) zanim ruszymy Phase 2.

---

## Phase 2: Przepięcie dev + E2E na lokal jako stały default + dowód braku egressu

### Overview

Ustalić profil lokalny jako **standardowy** tryb dev (remote opt-in tylko do debugowania proda) i udowodnić,
że pełny przebieg E2E tworzy usera **lokalnie**, a MAU/egress w chmurze nie rośnie.

### Changes Required:

#### 1. Lokalny profil jako standing default + restart dev servera

**File**: (brak zmian w kodzie) — operacyjne + zapis w `supabase/AGENTS.md`.

**Intent**: Profil `.dev.vars` zostaje `local` na stałe; dev server usera (zawsze na :4321) restartowany,
by Vite wczytał lokalny `.dev.vars`. Po `wsl --shutdown` ponowić `npm run env:local` (re-detekcja IP).

**Contract**: Udokumentowana reguła: „domyślnie pracujemy na `local`; `npm run env:remote` tylko świadomie do debugowania prod". Restart dev servera = user-only (memory: nie ubijać :4321 bez zgody).

#### 2. Pełny przebieg E2E przeciw lokalnej bazie

**File**: (weryfikacja) — `npm run test:e2e` z dev serverem na profilu lokalnym.

**Intent**: Potwierdzić, że `reuseExistingServer` reużywa dev servera na profilu lokalnym (lub że świeży webServer startuje na lokalu), więc signup z `auth.setup.ts` ląduje lokalnie.

**Contract**: `npm run test:e2e` zielone; user `e2e-shared-*@example.com` pojawia się w **lokalnym** Studio (`:54323` → Auth), **nie** w chmurze.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e` przechodzi w całości na profilu lokalnym
- [ ] `npm run test` (unit) i `npm run typecheck` zielone (brak regresji)
- [ ] `npm run lint` zielony

#### Manual Verification:

- [ ] (user-only) Lokalne Studio `:54323` → Authentication pokazuje świeżego usera `e2e-shared-*` po runie E2E
- [ ] (user-only) Dashboard chmury → MAU **nie wzrosło** po przebiegu dev + E2E (porównanie przed/po; MAU = proxy)
- [ ] (user-only) W przeglądarce na `:4321` operacje (login, lista półek) działają na danych lokalnych
- [ ] (user-only) **Trend egressu** w dashboardzie chmury wypłaszcza się w kolejnych dniach (metryka billowana — właściwy dowód, MAU to tylko sygnał wyprzedzający) [F1]

**Implementation Note**: Po Phase 2 — pauza na ręczne potwierdzenie (Studio + dashboard chmury) zanim utrwalimy dokumentację.

---

## Phase 3: Utrwalenie konfiguracji + dokumentacja + memory

### Overview

Zamknąć temat trwale: dokumentacja działającej ścieżki, by przyszłe sesje (i restarty Windows) nie odtwarzały problemu.

### Changes Required:

#### 1. Runbook + reguły

**File**: `supabase/AGENTS.md`, wskaźnik w `CLAUDE.md § Lokalna Supabase dev`.

**Intent**: Dodać sekcję „Przebicie sieci Windows→WSL (Hyper-V firewall)" z odwołaniem do `scripts/setup-wsl-firewall.ps1`,
który szczebel zadziałał, oraz przypomnieniem o `npm run env:local` po `wsl --shutdown` i regule „local = default".

**Contract**: Krótka sekcja + wpis w tabeli częstych komend; bez duplikacji do roota (CLAUDE.md trzyma 1-linijkowy wskaźnik).

#### 2. Aktualizacja memory

**File**: `~/.claude/.../memory/local-supabase-blocked-by-corporate-av.md` + `MEMORY.md` pointer.

**Intent**: Zmienić status z „blocked" na „rozwiązane: Hyper-V firewall `DefaultInboundAction: Block` → scoped allow-rule na 54321-54327". Zachować ostrzeżenie o re-detekcji IP po restarcie WSL.

**Contract**: Jeden plik faktu zaktualizowany; `MEMORY.md` linia zaktualizowana.

#### 3. Guard przeciw cichemu powrotowi egressu [F2]

**File**: `scripts/switch-env.mjs` (funkcja `toRemote`).

**Intent**: Po `wsl --shutdown` stary lokalny IP w `.dev.vars` jest martwy → pokusa `npm run env:remote`,
co cicho przywraca egress chmury. Dorzucić wyraźne ostrzeżenie przy aktywacji profilu remote, by powrót
do chmury był świadomą decyzją, nie odruchem.

**Contract**: `toRemote()` po przełączeniu drukuje prominentne ostrzeżenie (np. „⚠ PROFIL REMOTE = egress
chmury; używaj tylko do debugowania proda, wróć na `npm run env:local`"). Bez zmiany zachowania, tylko stdout.

### Success Criteria:

#### Automated Verification:

- [ ] `supabase/AGENTS.md` zawiera odwołanie do `scripts/setup-wsl-firewall.ps1`
- [ ] `npm run env:remote` drukuje ostrzeżenie o egressie chmury (potem wróć `npm run env:local`)
- [ ] `npm run lint` / `npm run typecheck` zielone (gdyby coś dotknęło kodu)

#### Manual Verification:

- [ ] (user-only) Po `wsl --shutdown` + `npm run env:local` połączenie wraca bez dotykania firewalla (reguła scoped na VMCreatorId przeżyła)

---

## Testing Strategy

### Unit Tests

- Bez nowych unitów — zmiana jest infrastrukturalna (firewall/profil/dokumentacja). `scripts/setup-wsl-firewall.ps1` jest idempotentny; weryfikacja przez ponowne uruchomienie.

### Integration / E2E

- Pełny `npm run test:e2e` na profilu lokalnym jako dowód, że flow uderza w lokalną bazę (signup widoczny lokalnie, MAU chmury płaskie).

### Manual Testing Steps (user-only)

1. (admin) Uruchom `scripts/setup-wsl-firewall.ps1`, potwierdź regułę `Get-NetFirewallHyperVRule`.
2. `npm run env:local`; z Windows `Invoke-WebRequest http://<WSL_IP>:54321/auth/v1/health` → 200.
3. Restart dev servera; w przeglądarce `:4321` zaloguj się / dodaj półkę → sprawdź dane w lokalnym Studio `:54323`.
4. `npm run test:e2e`; potwierdź usera `e2e-shared-*` w lokalnym Studio i brak wzrostu MAU w dashboardzie chmury.

## Migration Notes

- WSL IP zmienia się po `wsl --shutdown` → ponów `npm run env:local`. Reguła firewall (scoped na VMCreatorId) **nie** wymaga ponowienia.
- Profil pozostaje `local`; `npm run env:remote` tylko świadomie do debugowania proda (i wróć na `local` po).

## References

- Runbook: `supabase/AGENTS.md`
- Env wiring: `src/lib/db/AGENTS.md`
- Przełączanie env: `scripts/switch-env.mjs:22-87`
- E2E signup: `tests/e2e/auth.setup.ts:18-36`
- Playwright webServer: `playwright.config.ts:30-37`
- VS Code tasks: `.vscode/tasks.json`
- Memory: `local-supabase-blocked-by-corporate-av`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Przebicie sieci Windows → WSL Supabase

#### Automated

- [ ] 1.1 `node scripts/switch-env.mjs status` raportuje profil `local`
- [ ] 1.2 Z Windows `Invoke-WebRequest .../auth/v1/health` zwraca HTTP 200
- [ ] 1.3 `scripts/setup-wsl-firewall.ps1` idempotentny (drugie uruchomienie nie błędzi)

#### Manual

- [ ] 1.4 (user/admin) skrypt firewall uruchomiony bez odrzucenia przez GPO
- [ ] 1.5 Reguła widoczna w `Get-NetFirewallHyperVRule -Name 'WSL-Supabase-Local'`
- [ ] 1.6 Jeśli #1 odrzucone → udokumentowany szczebel kontyngencji, który zadziałał

### Phase 2: Przepięcie dev + E2E na lokal + dowód braku egressu

#### Automated

- [ ] 2.1 `npm run test:e2e` przechodzi w całości na profilu lokalnym
- [ ] 2.2 `npm run test` + `npm run typecheck` zielone
- [ ] 2.3 `npm run lint` zielony

#### Manual

- [ ] 2.4 (user) lokalne Studio pokazuje usera `e2e-shared-*` po E2E
- [ ] 2.5 (user) MAU w chmurze nie wzrosło po dev + E2E
- [ ] 2.6 (user) przeglądarka `:4321` działa na danych lokalnych
- [ ] 2.7 (user) trend egressu w dashboardzie chmury wypłaszcza się w kolejnych dniach

### Phase 3: Utrwalenie + dokumentacja + memory

#### Automated

- [ ] 3.1 `supabase/AGENTS.md` odwołuje się do `scripts/setup-wsl-firewall.ps1`
- [ ] 3.2 `npm run env:remote` drukuje ostrzeżenie o egressie chmury
- [ ] 3.3 `npm run lint` / `npm run typecheck` zielone

#### Manual

- [ ] 3.4 (user) po `wsl --shutdown` + `npm run env:local` połączenie wraca bez dotykania firewalla
