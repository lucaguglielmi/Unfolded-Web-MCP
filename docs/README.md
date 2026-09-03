# Documentation map

This directory is the readable contract for the code in this repository. Current specifications describe shipped behavior. Reports preserve dated evidence. Release records explain how a feature reached its current shape.

## Current documents

| Document | What it answers | Status |
| --- | --- | --- |
| [Live Sync](live-sync-spec.md) | How browsers pair and synchronize a design | Implemented |
| [Live Handoff](live-handoff-link-spec.md) | How an agent creates a short-lived continuation link | Implemented |
| [Tool Performance](webmcp-tool-performance-spec.md) | What the WebMCP tools expose and how the hot paths are guarded | Implemented |
| [User Flow](user-flow.md) | What a person or agent sees during editing and pairing | Current guide |
| [Profiler](webmcp-profiler-spec.md) | The current optional profiler package and its roadmap | Current package spec |
| [Performance Evidence](performance-report.md) | The last recorded measurements and how to refresh them | Dated evidence |
| [Profiler 0.2 Release Record](webmcp-profiler-0.2-spec.md) | Historical context for the 0.2 release line | Historical |

## Explorations

Ideas that are written out in enough detail to judge, but are **not
approved, not scheduled, and not a source of requirements**. Nothing in
this section may be built unless the repository owner explicitly decides
to proceed. See [explorations/README.md](explorations/README.md).

| Document | Question it explores | Status |
| --- | --- | --- |
| [Explorations index](explorations/README.md) | What an exploration is and the rules for this directory | Exploration — not approved |
| [One Continue: overview and plan](explorations/unified-continue-overview.md) | Could pairing, WebMCP, codes, links, and cross-device continuation collapse into one invisible mechanism and one visible verb? | Exploration — not approved |
| [One Continue: what the person sees](explorations/unified-continue-ui.md) | The header control, the Continue sheet, the copy rules, and the failure states | Exploration — not approved |
| [One Continue: under the hood and the agent surface](explorations/unified-continue-protocol-and-tools.md) | The standing invitation, presence by actor, a tool contract that always carries a continuation link, and the performance case | Exploration — not approved |

## Related material

- diagrams/ contains source diagrams for the product and protocol.
- assets/ contains screenshots used by the repository documentation.
- The root [README](../README.md) is the public setup and usage guide.
- packages/webmcp-profiler/README.md is the package-facing API guide.
- packages/webmcp-profiler/llms.txt is generated package context for language models.

## How to read these documents

- “Implemented” means the behavior is present in the current source and covered by tests or an explicit runtime check.
- “Current” describes behavior that is useful to users but is not necessarily a protocol requirement.
- “Historical” is context only; it is not a source of new requirements.
- Numbers in a report are only meaningful with their commit, environment, and measurement date.
- “Exploration — not approved” is an idea under consideration. It describes nothing that exists and authorizes nothing to be built.

## Documentation rules

1. Every document in this directory must appear in this index.
2. Current specifications begin with status, baseline, and last-verified metadata.
3. Normative behavior belongs in a current specification. Retrospectives and old decisions belong in reports or release records.
4. The current profiler specification is the source of truth for future profiler work. The 0.2 document is retained as release history.
5. Generated documentation blocks must be updated through their generator, not edited by hand.
6. Explorations live under explorations/, carry the exploration banner, and never change a current specification. Promoting one is an explicit decision by the repository owner, recorded in the commit or pull request that rewrites it into the current specifications.
