# Unfolded — WebMCP and Hackathon Hardening Specification

Status: **proposed, amended after review — early items landing**  
Baseline: `main` at `bdf87d0` (`docs: remove stale project plan`)  
Submission deadline: **2026-09-03 22:00 CEST**  

> **Amendments (2026-09-01 review).** Verified against the code: 6.4's
> `cereal-bowl` bug, 7.1's dead PLAN.md link, and 8.1's `Math.random`
> code path are all real (fixed where five-minute-sized). Corrections
> recorded inline below: 4.3 dual-publishes titles, 4.5's premise is
> narrowed to what is actually missing, 5.1/5.2 credit the recovery
> work already shipped, 6.3/12 resolve their contradiction on the
> pairing gate, 9.1 gains a measurable prerequisite, and 8.4 notes the
> committed `.env` holds only a public value. New: §5.3, the combined
> connection button (WebMCP + pairing status in one control).

## 1. Purpose

This specification turns the 2026-09-01 repository, live-product, WebMCP,
testing, and hackathon-compliance review into ordered implementation work.

The product already works: ChatGPT discovered all 13 site tools in production,
representative read and mutation calls succeeded, the build passed, all 190
unit tests passed, and the latest deployment workflow was green. The goal is
therefore not to redesign Unfolded. The goal is to:

1. align registration and tool metadata with the current WebMCP contract;
2. make failure states safe and legible in constrained judge browsers;
3. make the distinctive live-collaboration paths part of the release gate;
4. remove judge-facing ambiguity from the repository and submission;
5. leave lower-risk security and performance work clearly sequenced.

## 2. Scope and non-goals

### In scope

- `src/mcp/` registration lifecycle, types, metadata, cancellation, and errors;
- WebGL-unavailable and preview-error behavior;
- WebMCP, Worker, pairing, performance, and browser test coverage;
- README, judge instructions, repository presentation, video, and Devpost tasks;
- focused security and performance hardening that does not alter the product
  concept.

### Explicitly out of scope before submission

- new form families, curved-profile editing, gores, bands, handles, or boxes;
- a general-purpose 3D editor;
- changing the geometry formulas or printable-template vocabulary;
- renaming or merging the 13 public tool names;
- changing share-link query parameters;
- redesigning the application shell;
- replacing Cloudflare, React, Zustand, Three.js, or the PDF pipeline;
- adopting declarative or iframe WebMCP APIs, which ChatGPT's built-in browser
  does not currently support.

## 3. Delivery rules

- Work in the priority order below. P0 must be green before the demo is
  recorded. P1 must not delay the video or Devpost submission.
- Prefer one reviewable commit per numbered item. Closely coupled tests land in
  the same commit as their implementation.
- Preserve current public tool names, input schemas, result shapes, share-link
  parameters, storage keys, PDF dimensions, and agent connection semantics
  unless an item explicitly authorizes a change.
- Every implementation commit must pass:

  ```bash
  npm run lint
  npm test
  npm run build
  npm run e2e
  ```

- Commits touching the Worker or live sessions must additionally pass:

  ```bash
  npm run e2e:worker
  npm run e2e:pairing
  ```

- Do not record the final video against an uncommitted or untested build.
- If a standards change creates uncertainty in ChatGPT, keep the production-
  proven behavior and document the compatibility decision rather than taking a
  speculative rewrite into the submission.

---

## 4. P0 — current WebMCP contract alignment

> **Status (2026-09-01): 4.1–4.5 implemented**, with 6.1's
> standards-realistic fakes landed in the same pass. Registration is
> awaited/all-or-nothing/cancellable (`src/mcp/register.ts` +
> `useWebMCP.ts`, unit-tested against delayed/rejecting/aborting fakes);
> types model the current draft with the legacy surface quarantined
> (`modelContext.ts`); titles are top-level and dual-published, non-current
> hints dropped; every execute takes the host's cancellation signal, which
> reaches the pairing claim fetch; validation errors carry per-field
> issues, received values, and the unchanged state. New e2e checks cover
> descriptor conformity and host registry replacement.

### 4.1 Await registration and own its lifecycle

Current issue: `src/mcp/useWebMCP.ts` loops over `registerTool(tool)` without
awaiting the returned promises, then marks registration successful immediately.
It also relies on a module-global `registered` flag and a custom optional
`unregister()` return handle.

