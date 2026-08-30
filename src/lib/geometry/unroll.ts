import type { ClaySettings, FormParams } from "@/lib/model/schemas"

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

export type Piece = RectanglePiece | AnnularSectorPiece | DiscPiece | PolygonPiece

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
 * Build the full wet-clay template piece list for a form.
 *
 * The base disc is sized to the INNER wall diameter so the wall slab wraps
 * around it (standard slab-building order of assembly).
 */
export function buildPieces(form: FormParams, clay: ClaySettings): Piece[] {
  const scale = shrinkageScale(clay.shrinkagePct)
  const t = clay.wallThicknessMm

  if (form.type === "faceted") {
    // Straight-walled N-sided prism: N identical flat side panels joined with
    // mitered corners, plus a polygon base. Flat panels do not bend, so no
    // mid-surface correction applies — panels are cut to the outer face size
    // and the corner bevel absorbs the thickness.
    const n = form.facets
    const outerR = form.bottomDiameterMm / 2 // across corners (circumscribed)
    const sideOut = 2 * outerR * Math.sin(Math.PI / n)
    const apothemOut = outerR * Math.cos(Math.PI / n)
    const bevelDeg = 180 / n

    const pieces: Piece[] = [
      {
        kind: "rectangle",
        id: "side",
        label: "Side",
        widthMm: sideOut * scale,
        heightMm: form.heightMm * scale,
        stamp: `cut ${n} · bevel ${bevelDeg.toFixed(0)}°`,
        notes: [
          `Cut ${n} copies — one per side`,
          `Bevel both vertical edges at ${bevelDeg.toFixed(0)}° for mitered corners`,
          "Flat panels don't bend, so no mid-surface correction is applied",
        ],
      },
    ]

    const apothemIn = Math.max(0, apothemOut - t)
    pieces.push({
      kind: "polygon",
      id: "base",
      label: "Base",
      sides: n,
      circumradiusMm: (apothemIn / Math.cos(Math.PI / n)) * scale,
      notes: ["Sized to the inner faces so the sides wrap around it"],
    })
    return pieces
  }

  const outerTopR = (form.type === "cylinder" ? form.bottomDiameterMm : form.topDiameterMm) / 2
  const outerBottomR = form.bottomDiameterMm / 2
  const midTopR = outerTopR - t / 2
  const midBottomR = outerBottomR - t / 2
  const innerBottomR = outerBottomR - t

  const pieces: Piece[] = []
  // treat sub-0.05mm taper as straight: it is far below printing tolerance and
  // would otherwise unroll into an absurdly large near-degenerate sector
  const isStraight = Math.abs(midTopR - midBottomR) < 0.05

  if (isStraight) {
    const wall = unrollCylinder(midBottomR * scale, form.heightMm * scale)
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
    const wall = unrollFrustum(midTopR * scale, midBottomR * scale, form.heightMm * scale)
    pieces.push({
      ...wall,
      id: "wall",
      label: "Wall",
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
    diameterMm: 2 * Math.max(0, innerBottomR) * scale,
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
  const firedWall = clay.wallThicknessMm * (1 - clay.shrinkagePct / 100)
  const hIn = Math.max(0, form.heightMm - firedWall)
  if (hIn === 0) return 0

  let volumeMm3 = 0
  if (form.type === "faceted") {
    const apothemIn = (form.bottomDiameterMm / 2) * Math.cos(Math.PI / form.facets) - firedWall
    if (apothemIn <= 0) return 0
    const area = form.facets * apothemIn * apothemIn * Math.tan(Math.PI / form.facets)
    volumeMm3 = area * hIn
  } else {
    const rBot = Math.max(0, form.bottomDiameterMm / 2 - firedWall)
    const rTop =
      form.type === "tapered" ? Math.max(0, form.topDiameterMm / 2 - firedWall) : rBot
    volumeMm3 = (Math.PI * hIn * (rBot * rBot + rBot * rTop + rTop * rTop)) / 3
  }
  return Math.round(volumeMm3 / 1000)
}

/**
 * Physical-plausibility warnings for the current design. These are shown in
 * the UI and returned to agents so impossible combinations are caught before
 * anything is printed.
 */
export function formWarnings(form: FormParams, clay: ClaySettings): string[] {
  const warnings: string[] = []
  const t = clay.wallThicknessMm

  if (form.type === "faceted") {
    // For a prism the base sits inside the flat faces, so room for it is
    // measured across flats (apothem), not across corners.
    const apothemOut = (form.bottomDiameterMm / 2) * Math.cos(Math.PI / form.facets)
    const innerAcrossFlats = 2 * (apothemOut - t)
    if (innerAcrossFlats <= 0) {
      warnings.push(
        `Wall thickness (${t} mm) leaves no room for a base inside a ${form.bottomDiameterMm} mm ${form.facets}-sided form — thin the walls or widen it.`
      )
    } else if (innerAcrossFlats < 15) {
      warnings.push(
        `The base is only ${innerAcrossFlats.toFixed(0)} mm across the flats — joining the sides to it will be fiddly.`
      )
    }
    return warnings
  }

  const topD = form.type === "cylinder" ? form.bottomDiameterMm : form.topDiameterMm
  const innerBottomD = form.bottomDiameterMm - 2 * t

  if (innerBottomD <= 0) {
    warnings.push(
      `Wall thickness (${t} mm) leaves no room for a base inside a ${form.bottomDiameterMm} mm bottom — thin the walls or widen the base.`
    )
  } else if (innerBottomD < 15) {
    warnings.push(
      `The base disc is only ${innerBottomD.toFixed(0)} mm across — joining the wall to it will be fiddly.`
    )
  }
  if (topD - 2 * t <= 0) {
    warnings.push(
      `Wall thickness (${t} mm) closes off the ${topD} mm opening at the rim entirely.`
    )
  }
  const taper = Math.abs(topD - form.bottomDiameterMm)
  if (form.type === "tapered" && taper > 0.05 && taper < form.heightMm * 0.06) {
    warnings.push(
      "Very slight taper: the unrolled arc is nearly straight and unwieldy to print — consider a cylinder, or increase the taper."
    )
  }
  return warnings
}

/**
 * Formats one printed (wet-clay) dimension, with the corresponding fired
 * size alongside it whenever shrinkage actually changes the number — e.g.
 * "40.0 mm (35.2 mm fired)". scale=1 (no shrinkage configured) collapses to
 * plain "40.0 mm" since the parenthetical would just repeat the same value.
 */
function fmtFired(wetMm: number, scale: number): string {
  const wet = `${wetMm.toFixed(1)} mm`
  if (scale === 1) return wet
  return `${wet} (${(wetMm / scale).toFixed(1)} mm fired)`
}

/**
 * Human/agent-readable summary of a piece's key dimensions. Pass the
 * shrinkage scale (shrinkageScale(clay.shrinkagePct)) to annotate each
 * printed dimension with its fired size; omit it for plain wet-clay-only
 * output (e.g. internal length estimates).
 */
export function describePiece(piece: Piece, scale = 1): string {
  const dim = (v: number) => fmtFired(v, scale)
  switch (piece.kind) {
    case "rectangle":
      return `${piece.label}: rectangle ${dim(piece.widthMm)} x ${dim(piece.heightMm)}`
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
