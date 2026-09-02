function v(r, o) {
  const x = o.location ?? "document", w = o.async !== !1, n = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map(), a = [], l = /* @__PURE__ */ new Map(), _ = r.location?.origin ?? "null", T = () => {
    o.mirror && (r[o.mirror] = Object.fromEntries(n));
  }, m = (e) => {
    T();
    for (const t of l.get(e) ?? []) t();
  }, d = (e) => w ? new Promise((t) => setTimeout(() => t(e), 2)) : Promise.resolve(e), f = (e) => {
    n.has(e) && (n.delete(e), c.delete(e), m("toolchange"));
  }, b = (e, t) => {
    n.set(e.name, e), t ? (c.set(e.name, t), t.addEventListener("abort", () => {
      c.get(e.name) === t && f(e.name);
    }, { once: !0 })) : c.delete(e.name), m("toolchange");
  }, s = {
    addEventListener: (e, t) => {
      l.has(e) || l.set(e, /* @__PURE__ */ new Set()), l.get(e).add(t);
    },
    removeEventListener: (e, t) => l.get(e)?.delete(t)
  };
  o.legacy ? (s.provideContext = (e) => {
    a.push({ method: "provideContext" }), n.clear();
    for (const t of e?.tools ?? []) n.set(t.name, t);
    m("toolchange");
  }, s.clearContext = () => {
    a.push({ method: "clearContext" }), n.clear(), m("toolchange");
  }) : (s.registerTool = (e, t) => (a.push({
    method: "registerTool",
    name: e?.name,
    options: t
  }), !e || typeof e.name != "string" ? Promise.reject(/* @__PURE__ */ new TypeError("registerTool: a tool needs a name")) : t?.signal?.aborted ? d(void 0) : d(void 0).then(() => {
    t?.signal?.aborted || b(e, t?.signal);
  })), s.unregisterTool = (e) => (a.push({
    method: "unregisterTool",
    name: e
  }), f(e), d(void 0)), s.getTools = () => d([...n.values()].map((e) => ({
    name: e.name,
    description: e.description,
    inputSchema: e.inputSchema,
    origin: _
  }))), s.executeTool = (e, t, h) => g.call(e.name, t, h).then((u) => JSON.stringify(u)));
  const i = x === "document" ? r.document : x === "navigator" ? r.navigator : r, p = i?.modelContext, g = {
    registry: s,
    tools: n,
    registrations: a,
    call: async (e, t = {}, h = {}) => {
      const u = n.get(e);
      if (!u) throw new Error(`fake host: no tool named ${e}`);
      const C = h.signal ?? new AbortController().signal;
      return u.execute(t, { signal: C });
    },
    descriptors: () => [...n.values()],
    unregister: (e) => f(e),
    uninstall: () => {
      i && (p === void 0 ? delete i.modelContext : i.modelContext = p), o.mirror && delete r[o.mirror], o.expose && delete r[o.expose];
    }
  };
  return o.install !== !1 && i && (i.modelContext = s), o.expose && (r[o.expose] = g), T(), g;
}
function S(r = {}) {
  return v(globalThis, r);
}
var y = `(${v.toString()})(globalThis, { expose: "__webmcpFakeHost", mirror: "__mcpTools" })`;
function E(r = {}) {
  return `(${v.toString()})(globalThis, ${JSON.stringify({
    expose: "__webmcpFakeHost",
    mirror: "__mcpTools",
    ...r
  })})`;
}
export {
  y as FAKE_HOST_INIT_SCRIPT,
  S as createFakeHost,
  E as fakeHostInitScript
};

//# sourceMappingURL=testing.js.map