# S-32 — BYOK: klucze API własne użytkownika — Implementation Plan

## Overview

Zastąpić placeholder „Klucze API" w `/account` (S-31) działającą sekcją zarządzania
własnymi kluczami API. Tabela `user_api_keys` z AES-GCM po stronie Worker, CRUD
przez 3 pliki endpointów, UI w `AccountIsland`.

## Current State Analysis

Co już jest (zweryfikowane w kodzie):

- **`src/components/AccountIsland.tsx:394-408`** — placeholder `data-testid="account-keys-placeholder"`
  z disabled CTA „Dodaj klucz (wkrótce)". S-32 zastępuje ten blok.
- **`src/env.d.ts:17-25`** — `Cloudflare.Env` z 4 secrets (bez `USER_KEYS_ENCRYPTION_KEY`);
  S-32 dodaje piąty.
- **`src/lib/account/schema.ts`** — wzorzec Zod schemas dla konta; S-32 tworzy analogiczne
  w `src/lib/keys/schema.ts`.
- **`src/pages/api/account/profile.ts`** — wzorzec PATCH endpointu (Zod → RLS-scoped update →
  SQLSTATE mapping → F-02 envelope). S-32 stosuje ten sam kształt.
- **`src/lib/http/response.ts`** — `apiResponse/apiError/parseUuidParam`; `ApiErrorCode` union.
- **`supabase/migrations/0015_vision_cost_preservation.sql`** — najnowsza migracja;
  S-32 tworzy `0016_user_api_keys.sql`.
- **`vitest.config.ts:8-18`** — `cloudflare:workers` stub (`env: {}`); per-test
  `vi.mock('cloudflare:workers', () => ({ env: {...} }))` nadpisuje wartości.
- **Partial unique index** — precedens w `supabase/migrations/0001_initial_schema.sql`
  (`books_user_isbn13 ... WHERE isbn_13 is not null`); S-32 stosuje analogiczny dla
  ≤1 aktywnego klucza.

## Desired End State

Zalogowany użytkownik na `/account` widzi sekcję „Klucze API":
- Lista kluczy z etykietą, providerem, statusem aktywności, wynikiem ostatniego testu.
- Formularz dodawania (etykieta, provider, wartość klucza; opcjonalne `model`/`base_url`
  dla `openai_compatible`).
- Per klucz: przycisk „Aktywuj" (dezaktywuje pozostałe, aktywuje wybrany), „Testuj"
  (probe GET /v1/models → wynik ok/error), „Usuń".
- Klucz zaszyfrowany AES-GCM w DB; plaintext nigdy nie wraca w API response.

## What We're NOT Doing

- **Użycie klucza w pipeline vision** — to S-33. S-32 tylko przechowuje + testuje.
- **Rotacja klucza szyfrującego** (`USER_KEYS_ENCRYPTION_KEY`) — poza scope.
- **Import/eksport kluczy** — BYOK jest add-only w MVP.
- **Aktualizacja `model`/`base_url` istniejącego klucza** — `UpdateKeySchema` świadomie wyklucza te pola;
  zmiana wymaga usunięcia i ponownego dodania klucza.
- **Paginacja listy kluczy** — rozsądny limit (100) wystarczy dla MVP.
- **Audit log** dodawania/usuwania kluczy — poza scope.
- **Walidacja formatu klucza** (np. `sk-...` dla OpenAI) — sprawdzamy przez test probe,
  nie regex.
- **Twarda mitygacja SSRF dla `base_url`** (F3 plan-review) — probe `openai_compatible` robi
  server-side `fetch(${baseUrl}/v1/models)` na user-controlled URL. Blast radius mały (CF Workers
  egress = public-internet, brak VPC/metadata service za workerem; RLS scopuje usera do atakowania
  tylko własnej konfiguracji), więc dla MVP akceptowalne. Tania bariera: `CreateKeySchema.base_url`
  wymusza `z.string().url()` — opcjonalnie dociśnij `.startsWith('https://')`. Pełna allowlist/blok
  prywatnych zakresów odsunięty.
- **Auto-aktywacja pierwszego/jedynego klucza** (F4 plan-review) — nowe klucze mają `is_active=false`;
  user musi kliknąć „Aktywuj". Decyzja czy jedyny klucz auto-aktywować należy do **S-33** (pipeline
  use); S-32 nie zmienia defaultu.

