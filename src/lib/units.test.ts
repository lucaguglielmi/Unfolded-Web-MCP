import { describe, expect, it } from "vitest"
import { formatLength, formatVolume, isUnit } from "./units"

describe("formatLength", () => {
  it("renders centimeters with trailing zeros trimmed", () => {
    expect(formatLength(100, "cm")).toBe("10 cm")
    expect(formatLength(88, "cm")).toBe("8.8 cm")
    expect(formatLength(285.6, "cm")).toBe("28.56 cm")
  })

  it("renders inches to two decimals, trimmed", () => {
    expect(formatLength(25.4, "in")).toBe("1 in")
    expect(formatLength(100, "in")).toBe("3.94 in")
    expect(formatLength(285.6, "in")).toBe("11.24 in")
  })
})

describe("formatVolume", () => {
  it("uses ml below a liter and L above", () => {
    expect(formatVolume(350, "cm")).toBe("350 ml")
    expect(formatVolume(1500, "cm")).toBe("1.5 L")
    expect(formatVolume(12000, "cm")).toBe("12 L")
  })

  it("uses US fluid ounces in imperial mode", () => {
    expect(formatVolume(355, "in")).toBe("12 fl oz")
    expect(formatVolume(29.5735, "in")).toBe("1 fl oz")
  })
})

describe("isUnit", () => {
  it("accepts only the two supported units", () => {
    expect(isUnit("cm")).toBe(true)
    expect(isUnit("in")).toBe(true)
    expect(isUnit("mm")).toBe(false)
    expect(isUnit(undefined)).toBe(false)
  })
})
