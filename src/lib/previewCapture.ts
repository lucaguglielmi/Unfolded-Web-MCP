/**
 * Bridge between the R3F canvas and the get_preview_image WebMCP tool.
 * The Viewport registers its WebGL canvas on creation; the tool captures
 * a downscaled JPEG of the latest frame (the canvas is created with
 * preserveDrawingBuffer so the buffer survives until the next frame).
 */

let previewCanvas: HTMLCanvasElement | null = null

export function registerPreviewCanvas(canvas: HTMLCanvasElement): void {
  previewCanvas = canvas
}

// The capture is context the MODEL has to read: a 480px PNG of the render
// weighed ~130 KB base64 (~32 K tokens) per peek — by far the largest
// site-owned cost in the agent loop (docs/webmcp-profiler-spec.md §1).
// A 320px JPEG reads just as well for "does the pot look right?" at a
// tenth of the weight. JPEG is safe here because the frame is composited
// onto opaque white first (no alpha to lose).
const MAX_EDGE_PX = 320
const JPEG_QUALITY = 0.8

/** Compact JPEG snapshot of the 3D preview as base64 (no data: prefix), or null. */
export function capturePreviewImage(): { data: string; mimeType: string } | null {
  if (!previewCanvas || previewCanvas.width === 0 || previewCanvas.height === 0) return null
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(previewCanvas.width, previewCanvas.height))
    const w = Math.max(1, Math.round(previewCanvas.width * scale))
    const h = Math.max(1, Math.round(previewCanvas.height * scale))
    const out = document.createElement("canvas")
    out.width = w
    out.height = h
    const ctx = out.getContext("2d")
    if (!ctx) return null
    // WebGL clears to transparent — composite on white so the image
    // matches the app's background instead of going black in viewers
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(previewCanvas, 0, 0, w, h)
    const dataUrl = out.toDataURL("image/jpeg", JPEG_QUALITY)
    const comma = dataUrl.indexOf(",")
    return comma >= 0 ? { data: dataUrl.slice(comma + 1), mimeType: "image/jpeg" } : null
  } catch {
    return null
  }
}
