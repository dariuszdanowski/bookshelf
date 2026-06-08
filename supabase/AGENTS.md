# Lokalna Supabase dev — runbook

Wyniesione z `CLAUDE.md § Lokalna Supabase dev` (root trzyma tylko 1-linijkowy wskaźnik).

Migracje testujemy zawsze na **lokalnym stacku** zanim trafią do PR. Reguła z § Workflow agenta zostaje — `db push` na remote prod wykonuje się **tylko po merge**, ale **automatycznie** przez `deploy.yml` (nie ręcznie). Lokalna baza to brakujący środek: dev cycle dla migracji bez ryzyka zombi schema w prodzie.

**Wymagania**: WSL2 (Ubuntu) + Docker engine zainstalowany **w WSL** (`apt install docker-ce`, user w grupie `docker`). Docker Desktop **nie jest używany**. Sprawdzenie: `wsl -e bash -lc "docker info"`.

**Networking**: Astro dev biegnie w Windows (workerd/Cloudflare runtime nie wspiera SQLite SHM na `/mnt/c` NTFS-9P mount, więc nie da się go uruchomić w WSL bez przeniesienia repo do natywnego WSL fs). WSL2 localhost-forwarding nie działa dla portów Dockera, więc Astro nie dosięga `127.0.0.1:54321`. Workaround: `npm run env:local` dynamicznie wykrywa **WSL IP** (`wsl hostname -I`) i podstawia w generowanym `.dev.vars` — Astro w Windows łączy się do Supabase przez `http://192.168.x.x:54321` przez WSL NAT. WSL IP zmienia się po `wsl --shutdown` → należy odpalić `env:local` ponownie po każdym restarcie WSL. Mirrored networking mode próbowane — koliduje z bind portów Dockera (`address already in use`), nie używamy. **`.dev.vars.local` zostaje wzorcem z `127.0.0.1`** — switch-env podmienia host przy aktywacji; nie commituj zmiany.

**Bootstrap (jednorazowo, ~10 min pull obrazów):**

```powershell
wsl -e bash -lc "cd /mnt/c/Projekty/10xDevs/bookshelf && npx supabase start"
```

Output podaje lokalny API URL (`http://127.0.0.1:54321`), Studio (`http://127.0.0.1:54323`), Postgres (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) i lokalne klucze (`sb_publishable_*` / `sb_secret_*`). Klucze są stabilne — nie zmieniają się między `start`/`stop`/`reset`.

**Cykl per zmiana DB:**

1. Utwórz `supabase/migrations/NNNN_<name>.sql`
2. `wsl -e bash -lc "cd /mnt/c/Projekty/10xDevs/bookshelf && npx supabase db reset"` — drop + replay wszystkich migracji + `seed.sql` (idempotentne, świeże dane testowe)
3. Manual test: Studio `:54323` + `npm run dev` (Astro czyta `.dev.vars.local` jeśli aktywne)
4. Commit migracji + kodu → PR → review → **merge do main**
5. **Po merge**: `deploy.yml` sam uruchamia `supabase db push` na remote prod (migrate-first przed deployem). Ręcznie (`npx supabase db push`, sekrety remote w `.dev.vars`) tylko jako fallback/hotfix.

**Profile sekretów** — single source of truth dla Astro dev:
- `.dev.vars` (gitignored) — sekrety **remote** (prod Supabase, deploy/wrangler debug)
- `.dev.vars.local` (gitignored) — sekrety **lokalne** (output `supabase start`, ANTHROPIC_API_KEY skopiowane z `.dev.vars`)
- Przełączanie: ręczna zamiana (`Move-Item .dev.vars .dev.vars.remote.bak; Copy-Item .dev.vars.local .dev.vars`). Trzeci plik (`.dev.vars.remote.bak`) też pokryty wzorcem `.dev.vars*` w `.gitignore`. Astro czyta tylko `.dev.vars`.

**MCP supabase** (`mcp__supabase__*`) wskazuje na **remote prod** — używaj świadomie. Do queries na lokalnej DB: `docker exec -i supabase_db_bookshelf psql -U postgres -d postgres < query.sql` (kontener z `npx supabase start`).

**Częste komendy:**

| Komenda | Co robi |
| --- | --- |
| `npx supabase start` | start kontenerów (idempotentne; po restarcie WSL trzeba znowu) |
| `npx supabase stop` | stop bez utraty danych |
| `npx supabase stop --no-backup` | stop + drop danych (świeży reset przy następnym `start`) |
| `npx supabase db reset` | drop schema + replay migracji + seed (dane testowe znikają) |
| `npx supabase migration up` | dograj brakujące migracje bez resetu (zachowuje dane) |
| `npx supabase status` | URLs + keys + stan kontenerów |
| `npx supabase db push` | **push do remote prod** — automat w `deploy.yml` po merge; ręcznie tylko fallback/hotfix |

VS Code tasks (Ctrl+Shift+P → Tasks: Run Task) zawijają te komendy przez WSL automatycznie. `Dev: full local stack (env + supabase + astro)` to compound wykonujący `env:local` → `supabase start` → `astro dev` jednym uruchomieniem.
