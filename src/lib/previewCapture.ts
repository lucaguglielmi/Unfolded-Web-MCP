/**
 * Bridge between the R3F canvas and the get_preview_image WebMCP tool.
 * The Viewport registers its WebGL canvas on creation; the tool captures
 * a downscaled PNG of the latest frame (the canvas is created with
 * preserveDrawingBuffer so the buffer survives until the next frame).
 */

let previewCanvas: HTMLCanvasElement | null = null

export function registerPreviewCanvas(canvas: HTMLCanvasElement): void {
  previewCanvas = canvas
}

const MAX_EDGE_PX = 480

/** PNG snapshot of the 3D preview as base64 (no data: prefix), or null. */
export function capturePreviewPng(): string | null {
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
    const dataUrl = out.toDataURL("image/png")
    const comma = dataUrl.indexOf(",")
    return comma >= 0 ? dataUrl.slice(comma + 1) : null
  } catch {
    return null
  }
}
