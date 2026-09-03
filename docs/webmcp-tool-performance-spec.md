# WebMCP tool and performance specification

Status: implemented

Baseline: current main implementation at 1a2995d

Last verified: 2026-09-03 against src/mcp/tools.ts,
src/mcp/describe.ts, the profiler hooks, tests, and the WebMCP page

This document describes the tool surface that is actually shipped. The
performance rules are part of the contract because tool metadata and result
payloads are paid on every agent conversation.

## 1. Goals

The tool surface should let an agent complete the common design loop with
few round trips:

1. read the current design;
2. make a complete change in one mutation;
3. inspect the template or preview;
4. export the PDF;
5. hand the live design to the potter when requested.

Page-side computation is usually small compared with host and model
round-trip time. The important controls are therefore:

- one combined mutation tool;
- compact, structured results;
- truthful discovery metadata;
- no unnecessary token minting;
- lazy work for preview, profiler UI, and export-only code.

## 2. Tool inventory

There are 11 always-registered tools, in this order:

| Tool | Purpose | Input |
| --- | --- | --- |
| describe_project | complete current design and session snapshot | none |
| open_model | open a parameter link or query string | url |
| update_design | change any subset of form, clay, paper, units, or target capacity | partial update object |
| get_template_summary | layout, piece dimensions, notes, and page count | none |
| get_preview_image | compact image or text description of the 3D preview | none |
| export_templates | download the printable PDF | optional paperSize |
| apply_preset | replace the form and clay with a named preset | preset |
| create_live_handoff | mint a one-use live continuation link | none |
| join_session | join another device with its six-character code | code |
| start_pairing | mint a code and optional live link for this tab | none |
| undo_last_change | undo the latest form, clay, or paper change | none |

When the optional profiler is active, get_perf_report is appended as a
conditional twelfth tool. Its presence is gated by the profiler and is not
part of the unarmed discovery surface.

TOOL_SUMMARIES in src/mcp/tools.ts is the source for the WebMCP page's
human-facing list. The build and end-to-end checks independently verify the
registered names and count.

## 3. Shared input and state rules

All tool schemas are declared once with Zod and converted to JSON Schema
for registration. The same schema parses execution input. Validation bounds
therefore cannot drift between discovery and execution.

Numeric model dimensions are fired millimeters. Display units affect human
readable strings and the potter's preference only; tool input and numeric
output remain in millimeters.

The common design snapshot is:

    {
      form,
      clay,
      paperSize,
      units,
      designUrl,
      capacityMl,
      pieces,
      printedPages,
      warnings,
      session: { paired, peers }
    }

State-reporting tools return this snapshot after a successful mutation or
read. Validation failures normally include the unchanged snapshot.

## 4. update_design

update_design accepts any subset of the following in one call:

| Group | Fields and bounds |
| --- | --- |
| form | type round or faceted; tapered boolean; name 1 to 60 characters; heightMm 20 to 600; topDiameterMm and bottomDiameterMm 20 to 500; facets integer 3 to 8 |
| legacy form input | type cylinder means round and straight; type tapered means round and tapered |
| clay | shrinkagePct 0 to 25; wallThicknessMm 2 to 15 |
| display | units cm or in; display only |
| print | paperSize A4, A3, or Letter |
| volume | capacityMl 1 to 200000, used instead of heightMm |

The capacity solve uses the current diameters and clay settings after the
other supplied fields are applied. Height is solved directly from the
linear volume relationship; the agent must not iterate. Supplying both
heightMm and capacityMl is invalid. If the requested volume has no feasible
height, nothing is written.

The complete call is one undo scope. A no-op does not create an undo entry.
Display-unit changes are not part of model undo history. The store's
validated update path is shared with link opening and server patch
application.

## 5. Result contract

Every result is an object with a content array and the unchanged isError
flag convention. The additive structuredContent field follows contract
tool-result/2:

    {
      ok: boolean,
      message: string,
      ...
    }

ok is the inverse of isError. For state-reporting results, state in
structuredContent deep-equals the JSON snapshot in the text content and
warnings is included when non-empty. Agents should parse structuredContent
and treat the text as a readable fallback.

State-reporting tools are describe_project, open_model, update_design,
apply_preset, join_session, start_pairing, and undo_last_change.

The non-state result shapes are:

| Tool | Structured result |
| --- | --- |
| get_template_summary | ok, message, and the template summary |
| get_preview_image | ok, message, and summary; content also carries the image when capture succeeds |
| export_templates | ok, message, pages, paper, rows, cols, state, and warnings when present |
| create_live_handoff success | ok, message, liveHandoffUrl, designUrl, expiry fields, singleUse, instruction |
| create_live_handoff failure | exactly ok false and message; no state and no URL |

Cancellation returns exactly ok false and a cancellation message. A
cancelled call does not commit a mutation after the abort is observed.

## 6. Read, open, and visual tools

### 6.1 describe_project

Returns the whole current design, capacity, generated pieces, page count,
warnings, permanent designUrl, and session fact. It is pure: it does not
mint or prefetch a live token.

When session.paired is false, its description tells the agent to offer a
create_live_handoff link first and the six-character code second. The
alternative code path remains available even if a live handoff fails.

### 6.2 open_model

