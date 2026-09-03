# Contributing to webmcp-profiler

The package lives as a workspace of the Unfolded repository and the site
imports its **source** (through the `@/profiler` alias), so every change
here is compiled, tested, and driven end to end by a real WebMCP site
before it is published. That is deliberate. The rules that keep it true:

- **Same pull request.** A change under `packages/webmcp-profiler/` ships
  with every app-side change it needs. The root `AGENTS.md` lists the
  files to review.
- **Whole-repo gate.** Before pushing, from the repository root:
  `npm run lint && npm test && npm run build && npm run e2e`.
- **The package never imports from the app.** `src/` may import only
  from `src/`.
- **Generated blocks are regenerated, never edited.** The README's
  `<!-- gen:* -->` blocks and `llms.txt` come from `src/core/docs.ts`;
  run `npm run docs` after a build. `npm run docs:check` is what CI runs.

## Fast inner loop

```
npm test --workspace webmcp-profiler          # unit tests (happy-dom where needed)
npm run build --workspace webmcp-profiler     # ESM, IIFE, declarations, bench
npm run size --workspace webmcp-profiler      # gzip ceilings
npm run docs --workspace webmcp-profiler      # regenerate README blocks and llms.txt
npm run example --workspace webmcp-profiler   # examples/vanilla in vite preview
```

The bench against a running site: `npx webmcp-profiler bench http://localhost:4173`.

## Layout

```
src/index.ts          attachProfiler, the Profiler API, exports
src/attach.ts         the sync ?perf= gate      src/attach-lazy.ts  the lazy one
src/gate.ts           gate decision logic (no core import)
src/tool.ts           profilerTool()            src/testing.ts      createFakeHost()
src/overlay.ts        the panel (lazy chunk)    src/docs.ts         sync docs entry
src/core/collector.ts spans, ledger, report     src/core/interceptor.ts  registry patching
src/core/docs.ts      the typed documentation source (lazy chunk)
src/core/text.ts      phase hints and report views (sync)
src/core/compare.ts   report diffs              src/core/trace.ts   Perfetto export
src/bench/            input generation and the Playwright runner (Node)
bin/                  the CLI                   schema/             report JSON Schema
scripts/              docs generation, size check, prepublish guard
examples/vanilla/     the demo page
```

## Releasing

Bump `version` in `package.json` and add the `## [x.y.z]` heading to
`CHANGELOG.md` in the same commit. A push to `main` that changes
`package.json` runs the publish workflow: tests, build, `publint`, docs
check, size check, a tarball smoke test, then `npm publish` with
provenance through trusted publishing. `prepublishOnly` refuses a dirty
tree and a version without a changelog heading.
