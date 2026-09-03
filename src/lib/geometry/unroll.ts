import type { ClaySettings, FormParams } from "@/lib/model/schemas"
import { formatLength, type Unit } from "@/lib/units"

/**
 * Pure unrolling math for slab pottery templates.
 *
 * Slab-built forms are developable surfaces, so every piece flattens with
 * closed-form math — no mesh solver. Two corrections make the templates
 * physically correct:
 *
 * 1. Mid-surface: a slab of thickness t wrapped to outer radius r bends along
 *    its middle, so we develop radius (r - t/2), not the outer skin.
 * 2. Shrinkage: clay shrinks s% from wet to fired. Templates are for wet clay,
 *    so all dimensions scale by 1 / (1 - s/100).
 *
 * `wallThicknessMm` is the WET slab as the potter rolls it — the one
 * number in the model that is not a fired size. It shrinks with the rest
 * of the piece, so every function here agrees on one convention: the
 * templates subtract the slab from WET outer sizes (after scaling), and
 * the fired interior (capacity, warnings) subtracts the fired wall,
 * t·(1 - s/100), from FIRED outer sizes. Both describe the same vessel.
 */

export interface RectanglePiece {
  kind: "rectangle"
  id: string
  label: string
  widthMm: number
  heightMm: number
  /** short instruction printed on the piece itself (e.g. "cut 4 · bevel 45°") */
  stamp?: string
  notes: string[]
}

export interface TrapezoidPiece {
  kind: "trapezoid"
  id: string
  label: string
  /** width of the top edge (the rim end of the panel) */
  topWidthMm: number
  /** width of the bottom edge (the base end of the panel) */
  bottomWidthMm: number
  /** slant height of the panel (its true cut height, not the vessel height) */
  heightMm: number
  /** short instruction printed on the piece itself (e.g. "cut 6 · bevel 28°") */
  stamp?: string
  notes: string[]
}

export interface AnnularSectorPiece {
  kind: "annularSector"
  id: string
  label: string
  innerRadiusMm: number
  outerRadiusMm: number
  angleRad: number
  /** developed length of the longer curved edge */
  outerArcMm: number
  /** developed length of the shorter curved edge */
  innerArcMm: number
  slantMm: number
  /** short instruction printed on the piece itself (e.g. "bevel seam 45°") */
  stamp?: string
  notes: string[]
}

export interface DiscPiece {
  kind: "disc"
  id: string
  label: string
  diameterMm: number
  notes: string[]
}

export interface PolygonPiece {
  kind: "polygon"
  id: string
  label: string
  sides: number
  /** center to vertex (across-corners diameter = 2x this) */
  circumradiusMm: number
  notes: string[]
}

export type Piece = RectanglePiece | TrapezoidPiece | AnnularSectorPiece | DiscPiece | PolygonPiece

export function shrinkageScale(shrinkagePct: number): number {
  if (shrinkagePct < 0 || shrinkagePct >= 100) {
    throw new Error(`shrinkagePct out of range: ${shrinkagePct}`)
  }
  return 1 / (1 - shrinkagePct / 100)
}

/** Straight wall: unrolls to a rectangle (circumference x height). */
export function unrollCylinder(midRadiusMm: number, heightMm: number): Omit<RectanglePiece, "id" | "label" | "notes"> {
  return {
    kind: "rectangle",
    widthMm: 2 * Math.PI * midRadiusMm,
    heightMm,
  }
}

/**
 * Cone frustum wall: unrolls to an annular sector.
 * Works for either taper direction (top wider or bottom wider).
 */
export function unrollFrustum(
  topMidRadiusMm: number,
  bottomMidRadiusMm: number,
  heightMm: number
): Omit<AnnularSectorPiece, "id" | "label" | "notes"> {
  const rMax = Math.max(topMidRadiusMm, bottomMidRadiusMm)
  const rMin = Math.min(topMidRadiusMm, bottomMidRadiusMm)
  const delta = rMax - rMin
  if (delta < 1e-9) {
    throw new Error("unrollFrustum requires different radii; use unrollCylinder")
  }
  const slant = Math.hypot(delta, heightMm)
  const outerRadius = (rMax * slant) / delta
  const innerRadius = outerRadius - slant
  const angle = (2 * Math.PI * rMax) / outerRadius
  return {
    kind: "annularSector",
    innerRadiusMm: innerRadius,
    outerRadiusMm: outerRadius,
    angleRad: angle,
    outerArcMm: angle * outerRadius,
    innerArcMm: angle * innerRadius,
    slantMm: slant,
  }
}