## Implementation Approach

Dwie atomic fazy: backend (migracja + crypto + endpoints + unit testy) →
frontend (UI w AccountIsland + E2E). Każda faza = jeden commit. Plaintext klucza
przechodzi serwer tylko przy POST create i POST test (decrypt serwer-side).

---

## Phase 1: Migracja + encryption helpers + API endpoints

### Overview

Stworzyć tabelę `user_api_keys` z RLS i partial unique index, helpery AES-GCM,
schematy Zod, 3 pliki endpointów (index / [id] / [id]/test) i unit testy.

### Changes Required

#### 1. Migration

**File**: `supabase/migrations/0016_user_api_keys.sql` (nowy)

**Intent**: Tabela kluczy API z RLS owner-only + partial unique index wymuszający
≤1 aktywny klucz per user.

**Contract**:
```sql
create table user_api_keys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text not null,
  provider       text not null check (provider in ('anthropic','openai','openrouter','openai_compatible')),
  model          text,
  base_url       text,
  encrypted_key  text not null,
  is_active      boolean not null default false,
  last_tested_at timestamptz,
  last_test_result text check (last_test_result in ('ok','error')),
  created_at     timestamptz default now()
);

alter table user_api_keys enable row level security;

create policy "user_api_keys_select_own" on user_api_keys
  for select using (user_id = auth.uid());
create policy "user_api_keys_insert_own" on user_api_keys
  for insert with check (user_id = auth.uid());
create policy "user_api_keys_update_own" on user_api_keys
  for update using (user_id = auth.uid());
create policy "user_api_keys_delete_own" on user_api_keys
  for delete using (user_id = auth.uid());

create unique index user_api_keys_one_active_per_user
  on user_api_keys(user_id)
  where is_active = true;
```

#### 2. Env type extension

**File**: `src/env.d.ts`

**Intent**: Dodać `USER_KEYS_ENCRYPTION_KEY: string` do `Cloudflare.Env` — canonical
augmentation Worker Secrets.

**Contract**: Nowa linia w `interface Env` pod `ANTHROPIC_API_KEY`:
```ts
USER_KEYS_ENCRYPTION_KEY: string;
```

#### 3. AES-GCM crypto helpers

**File**: `src/lib/keys/crypto.ts` (nowy)

**Intent**: Szyfrowanie/deszyfrowanie kluczy API. AES-GCM (256-bit) przez `crypto.subtle`
(natywne dla CF Workers + przeglądarka). Master key z `USER_KEYS_ENCRYPTION_KEY` (base64,
32 bajty). IV losowy per szyfrowanie (12 bajtów), przechowywany jako `<ivB64>:<ctB64>`.

**Contract**:
- `encrypt(plaintext: string, rawKey: string): Promise<string>` — zwraca `"<ivB64>:<ctB64>"`.
  `rawKey` = base64-zakodowany 32-bajtowy klucz (argument, nie import `env` — testowalność).
- `decrypt(encrypted: string, rawKey: string): Promise<string>` — inverse.
- `getEncryptionKey(): string` — czyta `env?.USER_KEYS_ENCRYPTION_KEY ??
  import.meta.env.USER_KEYS_ENCRYPTION_KEY` (wzorzec z `supabase.server.ts`).
- Exportuje też `encryptWithEnvKey(plaintext)` / `decryptWithEnvKey(encrypted)` jako
  convenience wrappers wywołujące `getEncryptionKey()` wewnętrznie (endpointy używają tych).

#### 4. Zod schemas + DTO

**File**: `src/lib/keys/schema.ts` (nowy)

**Intent**: Walidacja input/output, typy DTO.

