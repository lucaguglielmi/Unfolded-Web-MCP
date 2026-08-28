import { useMemo } from "react"
import * as THREE from "three"
import { Canvas } from "@react-three/fiber"
import { Grid, OrbitControls } from "@react-three/drei"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Read-only 3D preview. The form is normalized so its largest dimension
 * always fills the same visual size — the fixed camera then frames every
 * design, from an espresso cup to a 400mm vase.
 */
const TARGET_SIZE = 1.35

function Scene() {
  const form = useProjectStore((s) => s.form)

  const { points, bottomY } = useMemo(() => {
    const topR = (form.type === "cylinder" ? form.bottomDiameterMm : form.topDiameterMm) / 2
    const bottomR = form.bottomDiameterMm / 2
    const maxDim = Math.max(form.heightMm, 2 * Math.max(topR, bottomR))
    const scale = TARGET_SIZE / maxDim
    return {
      points: [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(bottomR * scale, 0),
        new THREE.Vector2(topR * scale, form.heightMm * scale),
      ],
      bottomY: (-form.heightMm * scale) / 2,
    }
  }, [form])

  return (
    <>
      <group position={[0, bottomY, 0]}>
        <mesh>
          <latheGeometry args={[points, 96]} />
          <meshStandardMaterial color="#b08968" roughness={0.85} side={THREE.DoubleSide} />
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

export function Viewport() {
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
      <p className="text-muted-foreground/70 pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs">
        Drag to rotate · Scroll to zoom
      </p>
    </div>
  )
}