/**
 * Miter bevel for the edges between adjacent flat panels, in degrees: half
 * the angle between the two faces' outward normals. For a straight prism
 * this is exactly 180/n; taper leans the faces (tilt φ from vertical, with
 * tan φ = Δapothem / height), which shrinks the angle between normals —
 * n1·n2 = cos²φ·cos(2π/n) + sin²φ — so tapered corners need a shallower
 * bevel than straight ones.
 */
export function facetBevelDeg(
  n: number,
  apothemTopMm: number,
  apothemBottomMm: number,
  heightMm: number
): number {
  const phi = Math.atan2(Math.abs(apothemBottomMm - apothemTopMm), heightMm)
  const cosNormals =
    Math.cos(phi) ** 2 * Math.cos((2 * Math.PI) / n) + Math.sin(phi) ** 2
  const normalsAngle = Math.acos(Math.min(1, Math.max(-1, cosNormals)))
  return (normalsAngle * 90) / Math.PI // half of it, in degrees
}

/**
 * Build the full wet-clay template piece list for a form.
 *
 * The base disc is sized to the INNER wall diameter so the wall slab wraps
 * around it (standard slab-building order of assembly).
 */
export function buildPieces(form: FormParams, clay: ClaySettings): Piece[] {
  const scale = shrinkageScale(clay.shrinkagePct)
  const t = clay.wallThicknessMm

  if (form.type === "faceted") {
    // N-sided prism (straight) or pyramid frustum (tapered): N identical flat
    // side panels joined with mitered corners, plus a polygon base. Flat
    // panels do not bend, so no mid-surface correction applies — panels are
    // cut to the outer face size and the corner bevel absorbs the thickness.
    const n = form.facets
    const outerRBot = form.bottomDiameterMm / 2 // across corners (circumscribed)
    const outerRTop = (form.tapered ? form.topDiameterMm : form.bottomDiameterMm) / 2
    const sideBot = 2 * outerRBot * Math.sin(Math.PI / n)
    const sideTop = 2 * outerRTop * Math.sin(Math.PI / n)
    const apothemBot = outerRBot * Math.cos(Math.PI / n)
    const apothemTop = outerRTop * Math.cos(Math.PI / n)
    const bevelDeg = facetBevelDeg(n, apothemTop, apothemBot, form.heightMm)
    const bevelText = `${Number(bevelDeg.toFixed(1))}°`
    // the panel's true cut height is its slant, not the vessel height
    const slant = Math.hypot(form.heightMm, apothemBot - apothemTop)

    const pieces: Piece[] = []
    if (Math.abs(sideTop - sideBot) < 0.05) {
      pieces.push({
        kind: "rectangle",
        id: "side",
        label: "Side",
        widthMm: sideBot * scale,
        heightMm: form.heightMm * scale,
        stamp: `cut ${n} · bevel ${bevelText}`,
        notes: [
          `Cut ${n} copies — one per side`,
          `Bevel both vertical edges at ${bevelText} for mitered corners`,
          "Flat panels don't bend, so no mid-surface correction is applied",
        ],
      })
    } else {
      pieces.push({
        kind: "trapezoid",
        id: "side",
        label: "Side",
        topWidthMm: sideTop * scale,
        bottomWidthMm: sideBot * scale,
        heightMm: slant * scale,
        stamp: `cut ${n} · bevel ${bevelText}`,
        notes: [
          `Cut ${n} copies — one per side (the ${sideTop > sideBot ? "wider" : "narrower"} edge is the rim)`,
          `Bevel both slanted edges at ${bevelText} for mitered corners`,
          "Panel height is the slant height — the leaning face's true length",
          "Flat panels don't bend, so no mid-surface correction is applied",
        ],
      })
    }

    // the base sits inside the WET panels: one wet slab in from the scaled
    // outer faces
    const apothemIn = Math.max(0, apothemBot * scale - t)
    pieces.push({
      kind: "polygon",
      id: "base",
      label: "Base",
      sides: n,
      circumradiusMm: apothemIn / Math.cos(Math.PI / n),
      notes: ["Sized to the inner faces so the sides wrap around it"],
    })
    return pieces
  }

  // Wet-clay outer radii: the slab (thickness t, as rolled) wraps around
  // the wet outer surface, so the mid-surface and the inner face sit half
  // a slab and a whole slab inside it — subtracted AFTER shrinkage scaling,
  // since the slab is already a wet size.
  const wetOuterTopR = ((form.tapered ? form.topDiameterMm : form.bottomDiameterMm) / 2) * scale
  const wetOuterBottomR = (form.bottomDiameterMm / 2) * scale
  const wetHeight = form.heightMm * scale
  const midTopR = wetOuterTopR - t / 2
  const midBottomR = wetOuterBottomR - t / 2
  const innerBottomR = wetOuterBottomR - t

  const pieces: Piece[] = []
  // treat sub-0.05mm taper as straight: it is far below printing tolerance and
  // would otherwise unroll into an absurdly large near-degenerate sector
  const isStraight = Math.abs(midTopR - midBottomR) < 0.05

  if (isStraight) {
    const wall = unrollCylinder(midBottomR, wetHeight)
    pieces.push({
      ...wall,
      id: "wall",
      label: "Wall",
      stamp: "bevel seam 45°",
      notes: [
        "Wrap around the base; short edges join with a 45° bevel",
        "Add registration ticks before cutting the seam",
      ],
    })
  } else {
    const wall = unrollFrustum(midTopR, midBottomR, wetHeight)
    pieces.push({
      ...wall,
      id: "wall",
      label: "Wall",
      stamp: "bevel seam 45°",
      notes: [
        `The ${midTopR > midBottomR ? "outer" : "inner"} curved edge is the rim`,
        "Straight edges join with a 45° bevel",
      ],
    })
  }

  pieces.push({
    kind: "disc",
    id: "base",
    label: "Base",
    diameterMm: 2 * Math.max(0, innerBottomR),
    notes: ["Sized to the inner wall so the wall wraps around it"],
  })

  return pieces
}

