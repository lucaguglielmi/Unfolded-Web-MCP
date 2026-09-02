export {}
import { maybeAttachProfilerLazy } from "webmcp-profiler/attach-lazy"

maybeAttachProfilerLazy().then((profiler) => profiler?.overlay())
