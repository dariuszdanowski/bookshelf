# S-33: BYOK Pipeline Enforcement — Implementation Plan

## Overview

Wpięcie kluczy API z S-32 w pipeline vision: dwa endpointy (`process`, `refine`) zyskują
bramkę lookup klucza przed wywołaniem vision; `src/lib/vision/client.ts` abstrahuje do
`VisionProvider` z dwoma ścieżkami protokołów (Anthropic SDK / OpenAI-compatible fetch);
`PhotoUploader` sprawdza na mount czy user ma aktywny klucz i pokazuje empty state z CTA.

## Current State Analysis

**S-32 dał:** `user_api_keys` (AES-GCM, partial unique index `is_active`, 4 providery),
`src/lib/keys/crypto.ts` (`decryptWithEnvKey`), `src/lib/keys/schema.ts` (`ProviderEnum`,
`ApiKeyDTO`), `src/lib/keys/probe.ts` (per-provider probe), endpointy CRUD + test klucza,
sekcja kluczy w `AccountIsland`.

**Luki dla S-33:**
- `src/lib/vision/client.ts:88,167` — hardkoduje `env?.ANTHROPIC_API_KEY`, brak parametru per-user
- `POST /api/photos/[id]/process` — ma guard `ai_enabled` (L74–81), brak key lookup
- `POST /api/detections/[id]/refine` — brak zarówno `ai_enabled` guard jak i key lookup
- `PhotoUploader` — nie sprawdza klucza przed inicjacją uploadu
- `ApiErrorCode` — brak kodu `NO_API_KEY`

**Brak migracji DB** — `user_api_keys` istnieje od S-32.

## Desired End State

- Każde wywołanie vision (process + refine) wymaga aktywnego klucza w `user_api_keys`.
  Brak klucza → 403 `NO_API_KEY` (`message: "Brak aktywnego klucza API…", account_url: "/account"`).
- `ANTHROPIC_API_KEY` z Worker Secrets pozostaje w `env.d.ts` dla celów deweloperskich
  i awaryjnych, ale kod pipeline'u go nie używa.
- `detectSpines(input, config)` i `detectSingleSpineFromCrop(input, config)` przyjmują
  `VisionProviderConfig`; Anthropic path zachowuje retry-z-thinking; OpenAI-compatible path
  to single-attempt fetch.
- `PhotoUploader` na mount pobiera `GET /api/account/keys`; brak aktywnego klucza = empty state
  z linkiem do `/account`.

### Key Discoveries:

- `detectSpines()` i `detectSingleSpineFromCrop()` używają dynamic import `@anthropic-ai/sdk`
  (obejście Vite SSR bundlera) — pattern zachowany, apiKey przekazany parametrem.
- `refine.ts` nie ma guard'u `ai_enabled` — S-33 go doda dla spójności z `process.ts`.
- OpenAI-compatible format: `POST /v1/chat/completions` z `image_url` content block; response
  `choices[0].message.content` (JSON string); DetectionSchema.safeParse stosuje się do obu.
- Koszt dla non-Anthropic: `costUsd: 0` (system nie płaci za klucz usera).
  User's `vision_runs.cost_usd = 0` — intencjonalne; własny klucz = własny koszt.
- Model default: Anthropic → `claude-sonnet-4-6`; OpenAI-compatible → `gpt-4o-mini`.
  `user_api_keys.model` nadpisuje oba defaulty.

## What We're NOT Doing

- Migracji DB (tabela z S-32 gotowa).
- Tracking kosztu per-provider dla non-Anthropic (pricing external — `costUsd: 0`).
- Fallbacku do `ANTHROPIC_API_KEY` dla żadnego usera (hard require).
- Extended thinking dla OpenAI-compatible (specyfika Anthropic).
- `is_admin` bypass (S-26 — osobny slice).
- Zmiany w `AccountIsland` (S-32 już ma pełne CRUD UI kluczy).

## Implementation Approach

