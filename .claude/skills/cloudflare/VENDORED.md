# Vendored from cloudflare/skills

Subset of the official [Cloudflare Agent Skills](https://github.com/cloudflare/skills)
(Apache-2.0), installed per Cloudflare's agent setup guide
(https://developers.cloudflare.com/agent-setup/).

Included: `SKILL.md` plus the references relevant to this project's deployment
(Workers static assets via wrangler): `wrangler`, `static-assets`, `workers`, `pages`.
Other references named in SKILL.md (d1, durable-objects, workers-ai, …) are not
vendored — reinstall from the upstream repo if this project starts using them:

```
npx skills add https://github.com/cloudflare/skills
```
