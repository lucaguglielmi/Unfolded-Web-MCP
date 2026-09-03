// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  forgetMintedSecrets,
  isMintedHere,
  readPairingOffer,
  rememberMintedSecret,
  startPairingClipboardWatch,
} from "./pairingOffer"

/**
 * The clipboard offer: narrow enough that prose doesn't trip it, wide
 * enough that everything this app actually emits is recognised — the
 * agent's grouped code in a sentence, the dialog's bare copied code, and
 * a live link with its ?join= token.
 */

beforeEach(() => {
  forgetMintedSecrets()
})

describe("readPairingOffer — codes", () => {
  it("finds the grouped code inside an agent's message, in any language", () => {
    const offer = readPairingOffer(
      "Codice di associazione: UZ7-WR6\n\nSu tryunfolded.com: pulsante connessione → Continue on another screen"
    )
    expect(offer).toEqual({ kind: "code", secret: "UZ7WR6", display: "UZ7-WR6" })
  })

  it("accepts a space as the separator, and lowercase", () => {
    expect(readPairingOffer("the code is uz7 wr6 ok")?.secret).toBe("UZ7WR6")
  })

  it("accepts a bare code when it is the whole clipboard (the copy button's form)", () => {
    expect(readPairingOffer("  K7F3QP \n")?.secret).toBe("K7F3QP")
    expect(readPairingOffer("K7F-3QP")?.secret).toBe("K7F3QP")
  })

  it("never reads a bare six-glyph run out of prose — only the grouped form", () => {
    expect(readPairingOffer("this design is a SQUARE planter")).toBeNull()
  })

  it("rejects the ambiguous glyphs codes never contain", () => {
    // I, L, O, 0 and 1 are not in the alphabet, so these can't be codes
    expect(readPairingOffer("OL1-I0X")).toBeNull()
    expect(readPairingOffer("HELLO0")).toBeNull()
  })

  it("needs a boundary: a code-shaped run inside a longer word is not a code", () => {
    expect(readPairingOffer("XUZ7-WR6Q")).toBeNull()
  })

  it("is null on empty, junk, and plain conversation", () => {
    expect(readPairingOffer("")).toBeNull()
    expect(readPairingOffer("make it 12 cm tall please")).toBeNull()
  })

  it("stops scanning very long text instead of chewing through an article", () => {
    expect(readPairingOffer(`${"lorem ipsum ".repeat(5_000)}UZ7-WR6`)).toBeNull()
  })
})

describe("readPairingOffer — live links", () => {
  const token = "tok_abcdefghijklmnopqrstuvwx"

  it("takes the join token out of a live handoff link", () => {
    const offer = readPairingOffer(
      `Open this: https://tryunfolded.com/?type=tapered&height=120&via=chatgpt&join=${token}`
    )
    expect(offer).toEqual({ kind: "link", secret: token, display: "tryunfolded.com" })
  })

  it("drops the punctuation a link inherits from its sentence", () => {
    expect(readPairingOffer(`Open https://tryunfolded.com/?join=${token}.`)?.secret).toBe(token)
  })

  it("ignores a permanent design link — no ?join=, no offer", () => {
    expect(readPairingOffer("https://tryunfolded.com/?type=tapered&height=120")).toBeNull()
  })

  it("ignores a join value that isn't token-shaped", () => {
    expect(readPairingOffer("https://tryunfolded.com/?join=nope")).toBeNull()
  })

  it("prefers the link when a message carries both", () => {
    const offer = readPairingOffer(`Code UZ7-WR6 or https://tryunfolded.com/?join=${token}`)
    expect(offer?.kind).toBe("link")
  })
})

describe("codes this tab minted", () => {
  it("recognises its own code however it is written back", () => {
    rememberMintedSecret("UZ7WR6")
    expect(isMintedHere("uz7-wr6")).toBe(true)
    expect(isMintedHere("K7F3QP")).toBe(false)
  })

  it("remembers tokens verbatim", () => {
    rememberMintedSecret("tok_abcdefghijklmnopqrstuvwx")
    expect(isMintedHere("tok_abcdefghijklmnopqrstuvwx")).toBe(true)
  })

  it("survives a reload inside the code's lifetime", () => {
    rememberMintedSecret("UZ7WR6")
    // a fresh page: the in-memory cache is gone, session storage is not
    forgetMintedSecretsCacheOnly()
    expect(isMintedHere("UZ7-WR6")).toBe(true)
  })
})

/** drop the module's cache the way a reload would, keeping session storage */
function forgetMintedSecretsCacheOnly(): void {
  const stored = window.sessionStorage.getItem("unfolded:minted-secrets:v1")
  forgetMintedSecrets()
  if (stored) window.sessionStorage.setItem("unfolded:minted-secrets:v1", stored)
}

describe("startPairingClipboardWatch", () => {
  const paste = (text: string, target: EventTarget = document.body) => {
    const event = new Event("paste", { bubbles: true }) as Event & {
      clipboardData: { getData: () => string }
    }
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } })
    target.dispatchEvent(event)
  }

  it("offers what was pasted onto the page", () => {
    const onOffer = vi.fn()
    const stop = startPairingClipboardWatch({ onOffer, readClipboard: async () => null })
    paste("Pairing code: UZ7-WR6 — valid 15 minutes")
    expect(onOffer).toHaveBeenCalledWith({ kind: "code", secret: "UZ7WR6", display: "UZ7-WR6" })
    stop()
  })

  it("offers each secret once, however often it is pasted", () => {
    const onOffer = vi.fn()
    const stop = startPairingClipboardWatch({ onOffer, readClipboard: async () => null })
    paste("UZ7-WR6")
    paste("UZ7-WR6")
    expect(onOffer).toHaveBeenCalledTimes(1)
    stop()
  })

  it("stays out of the way when the paste lands in a field", () => {
    const onOffer = vi.fn()
    const stop = startPairingClipboardWatch({ onOffer, readClipboard: async () => null })
    const input = document.createElement("input")
    document.body.append(input)
    paste("UZ7-WR6", input)
    expect(onOffer).not.toHaveBeenCalled()
    input.remove()
    stop()
  })

  it("never offers this tab's own code back to it", () => {
    rememberMintedSecret("UZ7WR6")
    const onOffer = vi.fn()
    const stop = startPairingClipboardWatch({ onOffer, readClipboard: async () => null })
    paste("UZ7-WR6")
    expect(onOffer).not.toHaveBeenCalled()
    stop()
  })

  it("reads the clipboard on focus when that read is allowed to be silent", async () => {
    const onOffer = vi.fn()
    const stop = startPairingClipboardWatch({
      onOffer,
      readClipboard: async () => "UZ7-WR6",
    })
    await vi.waitFor(() => expect(onOffer).toHaveBeenCalledTimes(1))
    stop()
  })

  it("a clipboard that refuses to be read is simply no offer", async () => {
    const onOffer = vi.fn()
    const stop = startPairingClipboardWatch({
      onOffer,
      readClipboard: () => Promise.reject(new Error("NotAllowedError")),
    })
    window.dispatchEvent(new Event("focus"))
    await Promise.resolve()
    expect(onOffer).not.toHaveBeenCalled()
    stop()
  })

  it("stops listening when stopped", () => {
    const onOffer = vi.fn()
    startPairingClipboardWatch({ onOffer, readClipboard: async () => null })()
    paste("UZ7-WR6")
    expect(onOffer).not.toHaveBeenCalled()
  })
})
