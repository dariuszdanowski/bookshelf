---
name: Refactor context/changes/{change-id}/research.md with ast-grep
description: Use ast-grep to validate structural claims in the research document and update it.
license: CC-BY-4.0
metadata:
  technologies:
    - ast-grep
  skill_level: Advanced
  time_estimate: 2h
  recommended_tools:
    - ast-grep
    - VS Code
---

Ulepszamy raport context/changes/{change-id}/research.md.

Najpierw wypisz z niego wszystkie twierdzenia STRUKTURALNE (liczby call-site'ów, "tylko tutaj", "zawsze przez X", liczność metod, powtarzające się kształty wywołań).

Dla każdego zbuduj wzorzec narzędzia ast-grep, następnie wywołaj je i przeanalizuj wyniki - powinny potwierdzać lub obalać początkowe twierdzenie z raportu.

Wynik podaj jako: twierdzenie -> potwierdzone / doprecyzowane / obalone, z dokładnymi plikami i liniami.

Na koniec zaktualizuj i skoryguj raport wynikami z ast-grep.