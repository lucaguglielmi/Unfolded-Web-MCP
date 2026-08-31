import { useRef, useState } from "react"
import { Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { feedback, isFeedbackMuted, setFeedbackMuted } from "@/lib/feedback"

/**
 * Header speaker button: mutes the interface's sounds and haptics. Each
 * press flashes a small confirmation chip next to the button — "Haptic &
 * sound on/off" — since a mute's effect is otherwise invisible (silent,
 * by definition).
 */
export function FeedbackToggle() {
  const [muted, setMuted] = useState(isFeedbackMuted)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number>(0)

  const toggle = () => {
    const next = !muted
    setFeedbackMuted(next)
    setMuted(next)
    // audible confirmation only when turning feedback ON
    if (!next) feedback("tap")
    setNotice(next ? "Haptic & sound off" : "Haptic & sound on")
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 1600)
  }

  const label = muted ? "Unmute interface sounds and haptics" : "Mute interface sounds and haptics"
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={toggle}>
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
      {notice && (
        <span
          role="status"
          className="rise-in bg-background text-muted-foreground absolute top-full right-0 z-50 mt-1.5 rounded-md border px-2 py-1 text-[11px] whitespace-nowrap shadow-sm"
        >
          {notice}
        </span>
      )}
    </div>
  )
}
