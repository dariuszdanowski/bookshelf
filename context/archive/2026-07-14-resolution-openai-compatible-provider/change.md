---
change_id: resolution-openai-compatible-provider
title: AI book resolution przez BYOK openai_compatible provider
status: archived
created: 2026-07-14
updated: 2026-07-14
archived_at: 2026-07-14T15:53:32Z
---

## Notes

Rozszerz AI book resolution (src/lib/resolution/client.ts, dziś zablokowane do providera anthropic z natywnym web_search) o branch openai_compatible (fetch do baseUrl/chat/completions, bez web_search tool, best-effort z wiedzy modelu), zdejmij blokadę w src/pages/api/detections/[id]/resolve.ts. Kontekst: user ma własny self-hosted OpenAI-compatible LLM relay (cf-llm-relay, potwierdzony działający model RAV_LAPTOP::Qwen/Qwen3.6-27B, dobra jakość identyfikacji książek w testach). Decyzja usera: pełne przełączenie bez logiki hybrydowej — jeśli aktywny klucz BYOK usera to openai_compatible, CAŁA ścieżka resolution idzie przez tego providera (tak jak już działa dziś dla vision/client.ts), zero specjalnego fallbacku do Anthropica. Vision już wspiera openai_compatible bez zmian kodu (istniejąca ścieżka w client.ts) — to NIE jest częścią tego change'a, tylko konfiguracja usera w /account/keys.

Ekonomia kosztu (zmierzona przez usera): resolution (AI search fallback) ~$0.20/książka vs vision ~$0.02/zdjęcie — 10x droższe per-unit, stąd priorytet na tej ścieżce a nie na vision.

Ograniczenie do zaadresowania w planie: brak web_search na openai_compatible oznacza, że resolution dla tego providera opiera się wyłącznie na wiedzy treningowej modelu — brak live-lookup. Jakość dla obskurnych/niszowych wydań (dokładnie tam, gdzie strukturalna kaskada już zawiodła) będzie słabsza niż Anthropic+web_search. User świadomie akceptuje to jako koszt pełnego przełączenia (brak hybrydy).

Empiryczne testy relaya (2026-07-14): RAV_LAPTOP::Qwen/Qwen3.6-27B odpowiada w 5-18s, poprawnie identyfikuje zaszumiony tytuł ("Zbrodni i kara Dostojewsk" → Zbrodnia i kara, Dostojewski) i poprawnie interpretuje obraz (image_url base64, format zgodny z istniejącym src/lib/vision/client.ts). Model Qwen3 ma tryb "thinking" zjadający dużo tokenów przed właściwą odpowiedzią — trzeba liczyć się z wyższym max_tokens / wymuszeniem trybu bez rozumowania w promptach resolution.

Gotcha operacyjne: węzły LM Studio na relayu ignorują pole `model` w request — odpowiada zawsze aktualnie załadowany model niezależnie od żądanego id. `/v1/models` to katalog dostępnych, nie aktywnych modeli.
