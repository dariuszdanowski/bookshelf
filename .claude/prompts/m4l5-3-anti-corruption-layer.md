---
name: Domain-Driven Design Refactor Plan
description: A plan for refactoring to address leaky dependencies and broken domain layer boundaries using Domain-Driven Design principles.
---
You are working as a Domain-Driven Design specialist focused on identifying leaky dependencies and broken domain layer boundaries. The product is a refactoring PLAN, not an implementation — do not modify production code. Do not assume which dependency is leaking or what the entities are called — you need to DISCOVER and CHOOSE them. Steps: discovery → identification → classification → diagnosis → design.

STEP 0 — Discover the context.
- Read baseline documents, if they exist (prd.md / tech-stack.md / README).
  Pay attention to declarations about component interchangeability or that a certain entity
  is intentionally separated "to allow X to be replaced."
- Determine the stack, a list of external dependencies (package manifest), and code layers.

STEP 1 — IDENTIFY leaky dependencies.
- Find external dependencies that leak across layer boundaries. Signals:
  the same package imported in multiple layers (API + UI + service), duplicated
  reconstruction of library objects/types in several places, library types in
  domain signatures or in wire contracts (DTO/response), calling the
  same SDK on both sides of the client/server boundary.
- For each: list ALL files that "know" about it today (file:line).

STEP 2 — CLASSIFY and choose #1.
- Evaluate each axis: (a) number of layers/files affected, (b) risk/cost of replacing
  the library today, (c) whether documents declare it should be interchangeable (a discrepancy
  between intent-vs-code is a strong signal). Choose the worst leak. Justify.

STEP 3 — DIAGNOSIS.
- Show duplication (file:line citations) and leaks across boundaries — especially
  dangerous ones (e.g., a server library pulled into the client bundle). If a document
  declares interchangeability — cite it (file:line) and show that the code does not adhere to it.

STEP 4 — DESIGN ACL.
- Design a domain value object/entity that is the ONLY place of knowledge about
  the shape of the dependency (mapping from/to persistence, conversion to/from
  library type, domain operations). Show signatures + pseudocode.
- Define a NARROW port (domain interface) and an adapter implementing it through
  a specific library. The rest of the code only knows the port.

STEP 5 — Proof of isolation + before/after.
- Prove with a list that replacing the library only affects the adapter, not tables/API/UI.
- Before/after for duplicated places; show that the UI layer receives ready
  domain data, not a raw library object.
- If there are open questions dependent on the contract of this library — resolve
  them based on its documentation and indicate where to code the decision (in ACL, not in
  the API layer).

STEP 6 — Verification and plan.
- Success criterion: grep for the package name returns only files in the ACL/
  adapter directory. List which files currently know the dependency and which will not after refactoring.
- Phased plan consistent with the project convention.

CONSTRAINTS:
- Cite only verified file:line. Do not write production code.
- Save the document to: context/domain/03-anti-corruption-layer.md
  (frontmatter: title, created, type: refactor-plan).
- Return a 5-8 sentence summary at the end.

Save the result to context/domain/03-anti-corruption-layer.md