Required change:

- Make registration an async, all-or-nothing operation.
- Create one `AbortController` for a complete set of tool registrations.
- Await every `document.modelContext.registerTool(tool, { signal })` call.
- Mark the connection as active only after all registrations resolve.
- If any registration rejects, abort that registration set, report the failure,
  and leave the watcher eligible to retry.
- Abort the active controller on React cleanup.
- Track the identity of the registered `modelContext`. If the host replaces the
  object, abort the old registrations and register against the new context.
- Do not let two polling/focus/visibility attempts register concurrently.
- Suspend the heartbeat while `document.hidden`; immediately retry on focus or
  `visibilitychange`.

Acceptance criteria:

- A fake host whose registration promises resolve one at a time never produces
  an active badge before the final promise resolves.
- A rejection on tool N aborts tools 1…N−1 and permits one clean retry without
  duplicate-name errors.
- Unmount aborts the registrations exactly once.
- Replacing `document.modelContext` causes one clean re-registration.
- Late host injection still works.
- The production tool list still contains exactly the expected 13 names.

### 4.2 Replace the hand-written proposal contract

Current issue: `src/mcp/modelContext.ts` models an older proposal, including a
synchronous/unknown registration return and a returned unregister handle.

Required change:

- Prefer the maintained `webmcp-types` package if its pinned version matches
  the target ChatGPT and Chrome implementations.
- Otherwise, keep a minimal local compatibility declaration that exactly models
  the current interfaces used by Unfolded, with a comment linking to the
  relevant draft revision.
- Treat `document.modelContext` as the standards path.
- Keep `navigator.modelContext`, `window.modelContext`, and `provideContext`
  only in a clearly named legacy compatibility adapter. Do not describe those
  fallbacks as part of the current standard.

Acceptance criteria:

- TypeScript requires registration to be awaited.
- TypeScript exposes registration and execution cancellation signals.
- No production code expects a returned `unregister()` method.
- The README and `/webmcp` page distinguish the current path from legacy host
  compatibility.

### 4.3 Correct tool titles and annotations

Current issue: titles are nested inside `annotations`; several MCP-server hints
are supplied even though the current WebMCP annotations surface supports
`readOnlyHint` and `untrustedContentHint`. In the reviewed live host, titles and
unsupported hints were discarded.

Required change:

- Move each human-readable `title` to the top level of its tool descriptor,
  and ALSO keep `annotations.title` — MCP-style hosts read the nested form,
  current WebMCP hosts the top-level one; dual-publishing costs bytes, not
  correctness, and matches §3's compatibility rule.
- Send only current WebMCP annotation fields to `registerTool` (plus the
  nested title above).
- Keep unsupported internal concepts such as idempotence or destructiveness in
  application-owned metadata only if the UI or tests actually use them.
- Mark only non-mutating tools read-only:
  - `describe_project`
  - `get_template_summary`
  - `get_preview_image`
- Review whether any result contains third-party or externally sourced
  untrusted content. Do not set `untrustedContentHint` mechanically.

Acceptance criteria:

- The ChatGPT site-tools inspector displays useful titles.
- The host-visible descriptor snapshots contain no unsupported annotations.
- Read-only counts match actual behavior.
- Tool descriptions still state consequential side effects such as PDF download,
  state replacement, pairing, preset replacement, and undo.

### 4.4 Thread cancellation through tool execution

Required change:

- Accept the execution options argument and its `signal` in every tool handler.
- Pass cancellation to network-backed pairing/join work.
- Check cancellation at safe points in longer export or preview work.
- Return a consistent cancelled result when the host aborts; do not commit a
  late state mutation after cancellation.

Acceptance criteria:

- Cancelling a pending pairing request stops its fetch/work and does not mutate
  the session state afterward.
- Cancelling a read tool does not convert into an unexplained application error.
- Tests leave no unhandled promise rejections.

### 4.5 Improve validation errors without changing schemas

Current issue (narrowed on review): the main Zod path already formats
per-field issue paths and messages and appends the unchanged state —
`Invalid input:\n<path>: <message>… Current state unchanged: …`. What is
actually missing: accepted ranges/enums are not always spelled out, and a
few non-Zod paths (e.g. pairing-code shape checks) answer tersely. Audit
and enrich; do not rebuild.

