# Wprowadzenie promptfoo do projektu

## Badania

/10x-research code-review-evals Przeanalizuj obecny stan '@packages/code-reviewer' w kontekście potencjalnego wprowadzenia ewaluacji – możliwość ponownego użycia promptów, importowalność agenta itp. Moim pierwszym wyborem dla zestawu narzędzi do ewaluacji jest promptfoo. Jeśli mój stos technologiczny jest zgodny z tym narzędziem, idź w tym kierunku. W przeciwnym razie możesz przeanalizować inne narzędzia OSS, które pozwolą mi ocenić moje prompty i agentów. Użyj wyszukiwarki internetowej lub context7, aby uzyskać najbardziej aktualną dokumentację.

## Plan

/10x-plan code-review-evals Zaplanuj, jak wprowadzić promptfoo w ramach '@packages/code-reviewer'. Moim celem jest stworzenie pierwszej konfiguracji, która pozwoli mi przetestować ten sam prompt do przeglądu kodu na trzech różnych modelach (z-ai/glm-5.1 i deepseek/deepseek-v4-flash). W przypadku testów powinien być jeden, raczej złożony diff migrujący komponent React 16 do React 19+ z trzema istotnymi błędami. LLM-as-a-judge powinien zweryfikować, czy wyniki przeglądu kodu poprawnie identyfikują, co jest zepsute. Możesz również dodać test statyczny weryfikujący, czy przegląd kodu faktycznie się nie powiódł.