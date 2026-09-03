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

## Documentation rules

1. Every document in this directory must appear in this index.
2. Current specifications begin with status, baseline, and last-verified metadata.
3. Normative behavior belongs in a current specification. Retrospectives and old decisions belong in reports or release records.
4. The current profiler specification is the source of truth for future profiler work. The 0.2 document is retained as release history.
5. Generated documentation blocks must be updated through their generator, not edited by hand.
