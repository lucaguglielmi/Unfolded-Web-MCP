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

export type Piece = RectanglePiece | AnnularSectorPiece | DiscPiece

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
 * Physical-plausibility warnings for the current design. These are shown in
 * the UI and returned to agents so impossible combinations are caught before
 * anything is printed.
 */
export function formWarnings(form: FormParams, clay: ClaySettings): string[] {
  const warnings: string[] = []
  const t = clay.wallThicknessMm
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

/** Human/agent-readable summary of a piece's key dimensions. */
export function describePiece(piece: Piece): string {
  const mm = (v: number) => `${v.toFixed(1)} mm`
  switch (piece.kind) {
    case "rectangle":
      return `${piece.label}: rectangle ${mm(piece.widthMm)} x ${mm(piece.heightMm)}`
    case "annularSector":
      return (
        `${piece.label}: annular sector, radii ${mm(piece.innerRadiusMm)}-${mm(piece.outerRadiusMm)}, ` +
        `angle ${((piece.angleRad * 180) / Math.PI).toFixed(1)} deg, arcs ${mm(piece.innerArcMm)} / ${mm(piece.outerArcMm)}`
      )
    case "disc":
      return `${piece.label}: disc, diameter ${mm(piece.diameterMm)}`
  }
}
