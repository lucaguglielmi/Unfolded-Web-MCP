import { useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { Canvas, useFrame } from "@react-three/fiber"
import { Grid, Html, Line, OrbitControls } from "@react-three/drei"
import { cn } from "@/lib/utils"
import { registerPreviewCanvas } from "@/lib/previewCapture"
import { formatLength, type Unit } from "@/lib/units"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Read-only 3D preview. The form is normalized so its largest dimension
 * always fills the same visual size — the fixed camera then frames every
 * design, from an espresso cup to a 400mm vase.
 *
 * The vessel is hollow: an outer shell, a darker inner shell inset by the
 * real wall thickness, and a rim ring closing the wall edge — so looking
 * into the pot reads as an actual open vessel, not a solid extrusion.
 */
/* sized to leave margin around the pot for the dimension callouts */
const TARGET_SIZE = 1.0
const CLAY_OUTER = "#b08968"
const CLAY_INNER = "#7a5c42"
const CLAY_RIM = "#a37e5f"

/* dimension callouts: quiet technical-drawing gray, sized in scene units */
const MEASURE_LINE = "#c6c1bb"
const TICK = 0.045
const DIM_GAP = 0.18

export type MeasurementsMode = "static" | "cycle" | "hidden"

function MeasureLabel({
  position,
  opacity = 1,
  innerRef,
  children,
}: {
  position: [number, number, number]
  opacity?: number
  /** DOM handle so the cycle fader can drive opacity without re-rendering */
  innerRef?: (el: HTMLDivElement | null) => void
  children: string
}) {
  return (
    <Html
      position={position}
      center
      zIndexRange={[1, 0]}
      className="text-muted-foreground/80 pointer-events-none text-[10px] font-medium whitespace-nowrap select-none"
    >
      <div ref={innerRef} style={{ opacity }}>
        {children}
      </div>
    </Html>
  )
}

type Vec3 = [number, number, number]

interface MeasureEntry {
  key: string
  label: string
  labelPos: Vec3
  lines: Vec3[][]
}

const CYCLE_FADE_MS = 700
const CYCLE_HOLD_MS = 2200

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)

/** one callout: its dimension lines plus the floating label */
function MeasureEntryView({
  entry,
  opacity,
  groupRef,
  labelRef,
}: {
  entry: MeasureEntry
  opacity: number
  groupRef?: React.RefObject<THREE.Group | null>
  labelRef?: (el: HTMLDivElement | null) => void
}) {
  return (
    <group ref={groupRef}>
      {entry.lines.map((points, i) => (
        <Line key={i} points={points} color={MEASURE_LINE} lineWidth={1} transparent opacity={opacity} />
      ))}
      <MeasureLabel position={entry.labelPos} opacity={opacity} innerRef={labelRef}>
        {entry.label}
      </MeasureLabel>
    </group>
  )
}

/**
 * Cycle mode: ping-pong through the entries with a slow crossfade — fade
 * one in, hold, fade out, step to the neighbor, reverse at the ends. The
 * fade itself runs entirely outside React: useFrame drives the line
 * materials and the label's DOM opacity through refs, and React renders
 * only when the shown entry steps (about every 3.6 s).
 */
function CycleMeasurements({ entries }: { entries: MeasureEntry[] }) {
  const [index, setIndex] = useState(0)
  const direction = useRef(1)
  const phase = useRef<{ name: "in" | "hold" | "out"; t: number }>({ name: "in", t: 0 })
  const groupRef = useRef<THREE.Group>(null)
  const labelEl = useRef<HTMLDivElement | null>(null)

  const applyOpacity = (o: number) => {
    groupRef.current?.traverse((obj) => {
      const material = (obj as THREE.Mesh).material as THREE.Material | undefined
      if (material && "opacity" in material) material.opacity = o
    })
    if (labelEl.current) labelEl.current.style.opacity = String(o)
  }

  useFrame((_, delta) => {
    const p = phase.current
    p.t += delta * 1000
    if (p.name === "in") {
      const f = Math.min(1, p.t / CYCLE_FADE_MS)
      applyOpacity(easeInOut(f))
      if (f >= 1) Object.assign(p, { name: "hold", t: 0 })
    } else if (p.name === "hold") {
      if (p.t >= CYCLE_HOLD_MS) Object.assign(p, { name: "out", t: 0 })
    } else {
      const f = Math.min(1, p.t / CYCLE_FADE_MS)
      applyOpacity(1 - easeInOut(f))
      if (f >= 1) {
        Object.assign(p, { name: "in", t: 0 })
        setIndex((i) => {
          if (i + direction.current >= entries.length || i + direction.current < 0) {
            direction.current = -direction.current
          }
          return i + direction.current
        })
      }
    }
  })

  const entry = entries[Math.min(index, entries.length - 1)]
  return (
    <MeasureEntryView
      key={entry.key}
      entry={entry}
      // a freshly stepped entry mounts invisible; the fade-in lifts it
      opacity={0}
      groupRef={groupRef}
      labelRef={(el) => (labelEl.current = el)}
    />
  )
}