/**
 * Approximate interior capacity of the fired vessel, in milliliters.
 * Dimensions are fired outer sizes; the wall is entered as a WET slab
 * thickness, so it is shrunk to its fired size first. The interior is the
 * outer surface inset horizontally by one fired wall, above a floor one
 * fired wall thick — good to a few percent, which is what "make me a
 * 350 ml mug" needs.
 */
export function capacityMl(form: FormParams, clay: ClaySettings): number {
  const firedWall = firedWallMm(clay)
  const hIn = Math.max(0, form.heightMm - firedWall)
  if (hIn === 0) return 0
  return Math.round((interiorSectionMm2(form, firedWall) * hIn) / 1000)
}

/** the wet slab after firing — what the finished piece's wall measures */
export function firedWallMm(clay: ClaySettings): number {
  return clay.wallThicknessMm * (1 - clay.shrinkagePct / 100)
}

/**
 * Effective interior cross-section in mm² — the K in V = K · interiorHeight.
 * Volume is LINEAR in height for every supported shape (the frustum formula's
 * radii/areas don't depend on height), which is what makes update_design's
 * capacityMl an exact one-step solve.
 */
function interiorSectionMm2(form: FormParams, firedWall: number): number {
  const topOuter = form.tapered ? form.topDiameterMm : form.bottomDiameterMm
  if (form.type === "faceted") {
    // frustum of a pyramid: V = h/3 (A1 + A2 + sqrt(A1 A2)); straight prisms
    // fall out naturally with A1 == A2
    const cosN = Math.cos(Math.PI / form.facets)
    const tanN = Math.tan(Math.PI / form.facets)
    const area = (outerAcross: number) => {
      const apothemIn = Math.max(0, (outerAcross / 2) * cosN - firedWall)
      return form.facets * apothemIn * apothemIn * tanN
    }
    const aBot = area(form.bottomDiameterMm)
    const aTop = area(topOuter)
    return (aBot + aTop + Math.sqrt(aBot * aTop)) / 3
  }
  const rBot = Math.max(0, form.bottomDiameterMm / 2 - firedWall)
  const rTop = Math.max(0, topOuter / 2 - firedWall)
  return (Math.PI * (rBot * rBot + rBot * rTop + rTop * rTop)) / 3
}

/**
 * The fired height that gives the form the requested interior capacity,
 * keeping every other dimension fixed — exact, because volume is linear in
 * height. Returns null when the walls close the interior entirely (no
 * height can hold anything). The returned height is NOT clamped to the
 * schema range; callers clamp and report.
 */
export function heightForCapacityMl(
  form: FormParams,
  clay: ClaySettings,
  targetMl: number
): number | null {
  const firedWall = firedWallMm(clay)
  const section = interiorSectionMm2(form, firedWall)
  if (section <= 0) return null
  return (targetMl * 1000) / section + firedWall
}

/**
 * Physical-plausibility warnings for the current design. These are shown in
 * the UI and returned to agents so impossible combinations are caught before
 * anything is printed.
 */
