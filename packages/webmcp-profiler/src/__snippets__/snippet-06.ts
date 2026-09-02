export {}
import { maybeAttachProfiler } from "webmcp-profiler/attach"

maybeAttachProfiler({ allow: () => import.meta.env.DEV || location.search.includes("perf=") })
