# Documents

One row per document, what it is, who it is for, and its status.

| document | what it is | for | status |
| --- | --- | --- | --- |
| [`../packages/webmcp-profiler/README.md`](../packages/webmcp-profiler/README.md) | the profiler's user manual; also the npm page | anyone installing `webmcp-profiler` | landed, generated blocks kept current by CI |
| [`webmcp-profiler-0.2-spec.md`](./webmcp-profiler-0.2-spec.md) | the profiler's 0.2 release: every change, test, and app-side update | implementers of the package and the site | landed in 0.2.0 |
| [`webmcp-profiler-spec.md`](./webmcp-profiler-spec.md) | the profiler's long-range design beyond 0.2 | contributors deciding what to build next | design, partly built; §12 says what landed |
| [`performance-report.md`](./performance-report.md) | the only measured numbers: tools, boot, rendering, memory | anyone quoting a figure | snapshot at a named commit |
| [`user-flow.md`](./user-flow.md) | how a potter and an agent move through the site | product and copy | landed |
| [`live-sync-spec.md`](./live-sync-spec.md) | cross-device live sessions | implementers | landed |
| [`live-handoff-link-spec.md`](./live-handoff-link-spec.md) | the two link types and the docs guard | implementers | landed |
| [`../AGENTS.md`](../AGENTS.md) | how to work in this repository, for people and coding agents | contributors | landed |
| [`assets/`](./assets) | screenshots used by the README | | |

Conventions for specs: a status line (design / partly built / landed) with
the baseline commit; one "Changes since first draft" paragraph instead of
dated amendment blocks; every behaviour-changing section carries the
problem, the change, the acceptance criterion, and the app-side work; a
review-derived spec carries a traceability table.