Cztery fazy atomowe:

1. **VisionProvider abstraction** — `response.ts` + `client.ts` refaktor.
2. **Key lookup helper + endpoint enforcement** — nowy `getActiveProviderConfig.ts`,
   aktualizacja `process.ts` i `refine.ts`.
3. **PhotoUploader empty state** — eager key check na mount.
4. **Tests + docs** — unit testy dla nowych ścieżek, E2E dla empty state, AGENTS.md.

Fazy 1–3 nie mają zmian widocznych dla usera bez nowego klucza; Phase 4 zamyka jakość.

## Critical Implementation Details

**OpenAI-compatible fetch — format żądania i parsowanie odpowiedzi:**
Żądanie: `POST {baseUrl ?? 'https://api.openai.com'}/v1/chat/completions` z nagłówkiem
`Authorization: Bearer {apiKey}`, body JSON: `{ model, max_tokens: 4096, messages: [{ role: "system", content: VISION_SYSTEM_PROMPT }, { role: "user", content: [{ type: "image_url", image_url: { url: "data:{mediaType};base64,{base64}" } }, { type: "text", text: "Respond in JSON array..." }] }] }`.
Odpowiedź: `await resp.json()` → `body.choices[0]?.message?.content` (string) → `DetectionSchema.safeParse(JSON.parse(...))`. Brak retry-z-thinking: jeden attempt, parse fail → `{ ok: false, reason: 'parse_failure' }`.

**Kolejność guard'ów w refine.ts:**
Auth (401) → ai_enabled (403 AI_DISABLED) → key lookup (403 NO_API_KEY). Identyczna kolejność jak w `process.ts`.

**`getActiveProviderConfig` używa `supabase` z `locals`** (RLS-respecting anon client) —
nie service-role. RLS na `user_api_keys` gwarantuje `user_id = auth.uid()`.
Zwraca `null` gdy: brak wierszy lub błąd DB (nie rzuca — błędy DB logowane jako INTERNAL_ERROR).

---

## Phase 1: VisionProvider Abstraction

### Overview

Dodanie `'NO_API_KEY'` do `ApiErrorCode` i refaktor `src/lib/vision/client.ts`:
eksport `VisionProviderConfig`, nowe sygnatury `detectSpines(input, config)` i
`detectSingleSpineFromCrop(input, config)`, dwie ścieżki implementacji (Anthropic SDK /
OpenAI-compatible fetch).

### Changes Required:

#### 1. Error code

**File**: `src/lib/http/response.ts`

**Intent**: Dodaj `'NO_API_KEY'` do union `ApiErrorCode` jako jawny kod dla klienta.

**Contract**: Rozszerz union o literał `'NO_API_KEY'`. Brak zmian w helperach `apiResponse`/`apiError` — przyjmują `ApiErrorCode` przez union.

#### 2. VisionProviderConfig + refaktor client.ts

**File**: `src/lib/vision/client.ts`

**Intent**: Wyeksportuj typ `VisionProviderConfig`; zastąp hardkodowane `env?.ANTHROPIC_API_KEY`
parametrem `config` w obu funkcjach. Anthropic path zachowuje pełną logikę (SDK, retry-z-thinking).
OpenAI-compatible path implementuje fetch-based single-attempt.

**Contract**:

```typescript
export type VisionProviderConfig = {
  provider: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible';
  apiKey: string;
  model?: string | null;   // null → default per provider
  baseUrl?: string | null; // non-null tylko dla openai_compatible
};

export async function detectSpines(
  input: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
  config: VisionProviderConfig
): Promise<VisionResult>

export async function detectSingleSpineFromCrop(
  input: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
  config: VisionProviderConfig
): Promise<RefineVisionResult>
```