/**
 * The dimension callouts. Static mode (main preview) shows them all at
 * once; cycle mode (the small mobile thumbnail, where they'd clutter)
 * shows one at a time, slowly crossfading back and forth through the
 * set — which follows the shape: a tapered form also cycles its top
 * width. "hidden": the collapsed scroll-thumbnail is too small for any.
 */
function Measurements({ entries, mode }: { entries: MeasureEntry[]; mode: MeasurementsMode }) {
  if (mode === "hidden") return null
  if (mode === "cycle" && entries.length > 1) return <CycleMeasurements entries={entries} />
  return (
    <>
      {entries.map((entry) => (
        <MeasureEntryView key={entry.key} entry={entry} opacity={1} />
      ))}
    </>
  )
}

function Scene({ measurementsMode }: { measurementsMode: MeasurementsMode }) {
  const form = useProjectStore((s) => s.form)
  const wallThicknessMm = useProjectStore((s) => s.clay.wallThicknessMm)
  const unit: Unit = useProjectStore((s) => s.unit)

  // A faceted form is a lathe with exactly N revolution segments; flat
  // shading makes the facets read as crisp planes instead of a low-poly bug.
  const isFaceted = form.type === "faceted"
  const radialSegments = isFaceted ? form.facets : 96

  const { outerPoints, innerPoints, rimInnerR, rimOuterR, height, bottomY, halfBot, maxHalf } = useMemo(() => {
    // straight forms keep topDiameterMm mirrored to bottom (store invariant)
    const topR = form.topDiameterMm / 2
    const bottomR = form.bottomDiameterMm / 2
    const maxDim = Math.max(form.heightMm, 2 * Math.max(topR, bottomR))
    const s = TARGET_SIZE / maxDim

    const t = Math.min(wallThicknessMm, Math.min(topR, bottomR) - 1) * s
    const h = form.heightMm * s
    const oTop = topR * s
    const oBot = bottomR * s
    const iTop = Math.max(oTop - t, 0.01)
    const iBot = Math.max(oBot - t, 0.01)
    const floorY = Math.min(t, h / 2)

    return {
      outerPoints: [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(oBot, 0),
        new THREE.Vector2(oTop, h),
      ],
      innerPoints: [
        new THREE.Vector2(0.01, floorY),
        new THREE.Vector2(iBot, floorY),
        new THREE.Vector2(iTop, h),
      ],
      rimInnerR: iTop,
      rimOuterR: oTop,
      height: h,
      bottomY: -h / 2,
      halfBot: oBot,
      maxHalf: Math.max(oTop, oBot),
    }
  }, [form, wallThicknessMm])

  // flatShading is baked into compiled materials, so key meshes on the mode
  const meshKey = `${isFaceted}-${radialSegments}`

  // The camera looks in from a 45° azimuth while lathe vertex 0 sits at
  // azimuth 0 — which leaves a triangle or square presenting an almost
  // flat wall to the viewer. Start each faceted form with a corner turned
  // toward the camera, backed off by a sliver of its face angle so the two
  // front faces catch different light: every facet count opens on a
  // distinct, readable silhouette. Round forms are rotation-invariant.
  const CAMERA_AZIMUTH = Math.PI / 4
  const startYaw = isFaceted ? CAMERA_AZIMUTH - (0.3 * Math.PI) / form.facets : 0

  // Anchor points for the dimension callouts: height line to the right of
  // the pot, base width laid on the grid in front, wall-thickness leader on
  // the front-LEFT rim edge so it never collides with the (centered) top
  // width of a tapered form. Memoized so drei's Line geometries only
  // rebuild when the design actually changes, not on every Scene render.
  const measureEntries: MeasureEntry[] = useMemo(() => {
    const fmt = (mm: number) => formatLength(mm, unit)
    const dimX = maxHalf + DIM_GAP
    const dimZ = maxHalf + DIM_GAP
    const rimMid = ((rimInnerR + rimOuterR) / 2) * Math.SQRT1_2
    const topDimY = height + 0.14
    return [
      {
        key: "height",
        label: fmt(form.heightMm),
        labelPos: [dimX + 0.16, height / 2, 0],
        lines: [
          [[dimX, 0, 0], [dimX, height, 0]],
          [[dimX - TICK, 0, 0], [dimX + TICK, 0, 0]],
          [[dimX - TICK, height, 0], [dimX + TICK, height, 0]],
        ],
      },
      {
        key: "bottom",
        label: fmt(form.bottomDiameterMm),
        labelPos: [0, 0, dimZ + 0.2],
        lines: [
          [[-halfBot, 0, dimZ], [halfBot, 0, dimZ]],
          [[-halfBot, 0, dimZ - TICK], [-halfBot, 0, dimZ + TICK]],
          [[halfBot, 0, dimZ - TICK], [halfBot, 0, dimZ + TICK]],
        ],
      },
      // top width only when it can differ from the bottom
      ...(form.tapered
        ? [
            {
              key: "top",
              label: fmt(form.topDiameterMm),
              labelPos: [0, topDimY + 0.14, 0] as Vec3,
              lines: [
                [[-rimOuterR, topDimY, 0], [rimOuterR, topDimY, 0]] as Vec3[],
                [[-rimOuterR, topDimY - TICK, 0], [-rimOuterR, topDimY + TICK, 0]] as Vec3[],
                [[rimOuterR, topDimY - TICK, 0], [rimOuterR, topDimY + TICK, 0]] as Vec3[],
              ],
            },
          ]
        : []),
      {
        key: "wall",
        label: `wall ${fmt(wallThicknessMm)}`,
        labelPos: [-rimMid, height + 0.3, rimMid],
        lines: [[[-rimMid, height, rimMid], [-rimMid, height + 0.2, rimMid]]],
      },
      ]
  }, [form, wallThicknessMm, unit, maxHalf, height, rimInnerR, rimOuterR, halfBot])

  // One-time entrance: the vessel eases in from a slight extra yaw and a
  // touch smaller, settling into its resting pose over ~1.1s. Pure
  // delight — skipped entirely for reduced-motion users.
  const vesselRef = useRef<THREE.Group>(null)
  const introT = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 1
      : 0
  )
  useFrame((_, delta) => {
    if (introT.current >= 1 || !vesselRef.current) return
    introT.current = Math.min(1, introT.current + delta / 1.1)
    const eased = 1 - (1 - introT.current) ** 3
    vesselRef.current.rotation.y = startYaw + (1 - eased) * 0.5
    vesselRef.current.scale.setScalar(0.92 + 0.08 * eased)
  })

  return (
    <>
      <group ref={vesselRef} position={[0, bottomY, 0]} rotation={[0, startYaw, 0]}>
        <mesh key={`outer-${meshKey}`}>
          <latheGeometry args={[outerPoints, radialSegments]} />
          <meshStandardMaterial
            color={CLAY_OUTER}
            roughness={0.85}
            side={THREE.DoubleSide}
            flatShading={isFaceted}
          />
        </mesh>
        <mesh key={`inner-${meshKey}`}>
          <latheGeometry args={[innerPoints, radialSegments]} />
          <meshStandardMaterial
            color={CLAY_INNER}
            roughness={0.9}
            side={THREE.DoubleSide}
            flatShading={isFaceted}
          />
        </mesh>
        {/* rim: closes the wall-thickness edge between outer and inner shells.
            thetaStart -90° phases the ring's N-gon vertices onto the lathe's,
            so faceted rims sit flush on the prism walls. */}
        <mesh
          key={`rim-${meshKey}`}
          position={[0, height, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[rimInnerR, rimOuterR, radialSegments, 1, -Math.PI / 2]} />
          <meshStandardMaterial color={CLAY_RIM} roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/*
        Subtle dimension callouts in cm — the design (fired-target) sizes the
        potter set. A sibling of the vessel group, not a child, so they stay
        axis-aligned when faceted forms get their starting yaw. In the small
        mobile thumbnail they cycle one at a time instead of all at once.
      */}
      <group position={[0, bottomY, 0]}>
        <Measurements mode={measurementsMode} entries={measureEntries} />
      </group>

      <Grid
        position={[0, bottomY - 0.002, 0]}
        args={[10, 10]}
        cellSize={0.25}
        cellThickness={0.5}
        sectionSize={1}
        sectionThickness={0.9}
        cellColor="#e7e5e4"
        sectionColor="#d6d3d1"
        fadeDistance={11}
        infiniteGrid
      />
    </>
  )
}