export function formWarnings(form: FormParams, clay: ClaySettings, unit: Unit = "cm"): string[] {
  const warnings: string[] = []
  // room is checked inside the FIRED piece, so the wall that counts is the
  // fired one (the interior capacityMl computes); the message still names
  // the slab thickness the potter entered
  const t = firedWallMm(clay)
  const slab = clay.wallThicknessMm
  const len = (mm: number) => formatLength(mm, unit)

  const topOuter = form.tapered ? form.topDiameterMm : form.bottomDiameterMm

  if (form.type === "faceted") {
    // For a prism the base sits inside the flat faces, so room for it is
    // measured across flats (apothem), not across corners.
    const cosN = Math.cos(Math.PI / form.facets)
    const apothemOut = (form.bottomDiameterMm / 2) * cosN
    const innerAcrossFlats = 2 * (apothemOut - t)
    if (innerAcrossFlats <= 0) {
      warnings.push(
        `Wall thickness (${len(slab)}) leaves no room for a base inside a ${len(form.bottomDiameterMm)} ${form.facets}-sided form — thin the walls or widen it.`
      )
    } else if (innerAcrossFlats < 15) {
      warnings.push(
        `The base is only ${len(innerAcrossFlats)} across the flats — joining the sides to it will be fiddly.`
      )
    }
    if (form.tapered && (topOuter / 2) * cosN - t <= 0) {
      warnings.push(
        `Wall thickness (${len(slab)}) closes off the ${len(topOuter)} opening at the rim entirely.`
      )
    }
    return warnings
  }

  const topD = topOuter
  const innerBottomD = form.bottomDiameterMm - 2 * t

  if (innerBottomD <= 0) {
    warnings.push(
      `Wall thickness (${len(slab)}) leaves no room for a base inside a ${len(form.bottomDiameterMm)} bottom — thin the walls or widen the base.`
    )
  } else if (innerBottomD < 15) {
    warnings.push(
      `The base disc is only ${len(innerBottomD)} across — joining the wall to it will be fiddly.`
    )
  }
  if (topD - 2 * t <= 0) {
    warnings.push(
      `Wall thickness (${len(slab)}) closes off the ${len(topD)} opening at the rim entirely.`
    )
  }
  const taper = Math.abs(topD - form.bottomDiameterMm)
  if (form.tapered && taper > 0.05 && taper < form.heightMm * 0.06) {
    warnings.push(
      "Very slight taper: the unrolled arc is nearly straight and unwieldy to print — consider a cylinder, or increase the taper."
    )
  }
  return warnings
}

/**
 * Formats one printed (wet-clay) dimension in the potter's preferred unit,
 * with the corresponding fired size alongside it whenever shrinkage
 * actually changes the number — e.g. "4 cm (3.52 cm fired)". scale=1 (no
 * shrinkage configured) collapses to the plain value since the
 * parenthetical would just repeat it.
 */
function fmtFired(wetMm: number, scale: number, unit: Unit): string {
  const wet = formatLength(wetMm, unit)
  if (scale === 1) return wet
  return `${wet} (${formatLength(wetMm / scale, unit)} fired)`
}

/**
 * Human/agent-readable summary of a piece's key dimensions. Pass the
 * shrinkage scale (shrinkageScale(clay.shrinkagePct)) to annotate each
 * printed dimension with its fired size; omit it for plain wet-clay-only
 * output (e.g. internal length estimates).
 */
export function describePiece(piece: Piece, scale = 1, unit: Unit = "cm"): string {
  const dim = (v: number) => fmtFired(v, scale, unit)
  switch (piece.kind) {
    case "rectangle":
      return `${piece.label}: rectangle ${dim(piece.widthMm)} x ${dim(piece.heightMm)}`
    case "trapezoid":
      return (
        `${piece.label}: trapezoid, top ${dim(piece.topWidthMm)}, bottom ${dim(piece.bottomWidthMm)}, ` +
        `slant height ${dim(piece.heightMm)}`
      )
    case "annularSector":
      return (
        `${piece.label}: annular sector, radii ${dim(piece.innerRadiusMm)}-${dim(piece.outerRadiusMm)}, ` +
        `angle ${((piece.angleRad * 180) / Math.PI).toFixed(1)} deg, arcs ${dim(piece.innerArcMm)} / ${dim(piece.outerArcMm)}`
      )
    case "disc":
      return `${piece.label}: disc, diameter ${dim(piece.diameterMm)}`
    case "polygon": {
      const acrossCorners = 2 * piece.circumradiusMm
      const acrossFlats = acrossCorners * Math.cos(Math.PI / piece.sides)
      return `${piece.label}: ${piece.sides}-sided polygon, ${dim(acrossCorners)} across corners, ${dim(acrossFlats)} across flats`
    }
  }
}
