import { useMemo } from "react"
import * as THREE from "three"
import { Canvas } from "@react-three/fiber"
import { Grid, Html, Line, OrbitControls } from "@react-three/drei"
import { cn } from "@/lib/utils"
import { registerPreviewCanvas } from "@/lib/previewCapture"
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

const fmtCm = (mm: number) => `${Math.round(mm / 10 * 10) / 10} cm`

function MeasureLabel({ position, children }: { position: [number, number, number]; children: string }) {
  return (
    <Html
      position={position}
      center
      zIndexRange={[1, 0]}
      className="text-muted-foreground/80 pointer-events-none text-[10px] font-medium whitespace-nowrap select-none"
    >
      {children}
    </Html>
  )
}

function Scene() {
  const form = useProjectStore((s) => s.form)
  const wallThicknessMm = useProjectStore((s) => s.clay.wallThicknessMm)

  // A faceted form is a lathe with exactly N revolution segments; flat
  // shading makes the facets read as crisp planes instead of a low-poly bug.
  const isFaceted = form.type === "faceted"
  const radialSegments = isFaceted ? form.facets : 96

  const { outerPoints, innerPoints, rimInnerR, rimOuterR, height, bottomY, halfBot, maxHalf } = useMemo(() => {
    const topR = (form.type === "tapered" ? form.topDiameterMm : form.bottomDiameterMm) / 2
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
  // width of a tapered form.
  const dimX = maxHalf + DIM_GAP
  const dimZ = maxHalf + DIM_GAP
  const rimMid = ((rimInnerR + rimOuterR) / 2) * Math.SQRT1_2
  const topDimY = height + 0.14

  return (
    <>
      <group position={[0, bottomY, 0]} rotation={[0, startYaw, 0]}>
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
        axis-aligned when faceted forms get their starting yaw.
      */}
      <group position={[0, bottomY, 0]}>
        {/* height, on the right */}
        <Line points={[[dimX, 0, 0], [dimX, height, 0]]} color={MEASURE_LINE} lineWidth={1} />
        <Line points={[[dimX - TICK, 0, 0], [dimX + TICK, 0, 0]]} color={MEASURE_LINE} lineWidth={1} />
        <Line
          points={[[dimX - TICK, height, 0], [dimX + TICK, height, 0]]}
          color={MEASURE_LINE}
          lineWidth={1}
        />
        <MeasureLabel position={[dimX + 0.16, height / 2, 0]}>{fmtCm(form.heightMm)}</MeasureLabel>

        {/* width across the base, laid flat on the grid in front */}
        <Line points={[[-halfBot, 0, dimZ], [halfBot, 0, dimZ]]} color={MEASURE_LINE} lineWidth={1} />
        <Line
          points={[[-halfBot, 0, dimZ - TICK], [-halfBot, 0, dimZ + TICK]]}
          color={MEASURE_LINE}
          lineWidth={1}
        />
        <Line
          points={[[halfBot, 0, dimZ - TICK], [halfBot, 0, dimZ + TICK]]}
          color={MEASURE_LINE}
          lineWidth={1}
        />
        <MeasureLabel position={[0, 0, dimZ + 0.2]}>{fmtCm(form.bottomDiameterMm)}</MeasureLabel>

        {/* top width, only when it can differ from the bottom */}
        {form.type === "tapered" && (
          <>
            <Line
              points={[[-rimOuterR, topDimY, 0], [rimOuterR, topDimY, 0]]}
              color={MEASURE_LINE}
              lineWidth={1}
            />
            <Line
              points={[[-rimOuterR, topDimY - TICK, 0], [-rimOuterR, topDimY + TICK, 0]]}
              color={MEASURE_LINE}
              lineWidth={1}
            />
            <Line
              points={[[rimOuterR, topDimY - TICK, 0], [rimOuterR, topDimY + TICK, 0]]}
              color={MEASURE_LINE}
              lineWidth={1}
            />
            <MeasureLabel position={[0, topDimY + 0.14, 0]}>
              {fmtCm(form.topDiameterMm)}
            </MeasureLabel>
          </>
        )}

        {/* wall thickness: a short leader off the front-left rim edge */}
        <Line
          points={[[-rimMid, height, rimMid], [-rimMid, height + 0.2, rimMid]]}
          color={MEASURE_LINE}
          lineWidth={1}
        />
        <MeasureLabel position={[-rimMid, height + 0.3, rimMid]}>
          {`wall ${fmtCm(wallThicknessMm)}`}
        </MeasureLabel>
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

export function Viewport({ showHintOnMobile = true }: { showHintOnMobile?: boolean }) {
  return (
    <div className="relative h-full w-full">
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
        <Scene />
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
