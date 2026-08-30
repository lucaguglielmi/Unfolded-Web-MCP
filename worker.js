// Redirects www.tryunfolded.com to the apex; every other request falls
// through to the static assets. Needs `run_worker_first` in wrangler.jsonc —
// without it, asset-matching requests are served before this script runs,
// so www would serve the site instead of redirecting.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice("www.".length);
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
