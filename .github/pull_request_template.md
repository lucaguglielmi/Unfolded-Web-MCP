## What

<!-- one paragraph -->

## Checklist

- [ ] `npm run lint && npm test && npm run build && npm run e2e` green locally
- [ ] Touches `packages/webmcp-profiler/`? Then, in this PR:
  - [ ] app-side inventory in `AGENTS.md` reviewed and updated where needed
  - [ ] `npm run docs -w webmcp-profiler` run after the build (generated blocks, `llms.txt`)
  - [ ] `CHANGELOG.md` entry under `[Unreleased]` or the version being released
  - [ ] agent manifest unchanged, or regenerated from `describe()`
- [ ] Docs guard word ceiling respected if `README.md` changed
