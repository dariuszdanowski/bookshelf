---
name: 10x-research post-flow-analysis
description: Analyze the post-saving process, paying particular attention to related areas defined in context/map/repo-map.md
license: CC BY-NC-ND 4.0
metadata:
  priority: 8
  tags:
    - research
    - post-flow
    - analysis
    - e2e
    - testing
    - blast-radius
---
/10x-research post-flow-analysis Analyze the post-saving process, paying particular attention to related areas defined in context/map/repo-map.md

Use three parallel sub-agents:

1.  Trace e2e: recreate the path from the entry point, through layers, to write/read
    and back. Provide a sequence of steps with file:line and a Mermaid diagram.
2.  Test gaps: which methods and branches on this path have coverage,
    and which do not.
3.  Blast radius: what needs to change together when this flow changes — seam
    interface, generated layers, model, migrations, tests. Combine a static graph
    with co-change from git history.

Focus solely on the analysis and description of the current state of the repository.

Your report must contain two explicit and critical sections:

1.  Feature overview
2.  Technical debt

Save the findings of the study to context/changes/post-flow-analysis/research.md
