# Korpus referencyjny bbox — provenance

3 zdjęcia różnego rodzaju dostarczone przez usera (2026-06-08) jako ground-truth dla
walidacji jakości bbox (S-40). **Obrazy NIE są commitowane** (realne wnętrza usera —
prywatność, repo idzie na public; zob. `.gitignore`). Commitowane są tylko współrzędne:
`*.json` (ground-truth) + `results.md` (benchmark).

| Plik lokalny | Typ | Photo ID (prod) |
| --- | --- | --- |
| `01-shelf-vertical.jpg` | klasyczna półka, książki pionowo | b79f3a02-e56d-4b81-a339-2f780eed3f2d |
| `02-mixed.jpg` | mieszane: poziome + pionowe | 5b18b976-cf03-42f0-8617-070283c2d5a0 |
| `03-bed-nonshelf.jpg` | non-shelf: książki na łóżku | 7cb7193d-2edc-4d54-9a99-c94b278588b3 |

Źródło: Supabase Storage (bucket `shelf-photos`), pobrane service-role z `.dev.vars`.
Ground-truth bboxy anotowane przez agenta (Read tool) — patrz `<photo>.json`.

**Reminder produktowy (reframe):** niezmiennik bbox = ciasny obrys WIDOCZNEGO obiektu
książki, surface-agnostic (półka / stos / koc), per-book niezależne współrzędne. NIE „sięgnij deski".
