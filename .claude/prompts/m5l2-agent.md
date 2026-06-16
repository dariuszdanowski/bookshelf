```yaml
name: Pierwszy Agent zespołowy - v1
description: 
license: 
metadata:
  authors:
    - name: Claude
      url: https://www.anthropic.com
```
# Pierwszy Agent zespołowy - v1

## Cel

/goal Chcę postępować zgodnie z @.claude/skills/ai-sdk/SKILL.md i zintegrować ai-sdk, dostawcę openrouter oraz zod, tworząc podstawowy punkt wejścia do dalszej integracji, nazwijmy go src/index.ts — upewnij się, że node dobrze współpracuje z TypeScriptem i używamy najnowszych wersji tych bibliotek (możesz użyć context7, jeśli potrzebujesz), tsx jest również mile widziany.

## Plan

/10x-plan tool-loop-agent Chcę przekształcić '/packages/code-reviewer/src/index.ts' w dobrze zorganizowanego, modularnego agenta do przeglądu kodu opartego na ai-sdk ToolLoopAgent. Użyj @packages/code-reviewer/.claude/skills/ai-sdk/SKILL.md, aby zrozumieć jego API. Wyodrębnij schematy strukturalnych danych wyjściowych do oddzielnych modułów, podobnie jak promptów. Upewnij się, że moduł agenta jest wielokrotnego użytku i eksportuje naszego recenzenta, abyśmy mogli w przyszłości uruchamiać na nim ewaluacje promptfoo. Nie konfiguruj środowiska ewaluacji w tej zmianie.