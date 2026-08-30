import { useMemo } from "react"
import * as THREE from "three"
import { Canvas } from "@react-three/fiber"
import { Grid, OrbitControls } from "@react-three/drei"
import { cn } from "@/lib/utils"
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
const TARGET_SIZE = 1.35
const CLAY_OUTER = "#b08968"
const CLAY_INNER = "#7a5c42"
const CLAY_RIM = "#a37e5f"

function Scene() {
  const form = useProjectStore((s) => s.form)
  const wallThicknessMm = useProjectStore((s) => s.clay.wallThicknessMm)

  // A faceted form is a lathe with exactly N revolution segments; flat
  // shading makes the facets read as crisp planes instead of a low-poly bug.
  const isFaceted = form.type === "faceted"
  const radialSegments = isFaceted ? form.facets : 96

  const { outerPoints, innerPoints, rimInnerR, rimOuterR, height, bottomY } = useMemo(() => {
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
    }
  }, [form, wallThicknessMm])

  // flatShading is baked into compiled materials, so key meshes on the mode
  const meshKey = `${isFaceted}-${radialSegments}`

  return (
    <>
      <group position={[0, bottomY, 0]}>
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
      <Canvas camera={{ position: [2.4, 1.6, 2.4], fov: 38 }} className="touch-none bg-background">
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
