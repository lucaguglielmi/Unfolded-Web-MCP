import { useState } from "react"
import { Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { feedback, isFeedbackMuted, setFeedbackMuted } from "@/lib/feedback"

/** Header speaker button: mutes the interface's sounds and haptics. */
export function FeedbackToggle() {
  const [muted, setMuted] = useState(isFeedbackMuted)

  const toggle = () => {
    const next = !muted
    setFeedbackMuted(next)
    setMuted(next)
    // audible confirmation only when turning feedback ON
    if (!next) feedback("tap")
  }

  const label = muted ? "Unmute interface sounds and haptics" : "Mute interface sounds and haptics"
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={toggle}>
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </Button>
  )
}
