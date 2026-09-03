// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HIDDEN_POLL_MS, HOST_POLL_MS, startHostWatch } from "./hostWatch"

/**
 * docs/webmcp-tool-performance-spec.md §7: the host watch never slows
 * down and never stops — 500 ms for the life of a visible tab, 3 s while
 * hidden, and an immediate re-check on focus/visibility.
 */
describe("host watch", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("polls a visible document every 500 ms, long past the first 15 s", () => {
    const attempt = vi.fn()
    const stop = startHostWatch({ attempt, isHidden: () => false })
    vi.advanceTimersByTime(15_000)
    expect(attempt).toHaveBeenCalledTimes(15_000 / HOST_POLL_MS)
    // the interval did not change after the old 15 s window
    vi.advanceTimersByTime(60_000)
    expect(attempt).toHaveBeenCalledTimes(75_000 / HOST_POLL_MS)
    stop()
    vi.advanceTimersByTime(10_000)
    expect(attempt).toHaveBeenCalledTimes(75_000 / HOST_POLL_MS)
  })

  it("keeps polling a hidden document, at the slow rate", () => {
    const attempt = vi.fn()
    const stop = startHostWatch({ attempt, isHidden: () => true })
    vi.advanceTimersByTime(HIDDEN_POLL_MS - HOST_POLL_MS)
    expect(attempt).not.toHaveBeenCalled()
    vi.advanceTimersByTime(HOST_POLL_MS)
    expect(attempt).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(HIDDEN_POLL_MS * 9)
    expect(attempt).toHaveBeenCalledTimes(10)
    stop()
  })

  it("re-checks immediately on visibilitychange and focus", () => {
    const attempt = vi.fn()
    const stop = startHostWatch({ attempt, isHidden: () => true })
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event("focus"))
    expect(attempt).toHaveBeenCalledTimes(2)
    stop()
    document.dispatchEvent(new Event("visibilitychange"))
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it("follows visibility as it changes", () => {
    let hidden = false
    const attempt = vi.fn()
    const stop = startHostWatch({ attempt, isHidden: () => hidden })
    vi.advanceTimersByTime(HOST_POLL_MS * 4)
    expect(attempt).toHaveBeenCalledTimes(4)
    hidden = true
    vi.advanceTimersByTime(HOST_POLL_MS * 4)
    expect(attempt).toHaveBeenCalledTimes(4)
    hidden = false
    vi.advanceTimersByTime(HOST_POLL_MS)
    expect(attempt).toHaveBeenCalledTimes(5)
    stop()
  })
})
