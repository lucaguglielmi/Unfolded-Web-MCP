import { afterEach, describe, expect, it, vi } from "vitest"
import { buildShareParams, parseShareParams, sanitizeSharePatches, shareUrl } from "./shareLink"
import { DEFAULT_CLAY, PRESETS } from "./schemas"

describe("parseShareParams", () => {
  it("parses the canonical example link", () => {
    const patches = parseShareParams(
      "https://unfolded.example.com/?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5"
    )
    expect(patches.form).toEqual({
      type: "round",
      tapered: true,
      heightMm: 600,
      bottomDiameterMm: 300,
      topDiameterMm: 100,
    })
    expect(patches.clay).toEqual({ shrinkagePct: 12, wallThicknessMm: 5 })
    expect(patches.paperSize).toBeUndefined()
  })

  it("works with a bare query string, with or without the question mark", () => {
    for (const input of ["?type=hexagon&height=110", "type=hexagon&height=110"]) {
      const patches = parseShareParams(input)
      expect(patches.form).toEqual({ type: "faceted", facets: 6, heightMm: 110 })
    }
  })

  it("accepts a scheme-less link the way people paste it", () => {
    const patches = parseShareParams("tryunfolded.com/?type=hexagon&height=180#anchor")
    expect(patches.form).toEqual({ type: "faceted", facets: 6, heightMm: 180 })
    expect(parseShareParams("www.tryunfolded.com/webmcp?wall=6").clay).toEqual({ wallThicknessMm: 6 })
    // a scheme-less host with no query carries no parameters — not a crash
    expect(parseShareParams("tryunfolded.com/")).toEqual({})
  })

  it("maps friendly shape names to faceted forms", () => {
    expect(parseShareParams("type=triangle").form).toEqual({ type: "faceted", facets: 3 })
    expect(parseShareParams("type=octagon").form).toEqual({ type: "faceted", facets: 8 })
  })

  it("marks any shape tapered when the link carries a top size", () => {
    expect(parseShareParams("type=pentagon&top=120").form).toEqual({
      type: "faceted",
      facets: 5,
      tapered: true,
      topDiameterMm: 120,
    })
  })

  it("lets an explicit facets parameter override the alias", () => {
    expect(parseShareParams("type=faceted&facets=5").form).toEqual({ type: "faceted", facets: 5 })
  })

  it("clamps out-of-range values instead of failing", () => {
    const patches = parseShareParams("height=9999&bottom=1&wall=0.5&shrinkage=90")
    expect(patches.form).toEqual({ heightMm: 600, bottomDiameterMm: 20 })
    expect(patches.clay).toEqual({ wallThicknessMm: 2, shrinkagePct: 25 })
  })

  it("ignores unknown keys and malformed values", () => {
    const patches = parseShareParams("type=banana&height=abc&foo=bar&glaze=celadon")
    expect(patches).toEqual({})
  })

  it("decodes and truncates the name", () => {
    const long = "x".repeat(80)
    expect(parseShareParams("name=My%20favourite%20mug").form).toEqual({
      name: "My favourite mug",
    })
    expect(parseShareParams(`name=${long}`).form).toEqual({ name: "x".repeat(60) })
  })

  it("parses paper size case-insensitively", () => {
    expect(parseShareParams("paper=letter").paperSize).toBe("Letter")
    expect(parseShareParams("paper=a3").paperSize).toBe("A3")
    expect(parseShareParams("paper=A4").paperSize).toBe("A4")
    expect(parseShareParams("paper=A5").paperSize).toBeUndefined()
  })

  it("parses the display-unit preference, accepting friendly spellings", () => {
    expect(parseShareParams("units=in").unit).toBe("in")
    expect(parseShareParams("units=INCHES").unit).toBe("in")
    expect(parseShareParams("unit=inch").unit).toBe("in")
    expect(parseShareParams("units=cm").unit).toBe("cm")
    expect(parseShareParams("units=metric").unit).toBe("cm")
    expect(parseShareParams("units=furlongs").unit).toBeUndefined()
    expect(parseShareParams("height=110").unit).toBeUndefined()
  })
})

describe("sanitizeSharePatches", () => {
  it("accepts only own paper names, not Object.prototype properties", () => {
    expect(sanitizeSharePatches({ paperSize: "A4" })).toEqual({ paperSize: "A4" })
    expect(sanitizeSharePatches({ paperSize: "toString" })).toBeNull()
    expect(sanitizeSharePatches({ paperSize: "constructor" })).toBeNull()
  })
})

describe("buildShareParams / shareUrl", () => {
  it("round-trips a full design through the link", () => {
    const form = PRESETS["hex-planter"]
    const params = buildShareParams(form, DEFAULT_CLAY, "Letter")
    const patches = parseShareParams(params)
    expect(patches.form).toEqual({
      type: "faceted",
      facets: 6,
      heightMm: form.heightMm,
      bottomDiameterMm: form.bottomDiameterMm,
      name: form.name,
    })
    expect(patches.clay).toEqual(DEFAULT_CLAY)
    expect(patches.paperSize).toBe("Letter")
    expect(patches.unit).toBe("cm")
  })

  it("round-trips the unit preference", () => {
    const params = buildShareParams(PRESETS["classic-mug"], DEFAULT_CLAY, "A4", "in")
    expect(params.get("units")).toBe("in")
    expect(parseShareParams(params).unit).toBe("in")
    expect(shareUrl(PRESETS["classic-mug"], DEFAULT_CLAY, "A4", { unit: "in" })).toContain("units=in")
  })

  it("emits friendly shape names and only includes top for tapered forms", () => {
    const round = buildShareParams(PRESETS["classic-mug"], DEFAULT_CLAY, "A4")
    expect(round.get("type")).toBe("cylinder")
    expect(round.get("top")).toBeNull()
    const tapered = buildShareParams(PRESETS["bud-vase"], DEFAULT_CLAY, "A4")
    expect(tapered.get("type")).toBe("tapered")
    expect(tapered.get("top")).toBe("45")
  })

  it("builds a relative URL outside the browser", () => {
    const url = shareUrl(PRESETS["classic-mug"], DEFAULT_CLAY, "A4")
    expect(url.startsWith("?type=cylinder")).toBe(true)
    expect(url).not.toContain("via=")
  })

  describe("in a browser", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("targets the studio even when minted on an explainer page", () => {
      // the agent's tools register on /webmcp too — a link handed out from
      // there must open the studio, not the explainer
      vi.stubGlobal("location", { origin: "https://unfolded.example.com", pathname: "/webmcp" })
      const url = shareUrl(PRESETS["classic-mug"], DEFAULT_CLAY, "A4", { unit: "in" })
      expect(url.startsWith("https://unfolded.example.com/?type=cylinder")).toBe(true)
      expect(url).not.toContain("/webmcp")
      expect(new URL(url).pathname).toBe("/")
    })
  })

  it("tags agent-minted links with via=chatgpt, which parsing ignores", () => {
    const url = shareUrl(PRESETS["classic-mug"], DEFAULT_CLAY, "A4", { viaChatGpt: true })
    expect(url).toContain("via=chatgpt")
    // the marker is a connection signal, not a design parameter
    const patches = parseShareParams(url)
    expect(JSON.stringify(patches)).not.toContain("via")
  })
})