Required change:

- Preserve the existing Zod schemas and bounds.
- Format relevant issue paths, received values, and accepted ranges/enums into a
  compact agent-readable error.
- Continue returning the unchanged current state after a rejected mutation.
- Never echo tokens, internal stack traces, or unrelated state.

Acceptance criteria:

- An invalid height identifies `heightMm`, its accepted range, and the rejected
  value.
- An invalid enum lists allowed values.
- The state before and after every rejected mutation is identical.

---

## 5. P0 — browser resilience and preview truthfulness

### 5.1 Add a visible no-WebGL fallback

Observed issue: the review browser could not create a WebGL context. The
`get_preview_image` tool honestly returned a text fallback, but the human-facing
3D area did not provide an equally clear recovery state.

> Amendment: much of this shipped at `f5f06d5`/`9cd5b62` — the boundary now
> distinguishes true no-WebGL (honest message, no useless retry) from
> transient GPU reclaim (auto-retry on visibility, capped, plus a
> "Wake the preview" button), and a silent context loss remounts the canvas
> on return to the tab. Remaining from this item: the 2D silhouette /
> template thumbnail in the fallback, and routing both failure paths through
> one shared component (5.2).

Required change:

- Detect WebGL initialization failure and context loss.
- Keep parameters, template layout, share links, and PDF export operational.
- Replace the failed canvas with a designed fallback containing:
  - `3D preview unavailable in this browser`;
  - reassurance that dimensions and templates still work;
  - a lightweight 2D silhouette or template thumbnail when inexpensive;
  - a retry control only when retrying can genuinely help.
- Make `get_preview_image` return a compact structured/text explanation of the
  same state rather than implying an image was captured.

Acceptance criteria:

- Forcing `canvas.getContext()` to fail never leaves a blank primary region.
- The parameter panel, template panel, WebMCP mutations, and PDF export continue
  to work.
- The fallback is usable on mobile and meets color-contrast requirements.
- The browser console contains one actionable error, not a repeated error loop.

### 5.2 Preserve the viewport error boundary

- Verify `ViewportErrorBoundary` catches initialization, rendering, and context-
  loss exceptions without unmounting the rest of the app.
- Route it to the same fallback component as 5.1 so there is one truthful error
  experience.

### 5.3 One connection button: WebMCP + pairing status together

Owner-authorized UI change (explicitly amends §2's "no shell redesign" for
this one control). The separate WebMCP pill, sync badge, and pair-dialog
trigger merge into a single header **connection button** carrying two status
dots — agent (WebMCP) and live sync — so both connection stories live in one
glanceable, tappable place on every screen size.

- The button shows two dots at all times: agent (pulsing green = tools
  registered here; solid green = arrived via an agent link; grey = no host)
  and sync (green = live peers; amber = reconnecting; grey = paired alone or
  not paired). Its label states the most informative current fact.
- Tapping opens a panel that explains BOTH states in plain language for the
  current browser situation (ChatGPT in-app, native WebMCP, plain browser),
  offers **Continue on another screen** (the pairing dialog) and the
  **About WebMCP** link, and surfaces the last agent call when present.
  (Amendment, implemented: the link now reads "How does it work", and the
  no-agent state adds two buttons in the Continue action's style — **Open
  in ChatGPT**, a `chatgpt.com/?q=` link that injects a ready-made prompt
  carrying a fresh single-use pairing code so the agent both opens the site
  and joins the session, and **Copy prompt** with the same text for any
  other assistant. The Chrome flag hint lives solely in the dedicated
  nudge banner.)
- The honesty rules are inherited unchanged: agent state never inferred from
  user agent; pairing never claimed for a session no second device joined.
- Tests and docs that anchored on the old pill/badge selectors update in the
  same commit.
- Replace the deprecated Three.js clock API in a later compatibility commit;
  do not combine that dependency-facing change with the fallback.
  (Amendment: verify first — no `THREE.Clock` usage exists in the viewport
  code; frame deltas come from react-three-fiber's `useFrame`. This may be a
  phantom item.)

---

## 6. P0 — release and regression coverage

### 6.1 Make the registration fake standards-realistic

Current issue: the E2E host fake registers synchronously, masking promise,
rejection, cancellation, and partial-registration defects.

