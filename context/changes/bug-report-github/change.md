# bug-report-github

**Status:** implementing
**Updated:** 2026-06-18

## Opis

In-app formularz zgłaszania błędów → GitHub Issues API. Przycisk "Zgłoś błąd" w headerze (obok Help), modal z tytułem i opisem, POST do `/api/feedback` → GitHub Issues REST API. BYOK GITHUB_TOKEN (Worker secret).

## Zakres

- `POST /api/feedback` endpoint
- `BugReportModal.tsx` React island
- Trigger button w `Layout.astro` (obok Help)
- E2E test (mock GitHub API)
- GITHUB_TOKEN jako Worker secret

## Poza zakresem

- Anonimowe zgłoszenia
- Przesyłanie screenshotów
- Rate limiting w DB
- Customowe labels per kategoria błędu
