# Folio

A private article reader and news-collection API with a React interface. Extract
articles, collect daily feed links, and save Markdown or JSON for people and agents.
Built with React 19, TypeScript, TanStack Start, Tailwind CSS and Nitro.

## Getting started

Use **Node.js 24.20.0** and npm. From the repository root:

```sh
npm ci  # First checkout only; skip if dependencies are already installed
export ACCESS_HASH="$(openssl rand -hex 32)"
sh startup.sh
```

Open <http://localhost:8080>, enter an article URL and use `ACCESS_HASH` as the access
key. Reuse the same key across restarts to keep clients working. The home page's
**API documentation** control opens authenticated Swagger at `/api/docs`;
`/api/openapi` serves its specification.

See [`.env.example`](.env.example) for settings. Keep `VITE_AUTH_ENABLED=false` and
`DATABASE_URL` unset. `ACCESS_HASH` still protects private APIs; never commit it or
put it in a `VITE_` variable. Export other server settings before starting development;
see [environment loading](deployment.md#local-release-verification).

## Operating essentials

- Daily collection uses only the ten publisher Main feeds. Other catalog entries
  are available through explicit [selective fetching](scripts/selective-feeds.md).
- Link reports are versioned JSON; saved articles default to Markdown.
- Extraction depends on third-party services; availability and completeness vary.
- Render Free stores articles, reports and jobs in temporary files under `output/`.
  Sleep, restart or redeployment can erase them. Archive important output separately;
  interrupted jobs do not resume automatically. No database or account system is configured.

## Documentation

- [Reference](REFERENCE.md): full usage, retrieval order, proxy setup, API map,
  feed-summary rules and development commands.
- [Deployment](deployment.md): Render setup, limits, history import and release checks.
- [Agent instructions](AGENTS.md): repository contract and editing/verification rules.
- [Documentation index](docs/README.md): workflow guides, portable skills and historical material.