Dispatch wewnątrz: `config.provider === 'anthropic'` → istniejąca ścieżka Anthropic SDK
(z `config.apiKey` zamiast `env.ANTHROPIC_API_KEY`, model `config.model ?? 'claude-sonnet-4-6'`).
Pozostałe → nowa ścieżka OpenAI-compatible (fetch, model `config.model ?? 'gpt-4o-mini'`,
baseUrl `config.baseUrl ?? 'https://api.openai.com'`). Koszt dla non-Anthropic: `costUsd: 0`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` — pass (nowy `VisionProviderConfig`, `NO_API_KEY` w union)
- `npm run lint` — pass
- Unit testy vision client — pass z zaktualizowanymi sygnaturami (zmiana mockowania)

#### Manual Verification:

- Brak zmian widocznych dla usera w tej fazie (refaktor wewnętrzny).

---

## Phase 2: Key Lookup Helper + Endpoint Enforcement

### Overview

Nowy helper `src/lib/keys/getActiveProviderConfig.ts` pobiera i odszyfrowuje aktywny klucz
usera. `process.ts` zyskuje key lookup po guard'zie `ai_enabled`. `refine.ts` zyskuje
`ai_enabled` guard + key lookup.

### Changes Required:

#### 1. Key lookup helper

**File**: `src/lib/keys/getActiveProviderConfig.ts` (nowy)

**Intent**: Hermetyzuj powtarzalną logikę: fetch aktywnego klucza z `user_api_keys`,
odszyfrowanie, budowa `VisionProviderConfig`. Używany w obu endpointach.

**Contract**:

```typescript
import type { VisionProviderConfig } from '../vision/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types';