Accepts a full URL, an absolute URL from any origin, or a bare query
string. Recognized parameters include type, height, bottom, top, name,
shrinkage, wall, paper, and units. Unknown keys are ignored, malformed
values are dropped, missing values keep the current setting, and
out-of-range model values are clamped by the link parser.

The operation is one undo step and returns the resulting full snapshot.

### 6.3 get_template_summary

Returns the current paper size, overview/template/total page counts, tile
grid, layout dimensions, 10 mm glue overlap, each flat piece's kind and
dimensions, assembly notes, and warnings.

### 6.4 get_preview_image

Captures the latest rendered 3D canvas as a compact JPEG. The image is
limited to a 320-pixel maximum edge. If the canvas is unavailable, the
tool returns a successful text summary instead of pretending that an image
was captured.

## 7. Mutation, export, and undo tools

### 7.1 apply_preset

The preset enum is classic-mug, tumbler, bud-vase, and hex-planter. Applying
one replaces the form and clay settings with the preset/default values and
is one undo step.

### 7.2 export_templates

The optional paperSize is an export override. The PDF is generated against
that paper size. The store commits the paper-size preference only after a
successful, non-cancelled export; failure and cancellation cannot leave a
phantom paper-size edit.

The successful result reports page count, paper, and pagination rows and
columns beside the full state snapshot. The PDF is true-scale and includes
the overview, template tiles, glue overlaps, calibration marks, and the
parameter-only design QR.

### 7.3 undo_last_change

Undo reverts the latest form, clay, or paper change, regardless of whether
the change came from the agent, UI, link, preset, or live peer. Up to 50
history steps are retained. Display-unit preference is excluded from the
history.

## 8. Link and pairing performance rules

create_live_handoff is the only default agent link path. It waits for the
session socket and retries one time, then either returns a fresh
single-use liveHandoffUrl or fails with no URL. State reads never mint a
token. The permanent designUrl is not a live fallback.

start_pairing requests the code and live link in parallel. A successful
code mint remains useful if the optional link mint fails. The full pairing
contract is in live-handoff-link-spec.md.

## 9. Discovery and registration

The standards path is document.modelContext. The app also accepts legacy
navigator.modelContext and window.modelContext hosts, including the older
provideContext shape, so older hosts continue to work.

Registration is asynchronous and parallel where the host supports it. The
app keeps watching for a host or registry that appears after page load,
including when a hidden tab does not emit a visibility event.

The profiler can observe late registration. It does not add the report tool
unless it is active.

## 10. Payload and asset budgets

The text half of a state result is compact JSON preceded by a short message
when a message is useful. Structured content removes the need to duplicate
pretty-printed state. The preview image is intentionally bounded and
JPEG-encoded.

The discovery metadata test guards against accidental growth. The exact
budget is a test constant, not a user-facing promise; update it only when
the additional contract is intentional and the resulting conversation cost
has been reviewed.

Content-hashed files under /assets/ are served as public immutable assets
for one year by public/_headers. The HTML entry remains revalidated so a
new tool surface can be discovered after deployment.

## 11. Performance acceptance

The performance work is accepted when:

1. the common multi-field edit fits in one update_design call and one undo
   scope;
2. every registered input schema matches the parser that executes it;
3. state results are compact and structurally parseable;
4. no read path mints a session token;
5. preview and export-only code remain off the critical tool-registration
   path where practical;
6. late host discovery and registration do not require a page reload;
7. the unarmed app exposes 11 tools and the armed profiler adds only its
   conditional report tool;
8. build, lint, unit tests, docs checks, and the applicable browser/Worker
   checks agree with the contract.

## 12. Implementation notes

The main source locations are:

- src/mcp/tools.ts for descriptors, execution, and result envelopes;
- src/mcp/describe.ts for state and template serialization;
- src/mcp/modelContext.ts for the local WebMCP type and result contract;
- src/mcp/liveHandoff.ts for the live-link retry and fail-closed path;
- src/pages/agentManifest.ts for the machine-readable app manifest;
- src/lib/model/schemas.ts for shared input bounds;
- src/store/useProjectStore.ts for validated mutations and undo;
- src/lib/previewCapture.ts for image capture;
- public/_headers for asset caching.

## 13. Completed review items

The current surface has:

- one combined update tool instead of separate form, clay, units, and
  capacity mutations;
- direct capacity solving with atomic feasibility checks;
- full state beside compact text;
- a distinct permanent-link and live-handoff contract;
- cancellation-safe mutation and export paths;
- conditional profiler registration;
- late host discovery and parallel registration;
- immutable hashed asset caching.

These are implementation facts, not future work.

## 14. Traceability

| Requirement | Code or test |
| --- | --- |
| tool names and order | src/mcp/tools.ts, src/mcp/tools.test.ts |
| update bounds and capacity behavior | src/lib/model/schemas.ts, src/mcp/tools.test.ts |
| structured result parity | src/mcp/modelContext.ts, src/mcp/structuredResult.test.ts |
| link selection and failure | src/mcp/liveHandoff.ts, src/mcp/liveHandoff.test.ts |
| discovery and registration | src/mcp/register.ts and register tests |
| docs and metadata budget | src/mcp/docsGuard.test.ts |
| asset headers | public/_headers and Worker smoke checks |
| profiler-only tool | packages/webmcp-profiler/src/tool.ts and app tool tests |
