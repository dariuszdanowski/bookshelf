# M3 Lessons Integration Plan

_Wygenerowano: 2026-06-02_

## Kontekst

Moduł 3 ("AI Development Quality & Maintenance") odblokowany 2026-06-01. Projekt jest w ~60% ukończeniu (19 z 32 slice'ów done). Dwa aktywne slice'y: S-16 (photo-dedup), S-21 (image-identification-dual-path).

## Co projekt już ma (nie trzeba dodawać)

- 97 testów jednostkowych (all green), 27 E2E, 3 integracyjne
- Playwright + Vitest + vitest.integration.config.ts — pełna infrastruktura
- CI/CD: GitHub Actions (lint → typecheck → testy → deploy + post-deploy smoke)
- CLAUDE.md z regułami testowania (sekcja `## Testy`)

## Czego brakuje (delta z M3)

- **Brak hooków** — żadnego lefthook/husky/lint-staged ani PostToolUse w .claude/settings.json
- **Brak test-plan.md** — strategia testów jest w CLAUDE.md, ale nie jako formalna mapa ryzyk
- **Brak CLAUDE-m3l3 i CLAUDE-m3l4 rule pointers** w CLAUDE.md

---

## Plan: co używać i kiedy

### Użyć przy najbliższym slice'u (S-16 lub S-21)

#### 1. PostToolUse hook — M3L3 (priorytet: WYSOKI)

Jeden edit w `.claude/settings.json`. Efekt: agent sam poprawia lint/type error w następnej iteracji zamiast zostawiać do CI.

**Co dodać:**
```json
"hooks": {
  "PostToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        { "type": "command", "command": "npm run lint --silent 2>&1 | head -20" },
        { "type": "command", "command": "npx vitest related --run 2>&1 | tail -10" }
      ]
    }
  ]
}
```

Uwaga: `npx vitest related` działa na zmienionych plikach — scoped, nie uruchamia całej suity.

#### 2. CLAUDE-m3l4 rule pointer — M3L4 (priorytet: WYSOKI)

Dodać do CLAUDE.md krótki blok przed nowym E2E testem (zwłaszcza dla S-21):

```md
## E2E (M3L4)
- Modele na seed.spec.ts z tests/e2e/
- getByRole > CSS/XPath
- test independence: każdy test niezależny od innych
- wait-for-state nie waitForTimeout
- Assertions biznesowe, nie implementacyjne
- Unikaj auto-heal na logice (naprawia selektory OK, maskuje błędy logiczne)
```

#### 3. Minimalna mapa ryzyk dla S-16 + S-21 (priorytet: ŚREDNI)

Nie pełny `/10x-test-plan` przez całe PRD, tylko:
- S-16 (photo-dedup): risk #1 — fałszywe duplikaty przy różnym oświetleniu; risk #2 — hash collision przy crop/resize
- S-21 (dual-path vision): risk #1 — fallback path nie uruchamia się przy timeout; risk #2 — oba wyniki sprzeczne bez resolvera

Można zapisać jako sekcję w `context/changes/photo-dedup/plan.md` i analogicznie dla S-21.

---

### Tylko certyfikacja (niski ROI dla tego projektu)

| Co | Dlaczego certyfikacja |
|---|---|
| Pełny `test-plan.md` via `/10x-test-plan` przez całe PRD | Projekt 60%+ done; risk map na gotowym kodzie to retrospektywa |
| Stryker mutation testing (M3L2) | 97 testów działa, solo MVP, brak zespołu wprowadzającego regresje |
| Pełny `/10x-tdd` workflow (M3L2) | TDD ma sens od początku; na gotowych slice'ach to przepisywanie |
| Lefthook/Husky pre-commit (M3L3) | CI blokuje; pre-commit dla solo dewelopera = narzut bez zysku |
| Sentry integration (M3L5) | Brak monitoringu w projekcie; dodanie tylko pod lekcję = overkill |
| MCP-based Playwright (M3L4) | 114K tokenów/scenariusz; Playwright CLI wystarcza, projekt ma już 27 E2E |

`m3l2-ad-hoc-testing` prompt — warto używać przy edge-case'ach w nowych slice'ach (nie jako obowiązkowy element flow).

---

## Kolejność działań

```
[ ] 1. Dodaj PostToolUse hook do .claude/settings.json           ← przed S-16
[ ] 2. Dodaj blok E2E rules do CLAUDE.md (M3L4)                  ← przed S-21
[ ] 3. Minimalna mapa ryzyk w plan.md S-16 i S-21                ← w trakcie planowania
[ ] 4. (certyfikacja) Pełny test-plan.md via /10x-test-plan      ← kiedy będziesz składać materiały
[ ] 5. (certyfikacja) Lefthook setup                             ← kiedy będziesz składać materiały
[ ] 6. (certyfikacja) Stryker na jednym module                   ← kiedy będziesz składać materiały
```

---

## Pozostałe slice'y (13 proposed)

S-14, S-15, S-16, S-17, S-19, S-20, S-21, S-22, S-23, S-24, S-26, S-27, S-28

Aktywne: S-16 (photo-dedup), S-21 (image-identification-dual-path).
