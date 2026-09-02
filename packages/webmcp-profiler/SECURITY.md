# Security

## What the profiler holds

- Spans carry sizes, shapes, timings, tool names, and (per `errorPolicy`)
  error messages capped at 200 characters. Never input or result bodies,
  never stack traces, never user identifiers. A test enforces it.
- Nothing leaves the browser: the relay is a same-origin
  `BroadcastChannel`, `export()` is a download.
- Any same-origin script or tab can read the global and the relay. For
  production telemetry through `onSpan`, use `globalName: false` and
  `relay: false`.
- The gate's `allow` predicate is the site's last word on who can arm
  profiling; unknown `?perf=` values are never persisted.
- Relay input is validated and capped before it is rendered; the overlay
  renders text only.

## Supported versions

The latest minor receives fixes. Older minors do not.

## Reporting a vulnerability

Open a private security advisory on the repository
(https://github.com/lucaguglielmi/Unfolded-Web-MCP/security/advisories/new)
or write to the maintainer listed on the npm package page. Please do not
file public issues for security reports.
