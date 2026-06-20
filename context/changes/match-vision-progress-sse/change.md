---
id: match-vision-progress-sse
title: Match & Vision Progress — SSE Streaming
status: implementing
created: 2026-06-19
updated: 2026-06-20
branch: change/match-vision-progress-sse
---

## Summary

Dodanie SSE streaming dla fazy dopasowywania (match) książek.
Zamiast indeterminate ProgressModal, użytkownik widzi listę tytułów pojawiających się jeden po drugim + determinate pasek X/total.

## Motivation

ProgressModal po slice progress-modal jest indeterminate — pasek pulsuje, brak tytułów, brak %.
Faza match jest naturalnym miejscem na real-progress: znamy N detekcji z góry, matchujemy po jednej.
