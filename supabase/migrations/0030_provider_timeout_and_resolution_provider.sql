-- resolution-openai-compatible-provider: per-klucz override timeoutu/limitu
-- tokenów (czytany przez vision i resolution openai-compat branche) +
-- kolumna provider w resolution_calls dla telemetrii per-provider.

alter table user_api_keys
  add column request_timeout_ms integer,
  add column max_tokens_override integer;

alter table resolution_calls
  add column provider text;
