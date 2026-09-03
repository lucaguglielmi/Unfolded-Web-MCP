import { describe, expect, it } from "vitest"
import { securityHeaders } from "./securityHeaders"

describe("security headers", () => {
  it("allows the self-contained profiler guide clipboard handler by hash", () => {
    const csp = securityHeaders(new URL("https://tryunfolded.com/"))["Content-Security-Policy"]
    expect(csp).toContain("'sha256-E/t7skD8zO/p7pLoNjuqxsVh7kDieOfw8/z60LMNIbQ='")
  })
})