**Contract**:
```ts
export const ProviderEnum = z.enum(['anthropic','openai','openrouter','openai_compatible']);

export const CreateKeySchema = z.object({
  label:     z.string().trim().min(1).max(100),
  provider:  ProviderEnum,
  key_value: z.string().min(1).max(500),
  model:     z.string().max(100).nullish(),
  base_url:  z.string().url().max(500).nullish(),
});

export const UpdateKeySchema = z.object({
  label:     z.string().trim().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
}).refine(d => d.label !== undefined || d.is_active !== undefined,
  { message: 'At least one field required' });

export const ApiKeyDTO = z.object({
  id:               z.string().uuid(),
  label:            z.string(),
  provider:         ProviderEnum,
  model:            z.string().nullable(),
  base_url:         z.string().nullable(),
  is_active:        z.boolean(),
  last_tested_at:   z.string().nullable(),
  last_test_result: z.enum(['ok','error']).nullable(),
  created_at:       z.string(),
});
export type ApiKeyDTO = z.infer<typeof ApiKeyDTO>;
export type CreateKeyInput = z.infer<typeof CreateKeySchema>;
export type UpdateKeyInput = z.infer<typeof UpdateKeySchema>;
```

`model` i `base_url` nie ma w `UpdateKeySchema` — zmiana tych pól wymaga usunięcia i
ponownego dodania klucza (nie zmienia szyfrowanej wartości, ale zmienia semantykę klucza).

#### 5. Test probe helpers

**File**: `src/lib/keys/probe.ts` (nowy)

**Intent**: Tania weryfikacja klucza przez GET /v1/models na odpowiedni endpoint.
Parametryczna (nie czyta DB) — testowalność + reużycie w endpoincie.

**Contract**:
```ts
export async function probeKey(
  provider: z.infer<typeof ProviderEnum>,
  apiKey: string,
  baseUrl?: string | null
): Promise<'ok' | 'error'> { ... }
```

Wewnętrznie:
- `anthropic`: `fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } })`
- `openai`: `fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer <key>' } })`
- `openrouter`: `fetch('https://openrouter.ai/api/v1/models', { Authorization: 'Bearer <key>' })`
- `openai_compatible`: `fetch(`${baseUrl}/v1/models`, { Authorization: 'Bearer <key>' })`; jeśli
  `baseUrl` null → `'error'`.
- Każda ścieżka: `try/catch`, return `res.ok ? 'ok' : 'error'`; wyjątek → `'error'`.

#### 6. GET list + POST create endpoint

**File**: `src/pages/api/account/keys/index.ts` (nowy)

**Intent**: Lista kluczy (metadane, bez `encrypted_key`) + tworzenie nowego klucza.

**Contract**:
- `export const prerender = false`
- `GET`: 401 gdy `!locals.user`. `locals.supabase.from('user_api_keys').select('id,label,provider,model,base_url,is_active,last_tested_at,last_test_result,created_at').eq('user_id', user.id).order('created_at', { ascending: true })`. Sukces: `apiResponse({ data: { keys: data } })`. Błąd DB: 500.
- `POST`: 401. Parse JSON (400). `CreateKeySchema.safeParse` (400 `VALIDATION_ERROR` + details).
  Encrypt `key_value` → `encrypted_key`. Insert `{ user_id, label, provider, model, base_url, encrypted_key }`.
  Sukces: `apiResponse({ data: { key: <metadata bez encrypted_key> } })`, status 201.
  DB error `23505` (gdyby unique naruszony inaczej) → 400; inne → 500.

#### 7. PATCH update/activate + DELETE endpoint

**File**: `src/pages/api/account/keys/[id].ts` (nowy)

**Intent**: Aktualizacja etykiety lub zmiana aktywności klucza, usuwanie.

**Contract**:
- `export const prerender = false`
- UUID param przez `parseUuidParam(params.id)` (404 dla bad UUID — privacy).
- `PATCH`: 401. Parse + `UpdateKeySchema.safeParse` (400). Fetch row (`select('id,user_id')`
  `.eq('id', id).single()`): `PGRST116` → 404, inne → 500. RLS scope sprawdzany przez
  `eq('user_id', user.id)` w update.
  - Gdy `is_active === true`: najpierw `UPDATE user_api_keys SET is_active = false WHERE
    user_id = :uid AND id != :id` (dezaktywuj inne), potem `UPDATE SET is_active = true, ...label? WHERE id = :id AND user_id = :uid`.
  - Gdy `is_active === false` lub brak `is_active`: single `UPDATE` z polami z parsed.data.
  - `23505` (naruszenie partial unique) → 400 `VALIDATION_ERROR` „Inny klucz jest już aktywny.".
  - Sukces: `apiResponse({ data: { key: <metadata> } })`.
