# Explorations

> **Status: exploration only.** Nothing in this directory is approved,
> scheduled, or a source of requirements. Do not implement any of it, in
> whole or in part, unless the repository owner explicitly decides to
> proceed and says so in a commit, an issue, or a pull request that names
> the document. Until then the current specifications in `docs/` remain
> the contract, and the code and tests remain authoritative.

An exploration is a written-out idea: enough detail to judge it, estimate
it, and argue with it, but deliberately not a plan of record. Each
document carries the banner above, a baseline commit, and a list of the
current specifications it would amend if it were ever built.

## Documents

| Document | Question it explores | Status |
| --- | --- | --- |
| [One Continue: overview and plan](unified-continue-overview.md) | Could pairing, WebMCP, codes, links, and cross-device continuation collapse into one invisible mechanism and one visible verb? | Exploration — not approved |
| [One Continue: what the person sees](unified-continue-ui.md) | The header control, the Continue sheet, the copy rules, and the failure states | Exploration — not approved |
| [One Continue: under the hood and the agent surface](unified-continue-protocol-and-tools.md) | The standing invitation, presence by actor, the tool contract that always carries a continuation link, and the performance case | Exploration — not approved |

## Rules for this directory

1. Every document here must appear in the table above and in
   `docs/README.md`.
2. Every document starts with the exploration banner and names the
   current specifications it would replace or amend.
3. An exploration never changes a current specification. Promotion is a
   separate, explicit decision; when it happens, the exploration is
   rewritten into the current specifications and this copy is deleted or
   marked superseded.
4. Tests, guards, generated blocks, and agent-facing copy never reference
   an exploration.
