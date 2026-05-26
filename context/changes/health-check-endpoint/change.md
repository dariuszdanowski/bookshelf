---
change_id: health-check-endpoint
title: GET /api/health endpoint z F-02 envelope + middleware whitelist
status: in-progress
created: 2026-05-26
updated: 2026-05-26
archived_at: null
---

## Notes

S-11 w roadmapie (Stream E micro-slice bucket). Public GET endpoint zwracający `{data:{status:"ok",version,timestamp}}` używając F-02 `apiResponse` helper. Wymaga dodania `/api/health` do middleware `PUBLIC_EXACT` whitelist (single source of truth dla public paths). UWAGA: to JEDYNY slice w buckecie który tyka middleware — pozostałe 3 mają explicit instrukcję NIE tykać tego pliku.