Required change:

- Make the fake `registerTool` async and return a promise.
- Support deterministic delayed resolution and injected rejection.
- Record the registration options signal and simulate abort-driven removal.
- Add coverage for context replacement and page visibility transitions.

### 6.2 Test consecutive URL-changing mutations

Observed issue: reusing previously discovered host handles after a URL-changing
mutation produced a stale security-context error in one live browser; fresh tool
discovery fixed it.

Required change:

- Add a real browser regression that performs multiple consecutive mutations
  while URL synchronization is enabled.
- Test both host behaviors: rediscovery between calls and reuse of an existing
  registered descriptor where supported.
- Do not weaken URL state synchronization merely to satisfy the fake host.

Acceptance criteria:

- At least five consecutive mutations produce the correct final state and URL.
- No tool is duplicated and no stale mutation lands after navigation/context
  replacement.

### 6.3 Gate Worker and pairing behavior in deployment CI

Current issue: `deploy.yml` runs `npm run e2e`, but the distinctive Worker and
cross-device paths are separate commands and are not deployment gates.

Required change (amended to resolve the contradiction with §12):

- Add `npm run e2e:worker` to deployment CI as a **hard gate**.
- Add `npm run e2e:pairing` to CI **non-blocking first** (visible red that
  does not stop deploys); promote it to a hard gate only after a streak of
  green runs proves determinism. Rationale: the pairing suite needs a local
  `wrangler dev` with Durable Objects and is the flakiest suite in the repo —
  a hard gate that turns flaky the day before the deadline would block
  emergency deploys, the worst failure mode near submission.
- Keep failure logs and Playwright artifacts available from the workflow.
- If pairing proves flaky, fix determinism; do not silently remove the check.

Acceptance criteria:

- A broken Worker join-token path blocks deployment.
- A broken two-client state propagation path is loudly visible in CI, and
  blocks deployment once the pairing gate is promoted.
- The normal deployment remains within a reasonable hackathon feedback cycle.

### 6.4 Close current test-quality gaps

- Replace the nonexistent `cereal-bowl` preset in `e2e/perf.mjs` with a real
  preset so the benchmark does not measure an error path on alternate runs.
- Add an actual assertion that a human edit from the visible tab reaches the
  agent's next read; do not leave this behavior as a comment-only claim.
- Keep `EXPECTED_TOOLS` independent from production metadata so adding or
  removing a public tool requires an explicit contract update.

---

## 7. P0 — judge-facing repository and submission

### 7.1 Repair and strengthen the README

Current issue: `PLAN.md` was removed at `bdf87d0`, but the README still links to
it. Run instructions also omit the browser binary and extended E2E commands.

Required change:

- Remove the broken `PLAN.md` link.
- Put the production URL near the title: `https://tryunfolded.com`.
- Add a **Judge in 60 seconds** section with:

  ```bash
  npm ci
  npx playwright install chromium
  npm run lint
  npm test
  npm run build
  npm run e2e
  ```

- Document `e2e:worker` and `e2e:pairing` separately, including how their local
  Worker is started.
- Give three exact ChatGPT prompts and state the expected visible/tool outcome.
- Describe current-standard registration accurately after section 4 lands.
- Keep the existing explanation of the pottery problem, shrinkage correction,
  mid-surface development, capacity solver, and human-agent parity.

Acceptance criteria:

- Every README link resolves.
- A clean checkout can execute the documented commands without guessing.
- A judge can find the live app, source, license, test instructions, WebMCP tool
  list, and three demo prompts in under one minute.

### 7.2 Improve repository presentation

These are manual GitHub metadata/content tasks, not application behavior:

- Set the repository website to `https://tryunfolded.com`.
- Add topics: `webmcp`, `pottery`, `threejs`, `react`, and
  `cloudflare-workers`.
- Add one compressed screenshot showing the form, unfolded pieces, WebMCP badge,
  and printable output. Store only assets with clear ownership.
- Confirm GitHub continues to detect the MIT license in the About panel.

### 7.3 Complete the Devpost written submission

The final entry must explicitly answer, in the first person because this is a
solo project:

1. Why WebMCP is a strong fit for structured parametric design.
2. How it improves on manual UI manipulation or DOM guessing.
3. What the potter and agent can accomplish together that was previously
   difficult: conversational sizing plus visible, editable, printable geometry.