- `DELETE`: 401. `parseUuidParam`. `locals.supabase.from('user_api_keys').delete().eq('id', id)
  .eq('user_id', user.id)`. 0 deleted rows (PGRST116) → 404. Sukces: `apiResponse({ data: {} })`.

#### 8. POST test endpoint

**File**: `src/pages/api/account/keys/[id]/test.ts` (nowy)

**Intent**: Serwer-side probe klucza: decrypt → GET /v1/models → zapisz wynik → zwróć.

**Contract**:
- `export const prerender = false`
- `POST` handler: 401. `parseUuidParam`. Fetch row `select('id,provider,model,base_url,encrypted_key,user_id')
  .eq('id', id).eq('user_id', user.id).single()`: `PGRST116` → 404.
- Decrypt `encrypted_key` → plaintext. Wywołaj `probeKey(provider, plaintext, base_url)`.
- `UPDATE user_api_keys SET last_tested_at = now(), last_test_result = <result> WHERE id = :id`.
- `apiResponse({ data: { result } })`. Błędy decrypt/probe → `result: 'error'`, ale nadal 200
  (błąd jest wynikiem testu, nie serwera).

#### 9. Typowanie nowej tabeli w database.types.ts (hand-extend)

**File**: `src/lib/db/database.types.ts` (update, committed — nie gitignored)

**Intent**: Po migracji 0016 `from('user_api_keys')` zwraca `any` bez zaktualizowanych typów
(TypeScript strict NIE zgłasza błędu na nieznaną nazwę tabeli — confirmed; lint też przechodzi,
bo projekt nie ma type-aware `no-unsafe-*` reguł). To znaczy: typecheck/lint są zielone nawet
przy stale typach, ale każde zapytanie do nowej tabeli jest **untyped** — zero compile-catch na
literówki kolumn / kształt insertu.

