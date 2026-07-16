---
change_id: ai-resolution-search-tool
title: search_book tool dla AI-resolution (providerzy openai_compatible/openai/openrouter)
status: implementing
created: 2026-07-15
updated: 2026-07-15
---

## Notes

Realizacja Propozycji 1 z `modificationPlans/20260714-PROPOSAL-llm-book-search-extensions.md`
(sesja w `cf-llm-relay`, 2026-07-14/15). Luka: każdy model podpięty jako
`openai_compatible`/`openai`/`openrouter` w AI-resolution (`src/lib/resolution/client.ts`)
zgaduje wyłącznie z wiedzy treningowej, zero weryfikacji — w przeciwieństwie do Anthropic,
który ma natywny `web_search`. `findBookCandidates` (`src/lib/matching/findCandidates.ts`)
to gotowy, legalny silnik wyszukiwania (Google Books + Open Library + Biblioteka Narodowa) —
ten change owija go w narzędzie (`search_book`) wywoływane przez model w pętli tool-calling,
in-process, bez nowego endpointu HTTP.

Kontrakt narzędzia, pętla tool-calling, fallback bez `tools`, format promptu i ryzyka są już
rozpisane w dokumencie źródłowym (zweryfikowane 2026-07-15 jako wciąż aktualne względem kodu).
Propozycje 2-6 z tego samego dokumentu są świadomie poza zakresem tego change'a.