export async function getActiveProviderConfig(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<VisionProviderConfig | null>
```

Implementacja: `supabase.from('user_api_keys').select('provider,encrypted_key,model,base_url').eq('user_id', userId).eq('is_active', true).maybeSingle()`.
- `maybeSingle()` → `null` gdy brak wiersza (nie rzuca PGRST116).
- Sukces: `decryptWithEnvKey(row.encrypted_key)` → buduj `VisionProviderConfig`.
- Błąd DB lub deszyfrowania: `console.error(…err.message…)`, zwróć `null`
  (endpoint zmapuje na `INTERNAL_ERROR` lub `NO_API_KEY` w zależności od kontekstu — patrz process.ts).

#### 2. process.ts — key lookup step

**File**: `src/pages/api/photos/[id]/process.ts`

**Intent**: Po istniejącym guard'zie `ai_enabled` (linia ~81) wstaw key lookup;
brak aktywnego klucza → 403 `NO_API_KEY`; przekaż odszyfrowany config do `detectSpines`.

**Contract**: Wstaw po bloku `ai_enabled`:
```typescript
const providerConfig = await getActiveProviderConfig(supabase, locals.user.id);
if (!providerConfig) {
  return apiError({ code: 'NO_API_KEY', status: 403,
    message: 'Brak aktywnego klucza API. Dodaj klucz na stronie /account.',
    details: { account_url: '/account' } });
}
```
Zmień wywołanie `detectSpines({ base64, mediaType })` → `detectSpines({ base64, mediaType }, providerConfig)`.
Analogicznie `detectSingleSpineFromCrop` jeśli używany w tym pliku.

#### 3. refine.ts — ai_enabled guard + key lookup

**File**: `src/pages/api/detections/[id]/refine.ts`

**Intent**: Dodaj brakujący guard `ai_enabled` (spójność z process.ts) i key lookup przed wywołaniem
`detectSingleSpineFromCrop`. Brak klucza → 403 `NO_API_KEY`.

**Contract**: Po auth check (`!locals.user` → 401) wstaw:
```typescript
// ai_enabled guard (parity z process.ts)
const { data: profile } = await supabase.from('profiles')
  .select('ai_enabled').eq('id', locals.user.id).single();
if (!profile?.ai_enabled) {
  return apiError({ code: 'AI_DISABLED', status: 403, message: 'Analiza AI jest wyłączona.' });
}

// key lookup
const providerConfig = await getActiveProviderConfig(supabase, locals.user.id);
if (!providerConfig) {
  return apiError({ code: 'NO_API_KEY', status: 403,
    message: 'Brak aktywnego klucza API. Dodaj klucz na stronie /account.',
    details: { account_url: '/account' } });
}
```
Zmień `detectSingleSpineFromCrop({ base64: cropBase64, mediaType: 'image/jpeg' })` →
`detectSingleSpineFromCrop({ base64: cropBase64, mediaType: 'image/jpeg' }, providerConfig)`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` — pass (nowe importy, zgodne typy)
- `npm run lint` — pass
- Unit testy `process.ts`: istniejące przechodzą (mock `user_api_keys` zwracający aktywny klucz);
  nowe testy: brak aktywnego klucza → 403 `NO_API_KEY`
- Unit testy `refine.ts`: nowe testy: brak ai_enabled → 403 `AI_DISABLED`,
  brak klucza → 403 `NO_API_KEY`
- `npm run test` — pass

#### Manual Verification:

- `curl -X POST /api/photos/<id>/process` bez klucza w `user_api_keys` → 403 `NO_API_KEY`
- `curl -X POST /api/detections/<id>/refine` bez klucza → 403 `NO_API_KEY`
- Z aktywnym kluczem Anthropic → proces przebiega normalnie (weryfikacja manualna post-merge)

---

## Phase 3: PhotoUploader Empty State + CTA

### Overview

`PhotoUploader` na mount sprawdza `GET /api/account/keys`; jeśli brak aktywnego klucza —
empty state z CTA zamiast sekcji upload.

### Changes Required:

#### 1. Key check na mount

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Eager check aktywnego klucza na mount. Stan `null` = ładowanie (skeleton),
`false` = empty state z CTA do `/account`, `true` = normalny upload UI.

**Contract**: Dodaj stan:
```typescript
const [hasActiveKey, setHasActiveKey] = useState<boolean | null>(null);
```
W `useEffect([], [])` (nie po istniejącym load shelves — osobny effect):
```typescript
fetch('/api/account/keys')
  .then(r => r.json())
  .then(body => {
    const active = (body.data?.keys ?? []).some((k: { is_active: boolean }) => k.is_active);
    setHasActiveKey(active);
  })
  .catch(() => setHasActiveKey(false));
```

Renderowanie przed głównym JSX:
- `hasActiveKey === null` → `<Skeleton … />` (loading)
- `hasActiveKey === false` → empty state: ikona + "Brak klucza API" + link `<a href="/account">Dodaj klucz w ustawieniach</a>`
- `hasActiveKey === true` → istniejący upload UI (bez zmian)

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` — pass
- `npm run lint` — pass

#### Manual Verification:

- Bez aktywnego klucza w `user_api_keys` → `/upload` pokazuje empty state z linkiem do `/account`
- Po dodaniu klucza → `/upload` pokazuje normalny uploader
- Skeleton widoczny przez ~moment ładowania

---

## Phase 4: Tests + AGENTS.md Update

### Overview

Aktualizacja istniejących unit testów vision client (nowe sygnatury). Nowe unit testy dla
NO_API_KEY path. E2E test dla empty state w PhotoUploader. Aktualizacja AGENTS.md.

### Changes Required:

#### 1. Aktualizacja unit testów vision client

**File**: testy dla `src/lib/vision/client.ts` (zlokalizować w `tests/unit/lib/vision/`)

**Intent**: Zaktualizuj wywołania `detectSpines()` i `detectSingleSpineFromCrop()` o parametr
`VisionProviderConfig`. Dodaj testy dla ścieżki OpenAI-compatible (mock `fetch`, sprawdź
poprawny format żądania i parsowanie odpowiedzi).

**Contract**: Istniejące testy przekazują `{ provider: 'anthropic', apiKey: 'sk-test' }`.
Nowe testy: mock `globalThis.fetch` dla OpenAI-compat path, sprawdź że `costUsd === 0`.

#### 2. Unit testy endpoint guard'ów

**File**: testy dla `process.ts` i `refine.ts` (w `tests/unit/pages/api/`)

**Intent**: Przetestuj ścieżkę 403 `NO_API_KEY` gdy `user_api_keys` nie zwraca aktywnego klucza.
Dla `refine.ts` przetestuj też 403 `AI_DISABLED`.

**Contract**: W istniejących testach endpoint'ów mock `supabase.from('user_api_keys')` zwracający
aktywny klucz (happy path) i null (NO_API_KEY path). Sprawdź `code: 'NO_API_KEY'`, `status: 403`.

#### 3. E2E test — empty state PhotoUploader

**File**: `tests/e2e/` (rozszerzenie istniejącego lub nowy `byok-enforcement.spec.ts`)

**Intent**: Test: brak aktywnego klucza → PhotoUploader pokazuje CTA; kliknięcie CTA → `/account`.

**Contract**: `page.route('**/api/account/keys', route => route.fulfill({ status: 200, body: JSON.stringify({ data: { keys: [] } }) }))` → navigate `/upload` → `expect(page.getByText('Brak klucza API')).toBeVisible()` → `expect(page.getByRole('link', { name: /Dodaj klucz/ })).toHaveAttribute('href', '/account')`.

#### 4. AGENTS.md update

**File**: `src/lib/vision/AGENTS.md`

**Intent**: Udokumentuj nowy pattern VisionProvider: że `detectSpines` i `detectSingleSpineFromCrop`
wymagają `VisionProviderConfig`, że klucz jest pobierany przez `getActiveProviderConfig`, że
system nie używa globalnego `ANTHROPIC_API_KEY` w pipeline'ie.

**Contract**: Dodaj sekcję `## Provider abstraction (S-33)` z regułami:
- Sygnatury funkcji wymagają `VisionProviderConfig` — nigdy nie czytaj `env.ANTHROPIC_API_KEY` w client.ts
- Anthropic path: SDK + retry-with-thinking; OpenAI-compat: fetch, no thinking, `costUsd: 0`
- Klucz pobierany przez `getActiveProviderConfig(supabase, userId)` w endpointach (nie w client.ts)

### Success Criteria:

#### Automated Verification:

- `npm run test` — pass (97+ testów zielonych + nowe)
- `npm run test:e2e` — pass (w tym nowy test empty state)
- `npm run typecheck` — pass
- `npm run lint` — pass

#### Manual Verification:

- Z aktywnym kluczem Anthropic: upload zdjęcia → vision działa → detekcje w review
- Bez klucza: `/upload` → empty state → klik → `/account` → dodaj klucz → wróć → upload działa
- Refine (`Doprecyzuj odczyt`) z kluczem: działa; bez klucza: 403 (error state w UI)

---

## Testing Strategy

### Unit Tests:

- `src/lib/vision/client.ts` — Anthropic path (istniejące mocks + nowy `config` param);
  OpenAI-compatible path (mock `fetch`, format żądania, parsowanie `choices[0].message.content`,
  `costUsd === 0`)
- `process.ts` — NO_API_KEY path (mock keys → null); happy path z mockowanym kluczem
- `refine.ts` — AI_DISABLED path (ai_enabled=false); NO_API_KEY path; happy path
- `getActiveProviderConfig.ts` — null gdy `maybeSingle` returns null; poprawny kształt VisionProviderConfig

### Integration Tests:

- Brak nowych (DB mockowany w testach unit; real DB integration po merge)

### Manual Testing Steps:

1. Brak klucza: zaloguj → `/upload` → widać empty state z linkiem `/account`
2. Dodaj klucz Anthropic → aktywuj → wróć → `/upload` → normalny uploader
3. Upload zdjęcia z kluczem → vision przetwarza → detekcje pojawiają się w review
4. Testuj refine (`Doprecyzuj odczyt`) z aktywnym kluczem — działa
5. Dezaktywuj klucz → odśwież `/upload` → empty state wraca

## Performance Considerations

- `GET /api/account/keys` na mount PhotoUploader = 1 dodatkowy request przy wejściu na `/upload`.
  Odpowiedź RLS-scoped (mały zestaw wierszy per user) — latencja pomijalna.
- `getActiveProviderConfig` = 1 Supabase SELECT + 1 AES-GCM decrypt (CPU < 1ms).
  Sekwencyjnie przed vision call — nie blokuje throughput.

## Migration Notes

Brak migracji DB. `user_api_keys` istnieje od S-32.

Zmiana breaking dla istniejących userów bez aktywnego klucza: `process` i `refine` zwracają
teraz 403 zamiast wywoływać vision. W UI: PhotoUploader nie pokaże uploadu. Komunikacja
przez empty state + CTA.

## References

- S-32 archive: `context/archive/2026-06-04-byok-api-keys/`
- S-32 key endpoints: `src/pages/api/account/keys/`
- Encryption helper: `src/lib/keys/crypto.ts`
- Probe helper (per-provider URLs): `src/lib/keys/probe.ts`
- Current vision client: `src/lib/vision/client.ts`
- Current process endpoint: `src/pages/api/photos/[id]/process.ts`
- Current refine endpoint: `src/pages/api/detections/[id]/refine.ts`
- ApiErrorCode union: `src/lib/http/response.ts`
- VisionProvider rules: `src/lib/vision/AGENTS.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: VisionProvider Abstraction

#### Automated

- [x] 1.1 `npm run typecheck` — pass (NO_API_KEY w union, VisionProviderConfig types) — 839acb4
- [x] 1.2 `npm run lint` — pass — 839acb4
- [x] 1.3 unit testy vision client — pass z zaktualizowanymi sygnaturami — 839acb4

#### Manual

- [x] 1.4 brak zmian widocznych dla usera (refaktor wewnętrzny) — 839acb4

### Phase 2: Key Lookup + Endpoint Enforcement

#### Automated

- [x] 2.1 `npm run typecheck` — pass (nowe importy zgodne) — c8947f1
- [x] 2.2 `npm run lint` — pass — c8947f1
- [x] 2.3 unit testy process.ts — pass (happy path + NO_API_KEY path) — c8947f1
- [x] 2.4 unit testy refine.ts — pass (AI_DISABLED + NO_API_KEY + happy path) — c8947f1
- [x] 2.5 `npm run test` — pass — c8947f1

#### Manual

- [ ] 2.6 curl `POST /api/photos/<id>/process` bez klucza → 403 `NO_API_KEY`
- [ ] 2.7 curl `POST /api/detections/<id>/refine` bez klucza → 403 `NO_API_KEY`

### Phase 3: PhotoUploader Empty State

#### Automated

- [x] 3.1 `npm run typecheck` — pass — f71958b
- [x] 3.2 `npm run lint` — pass — f71958b

#### Manual

- [ ] 3.3 bez klucza → upload zdjęcia → error area z linkiem `/account` (NIE blokuje uploadu — adaptacja literalna: empty state zastąpiony NO_API_KEY po process)
- [ ] 3.4 z aktywnym kluczem → normalny upload UI + vision działa

### Phase 4: Tests + AGENTS.md

#### Automated

- [x] 4.1 `npm run test` — pass (nowe unit testy + zaktualizowane) — b6abd2f
- [x] 4.2 `npm run test:e2e` — pass (byok-enforcement: upload zawsze widoczny + NO_API_KEY error) — b6abd2f
- [x] 4.3 `npm run typecheck` — pass — b6abd2f
- [x] 4.4 `npm run lint` — pass — b6abd2f

#### Manual

- [ ] 4.5 full smoke: upload z kluczem Anthropic → detekcje → review → refine działa
- [ ] 4.6 flow: brak klucza → upload → error area z linkiem /account → dodaj klucz → upload działa
