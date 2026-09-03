# Working in this repository

Two things live here: **Unfolded**, a WebMCP-native pottery designer
(`src/`, `worker/`, deployed to tryunfolded.com), and **webmcp-profiler**
(`packages/webmcp-profiler/`), a zero-dependency npm package. The app
imports the package **source** through the `@/profiler` alias
(`vite.config.ts`, `tsconfig.app.json`), so the site is the package's
first consumer and its regression suite. Until the package moves to its
own repository, these rules hold.

## The same-pull-request rule

A change under `packages/webmcp-profiler/` lands in the same PR as every
app-side change it needs. Never leave the site on an older shape of the
package. Review this inventory on every profiler change:

- `src/main.tsx` (the boot gate call: `maybeAttachProfiler()`, no arguments)
- `src/pages/agentManifest.ts` (embeds the package's `describe()`; the
  `profilerNotes` block is the only hand-written part)
- `src/mcp/tools.ts` (`get_perf_report` is registered from `profilerTool()`)
- `src/pages/WebMCPPage.tsx` (profiler copy and links)
- `e2e/run.mjs` (uses `FAKE_HOST_INIT_SCRIPT`; the profiler checks)
- `e2e/perf.mjs` and `e2e/perf.cases.json` (the bench wrapper and its cases)
- `README.md` (profiler section; the docs guard caps the README at 2,800 words)
- `docs/performance-report.md` (numbers and claims)
- `.github/workflows/publish-profiler.yml` and `deploy.yml`
- `docs/webmcp-profiler-spec.md` §12 (what has landed)

## Commands

```
npm test --workspace webmcp-profiler                          # fast loop
npm run lint && npm test && npm run build && npm run e2e      # the gate, always before pushing
npm run build -w webmcp-profiler && npm run docs -w webmcp-profiler   # regenerate README blocks and llms.txt
```

The package's own tests are a subset of the root run, never a substitute.

## Rules that tests enforce

- The app imports the package only through `@/profiler/index`,
  `@/profiler/attach`, `@/profiler/tool`, `@/profiler/testing`, and
  `@/profiler/docs`; nothing deeper (`src/mcp/profilerBoundary.test.ts`).
- Generated blocks (`<!-- gen:* -->` in the package README, `llms.txt`)
  are regenerated, never edited (`npm run docs:check`).
- The package's sources never mention the app, the repo, or Unfolded
  (`packages/webmcp-profiler/src/hygiene.test.ts`).
- Retired claims stay retired in agent-facing copy
  (`src/mcp/docsGuard.test.ts`).
- The package has zero runtime dependencies (`package.test.ts`).

## Specs

`docs/README.md` indexes every document. A spec carries a status line
with its baseline commit and a "Changes since first draft" paragraph;
amendments go into git history, not dated blockquotes. The long-range
`docs/webmcp-profiler-spec.md` §12 is the single source of truth for what
has landed; when something lands, §12 gains a line.

## Releasing the package

Bump `version` in `packages/webmcp-profiler/package.json` and add the
matching `## [x.y.z]` heading to its `CHANGELOG.md` in one commit. A push
to `main` that changes that `package.json` publishes through trusted
publishing. No tokens exist anywhere.