4. How it was implemented: shared Zustand actions, validated tool schemas,
   closed-form geometry, client-side PDF, and optional live-device pairing.

Also verify:

- public repository and MIT license;
- working unrestricted live URL;
- English materials;
- project availability through the end of judging on 2026-09-21;
- no unlicensed music, trademarks, or third-party assets in the submission.

### 7.4 Record the final video only after P0 is green

Target duration: **2:45–2:55**, public YouTube, with clear audio.

Suggested sequence:

1. `0:00–0:15` — cereal-box template problem and the two hidden calculations.
2. `0:15–0:35` — app, live form, templates, and WebMCP-active state.
3. `0:35–1:20` — ask for a tapered 350 ml form with a named clay shrinkage;
   show one agent operation updating UI, geometry, and capacity.
4. `1:20–1:40` — make one human edit and let the agent read it back, proving
   that both actors share the same state.
5. `1:40–2:05` — preview plus template summary.
6. `2:05–2:30` — export and show the calibration ruler and page tiling.
7. `2:30–2:50` — printed/taped plan or clay result and the closing WebMCP line.

Pairing is optional in the video. Include it only if it rehearses reliably and
does not obscure the primary design-to-physical-template story.

---

## 8. P1 — security and operational hardening

P1 starts only after the final video and submission assets are safe.

### 8.1 Use cryptographic randomness for spoken codes

- Replace `Math.random()` in pairing-code generation with
  `crypto.getRandomValues()` and unbiased alphabet selection.
- Preserve code length, readability, expiry, rate limiting, and single-use
  semantics unless a separate threat analysis justifies a contract change.
- Add collision and alphabet tests; do not claim a statistical security level
  that the short human-readable code cannot provide.

### 8.2 Review browser and Worker security headers

Evaluate and test, rather than blindly add:

- `Origin-Agent-Cluster: ?1`;
- `Permissions-Policy: tools=(self)`;
- a deployment-appropriate CSP;
- `Referrer-Policy` and related baseline headers.

Acceptance criteria:

- ChatGPT still discovers and invokes all tools.
- Chrome's current WebMCP testing path still works.
- Three.js, PDF generation, QR generation, and WebSocket pairing are not blocked.
- Header behavior is verified on the production response, not only in source.

### 8.3 Document the live-session threat model

- State that session identifiers are bearer capabilities.
- Document join-token and spoken-code expiry, single-use behavior, rate limits,
  idle expiry, and data stored by the Durable Object.
- Review `Origin` handling for WebSocket/fetch requests.
- Confirm tool results do not expose durable capabilities or unnecessary tokens.
- Keep pottery parameters classified as low-sensitivity data; do not imply that
  this design is suitable for secrets.

### 8.4 Environment-file hygiene

(Amendment: verified — the committed `.env` contains only the public
`VITE_SITE_URL` with a comment saying exactly that. Correct hygiene, zero
urgency; nothing secret is exposed today.)

- Add `.env*` to `.gitignore` with an explicit exception for `.env.example`.
- Move the public `VITE_SITE_URL` example to `.env.example` and document that
  Vite-prefixed variables are client-visible.
- Do not rewrite deployment configuration unless this can land without risk.

---

## 9. P1 — payload and performance work

### 9.1 Reduce discovery metadata without losing semantics

The reviewed 13-tool surface exposed roughly 14,000 characters of metadata.

- Establish a metadata snapshot/budget in the profiler or tests.
- Shorten repeated explanations, especially in `update_form` and `set_units`.
- Keep bounds and nuanced behavior in JSON Schema and concise property
  descriptions rather than repeating them in the tool description.
- Preserve side effects, unit conventions, and return semantics.

Target: reduce estimated discovery tokens by **25% or more** with no measurable
drop in correct tool selection in the standard prompt suite.