export function Viewport({
  showHintOnMobile = true,
  measurementsMode = "static",
}: {
  showHintOnMobile?: boolean
  /** "static" shows all dimension callouts; "cycle" (small thumbnail) fades through them one at a time */
  measurementsMode?: MeasurementsMode
}) {
  return (
    <div className="viewport-in relative h-full w-full">
      <Canvas
        camera={{ position: [2.4, 1.6, 2.4], fov: 38 }}
        // preserveDrawingBuffer lets the get_preview_image WebMCP tool
        // snapshot the latest frame for the agent
        gl={{ preserveDrawingBuffer: true }}
        onCreated={(state) => registerPreviewCanvas(state.gl.domElement)}
        className="touch-none bg-background"
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 3]} intensity={1.05} />
        <directionalLight position={[-3, 2, -4]} intensity={0.35} />
        <Scene measurementsMode={measurementsMode} />
        <OrbitControls
          makeDefault
          enableDamping
          enablePan={false}
          target={[0, 0, 0]}
          minDistance={1.2}
          maxDistance={7}
          maxPolarAngle={Math.PI * 0.55}
        />
      </Canvas>
      <p
        className={cn(
          "text-muted-foreground/70 pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap",
          showHintOnMobile ? "block" : "hidden lg:block"
        )}
      >
        Drag to rotate · Scroll to zoom
      </p>
    </div>
  )
}