**Dlaczego hand-extend, nie `gen types`** (F1 plan-review): regeneracja przez `gen types` jest
**niewykonalna pre-merge** żadną ścieżką — lokalny stack jest AV-blocked na tej maszynie
(memory: local-supabase-blocked-by-corporate-av), a `--linked` na prod nie ma `user_api_keys`
dopóki `db push` nie wykona się **po merge** (deploy.yml). To dokładnie chicken-and-egg z
lessons.md („Nowa funkcja/rpc Postgres…"). Rozwiązanie zgodne z lekcją: **świadomie typuj
ręcznie i oflaguj**.

**Contract**: Ręcznie dodaj `user_api_keys` do `Database['public']['Tables']` w
`database.types.ts` — `Row` / `Insert` / `Update` (+ `Relationships` z FK do `auth.users`
wg wzorca istniejących tabel jak `vision_runs`). Oflaguj blokiem komentarza
`// hand-typed S-32 — regen via 'supabase gen types --linked' after 0016 lands in prod
(local stack AV-blocked, see lessons.md)`. Typy MUSZĄ odpowiadać dokładnie migracji 0016
(kolumny, nullability, enumy `provider`/`last_test_result`). Post-merge follow-up (opcjonalnie):
gdy prod ma tabelę, `--linked` regen nadpisze hand-typed wersję czysto.

#### 10. Unit testy — schema

**File**: `tests/unit/lib/keys/schema.test.ts` (nowy)

**Intent**: Zod schema validation.

**Pokrycie**:
- `CreateKeySchema`: valid input; brak `key_value` → error; za długi label; `openai_compatible`
  bez `base_url` (dozwolone — optional); `base_url` z błędnym URL → error.
- `UpdateKeySchema`: przynajmniej jedno pole required; oba opcjonalne (label + is_active); pusty
  obiekt → error.
- `ApiKeyDTO`: parse kompletnego obiektu → success; brak wymaganych pól → error.

#### 11. Unit testy — crypto helpers

**File**: `tests/unit/lib/keys/crypto.test.ts` (nowy)

**Intent**: Weryfikacja encrypt/decrypt round-trip i losowości IV.

**Mocking**: `vi.mock('cloudflare:workers', () => ({ env: { USER_KEYS_ENCRYPTION_KEY: '<base64-32-bytes-test-key>' } }))`.
Stały test key wbudowany — wzorzec z `tests/unit/lib/books/googleBooks.test.ts:3`.
`crypto.subtle` dostępny natywnie w Node 24 / jsdom (potwierdzone — bez polyfill).

**Pokrycie**:
- `encrypt` + `decrypt` round-trip: `decrypt(encrypt(plaintext, key), key) === plaintext`.
- Dwa wywołania `encrypt` z tym samym plaintext → różne wyniki (losowy IV).
- `decrypt` z błędnym ciphertext → rzuca.

#### 12. Unit testy — GET/POST /api/account/keys

**File**: `tests/unit/pages/api/account/keys/index.test.ts` (nowy)

**Intent**: Endpoint list + create.

**Mocking**: `vi.mock('../../../../../lib/keys/crypto', () => ({ encryptWithEnvKey: vi.fn().mockResolvedValue('iv:ct') }))`.

**Pokrycie**:
- GET: 200 + lista kluczy (metadane); 401 gdy user null; 500 przy DB error.
- POST: 201 + nowy klucz; 401; 400 przy Zod fail; 400 przy złym JSON; 500 przy DB error.
  Upewnij się, że `encrypted_key` NIE jest w odpowiedzi POST.

#### 13. Unit testy — PATCH/DELETE /api/account/keys/[id]

**File**: `tests/unit/pages/api/account/keys/id.test.ts` (nowy)

**Intent**: Update i delete.

**Pokrycie**:
- PATCH label: 200 + zaktualizowany klucz; 401; 404 przy nieistniejącym; 400 przy Zod fail.
- PATCH is_active=true: sprawdź że dezaktywacja innych wywołana przed aktywacją.
- DELETE: 200; 401; 404.

#### 14. Unit testy — POST /api/account/keys/[id]/test

**File**: `tests/unit/pages/api/account/keys/test.test.ts` (nowy)

**Intent**: Najkompleksowy endpoint (decrypt → probe → update). Mock crypto + mock fetch + mock supabase.

**Mocking**:
- `vi.mock('../../../../../lib/keys/crypto', () => ({ decryptWithEnvKey: vi.fn().mockResolvedValue('plaintext-key') }))`.
- `vi.mock('../../../../../lib/keys/probe', () => ({ probeKey: vi.fn().mockResolvedValue('ok') }))`.
- Mock `locals.supabase` chainable dla `select(...).eq(...).eq(...).single()` + `update(...).eq(...)`.

**Pokrycie**:
- 200 result `ok` gdy probe zwraca ok; `last_tested_at` i `last_test_result` zaktualizowane.
- 200 result `error` gdy probe zwraca error (endpoint nie rzuca — wynik to rezultat testu).
- 401 gdy user null; 404 gdy klucz nie należy do usera (PGRST116).

### Success Criteria

#### Automated Verification

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Nowe unit testy zielone: `npm run test`

#### Manual Verification

- Dodaj Worker Secret `USER_KEYS_ENCRYPTION_KEY` w Cloudflare Dashboard:
  wygeneruj klucz `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
  `wrangler secret put USER_KEYS_ENCRYPTION_KEY`. Dodaj do `.dev.vars` lokalnie. — **user-only**
- (Reszta manualnej weryfikacji w Phase 2 po UI)

**Implementation Note**: Faza czysto backendowa. Po zielonych automatach: commit, przejście do Phase 2.

---

## Phase 2: AccountIsland keys UI + E2E tests

### Overview

Zastąpić placeholder `data-testid="account-keys-placeholder"` w `AccountIsland.tsx`
pełną sekcją zarządzania kluczami. Dodać E2E test (mocked API).

### Changes Required

#### 1. AccountIsland — sekcja kluczy

**File**: `src/components/AccountIsland.tsx`

**Intent**: Zastąpić blok `<section data-testid="account-keys-placeholder">` (linie 394-408)
działającą sekcją keys management.

**State**:
```ts
const [keys, setKeys] = useState<ApiKeyDTO[]>([]);
const [keysLoading, setKeysLoading] = useState(true);
const [addOpen, setAddOpen] = useState(false);
const [addForm, setAddForm] = useState<CreateKeyInput>({ label:'', provider:'anthropic', key_value:'' });
const [addError, setAddError] = useState<string | null>(null);
const [addLoading, setAddLoading] = useState(false);
const [testingId, setTestingId] = useState<string | null>(null);
const [deletingId, setDeletingId] = useState<string | null>(null);
const [activatingId, setActivatingId] = useState<string | null>(null);
```

**Contract UI**:
- `useEffect` przy mount: `fetch('/api/account/keys')` → `setKeys(data.keys)`.
- Lista kluczy: per klucz — etykieta, badge providera, badge `Aktywny`/`Nieaktywny`,
  badge wyniku testu (`ok` = zielony, `error` = czerwony), przyciski.
  `data-testid="key-row-{id}"`, `data-testid="key-active-badge-{id}"`,
  `data-testid="key-test-result-{id}"`.
- Przycisk „Aktywuj" (`data-testid="key-activate-btn-{id}"`): `PATCH .../keys/{id}` z
  `{ is_active: true }` → `setKeys(prev => ...)`.
- Przycisk „Testuj" (`data-testid="key-test-btn-{id}"`): `POST .../keys/{id}/test` →
  aktualizuj `last_test_result` i `last_tested_at` w lokalnym state.
- Przycisk „Usuń" (`data-testid="key-delete-btn-{id}"`): `DELETE .../keys/{id}` →
  usuń z lokalnego state.
- Formularz dodawania (`data-testid="add-key-form"`): pola label, provider (select),
  key_value (password input), warunkowo model + base_url gdy `provider === 'openai_compatible'`.
  POST → dodaj do state, zamknij formularz. Błąd → `data-testid="add-key-error"`.
- Importuj `ApiKeyDTO` z `src/lib/keys/schema`.

#### 2. Aktualizacja istniejącego E2E testu konta

**File**: `tests/e2e/account.spec.ts`

**Intent**: Usunąć lub zaktualizować asercję `getByTestId('account-keys-placeholder').toBeVisible()`
(linia 36) — po zastąpieniu placeholder'a pełną sekcją ten testid nie istnieje i test padnie w CI.

**Contract**: Zastąp asercję `account-keys-placeholder` asercją potwierdzającą że sekcja kluczy
istnieje: `expect(page.getByRole('heading', { name: /klucze api/i })).toBeVisible()` lub
`expect(page.getByTestId('account-keys-section')).toBeVisible()` (jeśli section dostanie testid).

#### 3. E2E test kluczy

**File**: `tests/e2e/account-keys.spec.ts` (nowy)

**Intent**: Pokryć 2 ryzyka: (1) sekcja keys renderuje stan z API; (2) add + delete flow
aktualizuje UI bez page reload.

**Ryzyka z test-plan.md**: sekcja keys UI — stan synchronizowany z API, CRUD flow widoczny.

**Contract**:
- Auth: `storageState` (bez logowania w teście).
- Mock API przez `page.route`:
  - `GET **/api/account/keys` → pusta lista lub lista z 1 kluczem
  - `POST **/api/account/keys` → nowy klucz metadata
  - `DELETE **/api/account/keys/**` → 200
  - `PATCH **/api/account/keys/**` → zaktualizowany klucz
  - `POST **/api/account/keys/**/test` → `{ data: { result: 'ok' } }`
- Mock `GET **/api/account/stats` → `{ data: { total_vision_cost_usd: 0, ... } }` (żeby
  reszta AccountIsland nie błędowała)
- Mock `PATCH **/api/account/profile` → `{ data: { profile: { id: '...', display_name: 'Test' } } }`

**Testy**:
```
S-32: lista kluczy renderuje dane z API
  → route GET keys → klucz z is_active=true; goto /account; expect key-row + key-active-badge

S-32: add key form dodaje klucz do listy
  → route GET keys → []; route POST keys → nowy klucz; goto /account; fill form; submit;
    expect key-row widoczny bez reload

S-32: delete usuwa klucz z listy
  → route GET keys → [klucz]; route DELETE → 200; goto /account; click delete;
    expect key-row not attached
```

### Success Criteria

#### Automated Verification

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- E2E testy zielone: `npm run test:e2e -- --grep "S-32"`

#### Manual Verification

- Wejdź na `/account` → sekcja „Klucze API" widoczna (nie placeholder). — **user-only**
- Dodaj klucz Anthropic (realny klucz z `.dev.vars`) → pojawia się w liście. — **user-only**
- Kliknij „Testuj" → wynik `ok` pojawia się przy kluczu. — **user-only**
- Kliknij „Aktywuj" → klucz dostaje badge „Aktywny"; poprzednio aktywny traci go. — **user-only**
- Kliknij „Usuń" → klucz znika z listy. — **user-only**
- Supabase Studio: tabela `user_api_keys` — kolumna `encrypted_key` zawiera szyfrowany string
  (nie plaintext), `is_active` max 1 per user. — **user-only**

**Implementation Note**: Po zielonych automatach → manualna weryfikacja (user-only) → commit.

---

## Testing Strategy

### Unit Tests

- `tests/unit/lib/keys/schema.test.ts` — Zod schema (11 cases)
- `tests/unit/lib/keys/crypto.test.ts` — encrypt/decrypt round-trip + IV randomness (3 cases)
- `tests/unit/pages/api/account/keys/index.test.ts` — GET + POST (8 cases)
- `tests/unit/pages/api/account/keys/id.test.ts` — PATCH + DELETE (10 cases)
- `tests/unit/pages/api/account/keys/test.test.ts` — probe endpoint (5 cases)

### E2E Tests

- `tests/e2e/account-keys.spec.ts` — 3 scenariusze (mocked API, brak realnych kluczy LLM)

### Manual Tests (user-only)

1. Dodaj Worker Secret `USER_KEYS_ENCRYPTION_KEY` przed deploy.
2. Dodaj realny klucz Anthropic przez UI → Supabase Studio potwierdza encrypted_key.
3. Testuj klucz → wynik ok.
4. Usuń klucz → gone.

## Performance Considerations

GET /api/account/keys: jednorazowy fetch przy montowaniu AccountIsland. Lista kluczy krótka
(max kilka na usera). `Cache-Control: private, no-store` z F-02 defaults.

## Migration Notes

`supabase/migrations/0016_user_api_keys.sql` — nowa tabela, bez zmian w istniejących tabelach.
Po merge `deploy.yml` uruchamia `supabase db push` automatycznie.

Przed deployem: dodaj Worker Secret `USER_KEYS_ENCRYPTION_KEY` przez
`wrangler secret put USER_KEYS_ENCRYPTION_KEY` lub Cloudflare Dashboard.

## References

- Placeholder zastępowany: `src/components/AccountIsland.tsx:394-408`
- Wzorzec endpointu PATCH: `src/pages/api/account/profile.ts`
- Wzorzec CRUD [id]: `src/pages/api/shelves/[id].ts:19-113`
- Env typing: `src/env.d.ts`; wzorzec czytania env: `src/lib/db/supabase.server.ts`
- Wzorzec partial unique index: `supabase/migrations/0001_initial_schema.sql` (`books_user_isbn13`)
- E2E mock pattern: `tests/e2e/book-source-photo-link.spec.ts`
- vitest cloudflare:workers stub: `vitest.config.ts:8-18`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migracja + encryption helpers + API endpoints

#### Automated

- [x] 1.1 Typecheck przechodzi: `npm run typecheck` — f22a643
- [x] 1.2 Lint przechodzi: `npm run lint` — f22a643
- [x] 1.3 Unit testy (schema, crypto, index, [id], [id]/test) zielone: `npm run test` — f22a643

#### Manual

- [x] 1.4 `USER_KEYS_ENCRYPTION_KEY` dodany do `.dev.vars` (lokalny dev) + Worker Secret przed deploy — user-only — f22a643

(Hand-extend `database.types.ts` dla `user_api_keys` to krok automated #9 — nie wymaga
lokalnego stacku ani user-only; weryfikowany przez 1.1 typecheck.)

### Phase 2: AccountIsland keys UI + E2E tests

#### Automated

- [x] 2.1 Typecheck przechodzi: `npm run typecheck`
- [x] 2.2 Lint przechodzi: `npm run lint`
- [x] 2.3 account.spec.ts zielony po usunięciu placeholder asercji: `npm run test:e2e`
- [x] 2.4 E2E testy kluczy zielone: `npm run test:e2e -- --grep "S-32"`

#### Manual

- [x] 2.5 Sekcja „Klucze API" widoczna (nie placeholder) — user-only
- [x] 2.6 Add/test/activate/delete flow działa w przeglądarce — user-only
- [x] 2.7 Studio: encrypted_key szyfrowany, is_active max 1 per user — user-only