> Amendment: no standard prompt suite exists yet, which makes the criterion
> unfalsifiable and invites trimming the exact prose that makes agents call
> `set_capacity` instead of guess-looping `update_form`. Prerequisite: build
> the small prompt suite first; until it exists the 25% figure is advisory —
> trim obvious repetition, keep every behavioral-contract sentence.
>
> **Done (2026-09-01), in that order**: `src/mcp/promptSuite.test.ts` — 13
> prompts mapped to expected tools with required routing phrases, plus a
> 9,800-char metadata budget — landed first; the trim then cut 11,360 →
> 9,128 chars (−19.6%, ~560 tokens per conversation), mostly by removing
> description text that duplicated the input schemas and zod's `$schema`
> boilerplate. The suite caught and reverted two over-trims during the
> work. The last ~5% to 25% would cut protected contract sentences —
> stopped deliberately. Full numbers: docs/performance-report.md.

### 9.2 Review the 3D bundle

The review build reported the lazy viewport chunk at approximately 938 KB
minified / 251 KB gzip.

- Measure cold load on a mid-range mobile device and in ChatGPT before changing
  imports.
- Audit Three.js/drei imports and optional helpers.
- Preserve lazy loading and avoid preloading GPU work on browsers that cannot
  use it.
- Set performance budgets for shell interaction and time-to-preview rather than
  optimizing bundle size in isolation.

### 9.3 Keep structured-result migration post-submission

The current MCP-style text/content envelope works in ChatGPT. Native structured
WebMCP objects would be cleaner for many text tools, but changing result shapes
immediately before submission adds compatibility risk.

After submission:

- prototype `{ ok, message, state, warnings }` results for text tools;
- retain appropriate image content for preview results;
- measure payload bytes and model usability;
- migrate only with compatibility tests for ChatGPT and Chrome;
- version or document the result contract if external users may rely on it.

---

## 10. Manual validation matrix

| Environment | Required checks |
| --- | --- |
| ChatGPT built-in browser, GPT-5.6 Sol/Terra | 13 tools discovered; titles visible; read/mutate/solve/undo/export; consecutive mutations; human edit read-back |
| Chrome with current WebMCP testing support | registration, inspector metadata, cancellation smoke test, URL synchronization |
| Browser without WebGL | designed fallback; all non-3D functionality remains usable |
| Mobile browser | core editing, template navigation, share link, fallback layout, no accidental horizontal overflow |
| Two browser clients | link/code join, bidirectional state propagation, reconnect/convergence, invitation expiry |
| Real printer at 100% | calibration bar measured with a ruler, tiled pages align, one paper template assembled |

Record the tested browser/app versions and the final production commit in the
submission notes.

## 11. Implementation order and stop rules

1. Sections 4.1–4.4: registration, types, descriptors, cancellation.
2. Section 6.1 and 6.2: tests that prove the new lifecycle and chained calls.
3. Section 5: truthful no-WebGL/error experience.
4. Sections 6.3–6.4: Worker/pairing gates and current test gaps.
5. Section 7.1: README and judge quick start.
6. Run the complete automated and manual validation matrix.
7. Record the video and complete Devpost.
8. Only then consider P1 items.

Stop and preserve the last green commit if:

- ChatGPT tool discovery becomes unreliable;
- PDF scale/output changes unexpectedly;
- live pairing becomes flaky close to recording;
- a P1 improvement threatens the submission timeline.

## 12. P0 definition of done

P0 is complete when all of the following are true:

- registration is awaited, cancellable, retryable, and cleanup-safe;
- current tool titles and annotations appear correctly in the host inspector;
- all 13 existing tools retain their public names and behavior;
- validation errors are actionable and rejected mutations are atomic;
- no-WebGL browsers show a useful fallback instead of a blank preview;
- the standard and Worker suites pass as deployment gates; the pairing suite
  runs in CI (non-blocking until promoted per amended 6.3);
- the README contains no broken plan link and provides reproducible judge steps;
- consecutive live mutations work in ChatGPT without stale state;
- a real print calibration check has passed;
- the final video, Devpost fields, public repository, license, and live URL have
  been verified before the deadline.

## 13. References

- OpenAI Site Tools documentation:
  <https://learn.chatgpt.com/docs/webmcp>
- WebMCP Draft Community Group Report:
  <https://webmachinelearning.github.io/webmcp/>
- Chrome WebMCP imperative API guide:
  <https://developer.chrome.com/docs/ai/webmcp/imperative-api>
- WebMCP Challenge rules:
  <https://webmcp.devpost.com/rules>
- WebMCP Challenge dates:
  <https://webmcp.devpost.com/details/dates>

