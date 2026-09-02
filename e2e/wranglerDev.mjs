/**
 * One `wrangler dev --local` lifecycle for the harnesses that need the real
 * Worker (worker-smoke, pairing). Three guarantees the harnesses used to
 * lack:
 *  - a port already answering (a stale workerd from a killed run) fails
 *    fast with a fix, instead of the suite talking to the wrong process;
 *  - readiness has a hard deadline and fails with the captured wrangler
 *    log, instead of proceeding into a later, undiagnosed hang;
 *  - wrangler and its workerd children die on every exit path — normal
 *    end, thrown error, SIGINT/SIGTERM/SIGHUP, and an outer `timeout` —
 *    because they run in their own process group and the group is killed.
 */
import { spawn } from "node:child_process"
import { connect } from "node:net"
import { constants as osConstants } from "node:os"

const LOG_TAIL = 4000

/** rejects if something already answers on localhost:port */
export const assertPortFree = (port) =>
  new Promise((resolve, reject) => {
    const probe = connect({ port, host: "localhost" })
    probe.setTimeout(1000)
    const free = () => {
      probe.destroy()
      resolve()
    }
    probe.once("connect", () => {
      probe.destroy()
      reject(
        new Error(
          `port ${port} is already in use — a stale wrangler/workerd from an earlier run? ` +
            `Free it with: pkill -f "[w]orkerd serve"`
        )
      )
    })
    probe.once("error", free)
    probe.once("timeout", free)
  })

/**
 * Spawn `wrangler dev --port <port> --local <extraArgs>` in its own process
 * group and resolve once `ready(response)` holds for a fetch of the base
 * URL. Resolves to { log(), stop() }.
 */
export async function startWrangler({ port, extraArgs = [], readyTimeoutMs = 60_000, ready = (res) => res.status < 500 }) {
  await assertPortFree(port)
  const child = spawn("npx", ["wrangler", "dev", "--port", String(port), "--local", ...extraArgs], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  let log = ""
  const capture = (d) => (log = (log + d).slice(-LOG_TAIL))
  child.stdout.on("data", capture)
  child.stderr.on("data", capture)
  let exited = false
  child.once("exit", () => (exited = true))

  const killGroup = (signal) => {
    if (exited) return
    try {
      process.kill(-child.pid, signal)
    } catch {
      /* already gone */
    }
  }
  const onExit = () => killGroup("SIGKILL")
  const onSignal = (signal) => {
    killGroup("SIGTERM")
    process.exit(128 + osConstants.signals[signal])
  }
  process.on("exit", onExit)
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, onSignal)

  const stop = async () => {
    process.off("exit", onExit)
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(s, onSignal)
    if (exited) return
    killGroup("SIGTERM")
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        killGroup("SIGKILL")
        resolve()
      }, 3000)
      child.once("exit", () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  const deadline = Date.now() + readyTimeoutMs
  const base = `http://localhost:${port}`
  while (Date.now() < deadline && !exited) {
    try {
      if (ready(await fetch(base))) return { log: () => log, stop }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  await stop()
  throw new Error(
    `wrangler dev on :${port} ${exited ? "exited" : `not ready after ${readyTimeoutMs / 1000}s`}\n--- wrangler log ---\n${log}`
  )
}
