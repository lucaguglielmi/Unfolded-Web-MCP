import { useMemo } from "react"
import * as THREE from "three"
import { Canvas } from "@react-three/fiber"
import { Grid, OrbitControls } from "@react-three/drei"
import { useProjectStore } from "@/store/useProjectStore"

/** Scene units: 1 unit = 100 mm. */
const MM = 0.01

function FormMesh() {
  const form = useProjectStore((s) => s.form)

  const points = useMemo(() => {
    const topR = (form.type === "cylinder" ? form.bottomDiameterMm : form.topDiameterMm) / 2
    const bottomR = form.bottomDiameterMm / 2
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(bottomR * MM, 0),
      new THREE.Vector2(topR * MM, form.heightMm * MM),
    ]
  }, [form])

  return (
    <group position={[0, (-form.heightMm * MM) / 2, 0]}>
      <mesh>
        <latheGeometry args={[points, 96]} />
        <meshStandardMaterial color="#b08968" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export function Viewport() {
  return (
    <Canvas camera={{ position: [2.2, 1.4, 2.2], fov: 40 }} className="bg-muted/30">
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 3]} intensity={1.1} />
      <directionalLight position={[-3, 2, -4]} intensity={0.3} />
      <FormMesh />
      <Grid
        position={[0, -1.2, 0]}
        args={[10, 10]}
        cellSize={0.25}
        cellThickness={0.6}
        sectionSize={1}
        sectionThickness={1}
        cellColor="#a8a29e"
        sectionColor="#78716c"
        fadeDistance={12}
        infiniteGrid
      />
      <OrbitControls makeDefault enableDamping target={[0, 0, 0]} minDistance={0.5} maxDistance={8} />
    </Canvas>
  )
}
