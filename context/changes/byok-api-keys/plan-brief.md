# Plan Brief — S-32 byok-api-keys

## Problem

Strona `/account` ma placeholder sekcji „Klucze API" (S-31). Użytkownik nie może
dodać własnego klucza API — pipeline vision zawsze używa klucza Anthropic z Worker
Secrets właściciela deploymentu.

## Solution

Tabela `user_api_keys` z szyfrowaniem AES-GCM (Web Crypto, klucz w Worker Secret
`USER_KEYS_ENCRYPTION_KEY`), CRUD + endpoint testowania klucza + UI w AccountIsland.

**Kluczowe decyzje:**
- Szyfrowanie: `crypto.subtle` AES-GCM (Vault wyłączony, pgcrypto ma typing issues z RPC)
- Model kluczy: wiele na usera, ≤1 aktywny (partial unique index `WHERE is_active = true`)
- Providery: `anthropic | openai | openrouter | openai_compatible`
- Test probe: GET /v1/models per provider — tani, nie generuje kosztów LLM
- Plaintext nigdy w odpowiedzi API — decrypt tylko server-side do testu/pipeline

## Phases

1. **Backend** — migracja + crypto helpers + API endpoints (GET/POST/PATCH/DELETE + test)
2. **Frontend** — AccountIsland: zastąp placeholder pełną sekcją + E2E tests
