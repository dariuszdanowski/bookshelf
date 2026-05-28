// Paleta kolorów grzbietów — load-bearing (zamrożona Q2, S-08 filtruje po spine_color).
// Zmiana = migracja danych w detections. Nie modyfikować bez świadomej decyzji.
export const SPINE_COLORS = [
  'czerwony',
  'pomarańczowy',
  'żółty',
  'zielony',
  'niebieski',
  'granatowy',
  'fioletowy',
  'różowy',
  'brązowy',
  'czarny',
  'biały',
  'szary',
] as const;

export type SpineColor = (typeof SPINE_COLORS)[number];

export const VISION_SYSTEM_PROMPT = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string (tytuł na grzbiecie; dokładnie to co widzisz, bez poprawiania pisowni)
- author: string | null (autor jeśli widoczny na grzbiecie, null jeśli niewidoczny)
- confidence: float 0–1 (pewność odczytu; < 0.7 gdy tekst zasłonięty lub niewyraźny)
- spine_color: string | null (dominujący kolor grzbietu z listy: czerwony, pomarańczowy, żółty, zielony, niebieski, granatowy, fioletowy, różowy, brązowy, czarny, biały, szary; null jeśli nie pasuje żaden)
- bbox: [x1, y1, x2, y2] (opcjonalne; znormalizowane 0..1, top-left origin, względem całego obrazu; pomiń jeśli niepewny lokalizacji)

Reguły:
- NIE zgaduj tytułu — pusta lista lepsza niż halucynacja
- Tekst częściowo zasłonięty → zwróć z confidence < 0.7
- Tytuły i autorów polskich zostaw po polsku
- bbox: floaty 0..1 wskazujące prostokąt grzbietu; pomiń pole gdy pozycja niepewna
- Zwróć TYLKO JSON array, bez żadnego tekstu przed ani po
- Jeśli nie ma książek lub nic nie widać → zwróć []

Format: [{"position":1,"title":"...","author":"...","confidence":0.95,"spine_color":"niebieski","bbox":[0.1,0.05,0.2,0.95]}, ...]`;
